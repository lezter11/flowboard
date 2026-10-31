/** Pure rules for the multi-board view: which boards are shown, parsed from the URL and the per-project memory. No DOM. */

export const MAX_BOARDS = 6;

export interface SelectableBoard { id: string; isArchived: boolean }

/** ?boards=a,b,c -> unique, trimmed, non-empty ids in order. */
export function parseBoardsParam(raw: string | null | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(',')) {
    const id = part.trim();
    if (id) seen.add(id);
  }
  return [...seen];
}

export const formatBoardsParam = (ids: readonly string[]): string => ids.join(',');

/** Keeps only boards the user can see (the list the API returned) and that are not archived, in request order, up to the cap. */
export function dropStale(ids: readonly string[], boards: readonly SelectableBoard[]): string[] {
  const live = new Set(boards.filter((b) => !b.isArchived).map((b) => b.id));
  return ids.filter((id) => live.has(id)).slice(0, MAX_BOARDS);
}

/**
 * The boards to show. Order of intent: ?boards= (if it keeps 2+ valid boards), else the remembered selection when it
 * contains the board in ?id= (so "Board" in the rail reopens your combined view), else just ?id=. Stale ids are dropped
 * quietly; if nothing is left the default board, then the first open board. Before the board list is known the single ?id= is used,
 * which is exactly today's behaviour.
 */
export function resolveSelection(input: {
  idParam: string | null;
  boardsParam: string | null;
  remembered: readonly string[];
  boards: readonly SelectableBoard[] | null;
  defaultBoardId: string | null;
}): string[] {
  const { idParam, boardsParam, remembered, boards, defaultBoardId } = input;
  const requested = parseBoardsParam(boardsParam);
  if (!boards) return requested.length ? requested.slice(0, MAX_BOARDS) : idParam ? [idParam] : [];
  const fromUrl = dropStale(requested, boards);
  if (fromUrl.length >= 2) return fromUrl;
  if (fromUrl.length === 1) return fromUrl;
  if (requested.length === 0 && idParam) {
    const rem = dropStale(remembered, boards);
    if (rem.length >= 2 && rem.includes(idParam)) return rem;
    return [idParam];
  }
  const open = boards.filter((b) => !b.isArchived);
  const fallback = open.find((b) => b.id === defaultBoardId) ?? open[0];
  return fallback ? [fallback.id] : idParam ? [idParam] : [];
}

/** Next selection after a checkbox change. The last remaining board cannot be unticked; the cap blocks further ticks. */
export function toggleBoard(selected: readonly string[], id: string): string[] {
  if (selected.includes(id)) return selected.length > 1 ? selected.filter((x) => x !== id) : [...selected];
  return selected.length >= MAX_BOARDS ? [...selected] : [...selected, id];
}

export function selectAll(boards: readonly SelectableBoard[], selected: readonly string[]): string[] {
  const open = boards.filter((b) => !b.isArchived).map((b) => b.id);
  const keep = selected.filter((id) => open.includes(id));
  return [...keep, ...open.filter((id) => !keep.includes(id))].slice(0, MAX_BOARDS);
}

/** Clear keeps the first selected board: there is always at least one. */
export const clearSelection = (selected: readonly string[]): string[] => selected.slice(0, 1);

/** The dropdown only exists when there is something to choose between. */
export const showSwitcher = (boards: readonly SelectableBoard[] | null | undefined): boolean => (boards ?? []).filter((b) => !b.isArchived).length >= 2;

/** Per-section gating: the role comes from the project grant, and an archived board or project freezes just that section. */
export function sectionPermissions(canEditRole: boolean, canMoveRole: boolean, boardArchived: boolean, projectArchived: boolean) {
  const frozen = boardArchived || projectArchived;
  return { canEdit: canEditRole && !frozen, canMove: canMoveRole && !frozen };
}

const memoryKey = (projectId: string) => `flowboard.boards.${projectId}`;

export function readMemory(projectId: string, storage?: Pick<Storage, 'getItem'>): string[] {
  try {
    const store = storage ?? window.localStorage;
    const raw = store.getItem(memoryKey(projectId));
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_BOARDS) : [];
  } catch { return []; }
}

export function writeMemory(projectId: string, ids: readonly string[], storage?: Pick<Storage, 'setItem' | 'removeItem'>): void {
  try {
    const store = storage ?? window.localStorage;
    if (ids.length >= 2) store.setItem(memoryKey(projectId), JSON.stringify(ids.slice(0, MAX_BOARDS)));
    else store.removeItem(memoryKey(projectId));
  } catch { /* private mode or blocked storage: the URL still carries the selection */ }
}
