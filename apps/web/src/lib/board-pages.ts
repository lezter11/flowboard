import type { BoardSnapshotData, BoardSnapshotQuery, CardSummary, ColumnSummary, PlacementInput } from '@flowboard/contracts';
import type { Filters } from './board-model.ts';

export function serverBoardFilters(filters: Filters): BoardSnapshotQuery {
  if (filters.assignees.length > 1) throw new Error('The current server supports one assignee filter.');
  return {
    ...(filters.q.trim() ? { titleQuery: filters.q.trim() } : {}),
    ...(filters.assignees[0] ? { assigneeId: filters.assignees[0] } : {}),
    ...(filters.priority !== 'any' ? { priority: filters.priority } : {}),
    ...(filters.due !== 'any' ? { due: filters.due } : {}),
  };
}

export interface ColumnPageState { generation: string; cards: CardSummary[]; nextCursor: string | null; pending: boolean; error?: unknown }
export type ColumnPages = Record<string, ColumnPageState>;
export const columnPageKey = (boardId: string, columnId: string) => `${boardId}:${columnId}`;

export function boardPageGeneration(snapshot: BoardSnapshotData, filters: BoardSnapshotQuery): string {
  return JSON.stringify([snapshot.board.id, snapshot.board.snapshotVersion, snapshot.board.structureVersion, snapshot.asOfDate, filters.titleQuery ?? '', filters.priority ?? '', filters.assigneeId ?? '', filters.due ?? '']);
}

export function mergeColumnCards(first: readonly CardSummary[], following: readonly CardSummary[]): CardSummary[] {
  const cards = new Map<string, CardSummary>();
  for (const card of [...first, ...following]) {
    const previous = cards.get(card.id);
    if (!previous || card.version >= previous.version) cards.set(card.id, { ...previous, ...card });
  }
  return [...cards.values()].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export function applyBoardPages(snapshot: BoardSnapshotData, pages: ColumnPages, filters: BoardSnapshotQuery): BoardSnapshotData {
  const generation = boardPageGeneration(snapshot, filters);
  return { ...snapshot, columns: snapshot.columns.map((column) => {
    const page = pages[columnPageKey(snapshot.board.id, column.id)];
    return page?.generation === generation ? { ...column, cards: mergeColumnCards(column.cards, page.cards), nextCursor: page.nextCursor } : column;
  }) };
}

/** A pointer only identifies a visible anchor; the server resolves the real neighbors beyond any loaded page. */
export function placementAtIndex(column: ColumnSummary, movingCardId: string, index: number): PlacementInput {
  const cards = [...column.cards].filter((card) => card.id !== movingCardId).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (index <= 0) return { movingCardId, at: 'first' };
  const next = cards[index];
  if (next) return { movingCardId, at: 'before', anchorCardId: next.id };
  const previous = cards[cards.length - 1];
  return previous ? { movingCardId, at: 'after', anchorCardId: previous.id } : { movingCardId, at: 'last' };
}
