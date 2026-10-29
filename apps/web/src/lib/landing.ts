import type { SessionData } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { locationPath } from '@/lib/return-path';

/**
 * Where a signed-in visitor lands: the remembered location, else the only open project (and its only board),
 * else the projects hub. Mirrors landingPath() in functions/_middleware.ts.
 */
export async function landingFor(session: SessionData): Promise<string> {
  const remembered = locationPath(session.lastLocation);
  if (remembered) return remembered;
  const open = session.accessibleProjects.filter((project) => !project.isArchived);
  if (open.length !== 1) return '/projects';
  const projectId = open[0]!.id;
  try {
    const boards = (await api.listProjectBoards(projectId)).data.filter((board) => !board.isArchived);
    if (boards.length === 1) return `/board?id=${encodeURIComponent(boards[0]!.id)}`;
  } catch { /* fall back to the project page */ }
  return `/project?id=${encodeURIComponent(projectId)}`;
}
