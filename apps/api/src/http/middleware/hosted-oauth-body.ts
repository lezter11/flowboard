import type { MiddlewareHandler } from 'hono';
import { HostedOAuthError } from '../../adapters/hosted-oauth.ts';

const MAX_BYTES = 16 * 1024;
const MAX_DEADLINE_MS = 5_000;
interface BodyState { signal: AbortSignal; timedOut: () => boolean; text?: string; }
const bodies = new WeakMap<Request, BodyState>();

/** Only implemented OAuth/consent POST handlers own this smaller body budget. */
export function isHostedOAuthBodyRequest(method: string, path: string): boolean {
  return method === 'POST' && (
    /^\/api\/v1\/mcp\/oauth\/(register|token|revoke)$/.test(path)
    || /^\/api\/v1\/mcp\/authorization-requests\/[^/]+\/decision$/.test(path)
  );
}

function interrupted(state: BodyState): HostedOAuthError {
  return state.timedOut()
    ? new HostedOAuthError('temporarily_unavailable', 504)
    : new HostedOAuthError('invalid_request');
}

async function readBounded(request: Request, state: BodyState): Promise<string> {
  if (state.signal.aborted) {
    void request.body?.cancel().catch(() => {});
    throw interrupted(state);
  }
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BYTES)) {
    void request.body?.cancel().catch(() => {});
    throw new HostedOAuthError('invalid_request', 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new HostedOAuthError('invalid_request');
  let stopped = false;
  let completed = false;
  let abort!: () => void;
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => {
      stopped = true;
      // A source's cancel promise can itself stall. It must not delay the HTTP refusal.
      void reader.cancel().catch(() => {});
      reject(interrupted(state));
    };
    state.signal.addEventListener('abort', abort, { once: true });
  });
  const reading = (async () => {
    let size = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (;;) {
      if (stopped || state.signal.aborted) throw interrupted(state);
      const next = await reader.read();
      if (stopped || state.signal.aborted) throw interrupted(state);
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_BYTES) throw new HostedOAuthError('invalid_request', 413);
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    completed = true;
    return text;
  })();
  // The signal may have fired before listener installation or while acquiring the reader.
  if (state.signal.aborted) abort();
  try {
    return await Promise.race([reading, cancelled]);
  } catch (error) {
    if (error instanceof HostedOAuthError) throw error;
    throw new HostedOAuthError('invalid_request');
  } finally {
    stopped = true;
    state.signal.removeEventListener('abort', abort);
    if (!completed) void reader.cancel().catch(() => {});
    const release = () => { try { reader.releaseLock(); } catch { /* Already released by the runtime. */ } };
    void reading.then(release, release);
  }
}

/** Cached by private Request identity; the route parser never consumes the stream twice. */
export async function readHostedOAuthBody(request: Request): Promise<string> {
  const existing = bodies.get(request);
  if (existing) {
    if (existing.signal.aborted) {
      void request.body?.cancel().catch(() => {});
      throw interrupted(existing);
    }
    if (existing.text !== undefined) return existing.text;
    const text = await readBounded(request, existing);
    existing.text = text;
    return text;
  }
  // Defense in depth for independently mounted route-module harnesses.
  const controller = new AbortController();
  let timedOut = false;
  const forwardAbort = () => controller.abort();
  request.signal.addEventListener('abort', forwardAbort, { once: true });
  if (request.signal.aborted) forwardAbort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, MAX_DEADLINE_MS);
  try { return await readBounded(request, { signal: controller.signal, timedOut: () => timedOut }); }
  finally { clearTimeout(timer); request.signal.removeEventListener('abort', forwardAbort); }
}

function failure(error: HostedOAuthError): Response {
  return Response.json({ error: error.error }, { status: error.status, headers: {
    'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer',
  } });
}

export function hostedOAuthBodyMiddleware(options: {
  deadlineMs: number;
  onWorkLifetime?: (work: Promise<void>) => void;
}): MiddlewareHandler {
  return async (c, next) => {
    if (!isHostedOAuthBodyRequest(c.req.method, c.req.path)) return next();
    const request = c.req.raw;
    const controller = new AbortController();
    let timedOut = false;
    const forwardAbort = () => controller.abort();
    request.signal.addEventListener('abort', forwardAbort, { once: true });
    if (request.signal.aborted) forwardAbort();
    const state: BodyState = { signal: controller.signal, timedOut: () => timedOut };
    bodies.set(request, state);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<Response>(resolve => {
      timer = setTimeout(() => {
        timedOut = true;
        // Resolve the deadline response before reader cancellation unwinds its work.
        resolve(failure(new HostedOAuthError('temporarily_unavailable', 504)));
        controller.abort();
      }, Math.max(1, Math.min(options.deadlineMs, MAX_DEADLINE_MS)));
    });
    const work = (async (): Promise<Response> => {
      try {
        await readHostedOAuthBody(request);
        if (controller.signal.aborted) throw interrupted(state);
        await next();
        return c.res;
      } catch (error) {
        return failure(error instanceof HostedOAuthError ? error : new HostedOAuthError('server_error', 503));
      } finally {
        bodies.delete(request);
        request.signal.removeEventListener('abort', forwardAbort);
      }
    })();
    const lifetime = work.then(() => {});
    c.set('hostedMcpWork', lifetime);
    options.onWorkLifetime?.(lifetime);
    try { return await Promise.race([work, timeout]); }
    finally { if (timer !== undefined) clearTimeout(timer); }
  };
}
