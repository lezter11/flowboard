import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import type pg from 'pg';
import { personDisplaySchema } from '@flowboard/contracts';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { nameKey, projectNameSuffixes } from '../src/services/person-suffix.ts';

// B-23: same-name numbers. The first keeps no number; later joiners get 2, 3, 4. Computed on read over all
// active members (Owner first), so every producer agrees. Emails never appear in a person object.

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

/** An owner (named Shubham Singh) and a project made through the real create route. */
async function projectFixture(ownerName = 'Shubham Singh') {
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`b23.owner.${s}@flowboard.example`, ownerName, pool);
  const cookie = `flowboard_session=${owner.session.id}`;
  const res = await app.request(`${ORIGIN}/api/v1/projects`, {
    method: 'POST',
    headers: h(cookie, { 'idempotency-key': `b23-${crypto.randomUUID()}` }),
    body: JSON.stringify({ name: `Same names ${s}` }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return { owner, cookie, projectId: ((await res.json()) as any).data.id as string };
}

/** A member joins at a chosen time, so the ordering rule can be tested. The name is stored as given. */
async function join(fx: { projectId: string }, displayName: string, joinedAt: string) {
  const s = crypto.randomUUID();
  const user = await createDevUserAndSession(`b23.m.${s}@flowboard.example`, displayName, pool);
  const ws = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id = $1', [fx.projectId])).rows[0]!.workspace_id;
  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'member', 'active', $5, $5)`,
    [`pm_${s}`, fx.projectId, ws, user.user.id, joinedAt],
  );
  return { id: user.user.id, cookie: `flowboard_session=${user.session.id}`, displayName };
}

async function people(cookie: string, projectId: string) {
  const res = await app.request(`${ORIGIN}/api/v1/projects/${projectId}/people`, { headers: { cookie } });
  assert.equal(res.status, 200, await res.clone().text());
  return (await res.json()) as { data: Array<{ id: string; displayName: string; nameSuffix?: number | null; [k: string]: unknown }> };
}

function suffixOf(list: Array<{ id: string; nameSuffix?: number | null }>, userId: string) {
  return list.find((p) => p.id === userId)?.nameSuffix ?? null;
}

test('B-23 unique names carry no number', async () => {
  const fx = await projectFixture('Shubham Singh');
  const alone = await join(fx, 'Priya Nair', '2026-10-02T00:00:00Z');
  const list = (await people(fx.cookie, fx.projectId)).data;
  assert.equal(suffixOf(list, fx.owner.user.id), null);
  assert.equal(suffixOf(list, alone.id), null);
});

test('B-23 two, three and four duplicates number in join order, the Owner first', async () => {
  const fx = await projectFixture('Shubham Singh');
  const second = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  const third = await join(fx, 'Shubham Singh', '2026-10-03T00:00:00Z');
  const fourth = await join(fx, 'Shubham Singh', '2026-10-04T00:00:00Z');
  const list = (await people(fx.cookie, fx.projectId)).data;
  assert.equal(suffixOf(list, fx.owner.user.id), null, 'the Owner keeps the plain name');
  assert.equal(suffixOf(list, second.id), 2);
  assert.equal(suffixOf(list, third.id), 3);
  assert.equal(suffixOf(list, fourth.id), 4);
});

test('B-23 the Owner is first even when a same-named member joined before the Owner existed', async () => {
  const fx = await projectFixture('Olive Owner');
  // The member joined in 2025; the owner is "first" by rule, not by time.
  const early = await join(fx, 'Olive Owner', '2025-01-01T00:00:00Z');
  const list = (await people(fx.cookie, fx.projectId)).data;
  assert.equal(suffixOf(list, fx.owner.user.id), null);
  assert.equal(suffixOf(list, early.id), 2);
});

test('B-23 case and accent insensitive: "José Pérez" collides with "jose perez" (NFKC, accents removed)', async () => {
  assert.equal(nameKey('José  Pérez'), nameKey(' jose   PEREZ '));
  assert.equal(nameKey('Ｊｏｓｅ Perez'), nameKey('Jose Perez'), 'full-width letters fold with NFKC');
  const fx = await projectFixture('Jose Perez');
  const accented = await join(fx, 'José Pérez', '2026-10-02T00:00:00Z');
  const list = (await people(fx.cookie, fx.projectId)).data;
  assert.equal(suffixOf(list, accented.id), 2);
});

test('B-23 stable when an unrelated person joins; numbers do not move with unrelated members', async () => {
  const fx = await projectFixture('Shubham Singh');
  const dup = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  const before = suffixOf((await people(fx.cookie, fx.projectId)).data, dup.id);
  await join(fx, 'Someone Else', '2026-10-05T00:00:00Z');
  const after = suffixOf((await people(fx.cookie, fx.projectId)).data, dup.id);
  assert.equal(before, 2);
  assert.equal(after, 2);
});

test('B-23 the number drops when the first duplicate leaves, and the remaining one is unique again', async () => {
  const fx = await projectFixture('Shubham Singh');
  const dup = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  assert.equal(suffixOf((await people(fx.cookie, fx.projectId)).data, dup.id), 2);
  await pool.query(`UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2`, [fx.projectId, dup.id]);
  const list = (await people(fx.cookie, fx.projectId)).data;
  assert.equal(list.some((p) => p.id === dup.id), false, 'a removed member is not listed');
  assert.equal(suffixOf(list, fx.owner.user.id), null);
});

test('B-23 a rename that makes two names collide numbers the later member; renaming away removes the number', async () => {
  const fx = await projectFixture('Shubham Singh');
  const renamer = await join(fx, 'Priya Nair', '2026-10-02T00:00:00Z');
  assert.equal(suffixOf((await people(fx.cookie, fx.projectId)).data, renamer.id), null);
  await pool.query(`UPDATE users SET display_name = 'Shubham Singh' WHERE id = $1`, [renamer.id]);
  assert.equal(suffixOf((await people(fx.cookie, fx.projectId)).data, renamer.id), 2, 'collides after the rename');
  await pool.query(`UPDATE users SET display_name = 'Priya Nair' WHERE id = $1`, [renamer.id]);
  assert.equal(suffixOf((await people(fx.cookie, fx.projectId)).data, renamer.id), null, 'renamed away: no number');
});

test('B-23 people endpoint: the number is project-wide, so a filtered or paged response carries the same numbers', async () => {
  const fx = await projectFixture('Shubham Singh');
  const second = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  const filtered = await app.request(`${ORIGIN}/api/v1/projects/${fx.projectId}/people?query=Shubham`, { headers: { cookie: fx.cookie } });
  assert.equal(filtered.status, 200, await filtered.clone().text());
  const body = (await filtered.json()) as { data: Array<{ id: string; nameSuffix?: number | null }> };
  assert.equal(suffixOf(body.data, second.id), 2, 'a filtered view still numbers against all members');
});

test('B-23 the board snapshot and the people endpoint agree on the numbers', async () => {
  const fx = await projectFixture('Shubham Singh');
  const dup = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  // A board with an active card assigned to the duplicate. Members need a board grant to be assigned.
  const boardId = `brd_${crypto.randomUUID()}`;
  const ws = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id = $1', [fx.projectId])).rows[0]!.workspace_id;
  await pool.query(
    `INSERT INTO boards (id, workspace_id, project_id, name, description, structure_version, snapshot_version, archived, created_at, updated_at)
     VALUES ($1, $2, $3, 'B23 board', NULL, 1, 1, FALSE, NOW(), NOW())`,
    [boardId, ws, fx.projectId],
  );
  const columnId = `col_${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO columns (id, workspace_id, project_id, board_id, name, color, category, position, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'To do', 'blue', 'todo', 0, 1, NOW(), NOW())`,
    [columnId, ws, fx.projectId, boardId],
  );
  await pool.query(
    `INSERT INTO board_grants (board_id, project_id, workspace_id, user_id, granted_by) VALUES ($1, $2, $3, $4, $5)`,
    [boardId, fx.projectId, ws, dup.id, fx.owner.user.id],
  );
  const cardId = `card_${crypto.randomUUID()}`;
  await pool.query(
    `INSERT INTO cards (id, workspace_id, project_id, board_id, column_id, title, description, priority, position, state, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, 'Assigned card', '', 'medium', 100, 'active', 1, NOW(), NOW())`,
    [cardId, ws, fx.projectId, boardId, columnId],
  );
  await pool.query(
    `INSERT INTO card_assignees (card_id, user_id, workspace_id, project_id, created_at) VALUES ($1, $2, $3, $4, NOW())`,
    [cardId, dup.id, ws, fx.projectId],
  );

  const snapshot = await app.request(`${ORIGIN}/api/v1/boards/${boardId}`, { headers: { cookie: fx.cookie } });
  assert.equal(snapshot.status, 200, await snapshot.clone().text());
  const snapJson = JSON.stringify(await snapshot.json());
  const snapshotPeople = (JSON.parse(snapJson).data?.people ?? JSON.parse(snapJson).people) as Array<{ id: string; nameSuffix?: number | null }>;
  const fromSnapshot = snapshotPeople.find((p) => p.id === dup.id);
  assert.ok(fromSnapshot, 'the snapshot lists the assignee');
  assert.equal(fromSnapshot.nameSuffix, 2);
  assert.equal(suffixOf((await people(fx.cookie, fx.projectId)).data, dup.id), fromSnapshot.nameSuffix);
});

test('B-23 no email in any person object, and the contract stays backward compatible', async () => {
  const fx = await projectFixture('Shubham Singh');
  const dup = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  const res = await app.request(`${ORIGIN}/api/v1/projects/${fx.projectId}/people`, { headers: { cookie: fx.cookie } });
  const body = (await res.json()) as { data: Array<Record<string, unknown>> };
  for (const person of body.data) {
    assert.equal(JSON.stringify(person).includes('@'), false, `no address in a person object: ${Object.keys(person).join(',')}`);
    assert.equal(Object.hasOwn(person, 'email'), false);
  }
  assert.ok(body.data.some((p) => p.id === dup.id));
  const old = { id: 'usr_1', displayName: 'Old Client', avatarUrl: null, activeInProject: true };
  assert.ok(personDisplaySchema.safeParse(old).success, 'a response without nameSuffix still parses');
  assert.ok(personDisplaySchema.safeParse({ ...old, nameSuffix: 2 }).success);
  assert.equal(personDisplaySchema.safeParse({ ...old, nameSuffix: 1 }).success, false, 'numbers start at 2');
});

test('B-23 the helper numbers from the stored rows alone, for any caller', async () => {
  const fx = await projectFixture('Shubham Singh');
  const dup = await join(fx, 'Shubham Singh', '2026-10-02T00:00:00Z');
  const map = await projectNameSuffixes(pool, fx.projectId);
  assert.equal(map.get(dup.id), 2);
  assert.equal(map.has(fx.owner.user.id), false);
});
