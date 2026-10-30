import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// Mentions: who may be mentioned, replay, edits, and read-time privacy of the notification inbox.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });

async function fixture() {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const who = async (label: string) => createDevUserAndSession(`${label}.${s}@flowboard.example`, label, pool);
  const owner = await who('owner');
  const author = await who('author');
  const viewer = await who('viewer');
  const noGrant = await who('nogrant');
  const revoked = await who('revoked');
  const otherProject = await who('other');
  const stranger = await who('stranger');
  const ws = `ws_${s}`;
  const p1 = `p1_${s}`;
  const p2 = `p2_${s}`;
  const b1 = `b1_${s}`;
  const b2 = `b2_${s}`;
  const col = `col_${s}`;
  const card = `card_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P1',now(),now()),($3,$2,'P2',now(),now())`, [p1, ws, p2]);
  await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ($1,$2,$3,'B1',now(),now()),($4,$2,$5,'B2',now(),now())`, [b1, ws, p1, b2, p2]);
  await pool.query(`INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,'To do','blue','todo',0,1,now(),now())`, [col, ws, p1, b1]);
  await pool.query(`INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,'Secret launch plan','none',1000,'active',1,now(),now())`, [card, ws, p1, b1, col]);
  const member = (label: string, projectId: string, userId: string, role: string, status = 'active') =>
    pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,1,now(),now())`, [`pm_${label}_${s}`, projectId, ws, userId, role, status]);
  await member('author', p1, author.user.id, 'member');
  await member('viewer', p1, viewer.user.id, 'viewer');
  await member('nogrant', p1, noGrant.user.id, 'member');
  await member('revoked', p1, revoked.user.id, 'member', 'removed');
  await member('other', p2, otherProject.user.id, 'member');
  for (const [board, project, userId] of [
    [b1, p1, author.user.id], [b1, p1, viewer.user.id], [b1, p1, revoked.user.id], [b2, p2, otherProject.user.id],
  ] as const) {
    await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
      [board, project, ws, userId, owner.user.id]);
  }
  return { s, ws, p1, b1, card, owner, author, viewer, noGrant, revoked, otherProject, stranger, body: 'Please check Secret launch plan' };
}

type Fx = Awaited<ReturnType<typeof fixture>>;
const cookie = (who: { session: { id: string } }) => `flowboard_session=${who.session.id}`;

