'use client';

import { useEffect } from 'react';
import { useInfiniteQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from './api';
import { discardRefusedRows } from './feed-state';
import { mergeCursorPages, validateCursorPage, type CursorPage } from './comment-state';

/** Keeps cursor envelopes intact; refresh re-reads the loaded chain instead of appending duplicate first pages. */
export function useCursorFeed<T extends { id: string; version?: number }, Page extends CursorPage<T> = CursorPage<T>>(key: QueryKey, read: (cursor: string | undefined, signal: AbortSignal) => Promise<Page>, enabled = true) {
  const queryClient = useQueryClient();
  const feed = useInfiniteQuery({
    queryKey: key,
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {const page=await read(pageParam ?? undefined, signal); validateCursorPage(page,pageParam); return page;},
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: (count, error) => !(error instanceof ApiError && [401, 403, 404, 409].includes(error.status)) && count < 1,
  });
  const refused = feed.error instanceof ApiError && [401,403,404].includes(feed.error.status);
  const signature = JSON.stringify(key);
  useEffect(() => {
    // Drop protected row bodies/emails while keeping the refusal and its recovery UI. Never turn a denial into an empty success.
    if(refused) discardRefusedRows(queryClient,JSON.parse(signature),feed.error);
  },[refused,signature,queryClient,feed.error]);
  return { ...feed, items: !enabled || refused ? [] : mergeCursorPages(feed.data?.pages) };
}
