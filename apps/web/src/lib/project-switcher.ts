import type { SessionProjectSummary } from '@flowboard/contracts';
import { normalizeRole, ROLE_META, type Role } from './roles.ts';
import { splitProjects } from './project-groups.ts';

type Item = Pick<SessionProjectSummary, 'id' | 'name' | 'role' | 'isArchived'> & { isOwned?: boolean };

const ORDER: Role[] = ['owner', 'manager', 'member', 'viewer'];

/** Open projects only (archived ones live on the Projects page), each group sorted by name. */
export function switcherGroups<T extends Item>(projects: readonly T[]): { yours: T[]; shared: T[] } {
  const open = projects.filter((p) => !p.isArchived);
  const { yours, shared } = splitProjects(open);
  const byName = (a: T, b: T) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
  return { yours: [...yours].sort(byName), shared: [...shared].sort(byName) };
}

/**
 * The strongest role the person really holds in a project. No project, no role: owning a hidden container grants
 * nothing outside the projects themselves, so a Viewer-only invitee never sees Owner-level navigation.
 */
export function strongestRole(projects: readonly Pick<SessionProjectSummary, 'role'>[]): Role | null {
  for (const role of ORDER) if (projects.some((p) => normalizeRole(p.role) === role)) return role;
  return null;
}

export interface SwitcherLabel { title: string; subtitle: string; mark: string }

/** What the rail header shows: the current project and the role in it, or "Projects" and a count off-project. Never a workspace name. */
export function switcherLabel(current: Item | null, projects: readonly Item[]): SwitcherLabel {
  if (current) return { title: current.name, subtitle: ROLE_META[normalizeRole(current.role)].label, mark: current.name.slice(0, 2).toUpperCase() };
  const open = projects.filter((p) => !p.isArchived).length;
  return { title: 'Projects', subtitle: `${open} ${open === 1 ? 'project' : 'projects'}`, mark: 'PR' };
}
