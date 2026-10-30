import type pg from 'pg';
import type { Context } from 'hono';
import { createPool } from './postgres.ts';
import { buildInvitationEmail, acceptInvitationUrl } from '../services/invitation-email.ts';
import { mailerFromEnv, type MailEnv, type Mailer } from '../services/mailer.ts';

/**
 * Invitation email delivery from the outbox (B-10). The raw token and the recipient stay in the outbox
 * payload only while a retry may still need them. When a row settles (a send succeeds, or fails
 * permanently) the payload is replaced in the same statement that sets the status: a minimal receipt
 * with the provider message id, and nothing else (B-14, FB-AUD-09, FB-AUD-11). Logs carry reason codes only.
 */

export interface InvitationOutboxRow {
  id: string;
  payload: unknown;
}

export type DeliveryOutcome = { kind: 'delivered' } | { kind: 'failed' } | { kind: 'retry'; reason: string };

function parsePayload(payload: unknown): Record<string, unknown> {
  if (typeof payload === 'string') return JSON.parse(payload) as Record<string, unknown>;
  return (payload ?? {}) as Record<string, unknown>;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Sends one invitation row and records the outcome. The caller holds the row lock. */
export async function deliverInvitationRow(
  client: pg.ClientBase,
  row: InvitationOutboxRow,
  mailer: Mailer,
): Promise<DeliveryOutcome> {
  const payload = parsePayload(row.payload);
  const token = text(payload['token']);
  const to = text(payload['email']);

  // A row without a link (written before B-10, or after supersession) cannot be sent usefully.
  if (!token || !to) {
    await settle(client, row.id, 'failed', undefined);
    return { kind: 'failed' };
  }

  const content = buildInvitationEmail({
    appOrigin: mailer.appOrigin,
    projectName: text(payload['projectName']),
    inviterName: text(payload['inviterName']),
    role: text(payload['role']),
    expiresAt: text(payload['expiresAt']),
    acceptUrl: acceptInvitationUrl(mailer.appOrigin, token),
  });
  const outcome = await mailer.send({ to, ...content });

  if (outcome.status === 'sent') {
    await settle(client, row.id, 'delivered', outcome.providerMessageId);
    return { kind: 'delivered' };
  }
  if (outcome.status === 'permanent') {
    await settle(client, row.id, 'failed', undefined);
    return { kind: 'failed' };
  }
  return { kind: 'retry', reason: outcome.reason };
}

/**
 * Sets the final status and time, and replaces the payload with a receipt that holds only the
 * provider message id (none for a permanent failure). The recipient, role, project and inviter names
 * and the token are all dropped.
 */
async function settle(client: pg.ClientBase, id: string, status: 'delivered' | 'failed', providerMessageId: string | undefined): Promise<void> {
  await client.query(
    `UPDATE outbox
     SET status = $2,
         settled_at = NOW(),
         payload = jsonb_strip_nulls(jsonb_build_object('providerMessageId', $3::text))
     WHERE id = $1`,
    [id, status, providerMessageId ?? null],
  );
}

/**
 * Sends one pending invitation row straight after its commit. A row locked by the scheduled drain
 * is skipped. A retryable failure is left pending for the drain to retry.
 */
export async function deliverInvitationNow(pool: pg.Pool, outboxId: string, mailer: Mailer): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query<InvitationOutboxRow>(
      `SELECT id, payload FROM outbox
       WHERE id = $1 AND event_type = 'invitation.created' AND status = 'pending'
       FOR UPDATE SKIP LOCKED`,
      [outboxId],
    );
    const row = res.rows[0];
    if (row) await deliverInvitationRow(client, row, mailer);
    await client.query('COMMIT');
  } catch {
    await client.query('ROLLBACK').catch(() => {});
  } finally {
    client.release();
  }
}

/**
 * Starts the immediate send on the Worker's waitUntil, after the response is decided. Fail-soft:
 * with no mail configuration, no connection string, or no waitUntil (tests, Node), nothing starts
 * and the scheduled drain sends the email later.
 */
export function sendInvitationEmailSoon(c: Context, outboxId: string): void {
  const env = c.env as (MailEnv & { HYPERDRIVE?: { connectionString?: string }; DATABASE_URL?: string }) | undefined;
  const mailer = mailerFromEnv(env);
  const connectionString = env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
  if (!mailer || !connectionString) return;
  let ctx: { waitUntil(promise: Promise<unknown>): void };
  try {
    ctx = c.executionCtx;
  } catch {
    return;
  }
  // A private pool: the request's pool is closed when the response ends.
  const pool = createPool(connectionString, 1);
  ctx.waitUntil(
    deliverInvitationNow(pool, outboxId, mailer)
      .catch(() => {})
      .finally(() => pool.end()),
  );
}
