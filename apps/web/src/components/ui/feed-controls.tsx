'use client';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ErrorNote } from './error-note';
/** The recovery controls operate on this feed only, leaving independent drafts untouched. */
export function FeedControls({name,queryKey,feed,loaded}:{name:string;queryKey:QueryKey;loaded:number;feed:{error:Error|null;isPending:boolean;isFetching:boolean;isFetchNextPageError:boolean;isFetchingNextPage:boolean;hasNextPage:boolean;fetchNextPage:()=>Promise<unknown>;refetch:()=>Promise<unknown>}}) {
  const client=useQueryClient(); const stale=!!feed.error && 'code' in feed.error && ['STALE_CURSOR','INVALID_CURSOR'].includes(String(feed.error.code));
  return <div className="feed-controls">
    {feed.error && <ErrorNote error={feed.error} onRetry={stale?undefined:()=>void(feed.isFetchNextPageError?feed.fetchNextPage():feed.refetch())} />}
    {stale && <p className="hint">This list changed. Your drafts are kept. <button className="btn" type="button" onClick={()=>void client.resetQueries({queryKey,exact:true})}>Reload {name}</button></p>}
    {!feed.isPending && <p className="field-help" role="status">{loaded} loaded{feed.hasNextPage?'; more available.':feed.error?'.':'; end of this list.'}</p>}
    {feed.hasNextPage && !stale && <button className="btn" type="button" disabled={feed.isFetching} onClick={()=>void feed.fetchNextPage()}>{feed.isFetchingNextPage?'Loading…':`Load more ${name}`}</button>}
  </div>;
}
