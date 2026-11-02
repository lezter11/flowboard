import crypto from 'node:crypto';
import type pg from 'pg';
import { getPool } from './postgres.ts';
import type { SessionActor, TokenScope, TokenSummary } from '@flowboard/contracts';

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
  const { rawToken, prefix, tokenHash } = generatePersonalAccessToken();
  const id = `pat_${crypto.randomUUID()}`;

  const expiresAt = input.expiresInDays
    ? new Date(Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

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
    `INSERT INTO personal_access_tokens (
      id, user_id, name, token_hash, token_prefix, scopes, project_id, expires_at, created_at, updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    RETURNING id, name, token_prefix, scopes, project_id, expires_at, last_used_at, created_at`,
    [
      id,
      input.userId,
      input.name,
      tokenHash,
      prefix,
      input.scopes,
      input.projectId ?? null,
      expiresAt,
    ],
  );

  const row = res.rows[0]!;
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

  // Update last_used_at asynchronously
  clientOrPool
    .query('UPDATE personal_access_tokens SET last_used_at = NOW() WHERE id = $1', [row.id])
    .catch(() => {});

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
     WHERE user_id = $1 AND revoked_at IS NULL
     ORDER BY created_at DESC`,
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
