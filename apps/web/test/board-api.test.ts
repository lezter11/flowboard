import { test } from 'node:test';
import assert from 'node:assert/strict';
import { api } from '../src/lib/api.ts';

test('column continuation sends exact opaque cursor plus the original server filters', async () => {
  const original = globalThis.fetch; let sent = '';
  globalThis.fetch = async (url) => { sent = String(url); return Response.json({ data: [], nextCursor: 'another' }); };
  try {
    const page = await api.listBoardCards('b /1', { columnId: 'c /2', query: 'far title', priority: 'urgent', assigneeId: 'person', due: 'upcoming', cursor: 'opaque+/=', limit: 50 });
    assert.deepEqual(page, { data: [], nextCursor: 'another' });
    const url = new URL(sent, 'http://local.test');
    assert.equal(url.pathname, '/api/v1/boards/b%20%2F1/cards');
    assert.deepEqual(Object.fromEntries(url.searchParams), { columnId: 'c /2', query: 'far title', priority: 'urgent', assigneeId: 'person', due: 'upcoming', cursor: 'opaque+/=', limit: '50' });
  } finally { globalThis.fetch = original; }
});

test('canonical placement forwards actual first/last/before/after intent and anchor IDs', async () => {
  const original = globalThis.fetch; const requests: URL[] = [];
  globalThis.fetch = async (url) => { requests.push(new URL(String(url), 'http://local.test')); return Response.json({ data: { movingCardId: 'moving', toColumnId: 'dest', previousCardId: 'unseen', nextCardId: null, structureVersion: 9 } }); };
  try {
    for (const at of ['first', 'last', 'before', 'after'] as const) {
      const result = await api.getCardPlacement('b', 'dest', { movingCardId: 'moving', at, ...(at === 'before' || at === 'after' ? { anchorCardId: 'card-24' } : {}) });
      assert.equal(result.data.previousCardId, 'unseen'); assert.equal(result.data.structureVersion, 9);
    }
    assert.deepEqual(requests.map((u) => Object.fromEntries(u.searchParams)), [
      { movingCardId: 'moving', at: 'first' }, { movingCardId: 'moving', at: 'last' },
      { movingCardId: 'moving', at: 'before', anchorCardId: 'card-24' }, { movingCardId: 'moving', at: 'after', anchorCardId: 'card-24' },
    ]);
  } finally { globalThis.fetch = original; }
});

test('filtered snapshots forward priority-none and AbortSignal instead of filtering a cached page', async () => {
  const original = globalThis.fetch; const controller = new AbortController();
  let sent: { url: string; signal?: AbortSignal | null } | null = null;
  globalThis.fetch = async (url, options) => { sent = { url: String(url), signal: options?.signal }; return Response.json({ data: {} }); };
  try {
    await api.getBoardSnapshot('board', { titleQuery: 'card24', priority: 'none', assigneeId: 'person', due: 'today', cardLimitPerColumn: 15 }, controller.signal);
    assert.equal(sent!.signal, controller.signal);
    assert.deepEqual(Object.fromEntries(new URL(sent!.url, 'http://local.test').searchParams), { titleQuery: 'card24', priority: 'none', assigneeId: 'person', due: 'today', cardLimitPerColumn: '15' });
  } finally { globalThis.fetch = original; }
});

test('archived-board admin discovery is explicit and preserves the default list URL', async () => {
  const original = globalThis.fetch; const urls: string[] = [];
  globalThis.fetch = async (url) => { urls.push(String(url)); return Response.json({ data: [], nextCursor: null }); };
  try {
    await api.listProjectBoards('project');
    await api.listProjectBoards('project', { includeArchived: true });
    assert.deepEqual(urls, ['/api/v1/projects/project/boards', '/api/v1/projects/project/boards?includeArchived=true']);
  } finally { globalThis.fetch = original; }
});
