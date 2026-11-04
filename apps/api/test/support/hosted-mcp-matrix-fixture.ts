import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import type pg from 'pg';
import type { createApp } from '../../src/http/app.ts';
import { verifyHostedAccessToken } from '../../src/adapters/hosted-oauth.ts';

/** Genuine mounted OAuth state; no fabricated request/code/connection identifiers. */
export async function hostedMcpMatrixFixture(app: ReturnType<typeof createApp>, pool: pg.Pool,
  actor: { user: { id: string }; session: { id: string } }, projectId: string) {
  const origin = 'http://localhost', root = '/api/v1/mcp', callback = 'https://claude.ai/api/mcp/auth_callback';
  const cookie = `flowboard_session=${actor.session.id}`;
  const verifier = 'a'.repeat(64), challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const scopes = 'projects:read boards:read cards:read cards:create offline_access';
  const call = (path: string, init?: RequestInit) => app.request(origin + path, init);
  const json = (response: Response): Promise<any> => response.json();
  const registered = await call(root + '/oauth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_name: 'Synthetic matrix client', redirect_uris: [callback], token_endpoint_auth_method: 'none' }) });
  assert.equal(registered.status, 201, 'OAuth matrix requires genuine client registration');
  const clientId = (await json(registered)).client_id as string;
  const authorizeQuery = { client_id: clientId, redirect_uri: callback, resource: origin + root,
    response_type: 'code', code_challenge_method: 'S256', code_challenge: challenge, scope: scopes, state: 'matrix-state' };
  async function pending() {
    const start = await call(root + '/oauth/authorize?' + new URLSearchParams(authorizeQuery));
    assert.equal(start.status, 302);
    const requestId = new URL(start.headers.get('Location')!).searchParams.get('request')!;
    assert.match(requestId, /^[A-Za-z0-9_-]{43}$/);
    const bindingCookie = start.headers.get('set-cookie')!.split(';')[0]!;
    const headers = { Cookie: `${cookie}; ${bindingCookie}`, Origin: origin, 'Content-Type': 'application/json' };
    const view = await call(`${root}/authorization-requests/${requestId}`, { headers });
    assert.equal(view.status, 200);
    return { requestId, bindingCookie, headers, csrfToken: (await json(view)).data.csrfToken as string };
  }
  async function code() {
    const request = await pending();
    const approved = await call(`${root}/authorization-requests/${request.requestId}/decision`, { method: 'POST', headers: request.headers,
      body: JSON.stringify({ decision: 'allow', projectId, csrfToken: request.csrfToken }) });
    assert.equal(approved.status, 200);
    const redirect = new URL((await json(approved)).data.redirectUrl);
    assert.equal(redirect.origin, 'https://claude.ai');
    assert.equal(redirect.searchParams.get('state'), 'matrix-state');
    return redirect.searchParams.get('code')!;
  }
  const tokenInput = (value: string) => ({ grant_type: 'authorization_code', client_id: clientId, code: value,
    redirect_uri: callback, resource: origin + root, code_verifier: verifier });
  const redeem = async (input: Record<string, string>) => call(root + '/oauth/token', { method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(input) });
  const firstCode = await code(), exchanged = await redeem(tokenInput(firstCode));
  assert.equal(exchanged.status, 200);
  const token = await json(exchanged) as { access_token: string; refresh_token: string; scope: string };
  const principal = await verifyHostedAccessToken(pool, token.access_token, origin + root);
  assert.ok(principal);
  assert.equal(principal.actor.id, actor.user.id);
  assert.equal(principal.projectId, projectId);
  assert.deepEqual([...principal.scopes].sort(), ['boards:read', 'cards:create', 'cards:read', 'projects:read']);
  const consent = await pending();
  return { origin, root, callback, cookie, clientId, authorizeQuery, verifier, scopes, pending: consent,
    accessToken: token.access_token, refreshToken: token.refresh_token, connectionId: principal.connectionId,
    tokenInput, redeem, code, call };
}
