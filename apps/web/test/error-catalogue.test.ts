import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STANDARD_ERROR_CODES } from '@flowboard/contracts';
import { CATALOGUE, describeFailureOf, type Ctx, type Failure } from '../src/lib/error-catalogue.ts';

const SECRET = 'SECRET-SERVER-TEXT';
const ALL = [...new Set([...Object.keys(CATALOGUE), ...STANDARD_ERROR_CODES])];
const sentences = (t: string) => t.split(/(?<=[.?])\s+/).filter(Boolean);
const variants: Ctx[] = [{}, { role: 'owner' }, { role: 'manager', ownerName: 'Olivia Owner' }, { role: 'member' }, { role: 'viewer', boardName: 'Chat', projectName: 'Mention Test', names: ['Sam Lee'], item: 'Fix login' }];
const f = (code: string, status = 409, extra: Partial<Failure> = {}): Failure => ({ status, code, ...extra });

test('every code the contract lists has a catalogue entry', () => {
  for (const code of STANDARD_ERROR_CODES) assert.ok(CATALOGUE[code] || ['INTERNAL_ERROR'].includes(code), `no entry for ${code}`);
});

test('every entry reads like the style guide, for every role', () => {
  for (const code of ALL) for (const ctx of variants) {
    const d = describeFailureOf(f(code), ctx);
    const text = `${d.title} ${d.body}`;
    assert.ok(d.title.trim() && d.body.trim(), `${code}: empty`);
    assert.doesNotMatch(text, /\bplease\b/i, code);
    assert.doesNotMatch(text, /successfully/i, code);
    assert.doesNotMatch(text, /!/, code);
    assert.doesNotMatch(text, /\b[A-Z]{2,}(_[A-Z]+)+\b/, `${code}: code token in text`);
    assert.doesNotMatch(text, /\d+\s*(ms|bytes)\b/i, code);
    assert.doesNotMatch(text, /workspace/i, code);
    assert.ok(d.title.split(/\s+/).length <= 8, `${code}: title too long`);
    for (const s of sentences(d.body)) assert.ok(s.split(/\s+/).length <= 25, `${code}: sentence too long: ${s}`);
  }
});

test('the server message is never shown, for every code, every class and an unknown code', () => {
  for (const code of [...ALL, 'NEVER_HEARD_OF_THIS']) for (const status of [0, 400, 401, 403, 404, 409, 410, 413, 422, 429, 500, 502, 503, 504]) {
    const d = describeFailureOf({ ...f(code, status), details: { message: SECRET, reason: SECRET, scope: SECRET } } as Failure, { names: ['A'] });
    assert.doesNotMatch(JSON.stringify(d), new RegExp(SECRET), `${code}/${status}`);
  }
});

test('unknown codes fall back by status class', () => {
  assert.equal(describeFailureOf(f('WHO_KNOWS', 0)).title, 'You’re offline');
  assert.equal(describeFailureOf(f('WHO_KNOWS', 401)).action?.kind, 'signin');
  assert.match(describeFailureOf(f('WHO_KNOWS', 403)).body, /Ask an Owner or Manager/);
  assert.match(describeFailureOf(f('WHO_KNOWS', 404)).title, /isn’t available/);
  assert.match(describeFailureOf(f('WHO_KNOWS', 429, { retryAfter: 7 })).body, /in 7 seconds/);
  assert.equal(describeFailureOf(f('WHO_KNOWS', 502)).title, 'Something broke on our side');
});

test('request id shows only for server faults and unknown codes', () => {
  assert.equal(describeFailureOf(f('INTERNAL_ERROR', 500, { requestId: 'req-1' })).reference, 'req-1');
  assert.equal(describeFailureOf(f('WHO_KNOWS', 418, { requestId: 'req-2' })).reference, 'req-2');
  assert.equal(describeFailureOf(f('STALE_VERSION', 409, { requestId: 'req-3' })).reference, null);
  assert.equal(describeFailureOf(f('NETWORK_ERROR', 0, { requestId: 'req-4' })).reference, null);
});

