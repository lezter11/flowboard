import crypto from 'node:crypto';
import { getPool } from '../../src/adapters/postgres.ts';
import { getSessionWithUser } from '../../src/adapters/session.ts';

/**
 * B-20 test fixture. POST /api/v1/workspaces is retired: a person's personal workspace is made by
 * sign-in and by the first project create. Suites that need a workspace row insert it here instead.
 * The row matches what the retired route wrote (name, timezone, owner, version 1).
 */
export interface FixtureWorkspace {
  id: string;
  name: string;
  timezone: string;
  ownerId: string;
}

export async function insertWorkspaceForUser(
  ownerId: string,
  options: { name?: string; timezone?: string } = {},
): Promise<FixtureWorkspace> {
  const id = `ws_${crypto.randomUUID()}`;
  const name = options.name ?? 'Fixture Workspace';
  const timezone = options.timezone ?? 'UTC';
  await getPool().query(
    `INSERT INTO workspaces (id, name, timezone, owner_id, version, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 1, NOW(), NOW())`,
    [id, name, timezone, ownerId],
  );
  return { id, name, timezone, ownerId };
}

/** Same as insertWorkspaceForUser, starting from a `flowboard_session=...` cookie value. */
export async function insertWorkspaceForCookie(
  cookie: string,
  options: { name?: string; timezone?: string } = {},
): Promise<FixtureWorkspace> {
  const sessionId = /flowboard_session=([^;]+)/.exec(cookie)?.[1];
  if (!sessionId) throw new Error('fixture: no session cookie');
  const session = await getSessionWithUser(sessionId);
  if (!session) throw new Error('fixture: session not found');
  return insertWorkspaceForUser(session.user.id, options);
}
