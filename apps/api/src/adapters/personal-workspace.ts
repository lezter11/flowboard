import crypto from 'node:crypto';
import type pg from 'pg';
import { lockUserQuota } from './quotas.ts';

/**
 * The fixed internal name of a personal workspace (edge-case review F-05). It never carries the
 * person's name, so a long name cannot push the session response past its limit. Not shown in the UI.
 */
export const PERSONAL_WORKSPACE_NAME = 'Personal workspace';

/**
 * Returns the id of the user's primary workspace, creating a personal one if they own none (B-17).
 * Serialized by the same user quota lock every create uses, so two concurrent callers (Google sign-in
 * and a first project create) make one workspace. The primary is deterministic: the oldest owned
 * workspace by created_at, then id. Never by name.
 */
export async function ensurePersonalWorkspace(client: pg.ClientBase, userId: string): Promise<string> {
  await lockUserQuota(client, userId);
  const found = await client.query<{ id: string }>(
    'SELECT id FROM workspaces WHERE owner_id = $1 ORDER BY created_at ASC, id ASC LIMIT 1',
    [userId],
  );
  const existing = found.rows[0];
  if (existing) return existing.id;

  const id = `ws_${crypto.randomUUID()}`;
  await client.query(
    `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
     VALUES ($1, $2, 'UTC', $3, 1, NOW(), NOW())`,
    [id, PERSONAL_WORKSPACE_NAME, userId],
  );
  return id;
}
