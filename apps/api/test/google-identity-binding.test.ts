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
    APP_ORIGIN: origin,
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
    assert.deepEqual((await runMigrations(pool)).applied, [
      { version: '0030', name: '0030_google_account_subject.sql' },
      { version: '0031', name: '0031_google_email_credential_provenance.sql' },
    ]);
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
    const strictBaselineHash = crypto.createHash('sha256').update(ordinary.token).digest('hex');
    const strippedCookie = ordinary.token.replace(/^legacy_google_/, '');
    assert.notEqual(strippedCookie, ordinary.token);
    const legacySessionRows = await pool.query(
      'SELECT 1 FROM sessions WHERE id IN ($1, $2)', [strictBaselineHash, hashSessionToken(strippedCookie)],
    );
    assert.equal(legacySessionRows.rowCount, 0, 'older builds and stripped markers cannot resolve this session');
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

  await t.test('confirming Google revokes email-only API tokens and every stage of a Claude grant', async () => {
    const actor = f.actors.manager!;
    const trusted = actor.session.id;
    const fallback = await session(await signIn('recycled-address', actor.user.email));
    const root = origin + '/api/v1/mcp';
    const redirectUri = 'https://claude.ai/api/mcp/auth_callback';
    const verifier = 'a'.repeat(64);
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const request = (path: string, init?: RequestInit) => app.request(root + path, init, env);
    const type = { 'content-type': 'application/json' };
    const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
    const registered = await request('/oauth/register', { method: 'POST', headers: type,
      body: JSON.stringify({ client_name: 'Synthetic Claude connector', redirect_uris: [redirectUri] }) });
    assert.equal(registered.status, 201);
    const { client_id } = await registered.json() as { client_id: string };
    const mintRequest = (token: string) => app.request(origin + '/api/v1/tokens', { method: 'POST',
        headers: { ...type, origin, cookie: sessionCookie(token) },
        body: JSON.stringify({ name: 'Synthetic API token', scopes: ['boards:read'], projectId: 'prj' }) }, env);
    async function mint(token: string) {
      const r = await mintRequest(token);
      assert.equal(r.status, 201);
      return (await r.json() as { data: { token: string } }).data.token;
    }
    async function prepareConsent(token: string) {
      const query = new URLSearchParams({ client_id, redirect_uri: redirectUri, resource: root,
        response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', scope: 'boards:read offline_access' });
      const begin = await request('/oauth/authorize?' + query);
      assert.equal(begin.status, 302);
      const id = new URL(begin.headers.get('location')!).searchParams.get('request');
      const binding = begin.headers.getSetCookie()[0]!.split(';')[0];
      const headers = { ...type, origin, cookie: `${sessionCookie(token)}; ${binding}` };
      const view = await request(`/authorization-requests/${id}`, { headers });
      assert.equal(view.status, 200);
      const { data } = await view.json() as { data: { csrfToken: string } };
      return () => request(`/authorization-requests/${id}/decision`, { method: 'POST', headers,
        body: JSON.stringify({ decision: 'allow', projectId: 'prj', csrfToken: data.csrfToken }) });
    }
    async function approve(token: string) {
      const reply = await (await prepareConsent(token))();
      assert.equal(reply.status, 200);
      const { data } = await reply.json() as { data: { redirectUrl: string } };
      return new URL(data.redirectUrl).searchParams.get('code')!;
    }
    const tokenRequest = (fields: Record<string, string>) => request('/oauth/token', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id, resource: root, ...fields }) });
    const exchange = (code: string) => tokenRequest({ grant_type: 'authorization_code', code,
      redirect_uri: redirectUri, code_verifier: verifier });
    const refresh = (refresh_token: string) => tokenRequest({ grant_type: 'refresh_token', refresh_token });
    const tools = (token: string) => request('', { method: 'POST',
      headers: { ...type, ...bearer(token), accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
    const board = (token: string) => app.request(origin + '/api/v1/boards/brd/metadata', { headers: bearer(token) }, env);
    async function issue(token: string) {
      const response = await exchange(await approve(token));
      assert.equal(response.status, 200);
      return response.json() as Promise<{ access_token: string; refresh_token: string }>;
    }

    const weakPat = await mint(fallback.token);
    const trustedPat = await mint(trusted);
    const otherPat = await mint(f.actors.owner!.session.id);
    const weakClaude = await issue(fallback.token);
    const trustedClaude = await issue(trusted);
    const weakUnexchangedCode = await approve(fallback.token);
    const pendingConsent = await prepareConsent(fallback.token);
    assert.equal((await board(weakPat)).status, 200);
    assert.equal((await tools(weakClaude.access_token)).status, 200);

    const confirmation = await start(trusted);
    const linked = await session(await callback(confirmation, confirmation.issue('actual-manager', actor.user.email), trusted));
    assert.equal(linked.data.googleAccountStatus, 'linked');
    const results = await Promise.all([board(weakPat), tools(weakClaude.access_token), refresh(weakClaude.refresh_token),
      exchange(weakUnexchangedCode), pendingConsent(), board(trustedPat), tools(trustedClaude.access_token),
      refresh(trustedClaude.refresh_token), board(otherPat)]);
    assert.deepEqual(results.map(result => result.status), [401, 401, 400, 400, 401, 200, 200, 200, 200]);
    assert.deepEqual(await results[2]!.json(), { error: 'invalid_grant' });
    assert.deepEqual(await results[3]!.json(), { error: 'invalid_grant' });

    // Operator-assisted binding writes the same identity columns directly.
    const member = f.actors.member!;
    const memberFallback = await session(await signIn('recycled-member', member.user.email));
    const memberPat = await mint(memberFallback.token);
    const memberClaude = await issue(memberFallback.token);
    const memberConsent = await prepareConsent(memberFallback.token);
    const binding = await pool.connect();
    let racing: Promise<Response>[] = [];
    try {
      await binding.query('BEGIN');
      await binding.query('SELECT 1 FROM users WHERE id=$1 FOR NO KEY UPDATE', [member.user.id]);
      racing = [Promise.resolve(mintRequest(memberFallback.token)), Promise.resolve(memberConsent())];
      // Wait for both mounted routes to authenticate the cookie and reach the row lock.
      let waiting = 0;
      for (let attempt = 0; attempt < 250 && waiting !== 2; attempt++) {
        waiting = (await binding.query<{ count: number }>(`SELECT count(*)::int AS count FROM pg_stat_activity
          WHERE application_name=$1 AND wait_event_type='Lock' AND query LIKE '%AND google_subject IS NULL FOR NO KEY UPDATE%'`, [f.schema])).rows[0]!.count;
        if (waiting !== 2) await new Promise(resolve => setTimeout(resolve, 10));
        await binding.query('SELECT pg_stat_clear_snapshot()');
      }
      assert.equal(waiting, 2);
      await binding.query('UPDATE users SET google_issuer=$2, google_subject=$3 WHERE id=$1', [member.user.id, GOOGLE_ISSUER, 'actual-member']);
      await binding.query('COMMIT');
    } finally {
      await binding.query('ROLLBACK');
      binding.release();
    }
    assert.deepEqual((await Promise.all(racing)).map(result => result.status), [401, 401]);
    assert.equal((await board(memberPat)).status, 401);
    assert.equal((await tools(memberClaude.access_token)).status, 401);
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
