import assert from 'node:assert/strict';
import test from 'node:test';
import { isNetworkFailure, isStaleCode, NETWORK_MESSAGE } from '../src/lib/error-codes.ts';
import { projectAccess } from '../src/lib/project-access.ts';
import { isTrouble } from '../src/lib/poller.ts';

test('every stale-write code is recognised, including a moved board structure', () => {
  for (const code of ['STALE_VERSION', 'STALE_BOARD_VERSION', 'CONFLICT']) assert.equal(isStaleCode(code), true, code);
  for (const code of ['NOT_FOUND', 'FORBIDDEN', '', undefined, null]) assert.equal(isStaleCode(code), false, String(code));
});

test('a fetch TypeError is a network failure; an abort or an API error is not', () => {
  assert.equal(isNetworkFailure(new TypeError('Failed to fetch')), true);
  assert.equal(isNetworkFailure(new TypeError('Load failed')), true);
  const abort = new Error('x'); abort.name = 'AbortError';
  assert.equal(isNetworkFailure(abort), false);
  assert.equal(isNetworkFailure(new Error('boom')), false);
  assert.match(NETWORK_MESSAGE, /Can’t reach Flowboard/);
  assert.doesNotMatch(NETWORK_MESSAGE, /Failed to fetch/);
});

test('session access: role change, archive and removal are all visible', () => {
  const before = [{ id: 'p1', role: 'manager', isArchived: false }];
  assert.deepEqual(projectAccess(before, 'p1'), { kind: 'ok', role: 'manager', archived: false });
  assert.deepEqual(projectAccess([{ id: 'p1', role: 'viewer', isArchived: false }], 'p1'), { kind: 'ok', role: 'viewer', archived: false });
  assert.deepEqual(projectAccess([{ id: 'p1', role: 'manager', isArchived: true }], 'p1'), { kind: 'ok', role: 'manager', archived: true });
  assert.deepEqual(projectAccess([], 'p1'), { kind: 'removed' });
  assert.deepEqual(projectAccess(before, null), { kind: 'removed' });
});

test('the banner shows when offline or after two failed polls, not after one', () => {
  assert.equal(isTrouble(0, true), false);
  assert.equal(isTrouble(1, true), false);
  assert.equal(isTrouble(2, true), true);
  assert.equal(isTrouble(0, false), true);
});
