import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import type pg from 'pg';
import { createApp } from '../src/http/app.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { processOutboxLease } from '../src/adapters/notifications.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import { BrevoMailer, BREVO_SEND_URL, mailerFromEnv, validAppOrigin, type MailMessage } from '../src/services/mailer.ts';
import { buildInvitationEmail, escapeHtml, plainLine } from '../src/services/invitation-email.ts';

// B-10: invitation email through the outbox. Every test uses a fake fetch or a recording mailer.
// Nothing here calls Brevo.

const pool: pg.Pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);
const app = createApp(async () => {}, { pool });
const ORIGIN = 'https://flowboard.example';

async function fixture(projectName = 'Launch <b>"Team"</b> & co') {
  await runMigrations(pool);
  const s = crypto.randomBytes(4).toString('hex');
  const owner = await createDevUserAndSession(`owner.${s}@flowboard.example`, 'Olive Owner', pool);
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, owner.user.id]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,$3,now(),now())`, [project, ws, projectName]);
  return { s, project, owner, cookie: `flowboard_session=${owner.session.id}` };
}

function invite(fx: Awaited<ReturnType<typeof fixture>>, email: string, key = crypto.randomUUID()) {
  return app.request(`http://localhost/api/v1/projects/${fx.project}/invitations`, {
    method: 'POST',
    headers: { cookie: fx.cookie, origin: 'http://localhost', 'idempotency-key': `b10-${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email, role: 'member' }),
  });
}

/** A fake Brevo endpoint. Each call records what was sent; `reply` chooses the response. */
function fakeBrevo(reply: (n: number) => Response | Error = () => Response.json({ messageId: '<m-1@brevo>' }, { status: 201 })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), init });
    const r = reply(calls.length);
    if (r instanceof Error) throw r;
    return r;
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const brevoFor = (fetchImpl: typeof fetch) =>
  new BrevoMailer('test-key-not-real', { fromEmail: 'mail@flowboard.example', fromName: 'Flowboard', appOrigin: ORIGIN }, fetchImpl);

async function outboxRow(invitationId: string) {
  const res = await pool.query<{ id: string; status: string; retry_count: number; payload: any }>(
    `SELECT id, status, retry_count, payload FROM outbox WHERE event_type = 'invitation.created' AND payload->>'invitationId' = $1 ORDER BY created_at DESC`,
    [invitationId],
  );
  return res.rows;
}

test('B-10 email: the disabled mailer does nothing and the pending row keeps its link', async (t) => {
  await t.test('no key, no sender or a bad origin means no mailer', () => {
    assert.equal(mailerFromEnv({}), null);
    assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'mail@flowboard.example' }), null, 'origin missing');
    assert.equal(mailerFromEnv({ BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'not-an-address', APP_ORIGIN: ORIGIN }), null);
    assert.ok(mailerFromEnv({ BREVO_API_KEY: 'k', MAIL_FROM_EMAIL: 'mail@flowboard.example', APP_ORIGIN: ORIGIN }));
  });

  await t.test('an invitation with mail disabled stays pending and untouched, and the API still answers', async () => {
    const fx = await fixture();
    const email = `disabled.${fx.s}@example.com`;
    const res = await invite(fx, email);
    assert.equal(res.status, 201, await res.clone().text());
    const body = (await res.json()) as any;
    assert.ok(body.data.token, 'the one-time link is still returned to the inviter');
    const [row] = await outboxRow(body.data.id);
    assert.equal(row!.status, 'pending');
    assert.equal(row!.payload.token, body.data.token, 'the link is kept for a later send');
    await processOutboxLease(pool, { batchSize: 50 });
    const after = await outboxRow(body.data.id);
    assert.equal(after[0]!.status, 'pending', 'no mailer: the drain leaves the row alone');
    assert.equal(after[0]!.retry_count, 0, 'and does not count a failure');
  });
});

test('B-10 email: create sends the accept link to the invitee, then drops the token', async (t) => {
  const fx = await fixture();
  const email = `invitee.${fx.s}@example.com`;
  const res = await invite(fx, email);
  const body = (await res.json()) as any;
  const token = body.data.token as string;

  const fake = fakeBrevo();
  await t.test('the drain sends one email with the accept link on the configured origin', async () => {
    await processOutboxLease(pool, { batchSize: 50, mailer: brevoFor(fake.fetchImpl) });
    const mine = fake.calls.filter((c) => JSON.parse(String(c.init.body)).to[0].email === email);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.url, BREVO_SEND_URL);
    assert.equal((mine[0]!.init.headers as Record<string, string>)['api-key'], 'test-key-not-real');
    const payload = JSON.parse(String(mine[0]!.init.body));
    assert.deepEqual(payload.sender, { email: 'mail@flowboard.example', name: 'Flowboard' });
    assert.deepEqual(payload.to, [{ email }]);
    assert.ok(payload.textContent.includes(`${ORIGIN}/invitation?token=${token}`), 'text carries the link');
    assert.ok(payload.htmlContent.includes(`${ORIGIN}/invitation?token=${token}`), 'html carries the link');
    assert.ok(payload.subject.includes('Launch'), 'subject names the project');
  });

  await t.test('after the send the row is delivered, holds no token, and records only the provider id', async () => {
    const [row] = await outboxRow(body.data.id);
    assert.equal(row!.status, 'delivered');
    assert.equal(row!.payload.token, undefined);
    assert.equal(row!.payload.providerMessageId, '<m-1@brevo>');
    assert.ok(!JSON.stringify(row!.payload).includes(token), 'the token is gone from the row');
  });

  await t.test('an idempotent replay of the create writes no second row and sends nothing more', async () => {
    const sendsBefore = fake.calls.length;
    const key = crypto.randomUUID();
    const first = await invite(fx, `replay.${fx.s}@example.com`, key);
    assert.equal(first.status, 201);
    const replay = await invite(fx, `replay.${fx.s}@example.com`, key);
    assert.ok([200, 201].includes(replay.status));
    const body2 = (await replay.json()) as any;
    assert.equal(body2.replayed, true);
    const rows = await outboxRow(((await first.json()) as any).data.id);
    assert.equal(rows.length, 1, 'one outbox row');
    await processOutboxLease(pool, { batchSize: 50, mailer: brevoFor(fake.fetchImpl) });
    const replaySends = fake.calls.slice(sendsBefore).filter((c) => JSON.parse(String(c.init.body)).to[0].email === `replay.${fx.s}@example.com`);
    assert.equal(replaySends.length, 1, 'the replayed create does not send a second email');
  });
});

test('B-10 email: resend supersedes the earlier pending email, so only the newest link works', async () => {
  const fx = await fixture();
  const email = `resend.${fx.s}@example.com`;
  const created = (await (await invite(fx, email)).json()) as any;
  const oldToken = created.data.token as string;
  const invitationId = created.data.id as string;

  const resend = await app.request(`http://localhost/api/v1/projects/${fx.project}/invitations/${invitationId}/resend`, {
    method: 'POST',
    headers: { cookie: fx.cookie, origin: 'http://localhost', 'idempotency-key': `b10-resend-${crypto.randomUUID()}` },
  });
  assert.equal(resend.status, 200, await resend.clone().text());
  const newToken = ((await resend.json()) as any).data.token as string;
  assert.notEqual(newToken, oldToken);

  const rows = await outboxRow(invitationId);
  const superseded = rows.find((r) => r.payload.token === undefined && r.status === 'failed');
  assert.ok(superseded, 'the earlier pending row is settled without sending');
  assert.ok(!JSON.stringify(rows).includes(oldToken), 'the old token is gone everywhere in the outbox');

  const fake = fakeBrevo();
  await processOutboxLease(pool, { batchSize: 50, mailer: brevoFor(fake.fetchImpl) });
  const mine = fake.calls.map((c) => String(c.init.body)).filter((b) => b.includes(email));
  assert.equal(mine.length, 1, 'one email for the invitation, not two');
  assert.ok(mine[0]!.includes(newToken));
  assert.ok(!mine[0]!.includes(oldToken));
});

