import assert from 'node:assert/strict';
import test from 'node:test';
import { canInitiateTrashRestore } from '../src/lib/trash-restore.ts';

test('missing original destination can initiate explicit destination recovery within the live window', () => {
  assert.equal(canInitiateTrashRestore({ canRestore: false, blockedReason: 'destination_missing' }, 1, false), true);
});

test('restore initiation refuses the exact server cutoff, expiration and archived contexts', () => {
  for (const blockedReason of [null, 'destination_missing'] as const) {
    const row = { canRestore: blockedReason === null, blockedReason };
    assert.equal(canInitiateTrashRestore(row, 0, false), false);
    assert.equal(canInitiateTrashRestore(row, -1, false), false);
    assert.equal(canInitiateTrashRestore(row, 60_000, true), false);
  }
  for (const blockedReason of ['window_expired', 'project_archived', 'board_archived'] as const) {
    assert.equal(canInitiateTrashRestore({ canRestore: false, blockedReason }, 60_000, false), false);
  }
  assert.equal(canInitiateTrashRestore({ canRestore: false, blockedReason: null }, 60_000, false), false);
  assert.equal(canInitiateTrashRestore({ canRestore: true, blockedReason: null }, 1, false), true);
});
