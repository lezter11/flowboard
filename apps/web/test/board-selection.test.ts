import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BOARDS, clearSelection, dropStale, formatBoardsParam, parseBoardsParam, readMemory, resolveSelection, sectionPermissions, selectAll, showSwitcher, toggleBoard, writeMemory } from '../src/lib/board-selection.ts';

const boards = [
  { id: 'a', isArchived: false }, { id: 'b', isArchived: false }, { id: 'c', isArchived: true },
  { id: 'd', isArchived: false }, { id: 'e', isArchived: false }, { id: 'f', isArchived: false }, { id: 'g', isArchived: false }, { id: 'h', isArchived: false },
];

test('parses ?boards= with trimming, empties and duplicates', () => {
  assert.deepEqual(parseBoardsParam(' a, b,,a ,c'), ['a', 'b', 'c']);
  assert.deepEqual(parseBoardsParam(null), []);
  assert.equal(formatBoardsParam(['a', 'b']), 'a,b');
});

test('drops stale, archived and no-access ids quietly', () => {
  assert.deepEqual(dropStale(['a', 'zzz', 'c', 'b'], boards), ['a', 'b']);
});

test('single board parity: ?id= alone, with or without the board list, gives exactly that board', () => {
  assert.deepEqual(resolveSelection({ idParam: 'a', boardsParam: null, remembered: [], boards: null, defaultBoardId: null }), ['a']);
  assert.deepEqual(resolveSelection({ idParam: 'a', boardsParam: null, remembered: [], boards, defaultBoardId: 'b' }), ['a']);
  // an archived board opened by id still opens (read-only), as today
  assert.deepEqual(resolveSelection({ idParam: 'c', boardsParam: null, remembered: [], boards, defaultBoardId: 'a' }), ['c']);
});

test('?boards= wins; a lone survivor becomes a single board; none left falls back to default then first', () => {
  const r = (boardsParam: string, defaultBoardId: string | null = null) => resolveSelection({ idParam: 'a', boardsParam, remembered: [], boards, defaultBoardId });
  assert.deepEqual(r('a,b,zzz'), ['a', 'b']);
  assert.deepEqual(r('a,zzz'), ['a']);
  assert.deepEqual(r('zzz,yyy', 'd'), ['d']);
  assert.deepEqual(r('zzz,yyy'), ['a']);
});

test('remembered selection restores only when it contains the board being opened', () => {
  const base = { idParam: 'a', boardsParam: null, boards, defaultBoardId: 'a' };
  assert.deepEqual(resolveSelection({ ...base, remembered: ['a', 'b', 'gone'] }), ['a', 'b']);
  assert.deepEqual(resolveSelection({ ...base, remembered: ['b', 'd'] }), ['a']);
  assert.deepEqual(resolveSelection({ ...base, remembered: ['a', 'gone'] }), ['a']);
});

test('cap of 6: URL list, toggling and select all', () => {
  assert.equal(MAX_BOARDS, 6);
  assert.equal(resolveSelection({ idParam: 'a', boardsParam: 'a,b,d,e,f,g,h', remembered: [], boards, defaultBoardId: null }).length, 6);
  assert.deepEqual(toggleBoard(['a', 'b', 'd', 'e', 'f', 'g'], 'h'), ['a', 'b', 'd', 'e', 'f', 'g']);
  assert.deepEqual(toggleBoard(['a', 'b'], 'd'), ['a', 'b', 'd']);
  assert.deepEqual(toggleBoard(['a', 'b'], 'b'), ['a']);
  assert.deepEqual(toggleBoard(['a'], 'a'), ['a']);
  assert.deepEqual(selectAll(boards, ['h']), ['h', 'a', 'b', 'd', 'e', 'f']);
  assert.deepEqual(clearSelection(['b', 'a']), ['b']);
});

test('the switcher needs two or more boards the user can see', () => {
  assert.equal(showSwitcher([{ id: 'a', isArchived: false }]), false);
  assert.equal(showSwitcher([{ id: 'a', isArchived: false }, { id: 'c', isArchived: true }]), false);
  assert.equal(showSwitcher(boards), true);
  assert.equal(showSwitcher(null), false);
});

test('per-section permissions: viewer cannot edit, archived board freezes only its section', () => {
  assert.deepEqual(sectionPermissions(false, false, false, false), { canEdit: false, canMove: false });
  assert.deepEqual(sectionPermissions(true, true, false, false), { canEdit: true, canMove: true });
  assert.deepEqual(sectionPermissions(true, true, true, false), { canEdit: false, canMove: false });
  assert.deepEqual(sectionPermissions(true, true, false, true), { canEdit: false, canMove: false });
});

test('memory is per project and survives broken storage', () => {
  const data = new Map<string, string>();
  const store = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k) };
  writeMemory('p1', ['a', 'b'], store);
  assert.deepEqual(readMemory('p1', store), ['a', 'b']);
  assert.deepEqual(readMemory('p2', store), []);
  writeMemory('p1', ['a'], store);
  assert.deepEqual(readMemory('p1', store), []);
  data.set('flowboard.boards.p3', '{not json');
  assert.deepEqual(readMemory('p3', store), []);
  const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } };
  assert.deepEqual(readMemory('p1', broken), []);
  assert.doesNotThrow(() => writeMemory('p1', ['a', 'b'], broken));
});
