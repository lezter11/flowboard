import assert from 'node:assert/strict';
import test from 'node:test';
import { handleHostedMcpTransport } from '../src/services/hosted-mcp-transport.ts';
import type { FlowboardMcpOperations } from '@flowboard/mcp/server';

const endpoint = 'https://flowboard-app-uat.pages.dev/api/v1/mcp';
const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json', 'mcp-protocol-version': '2025-11-25' };
const operations: FlowboardMcpOperations = {
  async listProjects() { return { data: [{ id: 'project', name: 'Synthetic', description: null }], nextCursor: null }; },
  async listBoards() { return []; },
  async getBoard() { return { id: 'board', columns: [] }; },
  async createCard(input) { return { id: 'card', operationId: input.operationId }; },
  async searchCards() { return { data: [], nextCursor: null }; },
};
const request = (message: unknown, overrides?: RequestInit) => new Request(endpoint, {
  method: 'POST', headers, body: JSON.stringify(message), ...overrides,
});
const rpc = (method: string, id = 1, params?: unknown) => ({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

test('hosted transport initializes without a session, accepts initialized notification and lists exactly five tools', async () => {
  const initialized = await handleHostedMcpTransport(request(rpc('initialize', 1, {
    protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'synthetic', version: '1' },
  })), operations);
  assert.equal(initialized.status, 200);
  const init = await initialized.json() as any;
  assert.equal(init.result.protocolVersion, '2025-11-25');
  assert.equal(initialized.headers.get('mcp-session-id'), null);
  assert.equal(initialized.headers.get('set-cookie'), null);
  assert.equal(initialized.headers.get('cache-control'), 'no-store');
  assert.match(initialized.headers.get('vary')!, /Accept/i);
  assert.match(initialized.headers.get('vary')!, /Origin/i);
  const notification = await handleHostedMcpTransport(request({ jsonrpc: '2.0', method: 'notifications/initialized' }), operations);
  assert.equal(notification.status, 202);
  assert.equal(await notification.text(), '');
  const listed = await handleHostedMcpTransport(request(rpc('tools/list')), operations);
  const names = ((await listed.json() as any).result.tools as Array<{ name: string }>).map(tool => tool.name);
  assert.deepEqual(names, ['flowboard_list_projects', 'flowboard_list_boards', 'flowboard_get_board_columns', 'flowboard_create_card', 'flowboard_search_cards']);
});

test('tool calls validate input and unexpected operation errors cannot disclose secrets', async () => {
  let calls = 0;
  const scoped = { ...operations, async createCard() { calls++; throw new Error('synthetic database password'); } };
  const input = { operationId: '12345678-1234-1234-1234-123456789abc', boardId: 'board', column: 'todo', title: 'Synthetic' };
  const invalid = await handleHostedMcpTransport(request(rpc('tools/call', 1, { name: 'flowboard_create_card', arguments: { ...input, operationId: '' } })), scoped);
  assert.equal((await invalid.json() as any).result.isError, true);
  assert.equal(calls, 0);
  const failed = await handleHostedMcpTransport(request(rpc('tools/call', 2, { name: 'flowboard_create_card', arguments: input })), scoped);
  const text = await failed.text();
  assert.equal(calls, 1);
  assert.doesNotMatch(text, /database|password|synthetic/);
  assert.match(text, /same operationId and input/);
});

test('independent concurrent requests can reuse a JSON-RPC ID without sharing actor operations', async () => {
  const invoke = (name: string) => handleHostedMcpTransport(request(rpc('tools/call', 7, { name: 'flowboard_list_projects', arguments: {} })), {
    ...operations, async listProjects() { await new Promise(resolve => setTimeout(resolve, name === 'A' ? 8 : 1)); return { actor: name }; },
  });
  const results = await Promise.all([invoke('A'), invoke('B')]);
  for (const [index, response] of results.entries()) {
    const result = await response.json() as any;
    assert.equal(result.id, 7);
    assert.equal(JSON.parse(result.result.content[0].text).actor, index === 0 ? 'A' : 'B');
  }
});

test('transport rejects unsupported methods; preflight belongs to the outer origin/auth boundary', async () => {
  for (const method of ['GET', 'DELETE', 'PATCH', 'OPTIONS']) {
    const response = await handleHostedMcpTransport(new Request(endpoint, { method }), operations);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get('allow'), 'POST, OPTIONS');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('POST negotiates real accepted media types and rejects lookalikes, wildcards and q=0', async () => {
  for (const accept of ['', '*/*', 'application/json', 'text/event-stream', 'application/json-evil, text/event-stream', 'application/json;q=0, text/event-stream', 'application/json, text/event-stream;q=0']) {
    const response = await handleHostedMcpTransport(request(rpc('ping'), { headers: { ...headers, accept } }), operations);
    assert.equal(response.status, 406, accept);
  }
  const accepted = await handleHostedMcpTransport(request(rpc('ping'), { headers: { ...headers, accept: 'Application/JSON; q=0.8, TEXT/EVENT-STREAM; q=1' } }), operations);
  assert.equal(accepted.status, 200);
  assert.deepEqual((await accepted.json() as any).result, {});
});

test('malformed JSON, batches, excessive nesting and invalid content types cannot dispatch tools', async () => {
  for (const contentType of ['text/plain', 'application/json-patch+json', 'application/json-evil']) {
    const response = await handleHostedMcpTransport(request(rpc('ping'), { headers: { ...headers, 'content-type': contentType } }), operations);
    assert.equal(response.status, 415);
  }
  const invalid = await handleHostedMcpTransport(request(null, { body: '{' }), operations);
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json() as any).error.code, -32700);
  for (const message of [[], [rpc('ping')], { ...rpc('ping'), params: JSON.parse('['.repeat(40) + '0' + ']'.repeat(40)) }]) {
    const response = await handleHostedMcpTransport(request(message), operations);
    assert.equal(response.status, 400);
    assert.equal((await response.json() as any).error.code, -32600);
  }
  const version = await handleHostedMcpTransport(request(rpc('ping'), { headers: { ...headers, 'mcp-protocol-version': 'unsupported' } }), operations);
  assert.equal(version.status, 400);
  const unknown = await handleHostedMcpTransport(request(rpc('unknown')), operations);
  assert.equal((await unknown.json() as any).error.code, -32601);
});

test('both declared and streamed bodies are bounded; maximum escaped descriptions remain accepted', async () => {
  for (const mode of ['declared', 'streamed']) {
    const oversized = new Request(endpoint, { method: 'POST', headers: { ...headers, ...(mode === 'declared' ? { 'content-length': '131073' } : {}) },
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('x'.repeat(131073))); controller.close(); } }), duplex: 'half' } as RequestInit);
    const response = await handleHostedMcpTransport(oversized, operations);
    assert.equal(response.status, 413, mode);
  }
  const response = await handleHostedMcpTransport(request(rpc('tools/call', 1, { name: 'flowboard_create_card', arguments: {
    operationId: '12345678-1234-1234-1234-123456789abc', boardId: 'board', column: 'todo', title: 'Synthetic', description: '\u0001'.repeat(20000),
  } })), operations);
  assert.equal(response.status, 200);
  assert.notEqual((await response.json() as any).result.isError, true);
});

test('transport waits for underlying tool work before returning and preserves static errors', async () => {
  let finished = false;
  const response = await handleHostedMcpTransport(request(rpc('tools/call', 1, { name: 'flowboard_list_projects', arguments: {} })), {
    ...operations, async listProjects() { await new Promise(resolve => setTimeout(resolve, 10)); finished = true; return []; },
  });
  assert.equal(finished, true);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('set-cookie'), null);
});

test('an already-aborted unfinished body cancels promptly and never dispatches a tool', async () => {
  const controller = new AbortController();
  controller.abort();
  let cancelled = false;
  let calls = 0;
  const pending = new ReadableStream({ cancel() { cancelled = true; } });
  const response = await handleHostedMcpTransport(new Request(endpoint, { method: 'POST', headers, signal: controller.signal,
    body: pending, duplex: 'half' } as RequestInit), { ...operations, async listProjects() { calls++; return []; } });
  assert.equal(response.status, 400);
  assert.equal(cancelled, true);
  assert.equal(calls, 0);
});
