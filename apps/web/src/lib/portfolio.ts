'use client';

import { useQueries, useQuery } from '@tanstack/react-query';
import type { Board, BoardSnapshotData, SessionProjectSummary } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';

export const PROJECT_TONES = ['thistle', 'petal', 'pink', 'icy', 'sky', 'slate'] as const;
export type ProjectTone = (typeof PROJECT_TONES)[number];

/** The API has no project tone; derive a stable one from the project id (prototype fixtures carry a tone). */
export function projectTone(id: string): ProjectTone {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return PROJECT_TONES[hash % PROJECT_TONES.length]!;
}

export const projectMark = (name: string) => name.slice(0, 2).toUpperCase();

export interface BoardStats { total: number; done: number; open: number; percent: number }

export function statsFromSnapshot(snapshot: BoardSnapshotData | undefined): BoardStats | null {
  if (!snapshot) return null;
  const total = snapshot.totals.activeCardCount;
  const done = snapshot.columns.filter((c) => c.category === 'done').reduce((sum, c) => sum + c.activeCardCount, 0);
  return { total, done, open: total - done, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** Projects the actor can open, with their boards, and a card snapshot (1 card per column) per board for the counts. */
export function usePortfolio() {
  const { state } = useSession();
  const projects: SessionProjectSummary[] = state.status === 'ready' ? state.session.accessibleProjects : [];
  const boardQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['boards', project.id],
      queryFn: async () => (await api.listProjectBoards(project.id)).data,
      enabled: state.status === 'ready',
    })),
  });
  const boardsByProject = new Map<string, Board[]>();
  projects.forEach((project, index) => boardsByProject.set(project.id, boardQueries[index]?.data ?? []));
  const allBoards = projects.flatMap((project) => boardsByProject.get(project.id) ?? []).filter((b) => !b.isArchived).slice(0, 24);
  const snapshotQueries = useQueries({
    queries: allBoards.map((board) => ({
      queryKey: ['board-stats', board.id],
      queryFn: async () => (await api.getBoardSnapshot(board.id, { cardLimitPerColumn: 1 })).data,
      staleTime: 30_000,
    })),
  });
  const statsByBoard = new Map<string, BoardStats | null>();
  allBoards.forEach((board, index) => statsByBoard.set(board.id, statsFromSnapshot(snapshotQueries[index]?.data)));
  const loading = state.status === 'loading' || boardQueries.some((q) => q.isPending);
  return { projects, boardsByProject, statsByBoard, loading };
}

export function useProjectBoards(projectId: string | null) {
  return useQuery({
    queryKey: ['boards', projectId],
    queryFn: async () => (await api.listProjectBoards(projectId!)).data,
    enabled: !!projectId,
  });
}
