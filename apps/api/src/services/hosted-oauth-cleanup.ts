import type pg from 'pg';

export const HOSTED_OAUTH_IDENTITY_RETENTION_DAYS = 7;
export const HOSTED_OAUTH_CLEANUP_BATCH_SIZE = 25;
export const HOSTED_OAUTH_CLEANUP_MAX_BATCH_SIZE = 100;

export interface HostedOAuthCleanupResult {
  connectionsDeleted: number;
  requestsDeleted: number;
  requestsRedacted: number;
  clientsDeleted: number;
}

// A revoked connection ends at revocation or absolute expiry, whichever came
// first. Last use is a conservative backstop for existing receipt references.
// Keep all code/refresh hashes until this entire family becomes purgeable.
const DELETE_CONNECTIONS = `
  WITH candidates AS (
    SELECT g.id FROM mcp_oauth_connections g
    WHERE (g.revoked_at IS NOT NULL OR g.expires_at <= clock_timestamp())
      AND GREATEST(
        LEAST(g.expires_at, COALESCE(g.revoked_at, g.expires_at)),
        COALESCE(g.last_used_at, g.created_at)
      ) <= clock_timestamp() - ($2::int * INTERVAL '1 day')
    ORDER BY GREATEST(
      LEAST(g.expires_at, COALESCE(g.revoked_at, g.expires_at)),
      COALESCE(g.last_used_at, g.created_at)
    ), g.id
    LIMIT $1 FOR UPDATE OF g SKIP LOCKED
  )
  DELETE FROM mcp_oauth_connections g USING candidates c WHERE g.id = c.id`;

// A request's code FK uses ON DELETE CASCADE. Never remove the request while
// any retained code refers to it, even when its browser window is long over.
const DELETE_ORPHAN_REQUESTS = `
  WITH candidates AS (
    SELECT r.id FROM mcp_oauth_authorization_requests r
    WHERE r.expires_at <= clock_timestamp()
      AND NOT EXISTS (
        SELECT 1 FROM mcp_oauth_authorization_codes c WHERE c.request_id = r.id
      )
    ORDER BY r.expires_at, r.id
    LIMIT $1 FOR UPDATE OF r SKIP LOCKED
  )
  DELETE FROM mcp_oauth_authorization_requests r USING candidates c WHERE r.id = c.id`;

// A public all-zero hash is a non-credential sentinel compatible with the
// existing NOT NULL/hash-shape constraint. Active pending bindings are untouched.
const REDACT_REQUESTS = `
  WITH candidates AS (
    SELECT r.id FROM mcp_oauth_authorization_requests r
    WHERE (r.decided_at IS NOT NULL OR r.expires_at <= clock_timestamp())
      AND (r.state IS NOT NULL OR r.session_hash IS NOT NULL
        OR r.csrf_hash IS NOT NULL OR r.browser_binding_hash <> repeat('0', 64))
    ORDER BY COALESCE(r.decided_at, r.expires_at), r.id
    LIMIT $1 FOR UPDATE OF r SKIP LOCKED
  )
  UPDATE mcp_oauth_authorization_requests r
  SET state = NULL, session_hash = NULL, csrf_hash = NULL,
      browser_binding_hash = repeat('0', 64)
  FROM candidates c WHERE r.id = c.id`;

const DELETE_CLIENTS = `
  WITH candidates AS (
    SELECT c.client_id FROM mcp_oauth_clients c
    WHERE c.expires_at <= clock_timestamp()
      AND NOT EXISTS (
        SELECT 1 FROM mcp_oauth_connections g
        WHERE g.client_id = c.client_id AND g.revoked_at IS NULL
          AND g.expires_at > clock_timestamp()
      )
      AND NOT EXISTS (
        SELECT 1 FROM mcp_oauth_authorization_requests r
        WHERE r.client_id = c.client_id AND r.decided_at IS NULL
          AND r.expires_at > clock_timestamp()
      )
    ORDER BY c.expires_at, c.client_id
    LIMIT $1 FOR UPDATE OF c SKIP LOCKED
  )
  DELETE FROM mcp_oauth_clients c USING candidates d WHERE c.client_id = d.client_id`;

/**
 * One bounded transaction per scheduler tick. The cap counts top-level families
 * or requests per stage; deleting a terminal family cascades its credential rows.
 * A stage timeout rolls this transaction back and the Worker reports failure.
 */
export async function cleanupExpiredHostedOAuth(
  pool: pg.Pool,
  options: { batchSize?: number } = {},
): Promise<HostedOAuthCleanupResult> {
  const requested = options.batchSize ?? HOSTED_OAUTH_CLEANUP_BATCH_SIZE;
  if (!Number.isInteger(requested) || requested < 1) {
    throw new Error('OAuth cleanup batch size must be a positive integer.');
  }
  const limit = Math.min(requested, HOSTED_OAUTH_CLEANUP_MAX_BATCH_SIZE);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout = '5000ms'");
    const connections = await client.query(DELETE_CONNECTIONS, [limit, HOSTED_OAUTH_IDENTITY_RETENTION_DAYS]);
    const requests = await client.query(DELETE_ORPHAN_REQUESTS, [limit]);
    const redactions = await client.query(REDACT_REQUESTS, [limit]);
    const clients = await client.query(DELETE_CLIENTS, [limit]);
    await client.query('COMMIT');
    return {
      connectionsDeleted: connections.rowCount ?? 0,
      requestsDeleted: requests.rowCount ?? 0,
      requestsRedacted: redactions.rowCount ?? 0,
      clientsDeleted: clients.rowCount ?? 0,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
