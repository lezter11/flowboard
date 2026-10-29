'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import type { Board } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

/** Pure rule for the rail's Board button: default board, else the last board used here, else the only one, else the project page. */
export function boardTarget(projectId: string | null, defaultBoardId: string | null, lastBoardId: string | null, boards: Board[] | null): string {
  if (!projectId) return '/projects';
  const open = (boards ?? []).filter((board) => !board.isArchived);
  const pick = (id: string | null) => (id && open.some((board) => board.id === id) ? id : null);
  const id = pick(defaultBoardId) ?? pick(lastBoardId) ?? (open.length === 1 ? open[0]!.id : null);
  return id ? `/board?id=${encodeURIComponent(id)}` : `/project?id=${encodeURIComponent(projectId)}`;
}

/**
 * Where "Board" in the rail goes. The project comes from the route, else the remembered location, else the only open
 * project, so the button works from Inbox, My tasks, Activity and Settings too (it used to fall back to /projects there
 * and, on a board, to the board you were already on).
 */
export function useBoardHref(routeProjectId: string | null, currentBoardId: string | null): string {
  const pathname = usePathname();
  const params = useSearchParams();
  const { state } = useSession();
  const session = state.status === 'ready' ? state.session : null;
  const open = (session?.accessibleProjects ?? []).filter((project) => !project.isArchived);
  const last = session?.lastLocation ?? null;
  const projectId = routeProjectId
    ?? (pathname === '/project' ? params.get('id') : null)
    ?? (last && open.some((project) => project.id === last.projectId) ? last.projectId : null)
    ?? (open.length === 1 ? open[0]!.id : null);
  const project = open.find((candidate) => candidate.id === projectId) ?? null;
  const boards = useQuery({
    queryKey: ['boards', projectId],
    queryFn: async () => (await api.listProjectBoards(projectId!)).data,
    enabled: !!projectId && !!session,
  });
  const lastBoardId = currentBoardId ?? (last && last.projectId === projectId ? last.boardId : null);
  return boardTarget(projectId, project?.defaultBoardId ?? null, lastBoardId, boards.data ?? null);
}
