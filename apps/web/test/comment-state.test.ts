import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRetainedCommand } from '../src/lib/retained-command.ts';
import { commentPermissions, createCommentSessions, editDraftFromComment, isComposingInput, mergeCursorPages, validateCursorPage } from '../src/lib/comment-state.ts';
import { api } from '../src/lib/api.ts';
import { finalizeMentions } from '../src/lib/mentions.ts';
import { hasUnsaved, resetUnsavedForTests } from '../src/lib/unsaved.ts';

test('committed lost reply retries the original comment payload/key through the real API client', async () => {
  const original = globalThis.fetch;
  const receipts = new Map<string, string>();
  const sent: Array<{ key: string; body: string }> = [];
  let loseReply = true;
  globalThis.fetch = async (_url, init) => {
    const key = new Headers(init?.headers).get('Idempotency-Key')!;
    const body = String(init?.body);
    sent.push({ key, body });
    if (receipts.has(key)) assert.equal(receipts.get(key), body);
    else receipts.set(key, body);
    if (loseReply) { loseReply = false; throw new TypeError('reply lost after commit'); }
    return Response.json({ data: { id: 'saved-once', version: 1 }, replayed: true });
  };
  try {
    const operation = createRetainedCommand<{ body: string; mentions: Array<{ userId: string; start: number; end: number }> }>();
    const input = { body: 'Hi @Jo', mentions: [{ userId: 'jo', start: 3, end: 6 }] };
    await assert.rejects(operation.run(input, (body, key) => api.postCardComment('c', body, key)));
    input.body = 'Edited while response was unknown'; input.mentions[0]!.end = 999;
    await operation.run(input, (body, key) => api.postCardComment('c', body, key));
    assert.equal(receipts.size, 1);
    assert.equal(sent.length, 2);
    assert.equal(sent[1]!.key, sent[0]!.key);
    assert.equal(sent[1]!.body, '{"body":"Hi @Jo","mentions":[{"userId":"jo","start":3,"end":6}]}');
    assert.equal(operation.unresolved(), false);
  } finally { globalThis.fetch = original; }
});

test('quick-add retains expected board version and original explicit priority after an unknown 503', async () => {
  let number = 0;
  const operation = createRetainedCommand<{ title: string; priority: string; expectedBoardVersion: number }>(() => `attempt-${++number}`);
  const sent: unknown[] = [];
  const send = async (input: unknown, key: string) => { sent.push({ input, key }); if (sent.length === 1) throw { status: 503 }; return 'created'; };
  await assert.rejects(operation.run({ title: 'First', priority: 'high', expectedBoardVersion: 7 }, send));
  await operation.run({ title: 'Other', priority: 'urgent', expectedBoardVersion: 9 }, send);
  assert.deepEqual(sent, [{ input: { title: 'First', priority: 'high', expectedBoardVersion: 7 }, key: 'attempt-1' }, { input: { title: 'First', priority: 'high', expectedBoardVersion: 7 }, key: 'attempt-1' }]);
  await operation.run({ title: 'Next', priority: 'low', expectedBoardVersion: 9 }, send);
  assert.equal(number, 2);
});

test('definitive validation refusal permits a new edited intent, in-flight submissions share one request', async () => {
  let number = 0;
  const operation = createRetainedCommand<{ body: string }>(() => `attempt-${++number}`);
  await assert.rejects(operation.run({ body: 'invalid' }, async () => { throw { status: 422 }; }));
  assert.equal(operation.unresolved(), false);
  let release!: () => void; let calls = 0;
  const send = async () => { calls++; await new Promise<void>((r) => { release = r; }); return 1; };
  const a = operation.run({ body: 'fixed' }, send);
  const b = operation.run({ body: 'different' }, send);
  await Promise.resolve();
  release();
  assert.deepEqual(await Promise.all([a, b]), [1, 1]);
  assert.equal(calls, 1); assert.equal(number, 2);
});

test('a synchronous validation failure does not leave the next operation stuck on a rejected request', async () => {
  const operation = createRetainedCommand<{ body: string }>();
  await assert.rejects(operation.run({ body: 'bad' }, () => { throw { status: 422 }; }));
  assert.equal(await operation.run({ body: 'fixed' }, async (input) => input.body), 'fixed');
});

