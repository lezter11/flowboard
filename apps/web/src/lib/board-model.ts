import type { BoardSnapshotData, CardSummary, ColumnSummary } from '@flowboard/contracts';

/** Prototype column tones (styles.css, board-interactions.css). */
export type Tone = 'backlog' | 'progress' | 'testing' | 'completed' | 'blocked' | 'rose' | 'mint' | 'peach' | 'butter' | 'iris';

/**
 * The prototype names pastel tones. Columns may carry a stored tone (additive API field);
 * when absent, derive it from the name, then the category.
 */
const STORED_TONES: Record<string, Tone> = {
  lavender: 'backlog', ice: 'progress', grey: 'testing', green: 'completed', coral: 'blocked',
  rose: 'rose', mint: 'mint', peach: 'peach', butter: 'butter', lilac: 'iris',
};

/** Tone names the column editor offers. They are stored in the column's `color` field (any string up to 30 characters). */
export const COLUMN_TONES: Array<{ value: string; label: string; tone: Tone }> = [
  { value: 'lavender', label: 'Lavender', tone: 'backlog' }, { value: 'ice', label: 'Ice blue', tone: 'progress' }, { value: 'grey', label: 'Grey', tone: 'testing' },
  { value: 'green', label: 'Green', tone: 'completed' }, { value: 'coral', label: 'Coral', tone: 'blocked' }, { value: 'rose', label: 'Rose', tone: 'rose' },
  { value: 'mint', label: 'Mint', tone: 'mint' }, { value: 'peach', label: 'Peach', tone: 'peach' }, { value: 'butter', label: 'Butter', tone: 'butter' }, { value: 'lilac', label: 'Lilac', tone: 'iris' },
];

export function toneFor(column: Pick<ColumnSummary, 'name' | 'category'> & { tone?: string | null; color?: string | null }): Tone {
  // A stored tone or a tone name saved in `color` wins (older columns hold a hex value, which is ignored); otherwise derive it from the name, then the category.
  const stored = STORED_TONES[column.tone ?? column.color ?? ''];
  if (stored) return stored;
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
