import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test, { after, before } from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { DEFAULT_LIMITS, type Limits } from '../src/services/limits.ts';
import { buildInvitationEmail } from '../src/services/invitation-email.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// B-22: invitation caps and seats, resend limits, the accept lock order, accept into an archived project,
// NAME_REQUIRED on invite, the name character rule, and format characters stripped from email. Races use
// Promise.all over separate connections, so the locks (not the request order) decide the outcome.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 12);
setGlobalPool(pool);
const ORIGIN = 'http://localhost';

before(async () => {
  await runMigrations(pool);
});
after(async () => {
  await pool.end();
});

function appWith(limits: Partial<Limits>) {
  return createApp(async () => {}, { pool, limits: { ...DEFAULT_LIMITS, ...limits } });
}

/** A fresh owner with a project, made through the real create route. Returns the owner and the project id. */
async function ownerWithProject(app: ReturnType<typeof appWith>, label: string) {
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`b22.${label}.${s}@flowboard.example`, 'Olive Owner', pool);
  const cookie = `flowboard_session=${owner.session.id}`;
  const res = await app.request(`${ORIGIN}/api/v1/projects`, {
    method: 'POST',
    headers: { cookie, origin: ORIGIN, 'idempotency-key': `b22-${crypto.randomUUID()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ name: `Caps ${label}` }),
  });
  assert.equal(res.status, 201, await res.clone().text());
  return { owner, cookie, projectId: ((await res.json()) as any).data.id as string };
}

/** Each request gets its own client address, so the per-IP buckets do not decide these tests. */
function headers(cookie: string, extra: Record<string, string> = {}) {
  return {
    cookie,
    origin: ORIGIN,
    'content-type': 'application/json',
    'cf-connecting-ip': `10.${crypto.randomInt(256)}.${crypto.randomInt(256)}.${crypto.randomInt(256)}`,
    ...extra,
  };
}

function invite(app: ReturnType<typeof appWith>, cookie: string, projectId: string, email: string) {
  return app.request(`${ORIGIN}/api/v1/projects/${projectId}/invitations`, {
    method: 'POST',
    headers: headers(cookie, { 'idempotency-key': `b22-${crypto.randomUUID()}` }),
    body: JSON.stringify({ email, role: 'member' }),
  });
}

function acceptWith(app: ReturnType<typeof appWith>, cookie: string, token: string) {
  return app.request(`${ORIGIN}/api/v1/invitations/accept`, {
    method: 'POST',
    headers: headers(cookie, { 'idempotency-key': `b22-acc-${crypto.randomUUID()}` }),
    body: JSON.stringify({ token }),
  });
}

async function seedActiveMembers(projectId: string, count: number) {
  for (let i = 0; i < count; i++) {
    const u = await createDevUserAndSession(`b22.seat.${crypto.randomUUID()}@flowboard.example`, 'Seat Member', pool);
    const ws = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id = $1', [projectId])).rows[0]!.workspace_id;
    await pool.query(
      `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'member', 'active', NOW(), NOW())`,
      [`pm_${crypto.randomUUID()}`, projectId, ws, u.user.id],
    );
  }
}

test('B-22 seats: the pending limit refuses the next invitation; expired pending rows are not counted', async () => {
  const app = appWith({ pendingInvitesPerProject: 2 });
  const { cookie, projectId } = await ownerWithProject(app, 'pending');
  assert.equal((await invite(app, cookie, projectId, `p1.${crypto.randomUUID()}@flowboard.example`)).status, 201);
  assert.equal((await invite(app, cookie, projectId, `p2.${crypto.randomUUID()}@flowboard.example`)).status, 201);
  const refused = await invite(app, cookie, projectId, `p3.${crypto.randomUUID()}@flowboard.example`);
  assert.equal(refused.status, 409);
  const body = ((await refused.json()) as any).error;
  assert.equal(body.code, 'QUOTA_EXCEEDED');
  assert.equal(body.details.scope, 'pending_invitations');
  assert.equal(body.details.limit, 2);
  assert.equal(body.details.remedy, 'revoke_invitation');

  await pool.query(`UPDATE project_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE project_id = $1`, [projectId]);
  const afterExpiry = await invite(app, cookie, projectId, `p4.${crypto.randomUUID()}@flowboard.example`);
  assert.equal(afterExpiry.status, 201, 'expired invitations do not hold a seat');
});

test('B-22 seats: active members plus pending invitations reserve the member limit (rule 6)', async () => {
  const app = appWith({ membersPerProject: 3, pendingInvitesPerProject: 50 });
  const { cookie, projectId } = await ownerWithProject(app, 'seats');
  await seedActiveMembers(projectId, 1);
  assert.equal((await invite(app, cookie, projectId, `s1.${crypto.randomUUID()}@flowboard.example`)).status, 201);
  assert.equal((await invite(app, cookie, projectId, `s2.${crypto.randomUUID()}@flowboard.example`)).status, 201);
  const refused = await invite(app, cookie, projectId, `s3.${crypto.randomUUID()}@flowboard.example`);
  assert.equal(refused.status, 409, 'one active plus two pending reaches the limit of three');
  assert.equal(((await refused.json()) as any).error.details.scope, 'members');
});

test('B-22 accept: a project at the member limit refuses the next accept; the Owner is not counted', async () => {
  // Two seated members reach the limit of two, which also refuses the invitation itself (seat reservation).
  // The invitation is therefore sent under a roomy limit, and the accept runs under the real one.
  const roomy = appWith({ membersPerProject: 10 });
  const app = appWith({ membersPerProject: 2 });
  const { owner, cookie, projectId } = await ownerWithProject(roomy, 'accept-cap');
  await seedActiveMembers(projectId, 2);
  const email = `cap.${crypto.randomUUID()}@flowboard.example`;
  const created = await invite(roomy, cookie, projectId, email);
  assert.equal(created.status, 201);
  const token = ((await created.json()) as any).data.token as string;
  // A second invitee fills the last seat through a pending accept, so the first accept at the limit fails.
  const invitee = await createDevUserAndSession(email, 'Invitee', pool);
  const refused = await acceptWith(app, `flowboard_session=${invitee.session.id}`, token);
  assert.equal(refused.status, 409, await refused.clone().text());
  assert.equal(((await refused.json()) as any).error.details.scope, 'members');
  assert.ok(owner.user.id, 'owner exists and is not in the count');
});

test('B-22 resend: an expired invitation is refused and is not revived', async () => {
  const app = appWith({});
  const { cookie, projectId } = await ownerWithProject(app, 'resend-expired');
  const email = `exp.${crypto.randomUUID()}@flowboard.example`;
  const created = await invite(app, cookie, projectId, email);
  const invitationId = ((await created.json()) as any).data.id as string;
  await pool.query(`UPDATE project_invitations SET expires_at = NOW() - INTERVAL '1 day' WHERE id = $1`, [invitationId]);
  const res = await app.request(`${ORIGIN}/api/v1/projects/${projectId}/invitations/${invitationId}/resend`, {
    method: 'POST',
    headers: headers(cookie, { 'idempotency-key': `b22-${crypto.randomUUID()}` }),
  });
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(((await res.json()) as any).error.code, 'INVITATION_EXPIRED');
  const row = await pool.query<{ status: string }>('SELECT status FROM project_invitations WHERE id = $1', [invitationId]);
  const still = await pool.query<{ expired: boolean }>('SELECT expires_at <= NOW() AS expired FROM project_invitations WHERE id = $1', [invitationId]);
  assert.equal(still.rows[0]!.expired, true, 'the expiry was not pushed forward: the invitation was not revived');
  assert.ok(row.rows[0]);
});

test('B-22 resend spends the inviter buckets: a burst of resends is refused with RATE_LIMITED', async () => {
  const app = appWith({});
  const { cookie, projectId } = await ownerWithProject(app, 'resend-burst');
  const created = await invite(app, cookie, projectId, `burst.${crypto.randomUUID()}@flowboard.example`);
  const invitationId = ((await created.json()) as any).data.id as string;
  const codes: number[] = [];
  for (let i = 0; i < 25; i++) {
    const res = await app.request(`${ORIGIN}/api/v1/projects/${projectId}/invitations/${invitationId}/resend`, {
      method: 'POST',
      headers: headers(cookie, { 'idempotency-key': `b22-r-${crypto.randomUUID()}` }),
    });
    codes.push(res.status);
  }
  assert.ok(codes.includes(429), `some resend was refused: ${codes.join(',')}`);
  assert.equal(codes.filter((c) => c >= 500).length, 0);
});

test('B-22 accept into an archived project is refused with READ_ONLY_CONTEXT', async () => {
  const app = appWith({});
  const { cookie, projectId } = await ownerWithProject(app, 'archived-accept');
  const email = `arch.${crypto.randomUUID()}@flowboard.example`;
  const created = await invite(app, cookie, projectId, email);
  const token = ((await created.json()) as any).data.token as string;
  await pool.query(`UPDATE projects SET archived = TRUE WHERE id = $1`, [projectId]);
  const invitee = await createDevUserAndSession(email, 'Archived Invitee', pool);
  const res = await acceptWith(app, `flowboard_session=${invitee.session.id}`, token);
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as any).error.code, 'READ_ONLY_CONTEXT');
});

test('B-22 invite: a stored name is required before an invitation is sent (NAME_REQUIRED)', async () => {
  const app = appWith({});
  const { projectId } = await ownerWithProject(app, 'needs-name');
  const id = `usr_${crypto.randomBytes(6).toString('hex')}`;
  await pool.query(`INSERT INTO users (id, email, display_name, created_at, updated_at) VALUES ($1, $2, 'Google Only', NOW(), NOW())`, [id, `g.${id}@flowboard.example`]);
  const { createSession } = await import('../src/adapters/session.ts');
  const session = await createSession(id, 24, pool);
  // The inviter must hold Manager or Owner on this project. Make the unnamed user a manager.
  const ws = (await pool.query<{ workspace_id: string }>('SELECT workspace_id FROM projects WHERE id = $1', [projectId])).rows[0]!.workspace_id;
  await pool.query(
    `INSERT INTO project_memberships (id, project_id, workspace_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'manager', 'active', NOW(), NOW())`,
    [`pm_${crypto.randomUUID()}`, projectId, ws, id],
  );
  const res = await invite(app, `flowboard_session=${session.id}`, projectId, `nn.${crypto.randomUUID()}@flowboard.example`);
  assert.equal(res.status, 409, await res.clone().text());
  assert.equal(((await res.json()) as any).error.code, 'NAME_REQUIRED');
});

test('B-22 names: project and board names refuse control, zero-width and bidirectional characters', async () => {
  const app = appWith({});
  const { cookie, projectId } = await ownerWithProject(app, 'names');
  for (const bad of ['Launch‮fdp.exe', 'Zero​width', 'Line sep']) {
    const res = await app.request(`${ORIGIN}/api/v1/projects`, {
      method: 'POST',
      headers: headers(cookie, { 'idempotency-key': `b22-n-${crypto.randomUUID()}` }),
      body: JSON.stringify({ name: bad }),
    });
    assert.equal(res.status, 422, JSON.stringify(bad));
  }
  const board = await app.request(`${ORIGIN}/api/v1/projects/${projectId}/boards`, {
    method: 'POST',
    headers: headers(cookie, { 'idempotency-key': `b22-b-${crypto.randomUUID()}` }),
    body: JSON.stringify({ name: 'Board‮' }),
  });
  assert.equal(board.status, 422);
});

test('B-22 email: format characters are stripped from the project and inviter names in the text and subject', () => {
  const content = buildInvitationEmail({
    projectName: 'Invoice ‮fdp​',
    inviterName: 'Eve⁦',
    role: 'member',
    expiresAt: '2026-11-06T10:00:00.000Z',
    acceptUrl: 'https://flowboard.example/invitation?token=abc',
    invitationId: 'inv_0123abcd',
    recipientEmail: 'victim@example.net',
  });
  for (const copy of [content.subject, content.text]) {
    assert.equal(/[‮​⁦]/.test(copy), false, 'no format characters reach the subject or the text');
  }
});

test('B-22 races: parallel invitations at the pending limit never exceed it (forced interleaving)', async () => {
  const app = appWith({ pendingInvitesPerProject: 3 });
  const { cookie, projectId } = await ownerWithProject(app, 'race-pending');
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) => invite(app, cookie, projectId, `race${i}.${crypto.randomUUID()}@flowboard.example`)),
  );
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s === 201).length, 3, `statuses: ${statuses.join(',')}`);
  assert.equal(statuses.filter((s) => s >= 500).length, 0, 'no deadlock or server error');
  const pending = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM project_invitations WHERE project_id = $1 AND status = 'pending' AND expires_at > NOW()`, [projectId]);
  assert.equal(Number(pending.rows[0]!.n), 3);
});

