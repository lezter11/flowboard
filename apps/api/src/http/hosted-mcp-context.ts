import type pg from 'pg';
import type { HostedOAuthPrincipal } from '../adapters/hosted-oauth.ts';
import { matchPersonalAccessTokenRoute } from './middleware/token-policy.ts';

interface HostedMcpContext { principal: HostedOAuthPrincipal; pool: pg.Pool }
const contexts = new WeakMap<Request, HostedMcpContext>();

/** Public HTTP headers, serialized Requests and clones cannot create this identity. */
export function readHostedMcpContext(request: Request): HostedMcpContext | undefined {
  return contexts.get(request);
}

export async function dispatchHostedMcpRequest(
  dispatch: (request: Request) => Promise<Response>, request: Request,
  principal: HostedOAuthPrincipal, pool: pg.Pool,
): Promise<Response> {
  const url = new URL(request.url);
  const matched = matchPersonalAccessTokenRoute(request.method, url.pathname);
  if (!matched || url.origin !== new URL(principal.resource).origin || !principal.scopes.includes(matched.policy.scope)) {
    return Response.json({ error: { code: 'TOKEN_OPERATION_FORBIDDEN', message: 'MCP operation is not permitted.' } }, { status: 403 });
  }
  const headers = new Headers({ Accept: 'application/json' });
  for (const name of ['content-type', 'idempotency-key']) {
    const value = request.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  // Workers supports only follow/manual on Request construction. This is an
  // in-process call: manual never follows Location, and the client rejects3xx.
  const internal = new Request(request, { headers, redirect: 'manual' });
  contexts.set(internal, { principal, pool });
  try { return await dispatch(internal); }
  finally { contexts.delete(internal); }
}
