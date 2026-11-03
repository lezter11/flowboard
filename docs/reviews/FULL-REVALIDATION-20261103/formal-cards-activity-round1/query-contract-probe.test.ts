import assert from 'node:assert/strict';import test from 'node:test';import {lifecycleFixture} from '../../../../apps/api/test/support/lifecycle-fixture.ts';
test('observation: discussion and card discovery malformed and unknown query inputs',async t=>{
 const f=await lifecycleFixture(t);await f.post('Query probe');const rows=[];
 for(const path of ['/cards/card/comments?limit=1junk','/cards/card/comments?limit=0','/cards/card/comments?limit=101','/cards/card/comments?unexpectedField=x','/cards/card/comments?cursor=','/projects/prj/cards/search?unexpectedField=x','/projects/prj/cards/search?limit=2&titleQuery=irrelevant','/cards/card/activity?unexpectedField=x','/projects/prj/activity?unexpectedField=x','/workspaces/ws/activity?unexpectedField=x','/notifications?unexpectedField=x']){const r=await f.request('GET',path);rows.push({path,status:r.status});}
 const created=await f.request('POST','/cards/card/comments','member',{body:'Delete malformed query version'});const c=(await created.json()as any).data;
 const malformedVersion=await f.request('DELETE','/comments/'+c.id+'?expectedVersion=1junk','member');rows.push({path:'/comments/:id?expectedVersion=1junk',status:malformedVersion.status});
 console.log(JSON.stringify({observation:'query-contract-parity',rows}));assert.equal(rows[0].status,200);assert.equal(malformedVersion.status,200);
});
