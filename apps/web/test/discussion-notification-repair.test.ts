import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCommentSessions } from '../src/lib/comment-state.ts';
import { redactProtectedDrafts, redactRefusedDrafts, redactSessionDraftTransition } from '../src/lib/protected-drafts.ts';
import { notificationHref } from '../src/lib/notification-link.ts';

const original = { commentId: 'comment', expectedVersion: 2, body: 'Fetched @Jo', mentions: [{ userId: 'jo', start: 8, end: 11, name: 'Jo' }] };
test('comment refusal drops untouched fetched edit copies, including through remount and later successful unrelated reads', () => {
  const sessions = createCommentSessions();
  const session = sessions.forCard('repair-actor', 'repair-card', { projectId: 'repair-project', boardId: 'repair-board' });
  session.beginEdit(original);
  redactRefusedDrafts(['comments', 'repair-card', 'repair-actor']);
  assert.equal(session.get().edit, null);
  assert.equal(sessions.forCard('repair-actor', 'repair-card', { projectId: 'repair-project', boardId: 'repair-board' }).get().edit, null);
});
test('refusal preserves user-edited work, create draft and original uncertain command without leaking across actors', async () => {
  const sessions = createCommentSessions();
  const session = sessions.forCard('changed-actor', 'changed-card', { projectId: 'changed-project', boardId: 'changed-board' });
  session.beginEdit(original);
  session.update({ create: { body: 'My new comment', mentions: [] }, edit: { ...original, body: 'My changed edit' } });
  await assert.rejects(session.edit.run({ id: 'comment', input: { body: 'Original uncertain operation', mentions: [], expectedVersion: 2 } }, async () => { throw new TypeError('reply lost'); }));
  redactRefusedDrafts(['comments', 'changed-card', 'different-actor']);
  assert.equal(session.get().edit?.body, 'My changed edit');
  redactRefusedDrafts(['comments', 'changed-card', 'changed-actor']);
  redactProtectedDrafts({ boardId: 'changed-board' });
  assert.equal(session.get().edit?.body, 'My changed edit');
  assert.equal(session.get().create.body, 'My new comment');
  await session.edit.run({ id: 'other', input: { body: 'Different', mentions: [], expectedVersion: 9 } }, async (input) => { assert.equal(input.input.body, 'Original uncertain operation'); });
  assert.equal(sessions.forCard('different-actor', 'changed-card', { projectId: 'changed-project', boardId: 'changed-board' }).get().edit, null);
});
test('card refusal, role transition and logout clear unchanged baselines but scope gain does not', () => {
  const session = createCommentSessions().forCard('transition-actor', 'transition-card', { projectId: 'transition-project', boardId: 'transition-board' });
  const before = JSON.stringify(['transition-actor', [['transition-project', 'member', false]]]);
  session.beginEdit(original);
  redactSessionDraftTransition(before, JSON.stringify(['transition-actor', [['transition-project', 'member', false], ['other', 'viewer', false]]]));
  assert.equal(session.get().edit?.body, original.body);
  redactSessionDraftTransition(before, JSON.stringify(['transition-actor', [['transition-project', 'viewer', false]]]));
  assert.equal(session.get().edit, null);
  session.beginEdit(original); redactRefusedDrafts(['card', 'transition-card', 'transition-actor']); assert.equal(session.get().edit, null);
  session.beginEdit(original); redactSessionDraftTransition(before, 'signedOut'); assert.equal(session.get().edit, null);
});
test('deleted comment tombstones clear fetched copies, while mention-only edits count as authored work', () => {
  const sessions=createCommentSessions(), session=sessions.forCard('tombstone-actor','tombstone-card');
  assert.equal(sessions.forCard('tombstone-actor','tombstone-card',{projectId:'p',boardId:'b'}),session);
  session.beginEdit(original);session.update({edit:{...original,expectedVersion:3}});
  session.reconcile([{id:original.commentId,deletedAt:'2026-11-03T00:00:00Z'}]);assert.equal(session.get().edit,null);
  session.beginEdit(original);session.update({edit:{...original,mentions:[]}});
  session.reconcile([{id:original.commentId,deletedAt:'2026-11-03T00:00:00Z'}]);assert.deepEqual(session.get().edit?.mentions,[]);
});
test('clearing an unchanged fetched editor does not cancel an original edit whose reply was lost', async () => {
  const session=createCommentSessions().forCard('unknown-actor','unknown-card',{projectId:'unknown-project',boardId:'unknown-board'});
  session.beginEdit(original);
  await assert.rejects(session.edit.run({id:original.commentId,input:{body:original.body,mentions:[],expectedVersion:original.expectedVersion}},async()=>{throw new TypeError('reply lost');}));
  redactRefusedDrafts(['comments','unknown-card','unknown-actor']);
  assert.equal(session.get().edit,null);assert.equal(session.edit.unresolved(),true);
  await session.edit.retry(async(command)=>{assert.equal(command.id,original.commentId);assert.equal(command.input.body,original.body);assert.equal(command.input.expectedVersion,original.expectedVersion);});
  await assert.rejects(session.edit.retry(async()=>assert.fail('No pending command may be invented')),/No original request/);
});
test('notification server links map once-encoded exact board and card identifiers', () => {
  assert.equal(notificationHref('/projects/p/boards/b?cardId=c'), '/board?id=b&card=c');
  assert.equal(notificationHref('/projects/p/boards/b?card=c'), '/board?id=b&card=c');
  assert.equal(notificationHref('/projects/p/boards/b%20one?cardId=c%20two'), '/board?id=b%20one&card=c%20two');
});
test('notification mapping rejects external, malformed, ambiguous and wrong-resource routes', () => {
  for (const link of ['https://evil.example/projects/p/boards/b?cardId=c', '//evil.example/projects/p/boards/b?cardId=c', 'javascript:alert(1)', '/projects/p/boards/b?cardId=c&cardId=d', '/projects/p/boards/b?cardId=c&card=c', '/projects/p/boards/b?cardId=%ZZ', '/projects/p/boards/%?cardId=c', '/projects/p/boards/b?cardId=c#fragment', '/projects/p/boards/b/other?cardId=c', '/projects/p/boards/b?cardId=c&boardId=other', '/projects/p/boards/b?cardId=', '/projects/p/boards/%252Fbad?cardId=c', '/projects/p/boards/b?cardId=c%2Fother', '/projects/p/boards/b?cardId=c%00', '/projects/p/boards/b?cardId=c&unknown=x', '/projects/../boards/b?cardId=c']) assert.equal(notificationHref(link), null, link);
});
