import crypto from 'node:crypto';
import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import { ensurePersonalWorkspace } from './personal-workspace.ts';
import { lockUserQuota } from './quotas.ts';
import { createSession, type SessionRecord } from './session.ts';

export const GOOGLE_ISSUER = 'https://accounts.google.com';

export interface VerifiedGoogleProfile {
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  firstName: string | null;
  lastName: string | null;
}

function recoveryRequired(): HttpError {
  return HttpError.forbidden('Google sign-in requires account recovery.', 'GOOGLE_RECOVERY_REQUIRED');
}

/**
 * Runs in the caller's transaction. Subject serialization closes the first-login race,
 * while the address lock prevents two distinct subjects from claiming the same email.
 * All user quota locks precede row locks, as in project creation.
 */
export async function signInWithGoogle(
  client: pg.ClientBase,
  profile: VerifiedGoogleProfile,
  linkingSessionHash: string | null,
): Promise<SessionRecord> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('fb:google:subject'), hashtext($1))`, [profile.subject]);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext('fb:google:email'), hashtext($1))`, [profile.email]);

  const bound = (await client.query<{ id: string }>(
    'SELECT id FROM users WHERE google_issuer = $1 AND google_subject = $2',
    [GOOGLE_ISSUER, profile.subject],
  )).rows[0];

  let userId: string;
  let emailConflict = false;
  if (linkingSessionHash) {
    // Only a live copy of the same Flowboard browser session can authorize linking.
    const candidate = (await client.query<{ user_id: string }>(
      'SELECT user_id FROM sessions WHERE id = $1 AND expires_at > clock_timestamp()',
      [linkingSessionHash],
    )).rows[0];
    if (!candidate || (bound && bound.id !== candidate.user_id)) throw recoveryRequired();

    userId = candidate.user_id;
    await lockUserQuota(client, userId);
    const session = (await client.query(
      'SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2 AND expires_at > clock_timestamp() FOR SHARE',
      [linkingSessionHash, userId],
    )).rows[0];
    if (!session) throw recoveryRequired();

    const account = (await client.query<{ id: string }>(
      `UPDATE users SET google_issuer = $1, google_subject = $2
       WHERE id = $3 AND LOWER(BTRIM(email)) = $4
         AND (google_subject IS NULL OR (google_issuer = $1 AND google_subject = $2))
         AND NOT EXISTS (SELECT 1 FROM users other WHERE LOWER(BTRIM(other.email)) = $4 AND other.id <> $3)
       RETURNING id`,
      [GOOGLE_ISSUER, profile.subject, userId, profile.email],
    )).rows[0];
    if (!account) throw recoveryRequired();
  } else if (bound) {
    userId = bound.id;
    await lockUserQuota(client, userId);
    const conflict = await client.query(
      'SELECT 1 FROM users WHERE LOWER(BTRIM(email)) = $1 AND id <> $2 LIMIT 1',
      [profile.email, userId],
    );
    emailConflict = conflict.rows.length > 0;
  } else {
    userId = `usr_${crypto.randomUUID()}`;
    await lockUserQuota(client, userId);
    const inserted = await client.query(
      `INSERT INTO users (
         id, email, display_name, avatar_url, first_name, last_name, google_issuer, google_subject, created_at, updated_at
       )
       SELECT $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
       WHERE NOT EXISTS (SELECT 1 FROM users WHERE LOWER(BTRIM(email)) = $2)
       ON CONFLICT DO NOTHING RETURNING id`,
      [userId, profile.email, profile.displayName, profile.avatarUrl, profile.firstName, profile.lastName,
        GOOGLE_ISSUER, profile.subject],
    );
    if (!inserted.rows[0]) throw recoveryRequired();
  }

  if (bound || linkingSessionHash) {
    await client.query(
      `UPDATE users SET
         email = CASE WHEN $7 THEN email ELSE $2 END,
         google_email_conflict = $7,
         display_name = COALESCE(NULLIF(TRIM(display_name), ''), $3),
         avatar_url = COALESCE(NULLIF($4, ''), avatar_url),
         first_name = CASE WHEN name_confirmed_at IS NULL THEN $5 ELSE first_name END,
         last_name = CASE WHEN name_confirmed_at IS NULL THEN $6 ELSE last_name END,
         updated_at = NOW()
       WHERE id = $1`,
      [userId, profile.email, profile.displayName, profile.avatarUrl, profile.firstName, profile.lastName, emailConflict],
    );
  }

  await ensurePersonalWorkspace(client, userId);
  return createSession(userId, 24 * 7, client);
}
