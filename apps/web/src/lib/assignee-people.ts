'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

/** The project's people who may be assigned. Cached like the mention list; one query per project, so the merged board view
 *  loads the right people for each card's own project. */
export function useAssignablePeople(projectId: string | null | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['project-people', projectId, 'assignee'],
    queryFn: async () => (await api.listProjectPeople(projectId!, 'assignee')).data,
    enabled: enabled && !!projectId,
    staleTime: 60_000,
  });
}
