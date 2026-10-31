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
    invitationId: text(payload['invitationId']),
    recipientEmail: to,
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
 * What the immediate path did, as a reason code. Never a token, address, name or provider body.
 * `skipped:*` means nothing was attempted; `error:*` carries a SQLSTATE or a short system code.
 */
export type ImmediateResult =
  | 'delivered'
  | 'failed'
  | 'not_pending'
  | `retry:${string}`
  | `skipped:${string}`
  | `error:${string}`;

/**
 * Sends one pending invitation row straight after its commit. A row locked by the scheduled drain
 * (or already settled) is skipped. A retryable failure is left pending for the drain to retry.
 * Throws if no connection can be taken; the caller logs that as an error code.
 */
export async function deliverInvitationNow(pool: pg.Pool, outboxId: string, mailer: Mailer): Promise<ImmediateResult> {
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
    const outcome = row ? await deliverInvitationRow(client, row, mailer) : null;
    await client.query('COMMIT');
    if (!outcome) return 'not_pending';
    if (outcome.kind === 'retry') return `retry:${outcome.reason}`;
    return outcome.kind;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return `error:${errorCode(error)}`;
  } finally {
    client.release();
  }
}

/** A SQLSTATE or a short system code such as ECONNREFUSED. Never the message, which can echo SQL or values. */
function errorCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,16}$/.test(code) ? code : 'unknown';
}

/**
 * One line per immediate attempt, with the reason code only. Delivery and "already handled" are
 * info; everything else is a warning, because the scheduled drain must then pick the row up.
 */
function logImmediate(result: ImmediateResult): void {
  const line = JSON.stringify({ event: 'invitation_immediate_send', result });
  if (result === 'delivered' || result === 'not_pending') console.info(line);
  else console.warn(line);
}

type WaitUntilContext = { waitUntil(promise: Promise<unknown>): void };

/**
 * Starts the immediate send on the Worker's waitUntil, after the response is decided. Fail-soft:
 * with no mail configuration, no connection string, or no waitUntil (tests, Node), nothing starts
 * and the scheduled drain sends the email later. Each early return logs its reason code (UAT, B-14
 * follow-up), so a missing setting shows up in the Worker logs rather than as silence.
 */
export function sendInvitationEmailSoon(c: Context, outboxId: string): void {
  const env = c.env as (MailEnv & { HYPERDRIVE?: { connectionString?: string }; DATABASE_URL?: string }) | undefined;
  const mailer = mailerFromEnv(env);
  if (!mailer) return logImmediate('skipped:mail_not_configured');
  const connectionString = env?.HYPERDRIVE?.connectionString ?? env?.DATABASE_URL;
  if (!connectionString) return logImmediate('skipped:no_connection_string');
  let ctx: WaitUntilContext;
  try {
    ctx = c.executionCtx;
  } catch {
    // Hono throws here when the app was called without an ExecutionContext (the Worker must pass one).
    return logImmediate('skipped:no_execution_context');
  }
  // A private pool: the request's pool is closed when the response ends.
  const pool = createPool(connectionString, 1);
  ctx.waitUntil(
    deliverInvitationNow(pool, outboxId, mailer)
      .catch((error: unknown) => `error:${errorCode(error)}` as ImmediateResult)
      .then(logImmediate)
      .finally(() => pool.end().catch(() => {})),
  );
}