test('assignee refusal by role: Owner gets Open People, Manager and Member get the ask line and no button', () => {
  const failure = f('ASSIGNEE_NOT_ELIGIBLE', 422, { details: { ineligibleUserIds: ['u1'] } });
  const owner = describeFailureOf(failure, { role: 'owner', names: ['Sam Lee'], boardName: 'Chat' });
  assert.equal(owner.action?.kind, 'people');
  assert.match(owner.body, /Give them access in People/);
  for (const role of ['manager', 'member'] as const) {
    const d = describeFailureOf(failure, { role, names: ['Sam Lee'], boardName: 'Chat', ownerName: 'Olivia Owner' });
    assert.equal(d.action, null);
    assert.match(d.body, /Ask Olivia Owner to give them access/);
  }
  assert.match(describeFailureOf(failure, { role: 'member', names: ['Sam Lee'] }).body, /Ask the project Owner/);
});

test('assignee refusal by reason: viewer and left-the-project', () => {
  const viewer = f('ASSIGNEE_NOT_ELIGIBLE', 422, { details: { reasons: [{ userId: 'u', reason: 'viewer' }] } });
  assert.match(describeFailureOf(viewer, { role: 'owner', names: ['Vee'] }).body, /Viewers can’t be assigned work/);
  const left = f('ASSIGNEE_NOT_ELIGIBLE', 422, { details: { reasons: [{ userId: 'u', reason: 'not_active' }] } });
  assert.match(describeFailureOf(left, { role: 'owner', names: ['Lou'] }).body, /left this project/);
  assert.match(describeFailureOf(f('ASSIGNEE_NOT_ELIGIBLE', 422), { role: 'owner', names: ['A', 'B', 'C', 'D', 'E'] }).title, /A, B, C and 2 more can’t be assigned/);
});

test('read-only by reason and role', () => {
  const proj = f('READ_ONLY_CONTEXT', 409, { details: { reason: 'project_archived' } });
  assert.equal(describeFailureOf(proj, { role: 'owner', projectName: 'Mention Test' }).action?.kind, 'settings');
  assert.match(describeFailureOf(proj, { role: 'member', ownerName: 'Olivia Owner' }).body, /Ask Olivia Owner to reopen it/);
  const board = f('READ_ONLY_CONTEXT', 409, { details: { reason: 'board_archived' } });
  const d = describeFailureOf(board, { role: 'member', boardName: 'Chat' });
  assert.match(d.title, /“Chat” is archived/);
  assert.doesNotMatch(d.title + d.body, /project is archived/i);
});

test('403 on a hidden resource reads like 404; quota without current has no digits except the limit', () => {
  assert.equal(describeFailureOf(f('NOT_FOUND', 404, { details: { resource: 'card' } })).body, describeFailureOf(f('NOT_FOUND', 404, { details: { resource: 'card' } }), { role: 'viewer' }).body);
  const q = describeFailureOf(f('QUOTA_EXCEEDED', 409, { details: { scope: 'boards_per_project', limit: 5, remedy: 'archive_board' } }), { role: 'manager' });
  assert.deepEqual((q.title + q.body).match(/\d+/g), ['5']);
});

test('offline keeps the work: status 0 says changes are still here and offers retry', () => {
  const d = describeFailureOf(f('NETWORK_ERROR', 0));
  assert.match(d.body, /still on this page/);
  assert.equal(d.action?.kind, 'retry');
  assert.equal(d.retryable, true);
});

test('rate limit: seconds, minutes, and the Retry-After header as a fallback', () => {
  assert.match(describeFailureOf(f('RATE_LIMITED', 429, { details: { retryAfterSeconds: 12 } }), { doing: 'sending invitations' }).body, /sending invitations too quickly. Try again in 12 seconds/);
  assert.match(describeFailureOf(f('RATE_LIMITED', 429, { retryAfter: 120 })).body, /about 2 minutes/);
  assert.match(describeFailureOf(f('RATE_LIMITED', 429)).body, /Wait a moment/);
});

test('read-only without a reason does not guess between project and board', () => {
  const d = describeFailureOf(f('READ_ONLY_CONTEXT', 409), { role: 'member', ownerName: 'Olivia Owner' });
  assert.equal(d.title, 'This is archived');
  assert.match(d.body, /Ask Olivia Owner to reopen it/);
  assert.equal(describeFailureOf(f('READ_ONLY_CONTEXT', 409), { role: 'owner' }).action?.kind, 'settings');
});