test('a later authorization refusal cannot erase an earlier unknown committed operation', async () => {
  let number = 0;
  const operation = createRetainedCommand<{ body: string }>(() => `attempt-${++number}`);
  const requests: Array<{ input: { body: string }; key: string }> = [];
  let outcome = 0;
  const send = async (input: { body: string }, key: string) => {
    requests.push({ input, key }); outcome++;
    if (outcome === 1) throw new TypeError('committed reply lost');
    if (outcome === 2) throw { status: 401 };
    return 'replayed after sign-in';
  };
  await assert.rejects(operation.run({ body: 'original' }, send));
  await assert.rejects(operation.run({ body: 'changed' }, send));
  assert.equal(operation.unresolved(), true);
  assert.equal(await operation.run({ body: 'changed again' }, send), 'replayed after sign-in');
  assert.deepEqual(requests, [
    { input: { body: 'original' }, key: 'attempt-1' },
    { input: { body: 'original' }, key: 'attempt-1' },
    { input: { body: 'original' }, key: 'attempt-1' },
  ]);
});

test('cursor pages keep order, replace edited/deleted duplicates and reject cursor loops', () => {
  const items = mergeCursorPages([
    { data: [{ id: 'a', version: 1, body: 'private old body' }, { id: 'b', version: 1, body: 'B' }], nextCursor: 'next' },
    { data: [{ id: 'a', version: 2, body: '' }, { id: 'c', version: 1, body: 'C' }], nextCursor: null },
  ]);
  assert.deepEqual(items.map((x) => [x.id, x.body]), [['a', ''], ['b', 'B'], ['c', 'C']]);
  assert.throws(() => validateCursorPage({ data: [], nextCursor: 'same' }, 'same'), /cursor/i);
  assert.deepEqual(validateCursorPage({ data: [], nextCursor: null }, 'last'), { data: [], nextCursor: null });
});

test('roles distinguish author editing from moderation and never grant Viewer write controls', () => {
  assert.deepEqual(commentPermissions('manager', 'm', { authorId: 'other', deletedAt: null }), { edit: false, remove: true });
  assert.deepEqual(commentPermissions('owner', 'o', { authorId: 'other', deletedAt: null }), { edit: false, remove: true });
  assert.deepEqual(commentPermissions('member', 'me', { authorId: 'me', deletedAt: null }), { edit: true, remove: true });
  assert.deepEqual(commentPermissions('member', 'me', { authorId: 'other', deletedAt: null }), { edit: false, remove: false });
  assert.deepEqual(commentPermissions('viewer', 'me', { authorId: 'me', deletedAt: null }), { edit: false, remove: false });
  assert.deepEqual(commentPermissions('owner', 'o', { authorId: 'o', deletedAt: 'now' }), { edit: false, remove: false });
});

test('comment create/edit drafts remain actor/card-scoped through remount and clearing one draft keeps the other', () => {
  resetUnsavedForTests();
  const sessions = createCommentSessions();
  const session = sessions.forCard('actor', 'card');
  session.update({ create: { body: 'unsent original', mentions: [] } });
  session.update({ edit: { commentId: 'comment', expectedVersion: 4, body: 'unsaved edit', mentions: [] } });
  assert.equal(sessions.forCard('actor', 'card').get().create.body, 'unsent original');
  assert.equal(sessions.forCard('other', 'card').get().create.body, '');
  assert.equal(sessions.forCard('actor', 'other').get().edit, null);
  session.update({ create: { body: '', mentions: [] } });
  assert.equal(hasUnsaved(), true);
  assert.equal(session.get().edit?.body, 'unsaved edit');
  session.update({ edit: null }); assert.equal(hasUnsaved(), false);
});

test('edit restores actual UTF-16 spans, leaves malformed spans literal, and IME Enter is ignored', () => {
  const draft = editDraftFromComment({ id: 'c', version: 3, body: '😀 @Jo', mentions: [{ userId: 'jo', start: 3, end: 6 }] });
  assert.deepEqual(finalizeMentions(draft.body, draft.mentions), { body: '😀 @Jo', mentions: [{ userId: 'jo', start: 3, end: 6 }] });
  assert.equal(editDraftFromComment({ id: 'bad', version: 1, body: 'plain', mentions: [{ userId: 'jo', start: 0, end: 999 }] }).mentions.length, 0);
  assert.equal(isComposingInput({ isComposing: true }), true);
  assert.equal(isComposingInput({ keyCode: 229 }), true);
  assert.equal(isComposingInput({ isComposing: false, keyCode: 13 }), false);
});