test('B-22 races: parallel accepts at the member limit admit exactly the free seats', async () => {
  // Seat reservation would refuse these invitations under the real limit, so they are sent under a roomy one.
  const roomy = appWith({ membersPerProject: 10 });
  const app = appWith({ membersPerProject: 3 });
  const { cookie, projectId } = await ownerWithProject(roomy, 'race-accept');
  await seedActiveMembers(projectId, 1);
  const tokens: Array<{ token: string; cookie: string }> = [];
  for (let i = 0; i < 4; i++) {
    const email = `ra${i}.${crypto.randomUUID()}@flowboard.example`;
    const created = await invite(roomy, cookie, projectId, email);
    assert.equal(created.status, 201);
    const token = ((await created.json()) as any).data.token as string;
    const invitee = await createDevUserAndSession(email, 'Racer', pool);
    tokens.push({ token, cookie: `flowboard_session=${invitee.session.id}` });
  }
  const results = await Promise.all(tokens.map((t) => acceptWith(app, t.cookie, t.token)));
  const statuses = results.map((r) => r.status);
  assert.equal(statuses.filter((s) => s < 300).length, 2, `two free seats: ${statuses.join(',')}`);
  assert.equal(statuses.filter((s) => s >= 500).length, 0, 'no deadlock or server error');
  const active = await pool.query<{ n: string }>(`SELECT COUNT(*)::text AS n FROM project_memberships WHERE project_id = $1 AND status = 'active'`, [projectId]);
  assert.equal(Number(active.rows[0]!.n), 3, 'the seated count is exactly the limit');
});

test('B-22 races: accept and resend of the same invitation never deadlock (F-04)', async () => {
  const app = appWith({});
  const { cookie, projectId } = await ownerWithProject(app, 'race-f04');
  const email = `f04.${crypto.randomUUID()}@flowboard.example`;
  const created = await invite(app, cookie, projectId, email);
  const invitation = (await created.json()) as any;
  const token = invitation.data.token as string;
  const invitationId = invitation.data.id as string;
  const invitee = await createDevUserAndSession(email, 'Racer', pool);
  const inviteeCookie = `flowboard_session=${invitee.session.id}`;
  const jobs: Array<Promise<Response>> = [];
  for (let i = 0; i < 10; i++) {
    jobs.push(acceptWith(app, inviteeCookie, token));
    jobs.push(app.request(`${ORIGIN}/api/v1/projects/${projectId}/invitations/${invitationId}/resend`, {
      method: 'POST',
      headers: headers(cookie, { 'idempotency-key': `b22-f4-${crypto.randomUUID()}` }),
    }));
  }
  const statuses = (await Promise.all(jobs)).map((r) => r.status);
  assert.equal(statuses.filter((s) => s >= 500).length, 0, `no deadlock: ${statuses.join(',')}`);
});
