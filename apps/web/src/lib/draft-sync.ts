/** Keeps a user's unsaved card edits when the card changes on the server (polling, a colleague's save). */
export interface CardFields { title: string; description: string; priority: string; dueDate: string; assigneeIds: string[]; columnId: string }

const FIELDS = ['title', 'description', 'priority', 'dueDate', 'assigneeIds', 'columnId'] as const;
const same = (a: unknown, b: unknown) => (Array.isArray(a) && Array.isArray(b) ? a.join(',') === b.join(',') : a === b);

/**
 * Field by field: a field the user has not touched follows the server; a field they edited keeps their text.
 * `conflict` is true when a field the user edited was also changed on the server to something different from their draft.
 */
export function reconcileDraft<T extends CardFields>(prevBase: T, nextBase: T, draft: T): { draft: T; conflict: boolean } {
  const out: T = { ...draft };
  let conflict = false;
  for (const key of FIELDS) {
    const edited = !same(draft[key], prevBase[key]);
    const serverChanged = !same(prevBase[key], nextBase[key]);
    if (!serverChanged) continue;
    if (!edited) (out as CardFields)[key] = nextBase[key] as never;
    else if (!same(draft[key], nextBase[key])) conflict = true;
  }
  return { draft: out, conflict };
}
