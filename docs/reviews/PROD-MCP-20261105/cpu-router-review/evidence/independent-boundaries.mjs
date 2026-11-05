import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createApp as actual } from './actual-app.mjs';
import { createApp as smart } from './smart-app.mjs';
let queries = 0;
const origin = 'https://router-review.example';
const opts = { pool: { query() { queries++; throw new Error('No database allowed'); } }, storage: null, mcpPublicOrigin: origin,
  rateLimiter: () => ({ limit: async () => ({ success: true }) }), windowCounter: () => ({ consume: async () => ({ count: 1, retryAfterSeconds: 60 }) }) };
const a = actual(async () => {}, opts), b = smart(async () => {}, opts);
const paths = ['/health/live', '/health/live/', '/api/v1/session', '/api/v1/session/', '/api/v1/mcp', '/api/v1/%6dcp', '/api/v1/mcp/', '/api/v1/mcp//', '/api/v1/mcp%2F', '/api/v1/mcp/unknown', '/api/v1/mcp/%', '/api/v1/mcp/%ZZ', '/api/v1/mcp/connections', '/api/v1/mcp/authorization-requests/%', '/api/v1/boards/%ZZ/columns/%2F/placement', '/api//v1/mcp', '/api/v1/mcp/oauth/register/', '/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/api/v1/mcp', '/.well-known/oauth-authorization-server', '/.well-known/oauth-authorization-server/'];
const variants = [{}, { Authorization: 'Bearer malformed' }, { Cookie: 'flowboard_session=synthetic', Origin: 'https://hostile.example' },
  { Cookie: 'session=synthetic', 'Sec-Fetch-Site': 'cross-site' }, { Origin: 'https://claude.ai', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization, Content-Type, MCP-Protocol-Version' }];
const results = [];
for (const pathname of paths) for (const method of ['GET', 'POST', 'DELETE', 'OPTIONS', 'HEAD', 'PUT', 'PATCH']) for (const headers of variants) {
  // A synthetic cookie on a read/auth path would correctly issue a DB lookup. Those flows are covered by the serial real-PG gate.
  if ('Cookie' in headers && !['POST', 'DELETE', 'PUT', 'PATCH', 'OPTIONS'].includes(method)) continue;
  if ('Cookie' in headers && pathname === '/api/v1/mcp/connections' && method === 'OPTIONS') continue;
  const init = { method, headers: { accept: 'application/json, text/event-stream', 'x-request-id': 'independent-router-review', ...headers } };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) { init.body = '{}'; init.headers['content-type'] = 'application/json'; }
  const read = async app => {
    const r = await app.fetch(new Request(origin + pathname, init), { APP_ORIGIN: origin });
    return { status: r.status, body: await r.text(), headers: Object.fromEntries([...r.headers].filter(([name]) => !['server-timing', 'x-response-time'].includes(name))) };
  };
  const expected = await read(b), observed = await read(a);
  assert.deepEqual(observed, expected, JSON.stringify({ pathname, method, headerNames: Object.keys(headers) }));
  results.push({ pathname, method, headerNames: Object.keys(headers), status: observed.status });
}
assert.equal(queries, 0);
let concurrentContexts = 0;
const makeScoped = label => {
  const pool = { label, query() { queries++; throw new Error('No database allowed'); } };
  const limits = { ...opts.limits, marker: label };
  return actual(async () => {}, { ...opts, pool, limits,
    rateLimiter: c => ({ limit: async () => {
      assert.equal(c.get('pool'), pool); assert.equal(c.get('limits'), limits);
      await new Promise(resolve => setTimeout(resolve, label === 'A' ? 2 : 1));
      assert.equal(c.get('pool'), pool); assert.equal(c.get('limits'), limits);
      assert.equal(c.get('actor'), undefined); concurrentContexts++;
      return { success: true };
    } }) });
};
const scoped = [makeScoped('A'), makeScoped('B')];
await Promise.all(Array.from({ length: 64 }, async (_, index) => {
  const response = await scoped[index % 2].request(origin + '/api/v1/unknown', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-request-id': 'context-' + index }, body: '{}',
  });
  assert.equal(response.status, 404); assert.equal(response.headers.get('x-request-id'), 'context-' + index);
}));
assert.equal(concurrentContexts, 64); assert.equal(queries, 0);
const result = { status: 'pass', mountedResponseCases: results.length, differences: 0, databaseCalls: queries, statusBodySecurityHeadersEqual: true, results,
  concurrentDistinctPoolAndLimitsContexts: concurrentContexts,
  limits: 'Synthetic no-DB mounted negative/public boundary differential only. Authenticated authority/concurrency acceptance uses the separate disposable PostgreSQL gate.' };
await fs.writeFile(new URL('./independent-boundaries.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ ...result, results: undefined }));
