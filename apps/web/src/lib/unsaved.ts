/**
 * Places that hold text the person has not saved (a card drawer, the add-card form) register here, so that a session that ends
 * does not replace the page and throw the text away. Plain module state with a tiny subscribe, usable without React in tests.
 */
const open = new Set<string>();
const acknowledged = new Set<string>();
const background = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setUnsaved(id: string, unsaved: boolean, edited = false, inApp = true): void {
  const had = open.has(id);
  if (unsaved && edited) acknowledged.delete(id);
  if (unsaved && !inApp) background.add(id);
  else background.delete(id);
  if (unsaved && !had) { open.add(id); emit(); }
  if (!unsaved && had) { open.delete(id); acknowledged.delete(id); emit(); }
}
export const hasUnsaved = (): boolean => open.size > 0;
export function hasUnacknowledgedUnsaved(): boolean {
  for (const id of open) if (!acknowledged.has(id) && !background.has(id)) return true;
  return false;
}
/** Drafts kept in this tab still need protection on reload or sign-out. */
export function acknowledgeUnsaved(ids: Iterable<string>): void {
  for (const id of ids) if (open.has(id)) acknowledged.add(id);
}
export function subscribeUnsaved(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const resetUnsavedForTests = (): void => { open.clear(); acknowledged.clear(); background.clear(); };
