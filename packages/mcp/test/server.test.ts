import assert from 'node:assert/strict';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createFlowboardMcpServer, type FlowboardMcpOperations } from '../src/server.ts';

const operations: FlowboardMcpOperations = {
  async listProjects() { return { data: [], nextCursor: null }; },
  async listBoards() { return []; },
  async getBoard() { return { id: 'board', columns: [] }; },
  async createCard(input) { return { id: 'card', operationId: input.operationId }; },
  async searchCards() { return { data: [], nextCursor: null }; },
};

test('reusable factory exposes exactly the original five bounded tools and forwards validated input', async () => {
  const calls: unknown[] = [];
  const server = createFlowboardMcpServer({ ...operations, async createCard(input) { calls.push(input); return { id: 'card' }; } });
  const client = new Client({ name: 'factory-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), [
      'flowboard_list_projects', 'flowboard_list_boards', 'flowboard_get_board_columns',
      'flowboard_create_card', 'flowboard_search_cards',
    ]);
    const create = tools.find(tool => tool.name === 'flowboard_create_card')!;
    assert.ok(create.inputSchema.required?.includes('operationId'));
    assert.equal(create.annotations?.idempotentHint, true);
    const result = await client.callTool({ name: 'flowboard_create_card', arguments: {
      operationId: '12345678-1234-1234-1234-123456789abc', boardId: 'board', column: 'todo', title: ' Synthetic ',
    } });
    assert.notEqual(result.isError, true);
    assert.deepEqual(calls, [{ operationId: '12345678-1234-1234-1234-123456789abc', boardId: 'board', column: 'todo',
      title: 'Synthetic', description: '', priority: 'none' }]);
    const invalid = await client.callTool({ name: 'flowboard_create_card', arguments: { operationId: '', boardId: 'board', column: 'todo', title: 'invalid' } });
    assert.equal(invalid.isError, true);
    assert.equal(calls.length, 1);
  } finally { await client.close(); await server.close(); }
});

test('factory never exposes arbitrary operation exceptions to tool responses', async () => {
  const server = createFlowboardMcpServer({ ...operations, async listProjects() { throw new Error('database password and synthetic raw token'); } });
  const client = new Client({ name: 'safe-errors-test', version: '1' });
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport);
    const result = await client.callTool({ name: 'flowboard_list_projects', arguments: {} });
    assert.equal(result.isError, true);
    assert.doesNotMatch(JSON.stringify(result), /database|password|synthetic|raw token/);
    assert.match(JSON.stringify(result), /Flowboard operation failed/);
  } finally { await client.close(); await server.close(); }
});
