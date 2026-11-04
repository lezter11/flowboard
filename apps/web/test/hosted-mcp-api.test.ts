import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError } from '../src/lib/api.ts';

const module = await import('../src/lib/hosted-mcp-api.ts').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error;
  return {} as typeof import('../src/lib/hosted-mcp-api.ts');
});
const handle = 'a'.repeat(43);

test('consent fetch stays same-origin/no-store and maps OAuth refusal without rendering server diagnostics', async () => {
  assert.ok(module.hostedMcpApi, 'Hosted consent API is not implemented');
  const original = globalThis.fetch;
  let requested = '';
  globalThis.fetch = async (url, init) => {
    requested = String(url);
    assert.equal(init?.credentials, 'same-origin');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.redirect, 'error');
    return Response.json({ error: 'invalid_request', diagnostic: 'PRIVATE-SERVER-DIAGNOSTIC' }, { status: 404 });
  };
  try {
    await assert.rejects(module.hostedMcpApi.authorization(handle), error => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'MCP_REQUEST_UNAVAILABLE');
      assert.doesNotMatch(String(error), /PRIVATE/);
      return true;
    });
    assert.equal(requested, `/api/v1/mcp/authorization-requests/${handle}`);
  } finally { globalThis.fetch = original; }
});

test('strict connection response refuses unexpected credential fields instead of caching them', async () => {
  assert.ok(module.hostedMcpApi, 'Hosted consent API is not implemented');
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: [], access_token: 'PRIVATE' });
  try { await assert.rejects(module.hostedMcpApi.connections(), error => error instanceof ApiError && error.code === 'MCP_INVALID_RESPONSE' && !String(error).includes('PRIVATE')); }
  finally { globalThis.fetch = original; }
});

test('response deadline remains active while the response body is unfinished', async t => {
  const original = globalThis.fetch;
  let signal: AbortSignal | null = null;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.fetch = async (_url, init) => {
    signal = init?.signal ?? null;
    return new Response(new ReadableStream({ start(controller) { signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError'))); } }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    const pending = module.hostedMcpApi.connections();
    const failure = pending.catch(error => error);
    await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(15_000);
    assert.equal((signal as AbortSignal | null)?.aborted, true);
    const error = await failure;
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 0);
  } finally { globalThis.fetch = original; t.mock.timers.reset(); }
});

test('disconnect refuses an unexpected successful status instead of claiming revocation', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ data: { success: true } });
  try { await assert.rejects(module.hostedMcpApi.disconnect('connection_1'), error => error instanceof ApiError && error.code === 'MCP_INVALID_RESPONSE'); }
  finally { globalThis.fetch = original; }
});

test('disconnect sends only an authenticated same-origin DELETE and accepts empty 204', async () => {
  assert.ok(module.hostedMcpApi, 'Hosted consent API is not implemented');
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/v1/mcp/connections/connection_1');
    assert.equal(init?.method, 'DELETE');
    assert.equal(init?.body, undefined);
    return new Response(null, { status: 204 });
  };
  try { assert.equal(await module.hostedMcpApi.disconnect('connection_1'), undefined); }
  finally { globalThis.fetch = original; }
});
