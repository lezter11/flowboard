'use client';

import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Board, BoardSnapshotData, SessionProjectSummary } from '@flowboard/contracts';
import { api } from '@/lib/api';
import { usePollKeys } from '@/components/polling';
import { readPortfolioBoards, portfolioPollKeys } from './portfolio-state';
import { discardRefusedRows } from './feed-state';
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
export function usePortfolio(loadedProjects:SessionProjectSummary[]) {
  const { state } = useSession();
  const client=useQueryClient();
  const projects: SessionProjectSummary[] = state.status === 'ready' ? loadedProjects : [];
  const boardQueries = useQueries({
    queries: projects.map((project) => ({
      queryKey: ['boards', project.id],
      queryFn: () => readPortfolioBoards(client,project.id,()=>api.listProjectBoards(project.id)),
      enabled: state.status === 'ready',
    })),
  });
  const boardsByProject = new Map<string, Board[]>();
  projects.forEach((project,index)=>{if(boardQueries[index]?.isSuccess)boardsByProject.set(project.id,boardQueries[index]?.data??[]);});
  const boardListsReady=new Map(projects.map((project,index)=>[project.id,!!boardQueries[index]?.isSuccess]));
  const allBoards = projects.flatMap((project) => boardsByProject.get(project.id) ?? []).filter((b) => !b.isArchived).slice(0, 24);
  const snapshotQueries = useQueries({
    queries: allBoards.map((board) => ({
      queryKey: ['board-stats', board.id],
      queryFn: async ({signal}) => {try{return (await api.getBoardSnapshot(board.id, { cardLimitPerColumn: 1 },signal)).data;}catch(error){discardRefusedRows(client,['board-stats',board.id],error);throw error;}},
      staleTime: 30_000,
    })),
  });
  usePollKeys(portfolioPollKeys(projects.map((p)=>p.id),allBoards.map((b)=>b.id)),state.status==='ready');
  const statsByBoard = new Map<string, BoardStats | null>();
  allBoards.forEach((board, index) => statsByBoard.set(board.id, snapshotQueries[index]?.isSuccess?statsFromSnapshot(snapshotQueries[index]?.data):null));
  const loading = state.status === 'loading' || boardQueries.some((q) => q.isPending);
  return { projects, boardsByProject, statsByBoard, boardListsReady, loading };
}

export function useProjectBoards(projectId: string | null, includeArchived = false) {
  const client=useQueryClient();
  const key=includeArchived ? ['boards', projectId, 'include-archived'] : ['boards', projectId];
  return useQuery({
    queryKey:key,
    queryFn: () => readPortfolioBoards(client,projectId!,()=>api.listProjectBoards(projectId!, { includeArchived }),key),
    enabled: !!projectId,
  });
}
