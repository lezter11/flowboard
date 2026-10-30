'use client';

import { useQuery } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { boardQueryOptions } from '@/lib/queries';
import { normalizeRole, type Role } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { usePollKeys } from '@/components/polling';

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
  usePollKeys([['boards', projectId]], !!projectId && state.status === 'ready');
  // Outside a project (e.g. the project list) show the strongest role the actor holds.
  const ownsWorkspace = state.status === 'ready' && state.session.ownedWorkspaces.length > 0;
  const strongest = (['owner', 'manager', 'member', 'viewer'] as const).find((r) => ownsWorkspace && r === 'owner' || projects.some((p) => p.role === r));
  const role: Role = project ? normalizeRole(project.role) : normalizeRole(strongest);
  return { projectId, project, workspace, role, boardId, boards: boards.data ?? [], board: board.data ?? null, projects };
}
