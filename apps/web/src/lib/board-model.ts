import type { BoardSnapshotData, CardSummary, ColumnSummary } from '@flowboard/contracts';

/** Prototype column tones (styles.css, board-interactions.css). */
export type Tone = 'backlog' | 'progress' | 'testing' | 'completed' | 'blocked' | 'rose' | 'mint' | 'peach' | 'butter' | 'iris';

/**
 * The API stores a hex color and a category; the prototype names pastel tones.
 * Until columns carry a tone, derive it from the name, then the category.
 */
export function toneFor(column: Pick<ColumnSummary, 'name' | 'category'>): Tone {
  const name = column.name.toLowerCase();
  if (/block/.test(name)) return 'blocked';
  if (/test|review|\bqa\b/.test(name)) return 'testing';
  if (column.category === 'done' || /done|complete|shipped/.test(name)) return 'completed';
  if (/progress|doing|active/.test(name)) return 'progress';
  if (/not started|backlog|to ?do|queue/.test(name)) return 'backlog';
  return column.category === 'todo' ? 'backlog' : 'progress';
}

export interface Filters { q: string; assignees: string[]; due: 'any' | 'overdue' | 'soon' | 'none' }
export const EMPTY_FILTERS: Filters = { q: '', assignees: [], due: 'any' };
export const filtersActive = (f: Filters) => Boolean(f.q || f.assignees.length || f.due !== 'any');

export function sortedCards(column: ColumnSummary): CardSummary[] {
  return [...column.cards].sort((a, b) => a.position - b.position);
}

/** Pure preview of a move at an index of the destination (index counts cards without the moving card). */
export function optimisticMove(snapshot: BoardSnapshotData, card: CardSummary, toColumnId: string, index: number): BoardSnapshotData {
  return {
    ...snapshot,
    columns: snapshot.columns.map((col) => {
      const without = col.cards.filter((c) => c.id !== card.id);
      if (col.id === card.columnId && col.id !== toColumnId) {
        return { ...col, cards: without, activeCardCount: Math.max(0, col.activeCardCount - 1), matchingCardCount: Math.max(0, col.matchingCardCount - 1) };
      }
      if (col.id === toColumnId) {
        const ordered = [...without].sort((a, b) => a.position - b.position);
        const prev = ordered[index - 1];
        const next = ordered[index];
        const position = prev && next ? (prev.position + next.position) / 2 : prev ? prev.position + 1000 : next ? next.position - 1000 : 1000;
        const moved: CardSummary = { ...card, columnId: toColumnId, position };
        const sameColumn = col.id === card.columnId;
        return {
          ...col,
          cards: [...without, moved],
          activeCardCount: sameColumn ? col.activeCardCount : col.activeCardCount + 1,
          matchingCardCount: sameColumn ? col.matchingCardCount : col.matchingCardCount + 1,
        };
      }
      return col;
    }),
  };
}

/** previous/next neighbour ids for inserting at `index` among the destination's other cards. */
export function neighbours(column: ColumnSummary | undefined, movingId: string, index: number) {
  const ordered = column ? sortedCards(column).filter((c) => c.id !== movingId) : [];
  return { previousCardId: ordered[index - 1]?.id ?? null, nextCardId: ordered[index]?.id ?? null, count: ordered.length };
}
