import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseQuota, quotaAdvice, retryAfterSeconds, waitText, type FailureLike } from '../src/lib/quota-messages.ts';
import { isOwnedProject, projectUsage, splitProjects, usageText } from '../src/lib/project-groups.ts';

const quota = (details: unknown): FailureLike => ({ status: 409, code: 'QUOTA_EXCEEDED', message: 'x', details });

test('owned-project cap: calm advice with the archive way out, numbers from the server only', () => {
  const advice = quotaAdvice(quota({ scope: 'owned_projects', limit: 3, current: 3, remedy: 'archive_project' }))!;
  assert.match(advice.title, /project limit/);
  assert.match(advice.body, /Archive a project/);
  assert.equal(advice.action?.href, '/projects');
  assert.ok(!/workspace/i.test(advice.body + advice.title));
});

test('a Manager at the board cap never sees a number (no `current`)', () => {
  const advice = quotaAdvice(quota({ scope: 'boards_per_project', limit: 5, remedy: 'archive_board' }), { role: 'manager', projectId: 'p1' })!;
  assert.doesNotMatch(advice.body, /\d/);
  assert.match(advice.body, /Ask the project Owner/);
  assert.equal(advice.action, null);
});

test('an Owner at the board cap gets the count and a link to the project', () => {
  const advice = quotaAdvice(quota({ scope: 'boards_per_project', limit: 5, current: 5, remedy: 'archive_board' }), { role: 'owner', projectId: 'p 1' })!;
  assert.match(advice.body, /5 active boards/);
  assert.equal(advice.action?.href, '/project?id=p%201');
});

test('member and invitation caps: Owner and Manager get a way out, others are told to ask', () => {
  const m = quota({ scope: 'members', limit: 50, current: 50, remedy: 'remove_member' });
  assert.equal(quotaAdvice(m, { role: 'manager' })!.action?.href, '/people');
  assert.equal(quotaAdvice(m, { role: 'member' })!.action, null);
  const hidden = quotaAdvice(quota({ scope: 'pending_invitations', limit: 50, remedy: 'revoke_invitation' }), { role: 'manager' })!;
  assert.doesNotMatch(hidden.body, /\d/);
});

test('unknown future scopes and the remedy "none" still give a safe message', () => {
  const advice = quotaAdvice(quota({ scope: 'something_new', limit: 9, remedy: 'none' }))!;
  assert.equal(advice.action, null);
  const total = quotaAdvice(quota({ scope: 'owned_projects_total', limit: 20, remedy: 'none' }))!;
  assert.equal(total.action, null);
  assert.match(total.body, /archived ones included/);
});

test('non-quota failures and malformed details are not quota advice', () => {
  assert.equal(quotaAdvice({ status: 409, code: 'CONFLICT', message: '' }), null);
  assert.equal(parseQuota(quota(null)), null);
  assert.equal(parseQuota(quota({ scope: 7 })), null);
});

test('429 wait: seconds, minutes, and no number when the server gave none', () => {
  assert.equal(retryAfterSeconds({ status: 429, code: 'RATE_LIMITED', message: '', details: { retryAfterSeconds: 12.2 } }), 13);
  assert.equal(retryAfterSeconds({ status: 429, code: 'RATE_LIMITED', message: '', details: {} }), null);
  assert.equal(retryAfterSeconds({ status: 409, code: 'X', message: '', details: { retryAfterSeconds: 5 } }), null);
  assert.equal(waitText(1, 'creating projects'), 'You are creating projects too quickly. Try again in 1 second.');
  assert.match(waitText(120, 'creating projects'), /about 2 minutes/);
  assert.match(waitText(null, 'creating projects'), /Wait a moment/);
});

test('Yours and Shared with you use isOwned, and fall back to the role', () => {
  const list = [{ id: 'a', isOwned: true, role: 'owner' as const }, { id: 'b', isOwned: false, role: 'manager' as const }, { id: 'c', role: 'owner' as const }, { id: 'd', role: 'viewer' as const }];
  const { yours, shared } = splitProjects(list);
  assert.deepEqual(yours.map((p) => p.id), ['a', 'c']);
  assert.deepEqual(shared.map((p) => p.id), ['b', 'd']);
  assert.equal(isOwnedProject({ isOwned: false, role: 'owner' }), false);
});

test('usage comes from session.limits only', () => {
  assert.equal(projectUsage({}), null);
  const u = projectUsage({ limits: { ownedProjects: { limit: 7, used: 2 }, boardsPerProject: { limit: 5 }, membersPerProject: { limit: 50 }, pendingInvitationsPerProject: { limit: 50 } } })!;
  assert.equal(usageText(u), '2 of 7 projects');
  assert.equal(u.atCap, false);
  assert.equal(projectUsage({ limits: { ownedProjects: { limit: 3, used: 4 }, boardsPerProject: { limit: 5 }, membersPerProject: { limit: 50 }, pendingInvitationsPerProject: { limit: 50 } } })!.atCap, true);
});

import { friendlyMessage } from '../src/lib/quota-messages.ts';

test('friendly sentences for the new server refusals', () => {
  const f = (status: number, code: string, details?: unknown): FailureLike => ({ status, code, message: 'raw', details });
  assert.match(friendlyMessage(f(409, 'NAME_REQUIRED'))!, /first and last name in Settings/);
  assert.match(friendlyMessage(f(409, 'READ_ONLY_CONTEXT'))!, /archived/);
  assert.match(friendlyMessage(f(400, 'INVITATION_EXPIRED'))!, /Send a new invitation/);
  assert.match(friendlyMessage(f(429, 'RATE_LIMITED', { retryAfterSeconds: 30 }))!, /in 30 seconds/);
  assert.match(friendlyMessage(f(409, 'QUOTA_EXCEEDED', { scope: 'members', limit: 50, remedy: 'remove_member' }), { role: 'member' })!, /Ask the project Owner/);
  assert.equal(friendlyMessage(f(500, 'INTERNAL')), null);
});