function post(fx: Fx, actor: { session: { id: string } }, body: string, mentions: Array<{ userId: string; start: number; end: number }>, key: string = crypto.randomUUID()) {
  return app.request(`http://localhost/api/v1/cards/${fx.card}/comments`, {
    method: 'POST',
    headers: { cookie: cookie(actor), origin: 'http://localhost', 'idempotency-key': `b9m-${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ body, mentions }),
  });
}

// Span of "Secret launch plan" inside the body, so the mention token is valid.
const span = (body: string) => ({ start: body.indexOf('Secret'), end: body.indexOf('Secret') + 'Secret'.length });

async function notificationCount(userId: string, cardId: string) {
  const res = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM notifications WHERE user_id = $1 AND card_id = $2`, [userId, cardId]);
  return Number(res.rows[0]!.n);
}
async function commentCount(cardId: string) {
  const res = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM comments WHERE card_id = $1`, [cardId]);
  return Number(res.rows[0]!.n);
}

test('B-9 mentions: only readers of the card may be mentioned; refusals do not reveal who exists', async (t) => {
  const fx = await fixture();
  const sp = span(fx.body);

  await t.test('a viewer with a board grant can be mentioned and is notified', async () => {
    const res = await post(fx, fx.author, fx.body, [{ userId: fx.viewer.user.id, ...sp }]);
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal(await notificationCount(fx.viewer.user.id, fx.card), 1);
  });

  const refusals: Array<[string, () => string]> = [
    ['a member with no board grant', () => fx.noGrant.user.id],
    ['a removed member who once had a grant', () => fx.revoked.user.id],
    ['a user of another project', () => fx.otherProject.user.id],
    ['a registered user who is not a member of the project', () => fx.stranger.user.id],
    ['an id that does not exist', () => `usr_missing_${fx.s}`],
  ];
  const refused: Array<{ status: number; code: string; message: string }> = [];
  for (const [label, id] of refusals) {
    await t.test(`refuses ${label} with 422 and writes nothing`, async () => {
      const before = await commentCount(fx.card);
      const res = await post(fx, fx.author, fx.body, [{ userId: id(), ...sp }]);
      assert.equal(res.status, 422, await res.clone().text());
      const error = ((await res.json()) as any).error;
      refused.push({ status: res.status, code: error.code, message: error.message });
      assert.ok(!JSON.stringify(error).includes(id()), 'the refusal does not echo the id');
      assert.equal(await commentCount(fx.card), before, 'no comment was written');
    });
  }

  await t.test('the refusals for an existing non-reader and a missing id are identical', () => {
    const [nonMember, missing] = [refused[3], refused[4]];
    assert.deepEqual(nonMember, missing, 'the response does not reveal whether the user exists');
  });

  await t.test('a self-mention is accepted and notifies nobody', async () => {
    const before = await notificationCount(fx.author.user.id, fx.card);
    const res = await post(fx, fx.author, fx.body, [{ userId: fx.author.user.id, ...sp }]);
    assert.equal(res.status, 201);
    assert.equal(await notificationCount(fx.author.user.id, fx.card), before);
  });

  await t.test('an idempotent replay writes no second comment and no second notification', async () => {
    const key = `replay-${fx.s}`;
    const before = await notificationCount(fx.viewer.user.id, fx.card);
    const first = await post(fx, fx.author, fx.body, [{ userId: fx.viewer.user.id, ...sp }], key);
    assert.equal(first.status, 201);
    const commentsAfterFirst = await commentCount(fx.card);
    const replay = await post(fx, fx.author, fx.body, [{ userId: fx.viewer.user.id, ...sp }], key);
    assert.ok([200, 201].includes(replay.status));
    assert.equal(await commentCount(fx.card), commentsAfterFirst);
    assert.equal(await notificationCount(fx.viewer.user.id, fx.card), before + 1, 'one notification, not two');
  });
});

test('B-9 mentions: edits do not add notifications (v1 rule, documented)', async (t) => {
  const fx = await fixture();
  const sp = span(fx.body);
  const created = await post(fx, fx.author, fx.body, []);
  const commentId = ((await created.json()) as any).data.id as string;
  const before = await notificationCount(fx.viewer.user.id, fx.card);

  await t.test('an edit that adds a mention of a reader does not notify (docs/API.md: edits do not re-notify in v1)', async () => {
    const res = await app.request(`http://localhost/api/v1/comments/${commentId}`, {
      method: 'PATCH',
      headers: { cookie: cookie(fx.author), origin: 'http://localhost', 'idempotency-key': `b9e-${crypto.randomUUID()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: fx.body, mentions: [{ userId: fx.viewer.user.id, ...sp }], expectedVersion: 1 }),
    });
    assert.equal(res.status, 200, await res.clone().text());
    assert.equal(await notificationCount(fx.viewer.user.id, fx.card), before);
  });
});

test('B-9 mentions: a notification is re-authorised at read time, so revoked readers lose the snippet and title', async (t) => {
  const fx = await fixture();
  const sp = span(fx.body);
  const res = await post(fx, fx.author, fx.body, [{ userId: fx.viewer.user.id, ...sp }]);
  assert.equal(res.status, 201);
  const notifId = (await pool.query<{ id: string }>(`SELECT id FROM notifications WHERE user_id = $1 AND card_id = $2 ORDER BY created_at DESC LIMIT 1`, [fx.viewer.user.id, fx.card])).rows[0]!.id;
  const viewerCookie = `flowboard_session=${fx.viewer.session.id}`;
  const list = () => app.request('http://localhost/api/v1/notifications', { headers: { cookie: viewerCookie } });

  await t.test('while the grant is held, the viewer sees the notification with the snippet', async () => {
    const body = (await (await list()).json()) as any;
    const found = body.data.find((n: any) => n.id === notifId);
    assert.ok(found, 'visible');
    assert.ok(found.body.includes('Secret launch plan'));
  });

  await t.test('after the board grant is removed the notification disappears from the inbox', async () => {
    await pool.query(`DELETE FROM board_grants WHERE board_id = $1 AND user_id = $2`, [fx.b1, fx.viewer.user.id]);
    const body = (await (await list()).json()) as any;
    assert.equal(body.data.some((n: any) => n.id === notifId), false);
    assert.equal(JSON.stringify(body).includes('Secret launch plan'), false, 'no title or snippet leaks');
  });

  await t.test('marking it read after revocation is refused and does not change the row', async () => {
    const res = await app.request(`http://localhost/api/v1/notifications/${notifId}/read`, {
      method: 'PATCH',
      headers: { cookie: viewerCookie, origin: 'http://localhost' },
    });
    assert.ok(res.status >= 400, `refused, got ${res.status}`);
    const row = await pool.query<{ read: boolean }>('SELECT read FROM notifications WHERE id = $1', [notifId]);
    assert.equal(row.rows[0]!.read, false);
  });

  await t.test('a removed membership hides it too, even with a grant row left behind', async () => {
    await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)`,
      [fx.b1, fx.p1, fx.ws, fx.viewer.user.id, fx.owner.user.id]);
    await pool.query(`UPDATE project_memberships SET status = 'removed' WHERE project_id = $1 AND user_id = $2`, [fx.p1, fx.viewer.user.id]);
    const body = (await (await list()).json()) as any;
    assert.equal(body.data.some((n: any) => n.id === notifId), false);
  });

  await t.test('a trashed card hides the notification from its readers', async () => {
    await pool.query(`UPDATE project_memberships SET status = 'active' WHERE project_id = $1 AND user_id = $2`, [fx.p1, fx.viewer.user.id]);
    await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [fx.b1, fx.p1, fx.ws, fx.viewer.user.id, fx.owner.user.id]);
    const before = (await (await list()).json()) as any;
    assert.equal(before.data.some((n: any) => n.id === notifId), true, 'visible again once access is restored');
    await pool.query(`UPDATE cards SET state = 'trashed' WHERE id = $1`, [fx.card]);
    const after = (await (await list()).json()) as any;
    assert.equal(after.data.some((n: any) => n.id === notifId), false);
    await pool.query(`UPDATE cards SET state = 'active' WHERE id = $1`, [fx.card]);
  });
});
