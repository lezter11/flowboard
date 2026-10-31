'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** People who may be assigned on ONE board: the server keeps the Owner and active Managers and Members holding a grant on it.
 *  The board id is required (the server answers BOARD_REQUIRED without it); in the merged view pass the card's own board. */
export function useAssignablePeople(projectId: string | null | undefined, boardId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['project-people', projectId, 'assignee', boardId ?? null],
    queryFn: async () => (await api.listProjectPeople(projectId!, 'assignee', { boardId: boardId! })).data,
    enabled: enabled && !!projectId && !!boardId,
    staleTime: 60_000,
  });
}

/** Everyone active in the project with their role (purpose=display). Used only to tell Owners and Managers who is blocked by a missing board grant. */
export function useProjectPeople(projectId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['project-people', projectId, 'display'],
    queryFn: async () => (await api.listProjectPeople(projectId!, 'display')).data,
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });
}
