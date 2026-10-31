/**
 * Places that hold text the person has not saved (a card drawer, the add-card form) register here, so that a session that ends
 * does not replace the page and throw the text away. Plain module state with a tiny subscribe, usable without React in tests.
 */
const open = new Set<string>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setUnsaved(id: string, unsaved: boolean): void {
  const had = open.has(id);
  if (unsaved && !had) { open.add(id); emit(); }
  if (!unsaved && had) { open.delete(id); emit(); }
}
export const hasUnsaved = (): boolean => open.size > 0;
export function subscribeUnsaved(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }
export const resetUnsavedForTests = (): void => { open.clear(); };
