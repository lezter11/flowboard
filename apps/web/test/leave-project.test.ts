import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canLeave, describeLeaveFailure, leaveCopy } from '../src/lib/leave-project.ts';

test('only people in someone else project can leave', () => {
  assert.equal(canLeave({ role: 'member', isOwned: false }), true);
  assert.equal(canLeave({ role: 'manager', isOwned: false }), true);
  assert.equal(canLeave({ role: 'owner', isOwned: true }), false);
  assert.equal(canLeave({ role: 'owner' }), false);
  assert.equal(canLeave(null), false);
});

test('confirm copy names the project, says what is lost and what is not', () => {
  const c = leaveCopy('Bobs Garage');
  assert.match(c.title, /Bobs Garage/);
  assert.match(c.body, /own projects are not affected/);
  assert.doesNotMatch(c.body, /workspace/i);
});

test('server refusals are rewritten without the word workspace', () => {
  const owner = describeLeaveFailure({ status: 403, code: 'FORBIDDEN', message: 'Workspace owners cannot leave their project.' });
  assert.doesNotMatch(owner, /workspace/i);
  assert.match(owner, /Owners can’t leave/);
  assert.match(describeLeaveFailure({ status: 404, code: 'NOT_FOUND', message: 'x' }), /no longer a member/);
  assert.doesNotMatch(describeLeaveFailure({ status: 500, code: 'X', message: 'SECRET-SERVER-TEXT' }), /SECRET/);
});
