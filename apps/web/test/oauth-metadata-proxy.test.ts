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
