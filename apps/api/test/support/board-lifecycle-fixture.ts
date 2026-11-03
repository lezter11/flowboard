import type pg from 'pg';
const originalBodies=new WeakMap<pg.Pool,Map<string,object>>();
/** Unrelated legacy fixtures now send the API's existing required snapshot version.
 * A supplied version is never replaced, and repeated command keys retain their original body.
 * Dedicated OCC tests send explicit stale versions without this convenience helper.
 */
export async function versionedBoardLifecycleBody(pool:pg.Pool,path:string,body:unknown,key?:string):Promise<any>{
  const board=path.match(/^\/api\/v1\/boards\/([^/]+)\/(?:archive|reopen)$/)?.[1];
  if(!board||body&&typeof body==='object'&&'expectedVersion'in body)return body;
  const cache=originalBodies.get(pool)??new Map<string,object>();originalBodies.set(pool,cache);
  const identity=key?path+':'+key:undefined;
  if(identity&&cache.has(identity))return cache.get(identity);
  const current=await pool.query<{snapshot_version:number}>('SELECT snapshot_version FROM boards WHERE id=$1',[board]);
  const result={...(body&&typeof body==='object'?body:{}),expectedVersion:current.rows[0]?.snapshot_version??0};
  if(identity)cache.set(identity,result);return result;
}

/** Legacy project callers may supply a currently observed fixture version only
 * when omitted. A supplied version is never replaced, and an exact command key
 * retains its original body even after a later lifecycle transition. */
export async function versionedProjectLifecycleBody(pool:pg.Pool,path:string,body:unknown,key?:string):Promise<any>{
  const project=path.match(/^\/api\/v1\/projects\/([^/]+)\/(?:archive|reopen)$/)?.[1];
  if(!project||body&&typeof body==='object'&&'expectedVersion'in body)return body;
  const cache=originalBodies.get(pool)??new Map<string,object>();originalBodies.set(pool,cache);
  const identity=key?path+':'+key:undefined;
  if(identity&&cache.has(identity))return cache.get(identity);
  const current=await pool.query<{version:number}>('SELECT version FROM projects WHERE id=$1',[project]);
  const result={...(body&&typeof body==='object'?body:{}),expectedVersion:current.rows[0]?.version??0};
  if(identity)cache.set(identity,result);return result;
}
