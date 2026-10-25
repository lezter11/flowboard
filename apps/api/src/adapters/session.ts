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

export async function createSession(
  userId: string,
  ttlHours = 24 * 7,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionRecord> {
  const pool = clientOrPool ?? getPool();
  // 32 cryptographically secure random bytes as hex string (64 characters)
  const sessionId = crypto.randomBytes(32).toString('hex');
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
    [sessionId, userId, expiresAt.toISOString(), now.toISOString()],
  );

  const row = res.rows[0];
  if (!row) {
    throw new Error('Failed to create session');
  }

  return {
    id: row.id,
    userId: row.user_id,
    expiresAt: new Date(row.expires_at).toISOString(),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function getSessionWithUser(
  sessionId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionWithUser | null> {
  const pool = clientOrPool ?? getPool();
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
    [sessionId],
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

export async function revokeSession(
  sessionId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<void> {
  const pool = clientOrPool ?? getPool();
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
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
       display_name = EXCLUDED.display_name,
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
