import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import pg from 'pg';
import { runMigrations } from '../src/adapters/migrations.ts';
import { deliverInvitationNow } from '../src/adapters/invitation-delivery.ts';
import { localDatabaseUrl } from '../src/runtime/local-config.ts';
import type { Mailer, MailOutcome } from '../src/services/mailer.ts';
import { OUTBOX_RETENTION_DAYS, purgeSettledOutbox } from '../src/services/outbox-retention.ts';

// B-14 (FB-AUD-09, FB-AUD-11). Each run migrates a fresh schema, so the retention purge sees only these rows.
const url = localDatabaseUrl(process.env['DATABASE_URL']);

async function freshSchema() {
  const schema = `b14_outbox_${crypto.randomBytes(6).toString('hex')}`;
  const admin = new pg.Pool({ connectionString: url, max: 1 });
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const pool = new pg.Pool({ connectionString: url, max: 2, options: `-c search_path=${schema}` });
  await runMigrations(pool);
  return {
    pool,
    async close() {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    },
  };
}

const SECRET_PAYLOAD = {
  invitationId: 'inv_secret',
  email: 'private.person@flowboard.example',
  role: 'member',
  projectId: 'PROJECT_PLACEHOLDER',
  workspaceId: 'WORKSPACE_PLACEHOLDER',
  projectName: 'Quarterly Board Title',
  inviterName: 'Inviter Private Name',
  expiresAt: '2026-12-31T00:00:00.000Z',
  token: 'raw-token-do-not-keep',
};

/** A pending invitation row with the B-10 payload shape, in a fresh schema. */
async function seedPendingInvitation(pool: pg.Pool, outboxId: string, settledAgo?: string) {
  const s = crypto.randomBytes(4).toString('hex');
  const ws = `ws_${s}`;
  const project = `p_${s}`;
  await pool.query(`INSERT INTO users (id,email,display_name,created_at,updated_at) VALUES ($1,'owner@flowboard.example','Owner',now(),now())`, [`u_${s}`]);
  await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ($1,'WS','UTC',$2,now(),now())`, [ws, `u_${s}`]);
  await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ($1,$2,'P',now(),now())`, [project, ws]);
  const payload = { ...SECRET_PAYLOAD, projectId: project, workspaceId: ws };
  await pool.query(
    `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, retry_count, next_retry_at, created_at, settled_at)
     VALUES ($1, $2, $3, 'invitation.created', $4, 'pending', 0, now(), now(), $5)`,
    [outboxId, ws, project, JSON.stringify(payload), settledAgo ?? null],
  );
  return { ws, project };
}

function mailer(outcome: MailOutcome): Mailer & { sent: number } {
  const recorder = { appOrigin: 'https://app.flowboard.example', sent: 0, send: async () => { recorder.sent++; return outcome; } };
  return recorder;
}

test('B-14: a delivered invitation keeps only a receipt with the provider message id', async () => {
  const db = await freshSchema();
  try {
    await seedPendingInvitation(db.pool, 'out_sent');
    await deliverInvitationNow(db.pool, 'out_sent', mailer({ status: 'sent', providerMessageId: 'msg-123' }));

    const row = await db.pool.query<{ status: string; payload: unknown; settled_at: Date | null }>(
      'SELECT status, payload, settled_at FROM outbox WHERE id = $1',
      ['out_sent'],
    );
    assert.equal(row.rows[0]!.status, 'delivered');
    assert.ok(row.rows[0]!.settled_at instanceof Date, 'settled_at is set');
    assert.deepEqual(row.rows[0]!.payload, { providerMessageId: 'msg-123' });
    const text = JSON.stringify(row.rows[0]!.payload);
    for (const kept of [SECRET_PAYLOAD.email, SECRET_PAYLOAD.projectName, SECRET_PAYLOAD.inviterName, SECRET_PAYLOAD.token]) {
      assert.equal(text.includes(kept), false, `the receipt does not hold ${kept}`);
    }
  } finally {
    await db.close();
  }
});

test('B-14: a permanently refused invitation keeps an empty receipt, with no recipient or template fields', async () => {
  const db = await freshSchema();
  try {
    await seedPendingInvitation(db.pool, 'out_refused');
    await deliverInvitationNow(db.pool, 'out_refused', mailer({ status: 'permanent', reason: 'http_400' }));

    const row = await db.pool.query<{ status: string; payload: unknown; settled_at: Date | null }>(
      'SELECT status, payload, settled_at FROM outbox WHERE id = $1',
      ['out_refused'],
    );
    assert.equal(row.rows[0]!.status, 'failed');
    assert.ok(row.rows[0]!.settled_at instanceof Date, 'settled_at is set');
    assert.deepEqual(row.rows[0]!.payload, {});
  } finally {
    await db.close();
  }
});

test('B-14: a retryable failure keeps the payload, so the drain can still send it', async () => {
  const db = await freshSchema();
  try {
    await seedPendingInvitation(db.pool, 'out_retry');
    await deliverInvitationNow(db.pool, 'out_retry', mailer({ status: 'retry', reason: 'network' }));

    const row = await db.pool.query<{ status: string; payload: Record<string, unknown>; settled_at: Date | null }>(
      'SELECT status, payload, settled_at FROM outbox WHERE id = $1',
      ['out_retry'],
    );
    assert.equal(row.rows[0]!.status, 'pending');
    assert.equal(row.rows[0]!.settled_at, null);
    assert.equal(row.rows[0]!.payload['email'], SECRET_PAYLOAD.email);
    assert.equal(row.rows[0]!.payload['token'], SECRET_PAYLOAD.token);
  } finally {
    await db.close();
  }
});

test('B-14: the retention purge deletes settled rows older than 30 days, and nothing else', async () => {
  const db = await freshSchema();
  try {
    assert.equal(OUTBOX_RETENTION_DAYS, 30);
    await seedPendingInvitation(db.pool, 'out_pending_old');
    await db.pool.query(`UPDATE outbox SET created_at = now() - interval '400 days' WHERE id = 'out_pending_old'`);

    const ws = (await db.pool.query<{ workspace_id: string; project_id: string }>('SELECT workspace_id, project_id FROM outbox LIMIT 1')).rows[0]!;
    const insert = (id: string, status: string, createdDays: number, settledDays: number | null) =>
      db.pool.query(
        `INSERT INTO outbox (id, workspace_id, project_id, event_type, payload, status, next_retry_at, created_at, settled_at)
         VALUES ($1, $2, $3, 'invitation.created', '{}', $4, now(),
                 now() - ($5::int * interval '1 day'),
                 CASE WHEN $6::int IS NULL THEN NULL ELSE now() - ($6::int * interval '1 day') END)`,
        [id, ws.workspace_id, ws.project_id, status, createdDays, settledDays],
      );
    await insert('out_settled_31', 'delivered', 40, 31);
    await insert('out_settled_29', 'failed', 40, 29);
    await insert('out_legacy_settled', 'delivered', 40, null);
    await insert('out_legacy_recent', 'delivered', 3, null);

    const deleted = await purgeSettledOutbox(db.pool);
    assert.equal(deleted, 2, 'the 31-day-old settled row and the legacy row created 40 days ago are purged');

    const left = await db.pool.query<{ id: string }>('SELECT id FROM outbox ORDER BY id');
    assert.deepEqual(
      left.rows.map((r) => r.id),
      ['out_legacy_recent', 'out_pending_old', 'out_settled_29'],
      'pending rows are never purged, and recent settled rows stay',
    );
  } finally {
    await db.close();
  }
});
