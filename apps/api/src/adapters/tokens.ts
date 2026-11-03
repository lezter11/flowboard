import crypto from 'node:crypto';
import type pg from 'pg';
import { createTokenInputSchema, type SessionActor, type TokenScope, type TokenSummary } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { lockProjectBoardReadScope } from './board-grants-foundation.ts';

export const MAX_ACTIVE_PERSONAL_ACCESS_TOKENS = 20;

export interface PersonalAccessTokenRecord {
  id: string;
  userId: string;
  name: string;
  tokenHash: string;
  tokenPrefix: string;
  scopes: TokenScope[];
  projectId: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function hashPersonalAccessToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generatePersonalAccessToken(): { rawToken: string; prefix: string; tokenHash: string } {
  // Prefix 'flw_pat_' followed by 32 cryptographically secure random bytes in hex (64 chars) -> 72 chars total
  const randomPart = crypto.randomBytes(32).toString('hex');
  const rawToken = `flw_pat_${randomPart}`;
  const prefix = rawToken.slice(0, 16);
  const tokenHash = hashPersonalAccessToken(rawToken);
  return { rawToken, prefix, tokenHash };
}

export async function createPersonalAccessToken(
  clientOrPool: pg.Pool | pg.ClientBase,
  input: {
    userId: string;
    name: string;
    scopes: TokenScope[];
    projectId?: string | null | undefined;
    expiresInDays?: number | null | undefined;
  },
): Promise<{ token: string; tokenDetails: TokenSummary }> {
  const parsed = createTokenInputSchema.parse({
    name: input.name, scopes: input.scopes, projectId: input.projectId ?? undefined,
    expiresInDays: input.expiresInDays ?? undefined,
  });
  const ownsTransaction = typeof (clientOrPool as pg.Pool).connect === 'function'
    && typeof (clientOrPool as pg.Pool).totalCount === 'number';
  const client = ownsTransaction ? await (clientOrPool as pg.Pool).connect() : clientOrPool;
  // Passing a ClientBase requires an explicit caller-owned transaction, as with the other write adapters.
  try {
    if (ownsTransaction) await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`pat-issuance:${input.userId}`]);
    if (parsed.projectId) {
      // Canonical ownership inheritance and active membership locks, including real Owners with no membership row.
      await lockProjectBoardReadScope(client as pg.ClientBase, parsed.projectId, input.userId);
    }
    const count = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM personal_access_tokens
       WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp())`,
      [input.userId],
    );
    if (Number(count.rows[0]?.count ?? 0) >= MAX_ACTIVE_PERSONAL_ACCESS_TOKENS) {
      throw HttpError.conflict('Revoke an active token before creating another.', 'TOKEN_LIMIT_REACHED');
    }
    const { rawToken, prefix, tokenHash } = generatePersonalAccessToken();
    const id = `pat_${crypto.randomUUID()}`;

    const expiresAt = new Date(Date.now() + parsed.expiresInDays * 24 * 60 * 60 * 1000);

    const res = await client.query<{
      id: string;
      name: string;
      token_prefix: string;
      scopes: string[];
      project_id: string | null;
      expires_at: Date | null;
      last_used_at: Date | null;
      created_at: Date;
    }>(
      `INSERT INTO personal_access_tokens (
        id, user_id, name, token_hash, token_prefix, scopes, project_id, expires_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      RETURNING id, name, token_prefix, scopes, project_id, expires_at, last_used_at, created_at`,
      [
        id,
        input.userId,
        parsed.name,
        tokenHash,
        prefix,
        parsed.scopes,
        parsed.projectId ?? null,
        expiresAt,
      ],
    );

    const row = res.rows[0]!;
    if (ownsTransaction) await client.query('COMMIT');
    return {
      token: rawToken,
      tokenDetails: {
        id: row.id,
        name: row.name,
        tokenPrefix: row.token_prefix,
        scopes: row.scopes as TokenScope[],
        projectId: row.project_id,
        expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
        lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
        createdAt: row.created_at.toISOString(),
      },
    };
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    if (ownsTransaction) (client as pg.PoolClient).release();
  }
}

/** Hold through commit/rollback, before authorization locks and receipt replay. Revocation UPDATE waits on this lock. */
export async function lockPersonalAccessToken(
  client: pg.ClientBase,
  input: { tokenId: string; userId: string; projectId: string; requiredScope: TokenScope },
): Promise<void> {
  const result = await client.query<{ project_id: string | null; scopes: TokenScope[]; valid: boolean }>(
    `SELECT project_id, scopes,
       (revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp())) AS valid
     FROM personal_access_tokens WHERE id = $1 AND user_id = $2 FOR SHARE`,
    [input.tokenId, input.userId],
  );
  const row = result.rows[0];
  if (!row?.valid) throw HttpError.unauthorized('Invalid, expired or revoked API token.');
  if (!row.scopes.includes(input.requiredScope)) throw HttpError.forbidden('Token scope does not permit this operation.', 'TOKEN_SCOPE_REQUIRED');
  if (row.project_id && row.project_id !== input.projectId) throw HttpError.forbidden('Token is restricted to a different project.', 'TOKEN_PROJECT_FORBIDDEN');
}

export async function verifyPersonalAccessToken(
  clientOrPool: pg.Pool | pg.ClientBase,
  rawToken: string,
): Promise<{
  token: PersonalAccessTokenRecord;
  user: SessionActor;
} | null> {
  const tokenHash = hashPersonalAccessToken(rawToken);

  const res = await clientOrPool.query<{
    id: string;
    user_id: string;
    name: string;
    token_hash: string;
    token_prefix: string;
    scopes: string[];
    project_id: string | null;
    expires_at: Date | null;
    revoked_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
    updated_at: Date;
    email: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `SELECT 
      pat.id, pat.user_id, pat.name, pat.token_hash, pat.token_prefix,
      pat.scopes, pat.project_id, pat.expires_at, pat.revoked_at, pat.last_used_at,
      pat.created_at, pat.updated_at,
      u.email, u.display_name, u.avatar_url
    FROM personal_access_tokens pat
    JOIN users u ON u.id = pat.user_id
    WHERE pat.token_hash = $1`,
    [tokenHash],
  );

  const row = res.rows[0];
  if (!row) {
    return null;
  }

  // Check revocation
  if (row.revoked_at !== null) {
    return null;
  }

  // Check expiry
  if (row.expires_at !== null && row.expires_at.getTime() <= Date.now()) {
    return null;
  }

  return {
    token: {
      id: row.id,
      userId: row.user_id,
      name: row.name,
      tokenHash: row.token_hash,
      tokenPrefix: row.token_prefix,
      scopes: row.scopes as TokenScope[],
      projectId: row.project_id,
      expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
      revokedAt: null,
      lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    },
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
    },
  };
}

export async function listPersonalAccessTokens(
  clientOrPool: pg.Pool | pg.ClientBase,
  userId: string,
): Promise<TokenSummary[]> {
  const res = await clientOrPool.query<{
    id: string;
    name: string;
    token_prefix: string;
    scopes: string[];
    project_id: string | null;
    expires_at: Date | null;
    last_used_at: Date | null;
    created_at: Date;
  }>(
    `SELECT id, name, token_prefix, scopes, project_id, expires_at, last_used_at, created_at
     FROM personal_access_tokens
     WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > clock_timestamp())
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    tokenPrefix: row.token_prefix,
    scopes: row.scopes as TokenScope[],
    projectId: row.project_id,
    expiresAt: row.expires_at ? row.expires_at.toISOString() : null,
    lastUsedAt: row.last_used_at ? row.last_used_at.toISOString() : null,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function revokePersonalAccessToken(
  clientOrPool: pg.Pool | pg.ClientBase,
  tokenId: string,
  userId: string,
): Promise<boolean> {
  const res = await clientOrPool.query(
    `UPDATE personal_access_tokens
     SET revoked_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
    [tokenId, userId],
  );

  return (res.rowCount ?? 0) > 0;
}
