import type { SessionData } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { chooseLanding } from '@/lib/landing-rule';

/**
 * Where a signed-in visitor lands: the remembered location, else (first run) the projects hub when they own no project, else the only open project (and its only board),
 * else the projects hub. The rule itself lives in landing-rule.ts, shared with the middleware. Mirrors landingPath() in functions/_middleware.ts.
 */
export async function landingFor(session: SessionData): Promise<string> {
  const choice = chooseLanding(session.accessibleProjects, session.lastLocation);
  if ('to' in choice) return choice.to;
  const projectId = choice.singleProject;
  try {
    const boards = (await api.listProjectBoards(projectId)).data.filter((board) => !board.isArchived);
    if (boards.length === 1) return `/board?id=${encodeURIComponent(boards[0]!.id)}`;
  } catch { /* fall back to the project page */ }
  return `/project?id=${encodeURIComponent(projectId)}`;
}
