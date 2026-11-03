import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleFixture } from '../../../../apps/api/test/support/lifecycle-fixture.ts';
import { createCommentSessions, editDraftFromComment } from '../../../../apps/web/src/lib/comment-state.ts';
import { redactProtectedDrafts, redactRefusedDrafts, redactSessionDraftTransition } from '../../../../apps/web/src/lib/protected-drafts.ts';

test('observation: edit comment source and read recipient notification after removing sensitive original body', async t => {
  const f=await lifecycleFixture(t);
  const secret='SYNTHETIC_SECRET_REMOVED_BY_AUTHOR';
  const source=await f.post(secret);
  const edit=await f.request('PATCH','/comments/'+source.id,'member',{body:'Corrected ordinary message',mentions:[],expectedVersion:1});
  assert.equal(edit.status,200,await edit.clone().text());
  const inbox=await f.request('GET','/notifications','manager');
  assert.equal(inbox.status,200);
  const rows=(await inbox.json() as any).data;
  const sourceBody=(await f.pool.query('SELECT body FROM comments WHERE id=$1',[source.id])).rows[0].body;
  console.log(JSON.stringify({observation:'comment-edit-notification-retention',sourceBody,notificationBodies:rows.map((x:any)=>x.body),oldSensitiveBodyRemains:rows.some((x:any)=>x.body.includes(secret))}));
  assert.equal(sourceBody,'Corrected ordinary message');
  assert.equal(rows.length,1);
  assert.equal(rows.some((x:any)=>x.body.includes(secret)),true,'Observation pins current behavior, not acceptance');
});

test('observation: copied fetched comment edit survives all protected-draft refusal hooks', () => {
  const sessions=createCommentSessions();
  const session=sessions.forCard('review_actor','review_card');
  const saved={id:'review_comment',version:1,body:'SYNTHETIC_FETCHED_CANONICAL_BODY',mentions:[]};
  session.update({edit:editDraftFromComment(saved)});
  redactRefusedDrafts(['card','review_card','review_actor']);
  redactRefusedDrafts(['comments','review_card','review_actor']);
  redactSessionDraftTransition(JSON.stringify(['review_actor',[['review_project','member',false]]]),JSON.stringify(['review_actor',[]]));
  redactProtectedDrafts({actorId:'review_actor'});
  console.log(JSON.stringify({observation:'canonical-comment-edit-retention',editBody:session.get().edit?.body,ownChangesMade:false}));
  assert.equal(session.get().edit?.body,saved.body,'Observation pins current behavior, not acceptance');
  sessions.clear();
});

test('observation: unknown public card/comment write fields are silently stripped',async t=>{
 const f=await lifecycleFixture(t);const observations=[];
 const create=await f.request('POST','/boards/brd/cards','member',{title:'Unknown schema field',columnId:'col2',expectedBoardVersion:await f.version(),unexpectedField:'must reject'});observations.push({operation:'card-create',status:create.status});assert.equal(create.status,201);
 const card=(await create.json()as any).data;
 const update=await f.request('PATCH','/cards/'+card.id,'member',{title:'Changed',expectedVersion:card.version,unexpectedField:'must reject'});observations.push({operation:'card-update',status:update.status});assert.equal(update.status,200);
 const updated=(await update.json()as any).data;
 const move=await f.request('POST','/cards/'+card.id+'/move','member',{toColumnId:'col',previousCardId:null,nextCardId:null,expectedVersion:updated.version,expectedBoardVersion:await f.version(),unexpectedField:'must reject'});observations.push({operation:'card-move',status:move.status});assert.equal(move.status,200);
 const moved=(await move.json()as any).data;
 const undo=await f.request('POST','/cards/'+card.id+'/move-undo','member',{expectedVersion:moved.version,expectedBoardVersion:await f.version(),unexpectedField:'must reject'});observations.push({operation:'card-move-undo',status:undo.status});assert.equal(undo.status,200);
 const post=await f.request('POST','/cards/card/comments','member',{body:'Unknown post',unexpectedField:'must reject'});observations.push({operation:'comment-create',status:post.status});assert.equal(post.status,201);
 const comment=(await post.json()as any).data;
 const edit=await f.request('PATCH','/comments/'+comment.id,'member',{body:'Unknown edit',expectedVersion:1,unexpectedField:'must reject'});observations.push({operation:'comment-edit',status:edit.status});assert.equal(edit.status,200);
 const remove=await f.request('DELETE','/comments/'+comment.id,'member',{expectedVersion:2,unexpectedField:'must reject'});observations.push({operation:'comment-delete',status:remove.status});assert.equal(remove.status,200);
 const body='Nested @Retention manager';const start=body.indexOf('@');
 const nested=await f.request('POST','/cards/card/comments','member',{body,mentions:[{userId:f.actors.manager!.user.id,start,end:body.length,unexpectedField:'must reject'}]});observations.push({operation:'comment-mention-nested',status:nested.status});assert.equal(nested.status,201);
 console.log(JSON.stringify({observation:'unknown-field-acceptance',observations,receiptCount:Number((await f.pool.query('SELECT COUNT(*) FROM idempotency_receipts')).rows[0].count)}));
});