test('B-10 email: Brevo 5xx, 429 and network errors retry; other 4xx is permanent and drops the token', async (t) => {
  const cases: Array<[string, () => Response | Error, 'pending' | 'failed']> = [
    ['5xx retries', () => new Response('server error', { status: 503 }), 'pending'],
    ['429 retries', () => new Response('slow down', { status: 429 }), 'pending'],
    ['network error retries', () => new Error('socket reset'), 'pending'],
    ['400 is permanent', () => new Response('bad request body', { status: 400 }), 'failed'],
    ['401 is permanent', () => new Response('unauthorised', { status: 401 }), 'failed'],
  ];
  for (const [label, reply, expected] of cases) {
    await t.test(label, async () => {
      const fx = await fixture();
      const email = `class.${fx.s}@example.com`;
      const created = (await (await invite(fx, email)).json()) as any;
      const token = created.data.token as string;
      const fake = fakeBrevo(reply);
      await processOutboxLease(pool, { batchSize: 50, mailer: brevoFor(fake.fetchImpl) });
      const [row] = await outboxRow(created.data.id);
      assert.equal(row!.status, expected);
      if (expected === 'pending') {
        assert.equal(row!.retry_count, 1, 'the retry is counted');
        assert.equal(row!.payload.token, token, 'the link is kept for the retry');
      } else {
        assert.equal(row!.payload.token, undefined, 'the token is dropped once the send is refused');
      }
      assert.ok(!JSON.stringify(row!.payload).includes(token) || expected === 'pending');
    });
  }
});

