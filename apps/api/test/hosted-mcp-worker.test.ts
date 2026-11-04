import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createTestHarness } from 'wrangler';

test('actual workerd serves stateless SDK initialize/list/call/notification with no database or network requester', { timeout: 60_000 }, async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'flowboard-hosted-mcp-transport-'));
  const servicePath = fileURLToPath(new URL('../src/services/hosted-mcp-transport.ts', import.meta.url));
  const main = path.join(dir, 'probe.ts');
  await fs.writeFile(main, `import { handleHostedMcpTransport } from ${JSON.stringify(servicePath)};
export default { async fetch(request) {
  const actor = new URL(request.url).searchParams.get('actor') ?? 'synthetic';
  return handleHostedMcpTransport(request, {
    async listProjects() { return { data: [{ id: actor, name: 'Synthetic', description: null }], nextCursor: null }; },
    async listBoards() { return []; }, async getBoard() { return { id: 'board', columns: [] }; },
    async createCard(input) { return { id: 'card', operationId: input.operationId }; },
    async searchCards() { return { data: [], nextCursor: null }; }
  });
} };`);
  const configPath = path.join(dir, 'wrangler.json');
  await fs.writeFile(configPath, JSON.stringify({ name: 'flowboard-hosted-mcp-transport-test', main,
    compatibility_date: '2026-10-19', compatibility_flags: ['nodejs_compat'] }));
  const harness = createTestHarness({ workers: [{ configPath }] });
  try {
    await harness.listen();
    const worker = harness.getWorker('flowboard-hosted-mcp-transport-test');
    const send = (body: unknown, actor = 'synthetic') => worker.fetch(`https://flowboard-app-uat.pages.dev/api/v1/mcp?actor=${actor}`, {
      method: 'POST', headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify(body),
    });
    const initialize = await send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {
      protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'workerd-fixture', version: '1' },
    } });
    assert.equal(initialize.status, 200);
    assert.equal((await initialize.json() as any).result.protocolVersion, '2025-11-25');
    assert.equal(initialize.headers.get('mcp-session-id'), null);
    assert.equal(initialize.headers.get('set-cookie'), null);
    const notification = await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(notification.status, 202);
    assert.equal(await notification.text(), '');
    const listed = await send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    assert.equal((await listed.json() as any).result.tools.length, 5);
    const call = { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'flowboard_list_projects', arguments: {} } };
    const concurrent = await Promise.all([send(call, 'actor_A'), send(call, 'actor_B')]);
    for (const [index, response] of concurrent.entries()) {
      const body = await response.json() as any;
      assert.equal(body.id, 3);
      assert.equal(JSON.parse(body.result.content[0].text).data[0].id, index === 0 ? 'actor_A' : 'actor_B');
      assert.equal(response.headers.get('cache-control'), 'no-store');
    }
    const created = await send({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'flowboard_create_card', arguments: {
      operationId: '12345678-1234-1234-1234-123456789abc', boardId: 'board', column: 'todo', title: 'Synthetic',
    } } });
    assert.equal(JSON.parse((await created.json() as any).result.content[0].text).operationId, '12345678-1234-1234-1234-123456789abc');
    const batch = await send([{ jsonrpc: '2.0', id: 5, method: 'ping' }]);
    assert.equal(batch.status, 400);
    const oversized = await send({ jsonrpc: '2.0', id: 6, method: 'ping', params: { text: 'x'.repeat(131073) } });
    assert.equal(oversized.status, 413);
    t.diagnostic('Real local workerd + installed SDK; synthetic operations only. OAuth, PostgreSQL, Pages and hosted acceptance are separate.');
  } finally {
    await harness.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
