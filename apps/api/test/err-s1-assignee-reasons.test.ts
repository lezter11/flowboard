import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import type pg from 'pg';
import { assigneeNotEligibleDetailsSchema, ERROR_DETAILS_SCHEMAS } from '@flowboard/contracts';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// ERR-R1 S1: ASSIGNEE_NOT_ELIGIBLE explains each refused user with a reason, and names the board. The reasons
// come from the same rule as the validator, so they always match the decision.

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

async function fixture() {
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`s1.owner.${s}@flowboard.example`, 'Olive Owner', pool);
  const cookie = `flowboard_session=${owner.session.id}`;
  const made = await app.request(`${ORIGIN}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': `s1-${crypto.randomUUID()}` },
    body: JSON.stringify({ name: `Reasons ${s}` }),
  });
  assert.equal(made.status, 201, await made.clone().text());
  const projectId = ((await made.json()) as any).data.id as string;
  const ws = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id = $1', [projectId])).rows[0]!.workspace_id;
  const boardId = `brd_${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO boards (id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at)
     VALUES ($1, $2, $3, 'S1 board', NULL, 1, 1, FALSE, NOW(), NOW())`,
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

async function person(fx: Awaited<ReturnType<typeof fixture>>, role: string, status: 'active' | 'removed', label: string) {
  const user = await createDevUserAndSession(`s1.${label}.${crypto.randomUUID()}@flowboard.example`, label, pool);
  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
    [`pm_${crypto.randomUUID()}`, fx.projectId, fx.ws, user.user.id, role, status],
  );
  return user.user.id;
}

async function refusedBy(fx: Awaited<ReturnType<typeof fixture>>, ids: string[]) {
  const version = (await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [fx.boardId])).rows[0]!.structure_version;
  const res = await app.request(`${ORIGIN}/api/v1/boards/${fx.boardId}/cards`, {
    method: 'POST',
    headers: { cookie: fx.cookie, origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': `s1-card-${crypto.randomUUID()}` },
    body: JSON.stringify({ title: 'Reasons check', columnId: fx.columnId, assigneeIds: ids, expectedBoardVersion: version }),
  });
  assert.equal(res.status, 422, await res.clone().text());
  const body = (await res.json()) as { error: { code: string; details: unknown } };
  assert.equal(body.error.code, 'ASSIGNEE_NOT_ELIGIBLE');
  const parsed = assigneeNotEligibleDetailsSchema.safeParse(body.error.details);
  assert.ok(parsed.success, `details match the schema: ${JSON.stringify(parsed.success ? null : parsed.error.issues)}`);
  return body.error.details as { boardId: string; reasons: Array<{ userId: string; reason: string }>; ineligibleUserIds: string[] };
}

test('ERR-R1 S1: each refused user gets the reason that matches the rule (table test)', async () => {
  const fx = await fixture();
  const noGrant = await person(fx, 'manager', 'active', 'no-grant');
  const viewer = await person(fx, 'viewer', 'active', 'viewer');
  const left = await person(fx, 'member', 'removed', 'left-project');
  const stranger = `unknown_${crypto.randomUUID()}`;
  const details = await refusedBy(fx, [noGrant, viewer, left, stranger]);
  assert.equal(details.boardId, fx.boardId, 'the board is named');
  const reasonOf = (id: string) => details.reasons.find((r) => r.userId === id)?.reason;
  assert.equal(reasonOf(noGrant), 'no_board_access', 'a manager without a board grant');
  assert.equal(reasonOf(viewer), 'viewer', 'an active viewer');
  assert.equal(reasonOf(left), 'not_active', 'a member who left the project');
  assert.equal(reasonOf(stranger), 'not_active', 'an id with no membership at all');
  assert.deepEqual(details.ineligibleUserIds, [noGrant, viewer, left, stranger], 'the ids list is kept');
});

test('ERR-R1 S1: the reason is no_board_access for a member, and it clears once the grant is made', async () => {
  const fx = await fixture();
  const member = await person(fx, 'member', 'active', 'member-no-grant');
  const before = await refusedBy(fx, [member]);
  assert.equal(before.reasons[0]!.reason, 'no_board_access');
  await pool.query(
    `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by) VALUES ($1, $2, $3, $4, $5)`,
    [fx.boardId, fx.projectId, fx.ws, member, fx.owner.user.id],
  );
  const version = (await pool.query<{ structure_version: number }>('SELECT structure_version FROM boards WHERE id = $1', [fx.boardId])).rows[0]!.structure_version;
  const ok = await app.request(`${ORIGIN}/api/v1/boards/${fx.boardId}/cards`, {
    method: 'POST',
    headers: { cookie: fx.cookie, origin: ORIGIN, 'content-type': 'application/json', 'idempotency-key': `s1-ok-${crypto.randomUUID()}` },
    body: JSON.stringify({ title: 'Granted', columnId: fx.columnId, assigneeIds: [member], expectedBoardVersion: version }),
  });
  assert.equal(ok.status, 201, 'the granted member is assignable');
});

test('ERR-R1 S1: the ASSIGNEE_NOT_ELIGIBLE details schema is registered for the catalog', () => {
  assert.ok(ERROR_DETAILS_SCHEMAS.ASSIGNEE_NOT_ELIGIBLE, 'the code has a details schema');
});
