/** Columns a card can be restored into: the server's own list when it sends one, else the board's current columns. */
export interface ColumnOption { id: string; name: string; position?: number }

export function restoreColumns(details: unknown, boardColumns: readonly ColumnOption[] | undefined): ColumnOption[] {
  const fromServer = (details as { columns?: unknown } | null | undefined)?.columns;
  const pick = (list: readonly unknown[]): ColumnOption[] => list
    .filter((c): c is ColumnOption => !!c && typeof (c as ColumnOption).id === 'string' && typeof (c as ColumnOption).name === 'string')
    .map((c) => ({ id: c.id, name: c.name, position: typeof c.position === 'number' ? c.position : undefined }));
  const server = Array.isArray(fromServer) ? pick(fromServer) : [];
  const list = server.length ? server : pick(boardColumns ?? []);
  return list.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** One tap to confirm: the first column is preselected (decision D9). */
export const defaultRestoreColumn = (columns: readonly ColumnOption[]): string => columns[0]?.id ?? '';

export type TrashEmpty = 'loading' | 'no-projects' | 'not-allowed' | null;

/** Why the Trash page has nothing to show for this person. Members are told the rule; people with no projects are told that instead. */
export function trashEmptyState(s: { ready: boolean; projects: number; manageable: number }): TrashEmpty {
  if (!s.ready) return 'loading';
  if (s.projects === 0) return 'no-projects';
  if (s.manageable === 0) return 'not-allowed';
  return null;
}
