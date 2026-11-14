import assert from 'node:assert/strict';
import test from 'node:test';
const module = await import('../src/lib/pages-api-proxy.ts').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {} as typeof import('../src/lib/pages-api-proxy.ts');
});
test('service binding preserves canonical public URL and no-store protocol response', async () => {
  assert.ok(module.proxyApiRequest, 'Pages protocol proxy is not implemented');
  const raw = new Request('https://flowboard.example/.well-known/oauth-protected-resource/api/v1/mcp');
  let seen = '';
  const response = await module.proxyApiRequest(raw, { API: { fetch: async request => { seen = request.url; assert.equal(request.redirect, 'manual'); return Response.json({ resource: 'https://flowboard.example/api/v1/mcp' }); } } });
  assert.equal(seen, raw.url);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).resource, 'https://flowboard.example/api/v1/mcp');
});
test('protocol without a service binding fails honestly rather than rewriting the canonical host', async () => {
  assert.ok(module.proxyApiRequest, 'Pages protocol proxy is not implemented');
  for (const route of ['/api/v1/mcp', '/api/v1/mcp/connections', '/.well-known/oauth-authorization-server']) {
    const response = await module.proxyApiRequest(new Request('https://flowboard.example' + route), { API_ORIGIN: 'https://internal-worker.example' });
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('native Node imports every proxy entrypoint and executes its public-URL binding path', async () => {
  const entries: ReadonlyArray<readonly [string, string]> = [
    ['../functions/api/[[path]].ts', '/api/v1/mcp/connections'],
    ['../functions/.well-known/oauth-authorization-server.ts', '/.well-known/oauth-authorization-server'],
    ['../functions/.well-known/oauth-protected-resource.ts', '/.well-known/oauth-protected-resource'],
    ['../functions/.well-known/oauth-protected-resource/api/v1/mcp.ts', '/.well-known/oauth-protected-resource/api/v1/mcp'],
  ];
  for (const [entryPath, pathname] of entries) {
    const entry = await import(entryPath);
    const url = `https://flowboard.example${pathname}`;
    const response = await entry.onRequest({ request: new Request(url), env: { API: {
      fetch: async (request: Request) => Response.json({ forwardedUrl: request.url }),
    } } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal((await response.json()).forwardedUrl, url);
  }
});


test('canonical Pages health is anonymous, read-only and uses its Worker binding', async () => {
  const { onRequest } = await import('../functions/_middleware.ts');
  const seen: Request[] = [];
  const env = { API: { fetch: async (request: Request) => {
    seen.push(request);
    return new Response(request.method === 'HEAD' ? null : '{"data":{"status":"ready"}}', { status: 200 });
  } } };
  const next = async () => { throw new Error('Health must never fall through to a page'); };
  const origin = 'https://flowboard-app.pages.dev';
  const request = new Request(`${origin}/health/ready?ignored=1`, { headers: { Cookie: 'session=synthetic', Authorization: 'Bearer synthetic' } });
  const response = await onRequest({ request, env, next });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(seen[0]?.url, `${origin}/health/ready`);
  assert.equal(seen[0]?.headers.has('cookie'), false);
  assert.equal(seen[0]?.headers.has('authorization'), false);
  assert.equal((await onRequest({ request: new Request(`${origin}/health/live`, { method: 'HEAD' }), env, next })).status, 200);
  const post = await onRequest({ request: new Request(`${origin}/health/live`, { method: 'POST' }), env, next });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal((await onRequest({ request, env: {}, next })).status, 503);
  assert.equal(seen.length, 2);
});

test('Pages Functions apply HSTS to HTTPS redirects and API responses while preserving cookies', async () => {
  const { onRequest } = await import('../functions/_middleware.ts');
  const origin = 'https://flowboard.example';
  const hsts = 'max-age=31536000';
  const next = async () => {
    const response = Response.redirect(`${origin}/projects`, 302);
    const headers = new Headers(response.headers);
    headers.append('Set-Cookie', 'test-one=expired; Max-Age=0; Path=/');
    headers.append('Set-Cookie', 'test-two=synthetic; Path=/; HttpOnly');
    return new Response(null, { status: response.status, headers });
  };
  const landing = await onRequest({ request: new Request(origin), env: {}, next });
  assert.equal(landing.headers.get('location'), '/signin');
  assert.equal(landing.headers.get('strict-transport-security'), hsts);
  const request = new Request(`${origin}/api/v1/auth/google/callback`);
  const callback = await onRequest({ request, env: {}, next });
  assert.equal(callback.status, 302);
  assert.equal(callback.headers.get('location'), `${origin}/projects`);
  assert.equal(callback.headers.get('strict-transport-security'), hsts);
  assert.equal(callback.headers.getSetCookie().length, 2);
  const http = await onRequest({ request: new Request(request.url.replace('https:', 'http:')), env: {}, next });
  assert.equal(http.headers.has('strict-transport-security'), false);
});
