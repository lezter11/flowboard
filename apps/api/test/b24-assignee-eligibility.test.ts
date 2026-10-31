import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-24: the assignee picker and the card validator agree. Owner always; manager or member only with an
// active board grant; never a viewer. The table covers every role and grant combination on one board.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 8);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });
const ORIGIN = 'http://localhost';

before(async () => {
  await runMigrations(pool);
});
after(async () => {
  await pool.end();
});

function h(cookie: string, extra: Record<string, string> = {}) {
  return { cookie, origin: ORIGIN, 'content-type': 'application/json', ...extra };
}

async function fixture() {
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`b24.owner.${s}@flowboard.example`, 'Olive Owner', pool);
  const cookie = `flowboard_session=${owner.session.id}`;
  const made = await app.request(`${ORIGIN}/api/v1/projects`, {
    method: 'POST',
    headers: h(cookie, { 'idempotency-key': `b24-${crypto.randomUUID()}` }),
    body: JSON.stringify({ name: `Assignees ${s}` }),
  });
  assert.equal(made.status, 201, await made.clone().text());
  const projectId = ((await made.json()) as any).data.id as string;
  const ws = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id = $1', [projectId])).rows[0]!.workspace_id;
  const boardId = `brd_${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO boards (id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at)
     VALUES ($1, $2, $3, 'Assignee board', NULL, 1, 1, FALSE, NOW(), NOW())`,
    [boardId, ws, projectId],
  );
  const columnId = `col_${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'To do', 'blue', 'todo', 0, 1, NOW(), NOW())`,
    [columnId, ws, projectId, boardId],
  );
  return { owner, cookie, projectId, ws, boardId, columnId };
}

async function member(fx: Awaited<ReturnType<typeof fixture>>, role: 'manager' | 'member' | 'viewer', grant: boolean, label: string) {
  const user = await createDevUserAndSession(`b24.${label}.${crypto.randomUUID()}@flowboard.example`, label, pool);
  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'active', NOW(), NOW())`,
    [`pm_${crypto.randomUUID()}`, fx.projectId, fx.ws, user.user.id, role],
  );
  if (grant) await setGrant(fx, user.user.id, true);
  return { id: user.user.id, cookie: `flowboard_session=${user.session.id}` };
}

async function setGrant(fx: Awaited<ReturnType<typeof fixture>>, userId: string, on: boolean) {
  if (on) {
    await pool.query(
      `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (board_id, user_id) DO NOTHING`,
      [fx.boardId, fx.projectId, fx.ws, userId, fx.owner.user.id],
    );
    await pool.query('UPDATE boards SET access_revision = access_revision + 1 WHERE id = $1', [fx.boardId]);
  } else {
    await pool.query('DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2', [fx.boardId, userId]);
  }
}

/** The picker's view: is this person offered as an assignee for this board? */
async function pickerOffers(fx: Awaited<ReturnType<typeof fixture>>, userId: string) {
  const res = await app.request(`${ORIGIN}/api/v1/projects/${fx.projectId}/people?purpose=assignee&boardId=${fx.boardId}`, {
    headers: { cookie: fx.cookie },
  });
  assert.equal(res.status, 200, await res.clone().text());
  const data = ((await res.json()) as { data: Array<{ id: string; assignable?: boolean }> }).data;
  return data.some((p) => p.id === userId && p.assignable === true);
}

/** The validator's view: does a card create on this board accept this assignee? Uses the Owner. */
async function validatorAccepts(fx: Awaited<ReturnType<typeof fixture>>, userId: string) {
  const version = (await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [fx.boardId])).rows[0]!.structure_version;
  const res = await app.request(`${ORIGIN}/api/v1/boards/${fx.boardId}/cards`, {
    method: 'POST',
    headers: h(fx.cookie, { 'idempotency-key': `b24-card-${crypto.randomUUID()}` }),
    body: JSON.stringify({ title: 'Assignee check', columnId: fx.columnId, assigneeIds: [userId], expectedBoardVersion: version }),
  });
  if (res.status === 422) {
    const body = (await res.json()) as { error: { details?: { invalidAssigneeIds?: string[] } } };
    assert.ok(body.error.details?.invalidAssigneeIds?.includes(userId), 'the 422 names the ineligible user');
    return false;
  }
  assert.equal(res.status, 201, await res.clone().text());
  return true;
}

test('B-24 the picker and the validator agree for every role and grant combination', async () => {
  const fx = await fixture();
  const table: Array<[string, 'manager' | 'member' | 'viewer', boolean]> = [
    ['manager-grant', 'manager', true],
    ['manager-nogrant', 'manager', false],
    ['member-grant', 'member', true],
    ['member-nogrant', 'member', false],
    ['viewer-grant', 'viewer', true],
    ['viewer-nogrant', 'viewer', false],
  ];
  for (const [label, role, grant] of table) {
    const user = await member(fx, role, grant, label);
    const offered = await pickerOffers(fx, user.id);
    const accepted = await validatorAccepts(fx, user.id);
    assert.equal(offered, accepted, `${label}: picker and validator must agree`);
    const expected = role !== 'viewer' && grant;
    assert.equal(accepted, expected, `${label}: eligible only with a grant and a writable role`);
  }
});

test('B-24 owner is always offered; a manager without a grant is absent until the grant is made', async () => {
  const fx = await fixture();
  assert.equal(await pickerOffers(fx, fx.owner.user.id), true, 'the owner is always assignable');
  const manager = await member(fx, 'manager', false, 'late-grant');
  assert.equal(await pickerOffers(fx, manager.id), false);
  assert.equal(await validatorAccepts(fx, manager.id), false);
  await setGrant(fx, manager.id, true);
  assert.equal(await pickerOffers(fx, manager.id), true, 'present after the grant');
  assert.equal(await validatorAccepts(fx, manager.id), true, 'and accepted by the validator');
  await setGrant(fx, manager.id, false);
  assert.equal(await pickerOffers(fx, manager.id), false, 'absent again once the grant is removed');
});

test('B-24 a viewer is never assignable, with or without a grant', async () => {
  const fx = await fixture();
  const viewer = await member(fx, 'viewer', true, 'viewer-always');
  assert.equal(await pickerOffers(fx, viewer.id), false);
  assert.equal(await validatorAccepts(fx, viewer.id), false);
});

test('B-24 a caller who cannot read the board gets 404 from the picker, and no person list', async () => {
  const fx = await fixture();
  const noGrant = await member(fx, 'manager', false, 'cannot-read');
  const res = await app.request(`${ORIGIN}/api/v1/projects/${fx.projectId}/people?purpose=assignee&boardId=${fx.boardId}`, {
    headers: { cookie: noGrant.cookie },
  });
  assert.equal(res.status, 404, 'an unreadable board is not revealed');
  const body = JSON.stringify(await res.json());
  assert.equal(body.includes(fx.boardId), false);
});

test('B-24 no email appears in any assignee picker response', async () => {
  const fx = await fixture();
  await member(fx, 'manager', true, 'no-email');
  const res = await app.request(`${ORIGIN}/api/v1/projects/${fx.projectId}/people?purpose=assignee&boardId=${fx.boardId}`, {
    headers: { cookie: fx.cookie },
  });
  const data = ((await res.json()) as { data: Array<Record<string, unknown>> }).data;
  assert.ok(data.length >= 2);
  for (const person of data) {
    assert.equal(JSON.stringify(person).includes('@'), false, 'no address in a person object');
  }
});
