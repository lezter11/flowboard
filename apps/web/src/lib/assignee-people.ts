'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** The project's people who may be assigned. With a boardId the server keeps only people who hold a grant on that board (it refuses
 *  anyone else on save); without one it returns every Owner, Manager and Member. Cached like the mention list, one query per project and board. */
export function useAssignablePeople(projectId: string | null | undefined, boardId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['project-people', projectId, 'assignee', boardId ?? null],
    queryFn: async () => (await api.listProjectPeople(projectId!, 'assignee', boardId ? { boardId } : {})).data,
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });
}
