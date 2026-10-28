import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { signBoardAccessCursor, verifyBoardAccessCursor } from '../src/services/board-access-cursor-draft.ts';

// Deterministic test-only key; production must provision a random secret.
const key = new Uint8Array(32).fill(42);
const otherKey = new Uint8Array(32).fill(43);
const payload = {v:1 as const, boardId:'board_α', actorId:'owner', revision:'12', lastUserId:'member_é'};
const scope = {boardId:payload.boardId, actorId:payload.actorId};

test('Web Crypto cursor round-trips exact fields including Unicode and deterministic canonical serialization', async () => {
  const token = await signBoardAccessCursor(payload, key);
  assert.equal(await signBoardAccessCursor(payload, key), token);
  assert.deepEqual(await verifyBoardAccessCursor(token, key, scope), payload);
});

test('rejects altered token, altered scope and another key', async () => {
  const token = await signBoardAccessCursor(payload, key);
  const parts = token.split('.');
  const body = JSON.parse(Buffer.from(parts[0]!, 'base64url').toString('utf8'));
  body.revision = '13';
  const tampered = Buffer.from(JSON.stringify(body)).toString('base64url') + '.' + parts[1];
  await assert.rejects(verifyBoardAccessCursor(tampered, key, scope), /Invalid board access cursor/);
  await assert.rejects(verifyBoardAccessCursor(token, otherKey, scope), /Invalid board access cursor/);
  await assert.rejects(verifyBoardAccessCursor(token, key, {...scope, boardId:'other'}), /Invalid board access cursor/);
  await assert.rejects(verifyBoardAccessCursor(token, key, {...scope, actorId:'other'}), /Invalid board access cursor/);
});

test('rejects missing and weak keys before issuing or verifying tokens', async () => {
  const token = await signBoardAccessCursor(payload, key);
  for (const weak of [new Uint8Array(), new Uint8Array(31), undefined]) {
    await assert.rejects(signBoardAccessCursor(payload, weak as Uint8Array), /secret/);
    await assert.rejects(verifyBoardAccessCursor(token, weak as Uint8Array, scope), /secret/);
  }
});

test('rejects malformed, overlong, noncanonical and invalid signed payloads', async () => {
  for (const token of ['', 'a', 'a.b.c', 'a=.b', 'x'.repeat(4097), 'a.b']) {
    await assert.rejects(verifyBoardAccessCursor(token, key, scope), /Invalid board access cursor/);
  }
  function signedRaw(raw: string): string {
    const body = Buffer.from(raw).toString('base64url');
    const mac = createHmac('sha256', key).update(body).digest('base64url');
    return `${body}.${mac}`;
  }
  const noncanonical = signedRaw(JSON.stringify({boardId:payload.boardId, v:1, actorId:payload.actorId, revision:'12', lastUserId:payload.lastUserId}));
  await assert.rejects(verifyBoardAccessCursor(noncanonical, key, scope), /Invalid board access cursor/);
  for (const revision of ['0', '01', '-1', '9223372036854775808']) {
    await assert.rejects(signBoardAccessCursor({...payload,revision}, key), /Invalid board access cursor/);
    await assert.rejects(verifyBoardAccessCursor(signedRaw(JSON.stringify({...payload,revision})), key, scope), /Invalid board access cursor/);
  }
  await assert.rejects(verifyBoardAccessCursor(signedRaw(JSON.stringify({...payload,extra:'x'})), key, scope), /Invalid board access cursor/);
});
