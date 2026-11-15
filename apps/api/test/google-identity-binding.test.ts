import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { GOOGLE_ISSUER } from '../src/adapters/google-identity.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createDevUserAndSession, createSession, hashSessionToken } from '../src/adapters/session.ts';
import { lifecycleFixture } from './support/lifecycle-fixture.ts';

const origin = 'https://app.example.test';
const authPath = origin + '/api/v1/auth/google';
const cookie = (response: Response, name: string) =>
  response.headers.getSetCookie().find(value => value.startsWith(name + '='))?.split(';', 1)[0];
const sessionCookie = (token: string) => 'flowboard_session=' + token;
const settings = origin + '/settings?tab=account&google=';

test('mounted Google identity, legacy continuity and invitations with real PostgreSQL', async t => {
  const f = await lifecycleFixture(t, 29);
  const legacy = f.actors.owner!;
  const { pool, app } = f;
  const env = {
    GOOGLE_CLIENT_ID: 'synthetic-client',
    GOOGLE_CLIENT_SECRET: 'synthetic-secret',
    GOOGLE_REDIRECT_URI: authPath + '/callback',
    FRONTEND_URL: origin,
    CORS_ORIGIN: origin + ',https://trusted-but-other.example.test',
  };

  const realFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = realFetch; });
  const codes = new Map<string, { challenge: string; profile: Record<string, unknown> }>();
  let providerCalls = 0;
  globalThis.fetch = (async (input, init) => {
    providerCalls++;
    if (input === 'https://oauth2.googleapis.com/token') {
      const params = init?.body as URLSearchParams;
      const code = params.get('code')!;
      const request = codes.get(code);
      const verifier = params.get('code_verifier');
      const challenge = verifier && crypto.createHash('sha256').update(verifier).digest('base64url');
      assert.equal(init?.redirect, 'manual');
      assert.equal(params.get('redirect_uri'), env.GOOGLE_REDIRECT_URI);
      assert.equal(params.get('client_id'), env.GOOGLE_CLIENT_ID);
      if (!request || request.challenge !== challenge) return new Response(null, { status: 400 });
      return Response.json({ access_token: code });
    }
    assert.equal(input, 'https://www.googleapis.com/oauth2/v3/userinfo');
    assert.equal(init?.redirect, 'manual');
    const code = new Headers(init?.headers).get('authorization')!.slice('Bearer '.length);
    const request = codes.get(code);
    codes.delete(code);
    return Response.json(request!.profile);
  }) as typeof fetch;

  async function start(token?: string, next = '') {
    const response = await app.request(token ? authPath + '/link' : authPath + '/start' + next, token ? {
      method: 'POST',
      headers: { origin, cookie: sessionCookie(token) },
    } : undefined, env);
    assert.equal(response.status, token ? 200 : 302, await response.clone().text());
    const url = new URL(token
      ? (await response.json() as { data: { authorizationUrl: string } }).data.authorizationUrl
      : response.headers.get('location')!);
    assert.equal(url.origin, GOOGLE_ISSUER);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    const challenge = url.searchParams.get('code_challenge')!;
    const state = url.searchParams.get('state')!;
    assert.match(challenge, /^[A-Za-z0-9_-]{43}$/);
    const name = token ? '__Host-flowboard_oauth_link' : '__Host-flowboard_oauth_state';
    const header = response.headers.getSetCookie().find(value => value.startsWith(name + '='))!;
    assert.match(header, /Secure/);
    assert.match(header, /HttpOnly/);
    const attemptCookie = cookie(response, name)!;
    assert.ok(!attemptCookie.includes(token ?? 'no-token'));
    return {
      attemptCookie, state,
      issue(subject: unknown, email: string) {
        const code = crypto.randomUUID();
        codes.set(code, { challenge, profile: { sub: subject, email, email_verified: true } });
        return code;
      },
    };
  }

  async function callback(attempt: Awaited<ReturnType<typeof start>>, code: string, token?: string) {
    return app.request(authPath + '/callback?' + new URLSearchParams({ code, state: attempt.state }), {
      headers: { cookie: token ? [attempt.attemptCookie, sessionCookie(token)].join('; ') : attempt.attemptCookie },
    }, env);
  }

  async function signIn(subject: string, email: string) {
    const attempt = await start();
    return callback(attempt, attempt.issue(subject, email));
  }

  async function session(response: Response) {
    assert.equal(response.status, 302);
    const value = cookie(response, 'flowboard_session');
    assert.ok(value, response.headers.get('location') ?? 'Missing session cookie');
    const result = await app.request(origin + '/api/v1/session', { headers: { cookie: value } }, env);
    assert.equal(result.status, 200, await result.clone().text());
    return {
      token: value.split('=')[1]!,
      data: (await result.json() as { data: {
        actor: { id: string; email: string };
        googleAccountStatus: string;
        googleConfirmationAvailable?: boolean;
        accessibleProjects: { id: string }[];
      } }).data,
    };
  }

  function declined(response: Response, target = origin + '/signin?state=google_recovery') {
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), target);
    assert.equal(cookie(response, 'flowboard_session'), undefined);
  }

  await t.test('0030 upgrades legacy rows and sessions without inferring subjects', async () => {
    assert.deepEqual((await runMigrations(pool)).applied, [{ version: '0030', name: '0030_google_account_subject.sql' }]);
    assert.deepEqual((await runMigrations(pool)).applied, []);
    const row = (await pool.query('SELECT google_issuer, google_subject, google_email_conflict FROM users WHERE id = $1', [legacy.user.id])).rows[0];
    assert.deepEqual(row, { google_issuer: null, google_subject: null, google_email_conflict: false });
    await assert.rejects(pool.query('UPDATE users SET google_subject = $2 WHERE id = $1', [legacy.user.id, 'subject-without-issuer']),
      (error: { code: string }) => error.code === '23514');
    const result = await app.request(origin + '/api/v1/session', { headers: { cookie: sessionCookie(legacy.session.id) } }, env);
    assert.equal(result.status, 200);
    assert.equal((await result.json() as { data: { googleAccountStatus: string } }).data.googleAccountStatus, 'unlinked');
  });

  await t.test('missing and malformed subjects cannot create accounts', async () => {
    for (const subject of [undefined, '', 53, 'contains whitespace', 'a'.repeat(256), 'a\u0000']) {
      const attempt = await start();
      declined(await callback(attempt, attempt.issue(subject, 'malformed@example.test')), origin + '/signin?state=failed');
    }
    assert.equal((await pool.query("SELECT 1 FROM users WHERE email = 'malformed@example.test'")).rowCount, 0);
  });

  await t.test('legacy address claims need explicit same-origin intent and exact session continuity', async () => {
    const first = await start(undefined, '?link=true');
    const ordinary = await session(await callback(first, first.issue('subject-legacy', legacy.user.email.toUpperCase()), legacy.session.id));
    assert.equal(ordinary.data.actor.id, legacy.user.id);
    assert.equal(ordinary.data.googleAccountStatus, 'unlinked');
    assert.equal(ordinary.data.googleConfirmationAvailable, false);
    assert.ok(ordinary.data.accessibleProjects.some(project => project.id === 'prj'));
    const board = await app.request(origin + '/api/v1/boards/brd', { headers: { cookie: sessionCookie(ordinary.token) } }, env);
    assert.equal(board.status, 200);
    const freshRecovery = await app.request(authPath + '/link', {
      method: 'POST', headers: { origin, cookie: sessionCookie(ordinary.token) },
    }, env);
    assert.equal(freshRecovery.status, 403);
    assert.deepEqual(freshRecovery.headers.getSetCookie(), []);
    const linkHeaders = { cookie: sessionCookie(legacy.session.id) };
    const wrongStarts = [
      { method: 'GET', headers: linkHeaders, status: 404 },
      { method: 'POST', headers: linkHeaders, status: 403 },
      { method: 'POST', headers: { ...linkHeaders, origin: 'https://evil.example.test' }, status: 403 },
      { method: 'POST', headers: { ...linkHeaders, origin: 'https://trusted-but-other.example.test' }, status: 403 },
      { method: 'POST', headers: { origin }, status: 401 },
    ];
    for (const { method, headers, status } of wrongStarts) {
      const result = await app.request(authPath + '/link', { method, headers }, env);
      assert.equal(result.status, status);
      assert.deepEqual(result.headers.getSetCookie(), []);
    }
    const attempt = await start(legacy.session.id);
    const replacement = await createSession(legacy.user.id, 24, pool);
    const code = attempt.issue('subject-legacy', legacy.user.email);
    const before = providerCalls;
    declined(await callback(attempt, code), settings + 'failed');
    declined(await callback(attempt, code, replacement.id), settings + 'failed');
    assert.equal(providerCalls, before, 'wrong session stopped before Google');

    const attacker = await start();
    declined(await callback(attempt, attacker.issue('subject-legacy', legacy.user.email), legacy.session.id), settings + 'failed');
    const expired = await start(legacy.session.id);
    const fields = expired.attemptCookie.split('.');
    fields[2] = String(Math.floor(Date.now() / 1000) - 1);
    declined(await callback({ ...expired, attemptCookie: fields.join('.') }, expired.issue('subject-legacy', legacy.user.email), legacy.session.id),
      origin + '/signin?state=expired');

    const revoked = await start(replacement.id);
    await pool.query('DELETE FROM sessions WHERE id = $1', [hashSessionToken(replacement.id)]);
    declined(await callback(revoked, revoked.issue('subject-legacy', legacy.user.email), replacement.id), settings + 'failed');

    const wrongGoogle = await start(legacy.session.id);
    declined(await callback(wrongGoogle, wrongGoogle.issue('wrong-account-subject', 'other@example.test'), legacy.session.id), settings + 'failed');
    const linked = await callback(attempt, code, legacy.session.id);
    assert.equal(linked.headers.get('location'), settings + 'linked');
    const { data } = await session(linked);
    assert.equal(data.actor.id, legacy.user.id);
    assert.equal(data.googleAccountStatus, 'linked');
    assert.ok(data.accessibleProjects.some(project => project.id === 'prj'));
    const superseded = await app.request(origin + '/api/v1/session', { headers: { cookie: sessionCookie(ordinary.token) } }, env);
    assert.equal(superseded.status, 401, 'a prior email-only session cannot access the newly confirmed account');
    declined(await callback(attempt, code, legacy.session.id), settings + 'failed');
    declined(await signIn('recycled-address-subject', legacy.user.email));
    const theft = await start(legacy.session.id);
    declined(await callback(theft, theft.issue('recycled-address-subject', legacy.user.email), legacy.session.id), settings + 'failed');
    const transplant = await start(f.actors.manager!.session.id);
    declined(await callback(transplant, transplant.issue('subject-legacy', f.actors.manager!.user.email), f.actors.manager!.session.id), settings + 'failed');
    assert.equal((await session(await signIn('subject-legacy', legacy.user.email))).data.actor.id, legacy.user.id);
  });

  await t.test('parallel first callbacks create one account and workspace; email and subject are distinct keys', async () => {
    const email = 'concurrent@example.test';
    const results = await Promise.all([signIn('StableSubject', email), signIn('StableSubject', email)]);
    const first = await session(results[0]);
    assert.equal((await session(results[1])).data.actor.id, first.data.actor.id);
    declined(await signIn('stablesubject', email));
    const count = (await pool.query(
      `SELECT (SELECT COUNT(*)::int FROM users WHERE email = $1) AS accounts,
              (SELECT COUNT(*)::int FROM workspaces WHERE owner_id = $2) AS workspaces`,
      [email, first.data.actor.id],
    )).rows[0];
    assert.deepEqual(count, { accounts: 1, workspaces: 1 });
    const contenders = await Promise.all([
      signIn('first-contender', 'two-subjects@example.test'),
      signIn('second-contender', 'two-subjects@example.test'),
    ]);
    assert.equal(contenders.filter(response => cookie(response, 'flowboard_session')).length, 1);
    declined(contenders.find(response => !cookie(response, 'flowboard_session'))!);
    const different = await session(await signIn('stablesubject', 'case-separated@example.test'));
    assert.notEqual(different.data.actor.id, first.data.actor.id, 'subjects are case sensitive');
    await assert.rejects(pool.query('UPDATE users SET google_subject = $2 WHERE id = $1', [different.data.actor.id, 'StableSubject']),
      (error: { code: string }) => error.code === '23505');
  });

  await t.test('subject survives a domain change and address collision without transferring project or invite rights', async () => {
    const recipientEmail = 'invite-recipient@old.example.test';
    const user = await createDevUserAndSession(recipientEmail, 'Invite Recipient', pool);
    const link = await start(user.session.id);
    const initial = await session(await callback(link, link.issue('invited-person', recipientEmail), user.session.id));
    const invite = async (email: string) => {
      const raw = crypto.randomBytes(32).toString('hex');
      await pool.query(`INSERT INTO project_invitations
         (id, project_id, workspace_id, email, role, token_hash, invited_by, status, expires_at, created_at, updated_at)
        VALUES ($1, 'prj', 'ws', $2, 'member', $3, $4, 'pending', NOW()+INTERVAL '1 day', NOW(), NOW())`,
        [crypto.randomUUID(), email, hashSessionToken(raw), legacy.user.id]);
      return raw;
    };
    const accept = async (token: string, raw: string) => app.request(origin + '/api/v1/invitations/accept', {
      method: 'POST',
      headers: { cookie: sessionCookie(token), origin, 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID() },
      body: JSON.stringify({ token: raw }),
    }, env);
    const priorMembership = await accept(initial.token, await invite(recipientEmail));
    assert.equal(priorMembership.status, 200);
    const oldInvite = await invite(recipientEmail);
    const collision = await session(await signIn('invited-person', legacy.user.email));
    assert.equal(collision.data.actor.id, user.user.id);
    assert.equal(collision.data.googleAccountStatus, 'email_conflict');
    assert.equal((await accept(initial.token, oldInvite)).status, 403);
    assert.equal((await accept(collision.token, oldInvite)).status, 403);
    const leave = await app.request(origin + '/api/v1/projects/prj/leave', {
      method: 'POST',
      headers: { cookie: sessionCookie(collision.token), origin, 'idempotency-key': crypto.randomUUID() },
    }, env);
    assert.equal(leave.status, 200, await leave.clone().text());
    const pending = await pool.query('SELECT status FROM project_invitations WHERE token_hash = $1', [hashSessionToken(oldInvite)]);
    assert.equal(pending.rows[0]?.status, 'pending', 'a conflicted address cannot revoke an invitation through leave');

    const newEmail = 'invite-recipient@new.example.test';
    const updated = await session(await signIn('invited-person', newEmail));
    assert.equal(updated.data.actor.id, user.user.id);
    assert.equal(updated.data.actor.email, newEmail);
    assert.equal(updated.data.googleAccountStatus, 'linked');
    assert.equal((await accept(initial.token, oldInvite)).status, 403);
    const accepted = await accept(initial.token, await invite(newEmail));
    assert.equal(accepted.status, 200, await accepted.clone().text());
    const reassigned = await session(await signIn('reassigned-recipient', recipientEmail));
    assert.notEqual(reassigned.data.actor.id, user.user.id);
    assert.equal(reassigned.data.accessibleProjects.some(project => project.id === 'prj'), false);
  });
});
