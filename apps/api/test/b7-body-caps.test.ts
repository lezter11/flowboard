import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { createApp } from '../src/http/app.ts';
import { bodyLimitFor, DEFAULT_BODY_LIMIT_BYTES, IMAGE_BODY_LIMIT_BYTES, IMPORT_BODY_LIMIT_BYTES } from '../src/http/middleware/limits.ts';
import { runMigrations } from '../src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../src/adapters/postgres.ts';
import { createDevUserAndSession } from '../src/adapters/session.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';

// FB-AUD-08 regression: route-aware body caps and the bounded Google token-exchange log.

const MiB = 1024 * 1024;

test('B-7 body caps: the cap depends on the route, the method and the session', () => {
  const session = 'flowboard_session=abc';
  assert.equal(IMPORT_BODY_LIMIT_BYTES, 5 * MiB + 64 * 1024);
  assert.equal(IMAGE_BODY_LIMIT_BYTES, 10 * MiB + 64 * 1024);
  assert.equal(DEFAULT_BODY_LIMIT_BYTES, MiB);

  const cases: Array<[string, string, string | undefined, number, string]> = [
    ['POST', '/api/v1/boards/b1/imports', session, IMPORT_BODY_LIMIT_BYTES, 'signed-in board import'],
    ['POST', '/api/v1/boards/b1/card-imports', session, IMPORT_BODY_LIMIT_BYTES, 'signed-in card-import alias'],
    ['PUT', '/api/v1/image-uploads/u1/content', session, IMAGE_BODY_LIMIT_BYTES, 'signed-in image content'],
    ['POST', '/api/v1/boards/b1/imports', undefined, DEFAULT_BODY_LIMIT_BYTES, 'anonymous import keeps 1 MiB'],
    ['PUT', '/api/v1/image-uploads/u1/content', 'other=1', DEFAULT_BODY_LIMIT_BYTES, 'no session cookie keeps 1 MiB'],
    ['POST', '/api/v1/boards/b1/imports', 'session=abc', IMPORT_BODY_LIMIT_BYTES, 'legacy session cookie name is accepted'],
    ['GET', '/api/v1/boards/b1/imports', session, DEFAULT_BODY_LIMIT_BYTES, 'GET is not an import upload'],
    ['POST', '/api/v1/boards/b1/imports', 'x=1; flowboard_session=abc', IMPORT_BODY_LIMIT_BYTES, 'session among other cookies'],
    ['PUT', '/api/v1/image-uploads/u1/content', session, IMAGE_BODY_LIMIT_BYTES, 'image cap is not used for imports'],
    ['POST', '/api/v1/projects/p1/invitations', session, DEFAULT_BODY_LIMIT_BYTES, 'other routes stay at 1 MiB'],
    ['PATCH', '/api/v1/cards/c1', session, DEFAULT_BODY_LIMIT_BYTES, 'card PATCH stays at 1 MiB'],
  ];
  for (const [method, path, cookie, expected, why] of cases) {
    assert.equal(bodyLimitFor(method, path, cookie), expected, why);
  }
});

const pool = createPool(localDatabaseUrl(process.env['DATABASE_URL']), 4);
setGlobalPool(pool);

test('B-7 body caps: the boundary is enforced on the wire, with and without a session', async (t) => {
  await runMigrations(pool);
  const app = createApp(async () => {}, { pool });
  const s = crypto.randomBytes(4).toString('hex');
  const session = await createDevUserAndSession(`caps.${s}@flowboard.example`, 'Caps', pool);
  const cookie = `flowboard_session=${session.session.id}`;

  // Sends a body of exactly `size` bytes. Auth runs after the cap, so the status shows which side won.
  const send = (method: string, path: string, size: number, withCookie: boolean) =>
    app.request(`http://localhost${path}`, {
      method,
      headers: {
        ...(withCookie ? { cookie } : {}),
        'content-type': 'application/octet-stream',
        'idempotency-key': `b7-cap-${crypto.randomUUID()}`,
      },
      body: Buffer.alloc(size, 0x41),
    });
  const importPath = '/api/v1/boards/b_cap/imports';
  const imagePath = '/api/v1/image-uploads/u_cap/content';

  await t.test('a signed-in import at exactly 5 MiB plus envelope is not refused for size', async () => {
    const res = await send('POST', importPath, IMPORT_BODY_LIMIT_BYTES, true);
    assert.notEqual(res.status, 413);
  });

  await t.test('a signed-in import one byte over the cap is refused with 413', async () => {
    const res = await send('POST', importPath, IMPORT_BODY_LIMIT_BYTES + 1, true);
    assert.equal(res.status, 413);
    assert.equal(((await res.json()) as any).error.code, 'PAYLOAD_TOO_LARGE');
  });

  await t.test('an anonymous import over 1 MiB is refused with 413 before auth', async () => {
    const res = await send('POST', importPath, DEFAULT_BODY_LIMIT_BYTES + 1, false);
    assert.equal(res.status, 413);
  });

  await t.test('a signed-in image content upload at the envelope size is not refused for size', async () => {
    const res = await send('PUT', imagePath, IMAGE_BODY_LIMIT_BYTES, true);
    assert.notEqual(res.status, 413);
  });

  await t.test('a signed-in image content upload one byte over the cap is refused with 413', async () => {
    const res = await send('PUT', imagePath, IMAGE_BODY_LIMIT_BYTES + 1, true);
    assert.equal(res.status, 413);
  });

  await t.test('a signed-in import body is still capped at 5 MiB, not at the image cap', async () => {
    const res = await send('POST', importPath, IMAGE_BODY_LIMIT_BYTES, true);
    assert.equal(res.status, 413);
  });

  await t.test('other signed-in routes stay at 1 MiB', async () => {
    const res = await send('POST', '/api/v1/projects/p_cap/invitations', DEFAULT_BODY_LIMIT_BYTES + 1, true);
    assert.equal(res.status, 413);
  });
});

test('B-7 Google token exchange: a failure logs the status only, never the provider body', async (t) => {
  const app = createApp(async () => {}, { pool });
  const secretBody = `provider-secret-${'x'.repeat(4000)}`;
  const realFetch = globalThis.fetch;
  const logged: string[] = [];
  const realError = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
  };
  globalThis.fetch = (async (input: unknown) => {
    if (String(input).startsWith('https://oauth2.googleapis.com/token')) {
      return new Response(secretBody, { status: 400, headers: { 'content-type': 'text/plain' } });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }) as typeof fetch;
  try {
    await t.test('the response is a 400 TOKEN_EXCHANGE_FAILED and the log holds no provider text', async () => {
      const res = await app.request(
        'http://localhost/api/v1/auth/google/callback?code=abc&state=st_cap',
        { headers: { cookie: 'flowboard_oauth_state=st_cap' } },
        { GOOGLE_CLIENT_ID: 'client-id-cap', GOOGLE_CLIENT_SECRET: 'client-secret-cap' } as never,
      );
      assert.equal(res.status, 400);
      assert.equal(((await res.json()) as any).error.code, 'TOKEN_EXCHANGE_FAILED');
      const line = logged.find((l) => l.includes('google_token_exchange_failed'));
      assert.ok(line, 'a failure line is logged');
      assert.ok(!line.includes('provider-secret'), 'no provider body in the log');
      assert.ok(line.length < 200, 'the log line is short');
      assert.deepEqual(JSON.parse(line), { event: 'google_token_exchange_failed', status: 400 });
    });
  } finally {
    globalThis.fetch = realFetch;
    console.error = realError;
  }
});
