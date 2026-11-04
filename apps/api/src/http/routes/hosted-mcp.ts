import type { Context } from 'hono';
import { FlowboardOperationsClient } from '@flowboard/mcp/client';
import { verifyHostedAccessToken } from '../../adapters/hosted-oauth.ts';
import { getPool } from '../../adapters/postgres.ts';
import { consumeWindow } from '../../adapters/rate-limit-postgres.ts';
import { WINDOW_BUCKETS, type WindowBucket } from '../../services/rate-limit.ts';
import { getHostedMcpConfig, HOSTED_MCP_PATH } from '../../services/hosted-mcp-config.ts';
import { handleHostedMcpTransport } from '../../services/hosted-mcp-transport.ts';
import { dispatchHostedMcpRequest } from '../hosted-mcp-context.ts';

interface Options {
  publicOrigin?: string;
  deadlineMs: number;
  onWorkLifetime?: (work: Promise<void>) => void;
  dispatch: (request: Request, context: Context) => Promise<Response>;
}

function protocolFailure(status: number, message: string): Response {
  return Response.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, {
    status, headers: { 'Cache-Control': 'no-store', Vary: 'Origin, Accept', 'X-Content-Type-Options': 'nosniff' },
  });
}

async function rate(pool: ReturnType<typeof getPool>, bucket: WindowBucket, key: string): Promise<Response | null> {
  try {
    const config = WINDOW_BUCKETS[bucket];
    const counted = await consumeWindow(pool, bucket, key, config.windowSeconds);
    if (counted.count <= config.limit) return null;
    const response = protocolFailure(429, 'Too many MCP requests. Try again later.');
    response.headers.set('Retry-After', String(counted.retryAfterSeconds));
    return response;
  } catch { return protocolFailure(503, 'MCP rate limit check is unavailable.'); }
}

/** Exact protocol path only: OAuth/consent children retain their own route policy. */
export async function handleHostedMcpRequest(c: Context, options: Options): Promise<Response> {
  const config = getHostedMcpConfig(c, options.publicOrigin);
  const url = new URL(c.req.url);
  const origin = c.req.header('origin');
  const declaredHost = c.req.header('host');
  if (url.origin !== config.origin || (declaredHost !== undefined && declaredHost !== new URL(config.origin).host)) {
    return protocolFailure(403, 'MCP public host is not permitted.');
  }
  if (origin !== undefined && origin !== config.origin && origin !== 'https://claude.ai') {
    return protocolFailure(403, 'MCP origin is not permitted.');
  }
  const decorate = (response: Response): Response => {
    const headers = new Headers(response.headers);
    headers.set('Cache-Control', 'no-store');
    headers.set('Vary', 'Origin, Accept');
    headers.set('X-Content-Type-Options', 'nosniff');
    headers.delete('Set-Cookie');
    headers.delete('Access-Control-Allow-Credentials');
    if (origin !== undefined) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Expose-Headers', 'WWW-Authenticate, Retry-After, MCP-Protocol-Version, X-Request-Id');
    }
    return new Response(response.body, { status: response.status, headers });
  };
  if (c.req.method === 'OPTIONS') {
    const method = c.req.header('access-control-request-method');
    const requested = (c.req.header('access-control-request-headers') ?? '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean);
    const allowed = new Set(['authorization', 'content-type', 'accept', 'mcp-protocol-version']);
    if ((method !== undefined && method !== 'POST') || requested.some(name => !allowed.has(name))) {
      return decorate(protocolFailure(403, 'MCP preflight is not permitted.'));
    }
    const response = new Response(null, { status: 204, headers: {
      Allow: 'POST, OPTIONS', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type, Accept, MCP-Protocol-Version', 'Access-Control-Max-Age': '600',
    } });
    return decorate(response);
  }

  const controller = new AbortController();
  const request = new Request(c.req.raw, { signal: controller.signal });
  const run = async (): Promise<Response> => {
    const credential = /^Bearer (flw_mcp_access_[a-f0-9]{64})$/i.exec(request.headers.get('authorization') ?? '');
    const pool = getPool(c);
    const principal = credential ? await verifyHostedAccessToken(pool, credential[1]!, config.resource) : null;
    if (!principal) {
      const response = protocolFailure(401, 'A valid OAuth MCP access token is required.');
      response.headers.set('WWW-Authenticate', `Bearer resource_metadata="${config.origin}/.well-known/oauth-protected-resource${HOSTED_MCP_PATH}"`);
      return response;
    }
    const limited = await rate(pool, 'mcp-protocol', principal.connectionId);
    if (limited) return limited;
    const operations = new FlowboardOperationsClient(async (path, init) => {
      if (init.method === 'POST') {
        const denied = await rate(pool, 'mcp-create', principal.connectionId);
        if (denied) return denied;
      }
      return dispatchHostedMcpRequest(
        internal => options.dispatch(internal, c), new Request(new URL(path, config.origin), { ...init, redirect: 'manual' }), principal, pool,
      );
    });
    return handleHostedMcpTransport(request, operations);
  };
  const work = run().catch(() => protocolFailure(503, 'MCP service is temporarily unavailable.'));
  const lifetime = work.then(() => {});
  c.set('hostedMcpWork', lifetime);
  options.onWorkLifetime?.(lifetime);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Response>(resolve => {
    timer = setTimeout(() => {
      controller.abort(); // Cancels a slow body reader; a begun DB transaction still settles normally.
      resolve(protocolFailure(504, 'MCP request timed out. Retry a create only with the same operationId and input.'));
    }, options.deadlineMs);
  });
  try { return decorate(await Promise.race([work, timeout])); }
  finally { if (timer !== undefined) clearTimeout(timer); }
}
