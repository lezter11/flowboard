import crypto from 'node:crypto';
import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock } from './rbac.ts';

export interface ReplayReceiptResult {
  statusCode: number;
  responseBody: unknown;
  replayed: true;
}

/**
 * Receipt bodies are long-lived retry metadata, not a second copy of a resource.
 * Keep only identifiers/version markers so trash/purge cannot be bypassed through
 * an old card or comment response stored in this table.
 */
function minimalReceiptOutcome(responseBody: unknown): unknown {
  const parseValue = (value: unknown): unknown => {
    if (Array.isArray(value)) {
      return value.map(parseValue);
    }
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const outcome: Record<string, unknown> = {};
    for (const key of [
      'id', 'version', 'structureVersion', 'snapshotVersion', 'operationId',
      'success', 'role', 'projectId', 'workspaceId', 'state', 'status',
    ]) {
      const field = record[key];
      if (typeof field === 'string' || typeof field === 'number' || typeof field === 'boolean') {
        outcome[key] = field;
      }
    }

    // Preserve only the response envelope and safe operation identifiers. An
    // array result (for example a canonical column order) is reduced itemwise.
    if (Object.hasOwn(record, 'data')) {
      outcome.data = parseValue(record.data) ?? {};
    }
    return outcome;
  };

  return parseValue(responseBody) ?? {};
}

/**
 * Project-write variant: serialize current role/revocation against this
 * transaction before a receipt can disclose even its minimal outcome.
 */
export async function checkOrReplayProjectWriteReceipt(
  client: pg.ClientBase,
  actorId: string,
  projectId: string,
  minRole: 'manager' | 'member',
  idempotencyKey: string,
  methodPath: string,
  body: unknown,
  boardId?: string,
): Promise<ReplayReceiptResult | null> {
  await acquireWriteGrantLock(client, projectId, actorId, minRole, boardId);
  await acquireWritableProjectContextLock(client, projectId, boardId);
  return checkOrReplayReceipt(
    client,
    actorId,
    'project',
    projectId,
    idempotencyKey,
    methodPath,
    body,
  );
}

/**
 * Deterministically serialize any JavaScript value to canonical JSON.
 * - Objects have sorted keys.
 * - Undefined properties are omitted.
 * - Arrays preserve exact element order.
 * - Null is distinguished from undefined.
 */
export function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return `[${obj.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries: string[] = [];
  for (const key of keys) {
    const val = (obj as Record<string, unknown>)[key];
    if (val !== undefined) {
      entries.push(`${JSON.stringify(key)}:${canonicalJson(val)}`);
    }
  }
  return `{${entries.join(',')}}`;
}

export function sha256(input: string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

/**
 * Check for an existing idempotency receipt.
 * - If found and hashes match: returns the replayed response.
 * - If found and hashes mismatch: throws 409 IDEMPOTENCY_CONFLICT.
 * - If not found: returns null.
 */
export async function checkOrReplayReceipt(
  client: pg.ClientBase,
  actorId: string,
  scopeType: 'workspace' | 'project' | 'actor',
  scopeId: string,
  idempotencyKey: string,
  methodPath: string,
  body: unknown,
): Promise<ReplayReceiptResult | null> {
  // Only one transaction for an actor/scope/key may pass the initial lookup.
  // Without this lock, parallel identical creates can both perform their
  // side effect before saveReceipt discovers the unique-key collision.
  await client.query(
    'SELECT pg_advisory_xact_lock(hashtext($1))',
    [JSON.stringify([actorId, scopeType, scopeId, idempotencyKey])],
  );

  const currentPathHash = sha256(methodPath);
  const currentBodyHash = sha256(canonicalJson(body ?? {}));

  const res = await client.query<{
    id: string;
    method_path_hash: string;
    body_hash: string;
    status_code: number;
    response_body: unknown;
  }>(
    `SELECT id, method_path_hash, body_hash, status_code, response_body
     FROM idempotency_receipts
     WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3 AND expires_at > NOW()`,
    [actorId, scopeId, idempotencyKey],
  );

  if (res.rows.length === 0 || !res.rows[0]) {
    return null;
  }

  const receipt = res.rows[0];
  if (receipt.method_path_hash === currentPathHash && receipt.body_hash === currentBodyHash) {
    const responseBody =
      typeof receipt.response_body === 'string'
        ? JSON.parse(receipt.response_body)
        : receipt.response_body;
    return {
      statusCode: receipt.status_code,
      responseBody: minimalReceiptOutcome(responseBody),
      replayed: true,
    };
  }

  throw HttpError.conflict(
    'Idempotency key collision with different request payload.',
    'IDEMPOTENCY_CONFLICT',
  );
}

/**
 * Save an idempotency receipt inside the active database transaction.
 */
export async function saveReceipt(
  client: pg.ClientBase,
  actorId: string,
  scopeType: 'workspace' | 'project' | 'actor',
  scopeId: string,
  idempotencyKey: string,
  methodPath: string,
  body: unknown,
  statusCode: number,
  responseBody: unknown,
  ttlDays = 7,
): Promise<ReplayReceiptResult | null> {
  const methodPathHash = sha256(methodPath);
  const bodyHash = sha256(canonicalJson(body ?? {}));
  const id = 'rcp_' + crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  const insertRes = await client.query<{ id: string }>(
    `INSERT INTO idempotency_receipts (
      id, actor_id, scope_type, scope_id, idempotency_key,
      method_path_hash, body_hash, status_code, response_body,
      expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (actor_id, scope_id, idempotency_key)
    DO UPDATE SET
      method_path_hash = EXCLUDED.method_path_hash,
      body_hash = EXCLUDED.body_hash,
      status_code = EXCLUDED.status_code,
      response_body = EXCLUDED.response_body,
      expires_at = EXCLUDED.expires_at,
      created_at = EXCLUDED.created_at
    WHERE idempotency_receipts.expires_at <= NOW()
    RETURNING id`,
    [
      id,
      actorId,
      scopeType,
      scopeId,
      idempotencyKey,
      methodPathHash,
      bodyHash,
      statusCode,
      JSON.stringify(minimalReceiptOutcome(responseBody)),
      expiresAt.toISOString(),
      now.toISOString(),
    ],
  );

  if (insertRes.rows.length === 0) {
    // An active unexpired receipt already exists (winner of a concurrent race).
    // Re-read the winner's receipt rather than throwing an unhandled 500 unique violation.
    const winnerRes = await client.query<{
      id: string;
      method_path_hash: string;
      body_hash: string;
      status_code: number;
      response_body: unknown;
    }>(
      `SELECT id, method_path_hash, body_hash, status_code, response_body
       FROM idempotency_receipts
       WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3`,
      [actorId, scopeId, idempotencyKey],
    );

    if (winnerRes.rows.length === 0 || !winnerRes.rows[0]) {
      return null;
    }

    const winner = winnerRes.rows[0];
    if (winner.method_path_hash !== methodPathHash || winner.body_hash !== bodyHash) {
      throw HttpError.conflict(
        'Idempotency key collision with different request payload.',
        'IDEMPOTENCY_CONFLICT',
      );
    }

    const parsedWinnerBody =
      typeof winner.response_body === 'string'
        ? JSON.parse(winner.response_body)
        : winner.response_body;

    return {
      statusCode: winner.status_code,
      responseBody: minimalReceiptOutcome(parsedWinnerBody),
      replayed: true,
    };
  }

  return null;
}