test('quota copy always names the limit and only shows a count the server sent', () => {
  const owned = describeFailureOf(f('QUOTA_EXCEEDED', 409, { details: { scope: 'owned_projects', limit: 3, remedy: 'archive_project' } }), { role: 'owner' });
  assert.deepEqual((owned.title + owned.body).match(/\d+/g), ['3']);
  const withCount = describeFailureOf(f('QUOTA_EXCEEDED', 409, { details: { scope: 'owned_projects', limit: 3, current: 3, remedy: 'archive_project' } }), { role: 'owner' });
  assert.deepEqual((withCount.body).match(/\d+/g), ['3', '3']);
  const members = describeFailureOf(f('QUOTA_EXCEEDED', 409, { details: { scope: 'members', limit: 50, remedy: 'remove_member' } }), { role: 'owner' });
  assert.match(members.body, /up to 50 members|50 members/);
});

import { ERROR_CATALOG } from '@flowboard/contracts';

test('every code in the shared ERROR_CATALOG has its own catalogue entry, and reads well at its listed status', () => {
  const codes = Object.keys(ERROR_CATALOG);
  assert.ok(codes.length >= 104);
  for (const code of codes) {
    assert.ok(CATALOGUE[code], `${code}: no catalogue entry (a class default is not enough for a listed code)`);
    const status = (ERROR_CATALOG as Record<string, { status: number }>)[code]!.status;
    const d = describeFailureOf({ status, code }, { role: 'member' });
    assert.ok(d.title.trim() && d.body.trim(), code);
    assert.doesNotMatch(`${d.title} ${d.body}`, /please|successfully|!|workspace/i, code);
  }
});

test('codes with two statuses read the same at either', () => {
  for (const [code, statuses] of [['VALIDATION_ERROR', [400, 422]], ['BOARD_ARCHIVED', [409, 422]], ['INVITATION_EXPIRED', [400, 409]]] as const) {
    const [a, b] = statuses.map((status) => describeFailureOf({ status, code }));
    assert.deepEqual([a!.title, a!.body], [b!.title, b!.body], code);
  }
});

test('client-caused 400s do not blame the server, and no note promises a reference that is not shown', () => {
  for (const code of ['MALFORMED_REQUEST', 'BAD_REQUEST', 'MENTION_RANGE_INVALID', 'INVALID_CONTENT_TYPE', 'NUMERIC_ID_REJECTED', 'IDEMPOTENCY_KEY_REQUIRED']) {
    const d = describeFailureOf(f(code, 400, { requestId: 'req-9' }));
    assert.equal(d.title, 'That request didn’t go through', code);
    assert.equal(d.action?.kind, 'reload', code);
    assert.match(d.body, /Reload the page and try again/, code);
    assert.doesNotMatch(d.title + d.body, /our side|reference/i, code);
    assert.equal(d.reference, null, code);
  }
});

test('"the reference below" is promised only when a reference is shown', () => {
  const withRef = describeFailureOf(f('INTERNAL_ERROR', 500, { requestId: 'req-1' }));
  assert.match(withRef.body, /the reference below/);
  assert.equal(withRef.reference, 'req-1');
  const noId = describeFailureOf(f('INTERNAL_ERROR', 500));
  assert.doesNotMatch(noId.body, /reference/);
  assert.equal(noId.reference, null);
  for (const code of ALL) for (const status of [0, 400, 409, 422, 500, 503]) {
    const d = describeFailureOf(f(code, status, { requestId: 'r' }));
    if (/reference below/.test(d.body)) assert.equal(d.reference, 'r', `${code}/${status} promises a reference it does not show`);
  }
});

test('a plain 403 never tells an Owner to ask an Owner, and small file limits never read "0 MB"', () => {
  const owner = describeFailureOf(f('FORBIDDEN', 403), { role: 'owner' });
  assert.doesNotMatch(owner.body, /Ask an Owner/);
  assert.match(describeFailureOf(f('FORBIDDEN', 403), { role: 'member' }).body, /Ask an Owner or Manager/);
  assert.match(describeFailureOf(f('FILE_TOO_LARGE', 422, { details: { maxBytes: 300_000 } })).body, /limit is 1 MB/);
  assert.match(describeFailureOf(f('PAYLOAD_TOO_LARGE', 413, { details: { maxBytes: 300_000 } })).body, /limit is 1 MB/);
});
