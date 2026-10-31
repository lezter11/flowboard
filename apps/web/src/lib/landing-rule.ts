import { locationPath } from './return-path.ts';

/**
 * The one landing rule, shared by the client (lib/landing.ts) and the Pages middleware (functions/_middleware.ts) so they
 * cannot drift apart. Dependency-free on purpose.
 *
 *  1. A remembered location wins.
 *  2. First run: a person who owns no open project (invited only, or nothing yet) sees /projects, where New project is
 *     visible, instead of being dropped inside someone else's project. Opening a project remembers it, so rule 1 takes over.
 *  3. Exactly one open project: go into it (and into its only board).
 *  4. Otherwise /projects.
 */
export interface LandingProject { id: string; isArchived?: boolean; isOwned?: boolean; role?: string }
export type Landing = { to: string } | { singleProject: string };

export function chooseLanding(projects: readonly LandingProject[], last: { projectId: string; boardId: string | null } | null | undefined): Landing {
  const remembered = locationPath(last);
  if (remembered) return { to: remembered };
  const open = projects.filter((p) => !p.isArchived);
  const ownsOne = open.some((p) => p.isOwned ?? p.role === 'owner');
  if (!ownsOne) return { to: '/projects' };
  if (open.length !== 1) return { to: '/projects' };
  return { singleProject: open[0]!.id };
}
