import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, InfiniteQueryObserver } from '@tanstack/react-query';
import { ApiError } from '../src/lib/api.ts';
import { discardRefusedRows } from '../src/lib/feed-state.ts';
import { mergeCursorPages } from '../src/lib/comment-state.ts';

test('real query client continuation preserves server order, and refresh replaces the entire loaded cursor chain',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});let generation=0;const seen:Array<string|null>=[];
  const observer=new InfiniteQueryObserver(client,{queryKey:['feed','actor'],enabled:false,initialPageParam:null as string|null,queryFn:async({pageParam})=>{seen.push(pageParam);return {data:[{id:pageParam?'last':'first',version:generation,title:`generation${generation}`}],nextCursor:pageParam?null:`cursor${generation}`};},getNextPageParam:(last)=>last.nextCursor??undefined});
  const unsubscribe=observer.subscribe(()=>{});
  try {
    await observer.refetch();await observer.fetchNextPage();assert.deepEqual(seen,[null,'cursor0']);assert.deepEqual(mergeCursorPages(observer.getCurrentResult().data?.pages).map((r)=>r.id),['first','last']);
    generation=1;await observer.refetch();assert.deepEqual(seen,[null,'cursor0',null,'cursor1']);const rows=mergeCursorPages(observer.getCurrentResult().data?.pages);assert.equal(rows.length,2);assert.ok(rows.every((r)=>r.title==='generation1'));assert.equal(observer.getCurrentResult().hasNextPage,false);
  }finally{unsubscribe();observer.destroy();client.clear();}
});

test('access refusal clears protected cached row bodies and leaves the actual error status intact',async()=>{
  const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});const key=['notifications','actor'];
  try {client.setQueryData(key,{pages:[{data:[{id:'secret',body:'private'}],nextCursor:null}],pageParams:[null]});const query=client.getQueryCache().find({queryKey:key})!;const refusal=new ApiError(403,'FORBIDDEN','refused');query.setState({error:refusal,status:'error'});assert.equal(discardRefusedRows(client,key,refusal),true);assert.equal(client.getQueryData(key),undefined);assert.equal(query.state.status,'error');assert.equal(query.state.error,refusal);assert.equal(discardRefusedRows(client,key,new ApiError(503,'UNAVAILABLE','offline')),false);}finally{client.clear();}
});
