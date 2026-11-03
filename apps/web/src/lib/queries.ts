import { api, ApiError } from '@/lib/api';
import type { BoardSnapshotData, BoardSnapshotQuery } from '@flowboard/contracts';

export const BOARD_CARD_LIMIT = 15;

/** Shared by the board page and the sidebar so both read one cache entry. */
export function boardQueryOptions(boardId: string | null, filters?: BoardSnapshotQuery) {
  return {
    queryKey: filters === undefined ? ['board', boardId] as const : ['board', boardId, 'view', filters] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }) => (await api.getBoardSnapshot(boardId!, { ...filters, cardLimitPerColumn: BOARD_CARD_LIMIT }, signal)).data,
    ...(filters === undefined ? {} : { placeholderData: (previous: BoardSnapshotData | undefined) => previous?.board.id === boardId ? previous : undefined }),
    enabled: !!boardId,
    retry: (count: number, error: unknown) =>
      !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  };
}