test('B-10 email: the HTML is escaped, the subject is one line, and names cannot inject markup or headers', () => {
  const content = buildInvitationEmail({
    projectName: 'Launch <script>alert(1)</script> & "co"\r\nBcc: victim@example.net',
    inviterName: '<img src=x onerror=alert(1)>',
    role: 'manager',
    expiresAt: '2026-11-06T10:00:00.000Z',
    acceptUrl: `${ORIGIN}/invitation?token=abc`,
  });
  assert.ok(!content.subject.includes('\r') && !content.subject.includes('\n'), 'no CR or LF in the subject');
  assert.ok(!content.html.includes('<script>'), 'no raw script in the HTML');
  assert.ok(!content.html.includes('<img src=x'), 'no raw image tag in the HTML');
  assert.ok(content.html.includes('&lt;img src=x onerror=alert(1)&gt;'), 'the inviter name is escaped');
  assert.ok(content.html.includes('&amp;'), 'ampersands are escaped');
  assert.ok(content.html.includes('href="https://flowboard.example/invitation?token=abc"'), 'the link is quoted and escaped');
  assert.ok(content.text.includes('Manager'), 'role label');
  assert.ok(content.text.includes('2026-11-06'), 'expiry date only');
  assert.equal(escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  assert.equal(plainLine('a\r\nb\tc', 50), 'a b c');
  assert.ok(plainLine('x'.repeat(500), 100).length === 100, 'bounded');
});

test('B-10 email: the app origin comes from configuration only and must be https or a local dev host', () => {
  assert.equal(validAppOrigin('https://flowboard.example'), 'https://flowboard.example');
  assert.equal(validAppOrigin('https://flowboard.example/'), 'https://flowboard.example');
  assert.equal(validAppOrigin('http://localhost:3000'), 'http://localhost:3000');
  for (const bad of ['http://flowboard.example', 'https://flowboard.example/app', 'https://u:p@flowboard.example', 'https://flowboard.example?x=1', 'javascript:alert(1)', '']) {
    assert.equal(validAppOrigin(bad), null, bad);
  }
});

test('B-10 email: no token, key or provider body reaches a log on any send path', async () => {
  const fx = await fixture();
  const created = (await (await invite(fx, `logs.${fx.s}@example.com`)).json()) as any;
  const token = created.data.token as string;
  const captured: string[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const capture = (...args: unknown[]) => { captured.push(args.map((a) => String(a)).join(' ')); };
  console.log = capture; console.warn = capture; console.error = capture; console.info = capture;
  try {
    const { fetchImpl } = fakeBrevo(() => new Response(`provider echoed ${token}`, { status: 400 }));
    await processOutboxLease(pool, { batchSize: 50, mailer: brevoFor(fetchImpl) });
    const { fetchImpl: failing } = fakeBrevo(() => new Response('boom', { status: 500 }));
    await processOutboxLease(pool, { batchSize: 50, mailer: brevoFor(failing) });
  } finally {
    console.log = saved.log; console.warn = saved.warn; console.error = saved.error; console.info = saved.info;
  }
  assert.ok(!captured.some((line) => line.includes(token)), 'the token never appears in a log line');
  assert.ok(!captured.some((line) => line.includes('test-key-not-real')), 'the key never appears in a log line');
});
