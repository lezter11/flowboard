'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { boardQueryOptions } from '@/lib/queries';
import { normalizeRole, type Role } from '@/lib/roles';
import { useSession } from '@/lib/session';

/** Resolves the project the current route belongs to (board -> its project, /project?id=, else the first one). */
export function useActiveProject() {
  const pathname = usePathname();
  const params = useSearchParams();
  const { state } = useSession();
  const projects = state.status === 'ready' ? state.session.accessibleProjects : [];
  const id = params.get('id');
  const boardId = pathname === '/board' ? id : null;
  const board = useQuery({ ...boardQueryOptions(boardId), enabled: !!boardId && state.status === 'ready' });
  const projectId = pathname === '/project' ? id : board.data?.board.projectId ?? null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const workspace = state.status === 'ready'
    ? state.session.ownedWorkspaces.find((w) => w.id === project?.workspaceId) ?? state.session.ownedWorkspaces[0] ?? null
    : null;
  const boards = useQuery({
    queryKey: ['boards', projectId],
    queryFn: async () => (await api.listProjectBoards(projectId!)).data,
    enabled: !!projectId && state.status === 'ready',
  });
  const role: Role = normalizeRole(project?.role);
  return { projectId, project, workspace, role, boardId, boards: boards.data ?? [], board: board.data ?? null, projects };
}
