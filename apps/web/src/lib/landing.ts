import type { SessionData } from '@flowboard/contracts';
import { api } from '@/lib/api';

/**
 * Where a signed-in visitor lands. Mirrors landingPath() in functions/_middleware.ts:
 * the only open project (and its only board) when there is exactly one, else the projects hub.
 */
export async function landingFor(session: SessionData): Promise<string> {
  const open = session.accessibleProjects.filter((project) => !project.isArchived);
  if (open.length !== 1) return '/projects';
  const projectId = open[0]!.id;
  try {
    const boards = (await api.listProjectBoards(projectId)).data.filter((board) => !board.isArchived);
    if (boards.length === 1) return `/board?id=${encodeURIComponent(boards[0]!.id)}`;
  } catch { /* fall back to the project page */ }
  return `/project?id=${encodeURIComponent(projectId)}`;
}
