import type { SessionData, SessionProjectSummary } from '@flowboard/contracts';

/** A project is "yours" when the caller owns it. Old servers omit isOwned; then the role says the same thing. */
export function isOwnedProject(project: Pick<SessionProjectSummary, 'isOwned' | 'role'>): boolean {
  return project.isOwned ?? project.role === 'owner';
}

/** Splits a list into Yours and Shared with you, keeping each group's order. */
export function splitProjects<T extends Pick<SessionProjectSummary, 'isOwned' | 'role'>>(projects: readonly T[]): { yours: T[]; shared: T[] } {
  const yours: T[] = [];
  const shared: T[] = [];
  for (const project of projects) (isOwnedProject(project) ? yours : shared).push(project);
  return { yours, shared };
}

export interface ProjectUsage { used: number; limit: number; atCap: boolean }

/** Owned-project usage from the session's limits. Null when the server sent none (never guess a number). */
export function projectUsage(session: Pick<SessionData, 'limits'>): ProjectUsage | null {
  const owned = session.limits?.ownedProjects;
  if (!owned) return null;
  return { used: owned.used, limit: owned.limit, atCap: owned.used >= owned.limit };
}

/** "2 of 3 projects". */
export function usageText(usage: ProjectUsage): string {
  return `${usage.used} of ${usage.limit} ${usage.limit === 1 ? 'project' : 'projects'}`;
}
