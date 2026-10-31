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
