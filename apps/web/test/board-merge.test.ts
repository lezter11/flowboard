import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTarget, addableBoards, cardBoardMap, mergeColumns, planMove, type MergeSource } from '../src/lib/board-merge.ts';
import { sectionPermissions } from '../src/lib/board-selection.ts';

const card = (id: string, columnId: string, position: number) => ({ id, columnId, position, title: id, version: 1 }) as never;
const col = (id: string, name: string, position: number, cards: ReturnType<typeof card>[], category = 'active') =>
  ({ id, name, category, color: 'x', position, activeCardCount: cards.length, matchingCardCount: cards.length, cards, nextCursor: null }) as never;

// Board A: Todo(2), Doing(1), Done(0). Board B: " doing " (2, different case/space), Todo(1), Review(1) only B has.
const A: MergeSource = { id: 'A', name: 'Alpha', isArchived: false, columns: [
  col('a1', 'Todo', 0, [card('a-1', 'a1', 2), card('a-2', 'a1', 1)]), col('a2', 'Doing', 1, [card('a-3', 'a2', 1)]), col('a3', 'Done', 2, [], 'done') ] };
const B: MergeSource = { id: 'B', name: 'Beta', isArchived: false, columns: [
  col('b1', ' doing ', 0, [card('b-1', 'b1', 1), card('b-2', 'b1', 2)]), col('b2', 'todo', 1, [card('b-3', 'b2', 1)]), col('b3', 'Review', 2, [card('b-4', 'b3', 1)]) ] };

test('merges columns by trimmed, case-insensitive name; first board order, then extras', () => {
  const m = mergeColumns([A, B]);
  assert.deepEqual(m.map((c) => c.name), ['Todo', 'Doing', 'Done', 'Review']);
  assert.deepEqual([...m[1]!.sources.keys()], ['A', 'B']);
  assert.equal(m[1]!.name, 'Doing'); // name comes from the first board that has it
  assert.equal(m[3]!.sources.has('A'), false);
});

test('counts add up across boards and cards sort by board then position', () => {
  const m = mergeColumns([A, B]);
  assert.deepEqual(m.map((c) => c.activeCardCount), [3, 3, 0, 1]);
  assert.equal(m.reduce((n, c) => n + c.cards.length, 0), 7);
  assert.deepEqual(m[0]!.cards.map((c) => c.id), ['a-2', 'a-1', 'b-3']);
  assert.deepEqual(m[1]!.cards.map((c) => c.id), ['a-3', 'b-1', 'b-2']);
});

test('one board is returned untouched (single-board parity)', () => {
  const m = mergeColumns([A]);
  assert.deepEqual(m.map((c) => c.id), ['a1', 'a2', 'a3']);
  assert.deepEqual(m[0]!.cards.map((c) => c.id), ['a-1', 'a-2']);
  assert.equal(m[0]!.activeCardCount, 2);
});

const boardOf = (() => { const map = cardBoardMap([A, B]); return (id: string) => map.get(id); })();

test('a drop maps to the card’s own board column of the same name', () => {
  const m = mergeColumns([A, B]);
  const doing = m[1]!;
  const plan = planMove({ card: A.columns[0]!.cards[0]!, boardId: 'A', boardName: 'Alpha', target: doing, others: doing.cards, index: 3, boardOf });
  assert.deepEqual(plan, { ok: true, boardId: 'A', toColumnId: 'a2', index: 1 });
  const planB = planMove({ card: B.columns[1]!.cards[0]!, boardId: 'B', boardName: 'Beta', target: m[1]!, others: doing.cards, index: 0, boardOf });
  assert.deepEqual(planB, { ok: true, boardId: 'B', toColumnId: 'b1', index: 0 });
});

test('a board without that column refuses the drop with a hint', () => {
  const m = mergeColumns([A, B]);
  const review = m[3]!;
  const plan = planMove({ card: A.columns[0]!.cards[0]!, boardId: 'A', boardName: 'Alpha', target: review, others: review.cards, index: 0, boardOf });
  assert.equal(plan.ok, false);
  assert.match((plan as { hint: string }).hint, /Alpha has no “Review” column/);
});

test('reordering inside a merged column only among the same board’s cards', () => {
  const m = mergeColumns([A, B]);
  const doing = m[1]!; // a-3, b-1, b-2
  const b1 = B.columns[0]!.cards[0]!;
  const others = doing.cards.filter((c) => c.id !== b1.id); // a-3, b-2
  // dropping above Alpha's card is outside Beta's block
  const refused = planMove({ card: b1, boardId: 'B', boardName: 'Beta', target: doing, others, index: 0, boardOf });
  assert.equal(refused.ok, false);
  // dropping after b-2 is inside/at the end of Beta's block
  const ok = planMove({ card: b1, boardId: 'B', boardName: 'Beta', target: doing, others, index: 2, boardOf });
  assert.deepEqual(ok, { ok: true, boardId: 'B', toColumnId: 'b1', index: 1 });
});

test('add card: same-named column, else the board’s first column with fallback flagged', () => {
  assert.deepEqual(addTarget(B.columns, 'Todo'), { columnId: 'b2', columnName: 'todo', fallback: false });
  assert.deepEqual(addTarget(A.columns, 'Review'), { columnId: 'a1', columnName: 'Todo', fallback: true });
  assert.equal(addTarget([], 'x'), null);
});

test('add card board choice lists only boards the person can create in, default first', () => {
  const boards = [{ id: 'A', isArchived: false }, { id: 'B', isArchived: true }, { id: 'C', isArchived: false }];
  const viewerOnC = (b: { id: string }) => b.id !== 'C';
  assert.deepEqual(addableBoards(boards, viewerOnC).map((b) => b.id), ['A']);
  assert.deepEqual(addableBoards(boards, () => true).map((b) => b.id), ['A', 'C']);
});

test('permission gating per card’s board', () => {
  assert.equal(sectionPermissions(true, true, false, false).canMove, true);
  assert.equal(sectionPermissions(true, true, true, false).canMove, false);
  assert.equal(sectionPermissions(false, false, false, false).canEdit, false);
});
