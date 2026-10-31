/** Wording for an empty mention list. Pure, so the exact sentences are tested. */
export function mentionEmptyText(s: { loading: boolean; failed: boolean; candidates: ReadonlyArray<{ id: string }>; actorId: string | null; typed: string }): string {
  if (s.loading) return 'Loading people…';
  if (s.failed) return 'Could not load people for this card. Close this list and try again.';
  const others = s.candidates.filter((p) => p.id !== s.actorId);
  if (others.length === 0) return 'You are the only person in this project. Invite someone from People to mention them.';
  return 'No one matches.';
}

/** Who the picker offers: active people the server marked mentionable (a Viewer with board access yes, someone without a grant no). */
export function mentionCandidates<T extends { activeInProject?: boolean; mentionable?: boolean }>(people: readonly T[] | undefined): T[] {
  return (people ?? []).filter((p) => p.activeInProject !== false && p.mentionable !== false);
}
