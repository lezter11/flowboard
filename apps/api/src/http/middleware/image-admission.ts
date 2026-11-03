import type { Context, MiddlewareHandler } from 'hono';
import { authMiddleware } from './auth.ts';
import { bodyLimitFor, DEFAULT_BODY_LIMIT_BYTES } from './limits.ts';
import { HttpError } from '../errors.ts';
import { assertImageWorkActive, imageAdmissionUnavailable, withImageAdmission } from '../../services/image-admission.ts';

export const IMAGE_BODY_READ_DEADLINE_MS = 5_000;
export function isImageMemoryWrite(method: string, path: string): boolean {
  return method === 'PUT' && /^\/api\/v1\/image-uploads\/[^/]+\/content$/.test(path)
    || method === 'POST' && /^\/api\/v1\/image-uploads\/[^/]+\/finalize$/.test(path);
}

async function readBoundedBody(
  c: Context,
  maxBytes: number,
  deadlineMs: number,
  retainCleanup: () => () => void,
): Promise<void> {
  const body = c.req.raw.body;
  if (!body) return;
  const signal = c.req.raw.signal;
  const reader = body.getReader();
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort!: () => void;
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reading = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (stopped) throw imageAdmissionUnavailable();
      assertImageWorkActive();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw HttpError.payloadTooLarge('The request is too large.');
      chunks.push(value);
    }
  })();
  // Retain the actual read and cancellation lifetimes even if Promise.race returns.
  const releaseRead = retainCleanup();
  void reading.then(releaseRead, releaseRead);
  const interrupted = new Promise<never>((_, reject) => {
    abort = () => reject(imageAdmissionUnavailable());
    timer = setTimeout(abort, deadlineMs);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    await Promise.race([reading, interrupted]);
    assertImageWorkActive();
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    chunks.length = 0;
    const headers = new Headers(c.req.raw.headers);
    headers.delete('transfer-encoding');
    headers.set('content-length', String(total));
    c.req.raw = new Request(c.req.raw, { headers, body: bytes, duplex: 'half' } as RequestInit);
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    const releaseCancel = retainCleanup();
    // cancel() may invoke an uncooperative source; do not await it before replying.
    const settled = () => {
      try { reader.releaseLock(); }
      catch { /* The runtime may already have released it. */ }
      finally { releaseCancel(); }
    };
    void reader.cancel().then(settled, settled);
    chunks.length = 0;
  }
}

export function imageAdmissionMiddleware(
  defaultBodyBytes = DEFAULT_BODY_LIMIT_BYTES,
  bodyDeadlineMs = IMAGE_BODY_READ_DEADLINE_MS,
  onLifetime?: (work: Promise<void>) => void,
): MiddlewareHandler {
  return async (c, next) => {
    if (!isImageMemoryWrite(c.req.method, c.req.path)) return next();
    // Verify the cookie, rather than accepting cookie-shaped input for the large cap.
    return authMiddleware(c, async () => {
      try {
        let waitUntil: ((work: Promise<void>) => void) | undefined;
        try {
          const ctx = c.executionCtx;
          waitUntil = work => ctx.waitUntil(work);
        } catch { /* Node and mounted tests have no Worker execution context. */ }
        await withImageAdmission(c.req.raw.signal, async retainCleanup => {
          const max = bodyLimitFor(c.req.method, c.req.path, c.req.header('cookie'), defaultBodyBytes);
          await readBoundedBody(c, max, bodyDeadlineMs, retainCleanup);
          assertImageWorkActive();
          await next();
        }, work => {
          waitUntil?.(work);
          onLifetime?.(work);
        });
      } catch (error) {
        if (error instanceof HttpError && error.status === 503) c.header('Retry-After', '1');
        throw error;
      }
    });
  };
}
