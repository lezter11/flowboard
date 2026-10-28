import { api, ApiError } from '@/lib/api';

export const BOARD_CARD_LIMIT = 15;

/** Shared by the board page and the sidebar so both read one cache entry. */
export function boardQueryOptions(boardId: string | null) {
  return {
    queryKey: ['board', boardId] as const,
    queryFn: async () => (await api.getBoardSnapshot(boardId!, { cardLimitPerColumn: BOARD_CARD_LIMIT })).data,
    enabled: !!boardId,
    retry: (count: number, error: unknown) =>
      !(error instanceof ApiError && [401, 403, 404].includes(error.status)) && count < 1,
  };
}
