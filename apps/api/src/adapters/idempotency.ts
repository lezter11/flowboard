import crypto from 'node:crypto';
import type pg from 'pg';
import { HttpError } from '../http/errors.ts';

export interface ReplayReceiptResult {
  statusCode: number;
  responseBody: unknown;
  replayed: true;
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
     WHERE actor_id = $1 AND scope_id = $2 AND idempotency_key = $3`,
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
      responseBody,
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
): Promise<void> {
  const methodPathHash = sha256(methodPath);
  const bodyHash = sha256(canonicalJson(body ?? {}));
  const id = 'rcp_' + crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);

  await client.query(
    `INSERT INTO idempotency_receipts (
      id, actor_id, scope_type, scope_id, idempotency_key,
      method_path_hash, body_hash, status_code, response_body,
      expires_at, created_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      id,
      actorId,
      scopeType,
      scopeId,
      idempotencyKey,
      methodPathHash,
      bodyHash,
      statusCode,
      JSON.stringify(responseBody),
      expiresAt.toISOString(),
      now.toISOString(),
    ],
  );
}
