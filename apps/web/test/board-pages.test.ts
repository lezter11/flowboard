import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { BoardSnapshotData, CardSummary } from '@flowboard/contracts';
import { applyBoardPages, boardPageGeneration, placementAtIndex, serverBoardFilters } from '../src/lib/board-pages.ts';
import { memberControls, canEditBoardDetails, canViewPeopleDirectory, directoryRows } from '../src/lib/member-controls.ts';

const card = (id: string, position: number, version = 1) => ({ id, boardId: 'board', columnId: 'col', title: id, priority: 'high', dueDate: null, assigneeIds: [], position, version, commentCount: 0, imageCount: 0, createdAt: '2026-11-03T00:00:00.000Z', updatedAt: '2026-11-03T00:00:00.000Z' }) as CardSummary;
const snapshot = () => ({ board: { id: 'board', snapshotVersion: 7, structureVersion: 4 }, asOfDate: '2026-11-03', totals: { activeCardCount: 31, matchingCardCount: 31 }, columns: [{ id: 'col', cards: [card('first', 1), card('middle', 15)], activeCardCount: 31, matchingCardCount: 31, nextCursor: 'cursor1' }] }) as unknown as BoardSnapshotData;

test('actual server filter translation preserves supported priority-none, assignee, date and title semantics', () => {
  assert.deepEqual(serverBoardFilters({ q: '  far card  ', assignees: ['person'], due: 'upcoming', priority: 'none', column: 'col' }), { titleQuery: 'far card', assigneeId: 'person', due: 'upcoming', priority: 'none' });
  assert.deepEqual(serverBoardFilters({ q: '', assignees: [], due: 'any', priority: 'any', column: '' }), {});
  assert.throws(() => serverBoardFilters({ q: '', assignees: ['a', 'b'], due: 'any', priority: 'any', column: '' }), /one assignee/i);
});

test('continued pages expose card24 without duplicating a boundary or replacing full counts by loaded length', () => {
  const snap = snapshot(); const generation = boardPageGeneration(snap, {});
  const result = applyBoardPages(snap, { 'board:col': { generation, cards: [card('middle', 15, 2), card('card24', 24)], nextCursor: 'cursor2', pending: false } }, {});
  assert.deepEqual(result.columns[0]!.cards.map((c) => [c.id, c.version]), [['first', 1], ['middle', 2], ['card24', 1]]);
  assert.equal(result.columns[0]!.activeCardCount, 31); assert.equal(result.totals.matchingCardCount, 31);
  assert.equal(result.columns[0]!.nextCursor, 'cursor2');
});

test('a real15-card first page continues through card31 with stable ID order and no duplicate boundary', () => {
  const snap = snapshot(); snap.columns[0]!.cards = Array.from({ length: 15 }, (_, index) => card(`card${index + 1}`, index + 1));
  const following = Array.from({ length: 17 }, (_, index) => card(`card${index + 15}`, index + 15));
  const result = applyBoardPages(snap, { 'board:col': { generation: boardPageGeneration(snap, {}), cards: following, nextCursor: null, pending: false } }, {});
  const cards = result.columns[0]!.cards;
  assert.equal(cards.length, 31); assert.equal(cards[23]!.id, 'card24'); assert.equal(cards[30]!.id, 'card31');
  assert.equal(new Set(cards.map((card) => card.id)).size, 31);
  assert.equal(result.columns[0]!.nextCursor, null); assert.equal(result.columns[0]!.matchingCardCount, 31);
});

test('a changed snapshot, calendar day or filter never combines old continuation cards/cursors', () => {
  const snap = snapshot(); const pages = { 'board:col': { generation: boardPageGeneration(snap, {}), cards: [card('card24', 24)], nextCursor: null, pending: false } };
  for (const next of [{ ...snap, board: { ...snap.board, snapshotVersion: 8 } }, { ...snap, asOfDate: '2026-11-04' }]) {
    const result = applyBoardPages(next, pages, {});
    assert.equal(result.columns[0]!.cards.length, 2); assert.equal(result.columns[0]!.nextCursor, 'cursor1');
  }
  assert.equal(applyBoardPages(snap, pages, { priority: 'urgent' }).columns[0]!.cards.length, 2);
});

test('dropping after the last loaded card asks after that anchor rather than pretending the full column ended', () => {
  const column = snapshot().columns[0]!;
  assert.deepEqual(placementAtIndex(column, 'moving', 2), { movingCardId: 'moving', at: 'after', anchorCardId: 'middle' });
  assert.deepEqual(placementAtIndex(column, 'moving', 0), { movingCardId: 'moving', at: 'first' });
  assert.deepEqual(placementAtIndex(column, 'moving', 1), { movingCardId: 'moving', at: 'before', anchorCardId: 'middle' });
});

test('Manager controls cannot promote or change self, peer Manager or Owner, while Owner can administer others', () => {
  assert.deepEqual(memberControls('manager', 'me', 'member', 'other', false).roles, ['member', 'viewer']);
  assert.equal(memberControls('manager', 'me', 'member', 'other', false).remove, true);
  for (const [targetRole, targetId] of [['manager', 'peer'], ['owner', 'owner'], ['member', 'me']] as const) {
    const result = memberControls('manager', 'me', targetRole, targetId, false);
    assert.equal(result.edit, false); assert.equal(result.remove, false);
  }
  assert.deepEqual(memberControls('owner', 'owner', 'manager', 'peer', false).roles, ['manager', 'member', 'viewer']);
  assert.equal(memberControls('owner', 'owner', 'member', 'other', true).remove, false);
  assert.equal(canEditBoardDetails('manager', false, false), false);
  assert.equal(canEditBoardDetails('owner', true, false), false);
  assert.equal(canEditBoardDetails('owner', false, false), true);
});

test('full directory remains Owner/Manager only and stale cached emails disappear on role loss or refused read', () => {
  const cached = [{ id: 'secret-person', email: 'private@example.test' }];
  for (const role of ['member', 'viewer'] as const) {
    assert.equal(canViewPeopleDirectory(role), false);
    assert.deepEqual(directoryRows(role, cached, false), []);
  }
  for (const role of ['owner', 'manager'] as const) {
    assert.equal(canViewPeopleDirectory(role), true);
    assert.deepEqual(directoryRows(role, cached, false), cached);
    assert.deepEqual(directoryRows(role, cached, true), []);
  }
  assert.equal(canViewPeopleDirectory(undefined), false);
});
