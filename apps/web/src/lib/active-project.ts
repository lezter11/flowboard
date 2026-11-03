'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePathname, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { readPortfolioBoards } from './portfolio-state';
import { boardQueryOptions } from '@/lib/queries';
import { normalizeRole, type Role } from '@/lib/roles';
import { strongestRole } from '@/lib/project-switcher';
import { useSession } from '@/lib/session';
import { usePollKeys } from '@/components/polling';

/** Resolves the project the current route belongs to (board -> its project, /project?id=, else the first one). */
export function useActiveProject() {
  const client=useQueryClient();
  const pathname = usePathname();
  const params = useSearchParams();
  const { state } = useSession();
  const projects = state.status === 'ready' ? state.session.accessibleProjects : [];
  const id = params.get('id');
  const boardId = pathname === '/board' ? id : pathname === '/settings' ? params.get('board') : null;
  const board = useQuery({ ...boardQueryOptions(boardId), enabled: !!boardId && state.status === 'ready' });
  const projectId = pathname === '/project' ? id : ['/people','/my-tasks','/activity','/trash','/settings'].includes(pathname) ? params.get('project') : board.data?.board.projectId ?? null;
  const project = projects.find((p) => p.id === projectId) ?? null;
  const boards = useQuery({
    queryKey: ['boards', projectId],
    queryFn: () => readPortfolioBoards(client,projectId!,()=>api.listProjectBoards(projectId!)),
    enabled: !!projectId && state.status === 'ready',
  });
  usePollKeys([['boards', projectId]], !!projectId && state.status === 'ready');
  // The role is the one held in this project. Outside a project it is the strongest role held in any project, or none:
  // owning a project elsewhere grants nothing here, and a person with no projects gets no management navigation.
  const role: Role | null = project ? normalizeRole(project.role) : strongestRole(projects);
  return { projectId, project, role, boardId, boards: boards.data ?? [], board: board.data ?? null, projects };
}
