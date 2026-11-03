import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';

test('strict command boundaries reject unknown fields without writes or receipts', async t => {
 const f=await lifecycleFixture(t); const c=await f.post();
 const boardVersion=await f.version();
 const cases:[string,string,object][]=[
  ['POST','/boards/brd/cards',{title:'Rejected',columnId:'col',expectedBoardVersion:boardVersion}],
  ['PATCH','/cards/card',{title:'Rejected',expectedVersion:1}],
  ['POST','/cards/card/move',{toColumnId:'col',previousCardId:null,nextCardId:null,expectedVersion:1,expectedBoardVersion:boardVersion}],
  ['POST','/cards/card/move-undo',{expectedVersion:1,expectedBoardVersion:boardVersion}],
  ['POST','/cards/card/comments',{body:'Rejected',mentions:[]}],
  ['PATCH',`/comments/${c.id}`,{body:'Rejected',mentions:[],expectedVersion:1}],
  ['DELETE',`/comments/${c.id}`,{expectedVersion:1}],
 ];
 const before=await f.pool.query(`SELECT (SELECT count(*) FROM idempotency_receipts)::int AS receipts,(SELECT count(*) FROM cards)::int AS cards,(SELECT count(*) FROM activity_log)::int AS activities`);
 for(const [method,path,body]of cases){const r=await f.request(method,path,'member',{...body,unexpectedField:true});assert.equal(r.status,422,method+' '+path+' '+await r.text());}
 const body='@Retention manager';
 const nested=await f.request('POST','/cards/card/comments','member',{body,mentions:[{userId:f.actors.manager!.user.id,start:0,end:body.length,unexpectedField:true}]});
 assert.equal(nested.status,422,await nested.text());
 const after=await f.pool.query(`SELECT (SELECT count(*) FROM idempotency_receipts)::int AS receipts,(SELECT count(*) FROM cards)::int AS cards,(SELECT count(*) FROM activity_log)::int AS activities`);
 assert.deepEqual(after.rows,before.rows);
 assert.equal((await f.pool.query('SELECT version,deleted_at,body FROM comments WHERE id=$1',[c.id])).rows[0].body,c.body);
});

test('strict card and comment query boundaries reject malformed and ignored values',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post();
 for(const path of ['/cards/card/comments','/boards/brd/cards','/projects/prj/cards/search'])for(const query of ['limit=1junk','limit=0','limit=101','limit=','limit=1.5','limit=1e1','cursor=','unknown=true']){
  const r=await f.request('GET',path+'?'+query,'member');assert.equal(r.status,422,path+'?'+query+' '+await r.text());
 }
 for(const path of ['/boards/brd/cards','/projects/prj/cards/search'])for(const query of ['query=','titleQuery=ignored']){
  const r=await f.request('GET',path+'?'+query,'member');assert.equal(r.status,422,path+'?'+query+' '+await r.text());
 }
 for(const query of ['expectedVersion=1junk','expectedVersion=','expectedVersion=-1','expectedVersion=1.5','expectedVersion=1e0','expectedVersion=1&unknown=1']){
  const r=await f.request('DELETE',`/comments/${c.id}?`+query,'member');assert.equal(r.status,422,query+' '+await r.text());
 }
 assert.equal((await f.pool.query('SELECT deleted_at FROM comments WHERE id=$1',[c.id])).rows[0].deleted_at,null);
 assert.equal((await f.request('GET','/cards/card/comments?limit=1','member')).status,200);
 assert.equal((await f.request('GET','/projects/prj/cards/search?query=Discussion&limit=1','member')).status,200);
 for(const path of ['/cards/card/comments','/boards/brd/cards','/projects/prj/cards/search'])assert.equal((await f.request('GET',path+'?limit=1junk','outsider')).status,404,path);
 assert.equal((await f.request('DELETE',`/comments/${c.id}?expectedVersion=1junk`,'outsider')).status,404);
 const valid=await f.request('DELETE',`/comments/${c.id}?expectedVersion=1`,'member');assert.equal(valid.status,200,await valid.text());
});


test('delete comment body/query alternatives reject conflicts, unknown query and malformed JSON before mutation',async t=>{
 const f=await lifecycleFixture(t);const c=await f.post();
 for(const [query,body]of [['expectedVersion=2',{expectedVersion:1}],['unknown=1',{expectedVersion:1}]] as const){const r=await f.request('DELETE',`/comments/${c.id}?`+query,'member',body);assert.equal(r.status,422,await r.text());}
 const malformed=await f.app.request(`http://localhost/api/v1/comments/${c.id}?expectedVersion=1`,{method:'DELETE',headers:{cookie:`flowboard_session=${f.actors.member!.session.id}`,origin:'http://localhost','idempotency-key':'malformed-comment-delete-key','content-type':'application/json'},body:'{"expectedVersion":'});
 assert.equal(malformed.status,400);assert.equal((await malformed.json() as any).error.code,'MALFORMED_REQUEST');
 assert.equal((await f.pool.query('SELECT deleted_at FROM comments WHERE id=$1',[c.id])).rows[0].deleted_at,null);
 const valid=await f.request('DELETE',`/comments/${c.id}?expectedVersion=1`,'member',{expectedVersion:1});assert.equal(valid.status,200,await valid.text());
});
