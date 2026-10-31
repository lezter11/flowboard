import type { CardSummary, ColumnSummary } from '@flowboard/contracts';

/** Pure rules for the merged multi-board view. One set of columns, matched by name; every card still belongs to exactly one board. */

export interface MergeSource { id: string; name: string; isArchived: boolean; columns: ColumnSummary[] }

export interface MergedColumn extends ColumnSummary {
  /** Each ticked board's own column with this name (normalised). */
  sources: Map<string, ColumnSummary>;
}

export const normalizeName = (name: string): string => name.trim().toLowerCase();

const byPosition = (a: { position: number }, b: { position: number }) => a.position - b.position;

/**
 * Union of the boards' columns by normalised name. Order: the first board's order, then columns only later boards
 * have (each in its own order). Tone, category and name come from the first board that has the column; counts add up;
 * cards are in display order: board order, then each board's own position. One board returns its columns untouched.
 */
export function mergeColumns(sources: readonly MergeSource[]): MergedColumn[] {
  if (sources.length === 1) {
    const only = sources[0]!;
    return [...only.columns].sort(byPosition).map((c) => ({ ...c, sources: new Map([[only.id, c]]) }));
  }
  const merged = new Map<string, MergedColumn>();
  for (const source of sources) {
    for (const column of [...source.columns].sort(byPosition)) {
      const key = normalizeName(column.name);
      const cards = [...column.cards].sort(byPosition);
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...column, cards, sources: new Map([[source.id, column]]) });
      } else {
        existing.sources.set(source.id, column);
        existing.cards = [...existing.cards, ...cards];
        existing.activeCardCount += column.activeCardCount;
        existing.matchingCardCount += column.matchingCardCount;
      }
    }
  }
  return [...merged.values()];
}

/** card id -> board id, for every card the merged columns hold. */
export function cardBoardMap(sources: readonly MergeSource[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const source of sources) for (const column of source.columns) for (const card of column.cards) map.set(card.id, source.id);
  return map;
}

export type MovePlan =
  | { ok: true; boardId: string; toColumnId: string; index: number }
  | { ok: false; hint: string };

/**
 * Where a dropped card goes. A card only ever moves inside its own board, into that board's column of the same name.
 * `others` are the cards shown in the target column without the dragged one; `index` is the drop position among them.
 * Reordering inside the same merged column is only allowed among the same board's cards.
 */
export function planMove(input: {
  card: CardSummary;
  boardId: string;
  boardName: string;
  target: MergedColumn;
  others: readonly CardSummary[];
  index: number;
  boardOf: (cardId: string) => string | undefined;
}): MovePlan {
  const { card, boardId, boardName, target, others, index, boardOf } = input;
  const dest = target.sources.get(boardId);
  if (!dest) return { ok: false, hint: `${boardName} has no “${target.name}” column, so this card cannot go there.` };
  const own = others.map((c) => boardOf(c.id) === boardId);
  const local = own.slice(0, index).filter(Boolean).length;
  const sameColumn = card.columnId === dest.id;
  if (sameColumn && own.some((x) => !x)) {
    const first = own.indexOf(true);
    const last = own.lastIndexOf(true);
    if (first !== -1 && (index < first || index > last + 1)) {
      return { ok: false, hint: `Cards stay grouped by board. Drop it among ${boardName}’s cards to reorder.` };
    }
  }
  return { ok: true, boardId, toColumnId: dest.id, index: local };
}

export interface AddTarget { columnId: string; columnName: string; fallback: boolean }

/** The column a new card lands in on the chosen board: the same-named one, else that board's first column (fallback is true so the UI says so). */
export function addTarget(columns: readonly ColumnSummary[], name: string): AddTarget | null {
  const sorted = [...columns].sort(byPosition);
  const match = sorted.find((c) => normalizeName(c.name) === normalizeName(name));
  if (match) return { columnId: match.id, columnName: match.name, fallback: false };
  const first = sorted[0];
  return first ? { columnId: first.id, columnName: first.name, fallback: true } : null;
}

/** Boards where the person may create cards (not archived, and the role allows it); the default is the first one. */
export function addableBoards<T extends { id: string; isArchived: boolean }>(boards: readonly T[], canCreate: (board: T) => boolean): T[] {
  return boards.filter((b) => !b.isArchived && canCreate(b));
}

/** Accent index of a board in the current selection, for its chip colour. */
export const boardTone = (index: number): number => ((index % 5) + 5) % 5;
