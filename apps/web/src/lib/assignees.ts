/**
 * Who can be assigned to a card. The board snapshot only lists people who are ALREADY assigned to a card on that board, so it
 * cannot be the source of candidates (on a fresh board nobody could ever be assigned first). Candidates come from the project's
 * people (purpose=assignee); the snapshot is used only to name people who are already on cards.
 */
export const MAX_ASSIGNEES = 20;
export const EMPTY_ASSIGNEES = 'No one else is in this project yet. Invite people from People.';

export interface PersonLike { id: string; displayName: string; activeInProject?: boolean; assignable?: boolean; scopedRole?: string | null }

const RANK: Record<string, number> = { owner: 0, manager: 1, member: 2 };

/** Active people who may work on cards: Owner, Managers and Members. Never a Viewer, even if a server forgets to say so. */
export function assignableList<T extends PersonLike>(projectPeople: readonly T[] | undefined): T[] {
  return (projectPeople ?? [])
    .filter((p) => p.activeInProject !== false && p.assignable !== false && p.scopedRole !== 'viewer')
    .sort((a, b) => (RANK[a.scopedRole ?? ''] ?? 3) - (RANK[b.scopedRole ?? ''] ?? 3) || a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
}

/** Names for chips: everyone the snapshot knows (including people who left) plus the project's current people. Current people win. */
export function namesFor<T extends PersonLike>(snapshotPeople: ReadonlyMap<string, T>, projectPeople: readonly T[] | undefined): Map<string, T> {
  const map = new Map(snapshotPeople);
  for (const p of projectPeople ?? []) map.set(p.id, p);
  return map;
}

export type PickerState = 'loading' | 'error' | 'empty' | 'ready';
export function pickerState(q: { isPending: boolean; isError: boolean }, list: readonly unknown[]): PickerState {
  if (q.isPending) return 'loading';
  if (q.isError) return 'error';
  return list.length === 0 ? 'empty' : 'ready';
}

/**
 * Assigned ids that can no longer be assigned. Only judged against the project list once it has loaded; until then (or if it
 * failed) fall back to what the snapshot says, so a slow request never flags everyone as "can't be assigned".
 */
export function ineligibleIds(ids: readonly string[], projectList: readonly PersonLike[], loaded: boolean, snapshotPeople: ReadonlyMap<string, PersonLike>): string[] {
  if (loaded) return ids.filter((id) => !projectList.some((p) => p.id === id));
  return ids.filter((id) => { const p = snapshotPeople.get(id); return !!p && (p.activeInProject === false || p.assignable === false); });
}

export const canAddAssignee = (count: number): boolean => count < MAX_ASSIGNEES;

export interface FailureLike { status: number; code: string; message?: string; details?: unknown }

/**
 * The people a refused save names: code ASSIGNEE_NOT_ELIGIBLE, or today's 422 whose details carry invalidAssigneeIds.
 * Null when the failure is about something else. Ids only; the caller turns them into names.
 */
export function ineligibleFromFailure(f: FailureLike): string[] | null {
  if (f.status !== 422 && f.code !== 'ASSIGNEE_NOT_ELIGIBLE') return null;
  // ineligibleUserIds is the contract; invalidAssigneeIds is what older servers sent.
  const d = f.details as { ineligibleUserIds?: unknown; invalidAssigneeIds?: unknown } | null | undefined;
  const raw = Array.isArray(d?.ineligibleUserIds) ? d!.ineligibleUserIds : Array.isArray(d?.invalidAssigneeIds) ? d!.invalidAssigneeIds : [];
  const ids = raw.filter((x): x is string => typeof x === 'string');
  if (ids.length > 0) return ids;
  return f.code === 'ASSIGNEE_NOT_ELIGIBLE' || /access to this board/i.test(f.message ?? '') ? [] : null;
}

const joinNames = (names: string[]) => names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** "Couldn't assign Sam Lee and Ana Rao. They do not have access to this board." Falls back to the server's sentence when no one is named. */
export function describeIneligible(names: string[], _serverMessage = ''): string {
  // The server's sentence is never shown (it is for logs); without names, say it in general.
  if (names.length === 0) return 'Some people can’t be assigned to this card. Remove them and save.';
  return `Couldn’t assign ${joinNames(names)}. ${names.length === 1 ? 'They do' : 'They do'} not have access to this board.`;
}

/** Managers and Members of the project who hold no grant on this board: in the project's assignable list but not in the board's. */
export function noBoardAccess<T extends PersonLike>(projectWide: readonly T[] | undefined, boardWide: readonly T[] | undefined): T[] {
  const onBoard = new Set((boardWide ?? []).map((p) => p.id));
  return assignableList(projectWide).filter((p) => !onBoard.has(p.id) && p.scopedRole !== 'owner');
}

/** What the save bar says. A failed save never sits on "Unsaved changes". */
export function saveBarText(s: { saving: boolean; failed: boolean; dirty: boolean; reason?: string }): string {
  if (s.saving) return 'Saving…';
  if (s.failed) return s.reason ? `Couldn’t save. ${s.reason}` : 'Couldn’t save.';
  return s.dirty ? 'Unsaved changes' : 'All changes saved';
}

export const NO_ACCESS_HINT = 'Give them access to this board first.';

/** Why the people list failed. BOARD_REQUIRED means this tab is older than the server: say so, never show an empty list. */
export function peopleLoadError(f: { status?: number; code?: string } | null | undefined): string {
  if (f?.code === 'BOARD_REQUIRED') return 'Flowboard was updated. Reload the page to assign people.';
  return 'Could not load the project’s people.';
}
