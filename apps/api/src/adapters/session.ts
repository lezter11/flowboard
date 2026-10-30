import crypto from 'node:crypto';
import type pg from 'pg';
import { getPool } from './postgres.ts';
import type { SessionActor } from '@flowboard/contracts';

export interface SessionRecord {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
}

export interface SessionWithUser {
  session: SessionRecord;
  user: SessionActor;
}

export interface SessionCookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: 'Lax';
  secure: boolean;
  maxAge: number;
}

export interface ClearSessionCookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: 'Lax';
  secure: boolean;
  maxAge: number;
}

export function isLocalhost(hostOrHostname?: string): boolean {
  if (!hostOrHostname) {
    return process.env.NODE_ENV !== 'production';
  }
  let host = hostOrHostname;
  if (host.includes('://')) {
    try {
      host = new URL(host).hostname;
    } catch {
      // ignore
    }
  }
  if (host.startsWith('[')) {
    const endBracket = host.indexOf(']');
    if (endBracket !== -1) {
      host = host.substring(1, endBracket);
      return host === '::1';
    }
  }
  const [hostnamePart = ''] = host.split(':');
  const hostname = hostnamePart.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

export function getSessionCookieOptions(hostOrHostname?: string): SessionCookieOptions {
  const local = isLocalhost(hostOrHostname);
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: !local,
    maxAge: 7 * 24 * 3600,
  };
}

export function getClearSessionCookieOptions(hostOrHostname?: string): ClearSessionCookieOptions {
  const local = isLocalhost(hostOrHostname);
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    secure: !local,
    maxAge: 0,
  };
}

export async function getUserByEmail(
  email: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionActor | null> {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `SELECT id, email, display_name, avatar_url
     FROM users
     WHERE email = $1`,
    [email],
  );

  const row = res.rows[0];
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
  };
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  ttlHours = 24 * 7,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionRecord> {
  const pool = clientOrPool ?? getPool();
  // 32 cryptographically secure random bytes as hex string (64 characters)
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashSessionToken(rawToken);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlHours * 60 * 60 * 1000);

  const res = await pool.query<{
    id: string;
    user_id: string;
    expires_at: Date;
    created_at: Date;
  }>(
    `INSERT INTO sessions (id, user_id, expires_at, created_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, user_id, expires_at, created_at`,
    [tokenHash, userId, expiresAt.toISOString(), now.toISOString()],
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to create session');
  }

  return {
    id: rawToken,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getSessionWithUser(
  sessionIdOrToken: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionWithUser | null> {
  const pool = clientOrPool ?? getPool();
  const tokenHash = hashSessionToken(sessionIdOrToken);
  const res = await pool.query<{
    session_id: string;
    user_id: string;
    expires_at: Date;
    session_created_at: Date;
    email: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `SELECT 
       s.id AS session_id,
       s.user_id,
       s.expires_at,
       s.created_at AS session_created_at,
       u.email,
       u.display_name,
       u.avatar_url
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.id = $1 AND s.expires_at > NOW()`,
    [tokenHash],
  );

  const row = res.rows[0];
  if (!row) {
    return null;
  }

  return {
    session: {
      id: row.session_id,
      userId: row.user_id,
      expiresAt: new Date(row.expires_at).toISOString(),
      createdAt: new Date(row.session_created_at).toISOString(),
    },
    user: {
      id: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
    },
  };
}

/** Revokes by the stored session id (the token hash). Callers pass c.get('sessionId'), never the raw cookie. */
export async function revokeSession(
  storedSessionId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<void> {
  const pool = clientOrPool ?? getPool();
  await pool.query('DELETE FROM sessions WHERE id = $1', [storedSessionId]);
}

export async function createDevUserAndSession(
  email: string,
  displayName: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionWithUser> {
  const pool = clientOrPool ?? getPool();
  const now = new Date().toISOString();
  const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;

  const userRes = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `INSERT INTO users (id, email, display_name, avatar_url, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (email) DO UPDATE SET
       display_name = COALESCE(NULLIF(TRIM(users.display_name), ''), EXCLUDED.display_name),
       updated_at = EXCLUDED.updated_at
     RETURNING id, email, display_name, avatar_url`,
    [userId, email, displayName, null, now, now],
  );

  const userRow = userRes.rows[0];
  if (!userRow) {
    throw new Error('Failed to create or update user');
  }

  const session = await createSession(userRow.id, 24 * 7, pool);

  return {
    session,
    user: {
      id: userRow.id,
      email: userRow.email,
      displayName: userRow.display_name,
      avatarUrl: userRow.avatar_url ?? null,
    },
  };
}

export async function updateUserProfile(
  userId: string,
  input: { displayName: string },
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionActor> {
  const pool = clientOrPool ?? getPool();
  // Only the display name is user-editable. Google sign-in keeps a non-empty name (see the
  // ON CONFLICT rule in routes/google-auth.ts) and owns the email and avatar.
  const fields = ['display_name = $1', 'updated_at = NOW()'];
  const values: unknown[] = [input.displayName.trim()];
  const idx = 2;
  values.push(userId);

  const res = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    avatar_url: string | null;
  }>(
    `UPDATE users
     SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, email, display_name, avatar_url`,
    values,
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('User not found');
  }

  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url ?? null,
  };
}
