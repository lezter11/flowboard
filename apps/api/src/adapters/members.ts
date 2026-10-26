import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import type {
  ProjectRole,
  ProjectMemberStatus,
  ProjectMember,
  SessionActor,
} from '@flowboard/contracts';
import { getPool } from './postgres.ts';
import { acquireWriteGrantLock } from './rbac.ts';

function isPool(target: pg.Pool | pg.ClientBase): target is pg.Pool {
  return typeof (target as pg.Pool).connect === 'function' && typeof (target as pg.Pool).totalCount === 'number';
}

export async function updateProjectMember(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  projectId: string,
  targetUserId: string,
  newRole: ProjectRole,
  newStatus: ProjectMemberStatus,
  expectedVersion: number,
): Promise<ProjectMember> {
  const pool = clientOrPool ?? getPool();
  let poolClient: pg.PoolClient | undefined;
  let client: pg.ClientBase;

  if (isPool(pool)) {
    poolClient = await pool.connect();
    client = poolClient;
  } else {
    client = pool;
  }

  try {
    if (poolClient) {
      await client.query('BEGIN');
    }

    // 1. Acquire write grant lock on actor (checks workspace ownership or holds FOR SHARE on actor's membership)
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
    const isWorkspaceOwner = grant.isOwner;

    // 2. Query target member with FOR UPDATE row lock
    const targetRes = await client.query<{
      id: string;
      project_id: string;
      workspace_id: string;
      user_id: string;
      role: ProjectRole;
      status: ProjectMemberStatus;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2
       FOR UPDATE`,
      [projectId, targetUserId],
    );

    if (targetRes.rows.length === 0) {
      throw HttpError.notFound('Member not found.', 'NOT_FOUND');
    }

    const targetMember = targetRes.rows[0]!;

    // 3. Authority bounds
    if (!isWorkspaceOwner) {
      // Cannot modify self
      if (targetUserId === actor.id) {
        throw HttpError.forbidden('Cannot modify own membership.', 'FORBIDDEN');
      }

      // Cannot modify workspace owner
      if (targetUserId === grant.ownerId) {
        throw HttpError.forbidden('Project managers cannot modify workspace owner.', 'FORBIDDEN');
      }

      // Cannot modify another manager
      if (targetMember.role === 'manager') {
        throw HttpError.forbidden('Project managers cannot modify other managers.', 'FORBIDDEN');
      }

      // Cannot promote to manager
      if (newRole === 'manager') {
        throw HttpError.forbidden('Only workspace owners can appoint managers.', 'FORBIDDEN');
      }

      // Project managers can only assign member or viewer
      if (newRole !== 'member' && newRole !== 'viewer') {
        throw HttpError.forbidden('Project managers can only assign member or viewer roles.', 'FORBIDDEN');
      }
    }

    // 4. Optimistic concurrency version check
    if (targetMember.version !== expectedVersion) {
      throw HttpError.conflict('Member was concurrently updated. Refresh and try again.', 'STALE_VERSION');
    }

    // 5. Update target member with OCC and role predicate for non-owners
    const updateQuery = isWorkspaceOwner
      ? `UPDATE project_memberships
         SET role = $1, status = $2, version = version + 1, updated_at = NOW()
         WHERE project_id = $3 AND user_id = $4 AND version = $5
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`
      : `UPDATE project_memberships
         SET role = $1, status = $2, version = version + 1, updated_at = NOW()
         WHERE project_id = $3 AND user_id = $4 AND version = $5 AND role IN ('member', 'viewer')
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`;

    const updateRes = await client.query<{
      id: string;
      project_id: string;
      workspace_id: string;
      user_id: string;
      role: ProjectRole;
      status: ProjectMemberStatus;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      updateQuery,
      [newRole, newStatus, projectId, targetUserId, expectedVersion],
    );

    if (updateRes.rows.length === 0) {
      if (!isWorkspaceOwner && targetMember.role === 'manager') {
        throw HttpError.forbidden('Project managers cannot modify other managers.', 'FORBIDDEN');
      }
      throw HttpError.conflict('Member was concurrently updated. Refresh and try again.', 'STALE_VERSION');
    }

    if (poolClient) {
      await client.query('COMMIT');
    }

    const updated = updateRes.rows[0]!;
    return {
      id: updated.id,
      projectId: updated.project_id,
      userId: updated.user_id,
      role: updated.role,
      status: updated.status,
      version: updated.version,
      createdAt: new Date(updated.created_at).toISOString(),
      updatedAt: new Date(updated.updated_at).toISOString(),
    };
  } catch (err) {
    if (poolClient) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
}

export const updateMemberRole = updateProjectMember;

export async function removeProjectMember(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  projectId: string,
  targetUserId: string,
): Promise<{ success: boolean; membership: ProjectMember }> {
  const pool = clientOrPool ?? getPool();
  let poolClient: pg.PoolClient | undefined;
  let client: pg.ClientBase;

  if (isPool(pool)) {
    poolClient = await pool.connect();
    client = poolClient;
  } else {
    client = pool;
  }

  try {
    if (poolClient) {
      await client.query('BEGIN');
    }

    // 1. Acquire write grant lock on actor (checks workspace ownership or holds FOR SHARE on actor's membership)
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');
    const isWorkspaceOwner = grant.isOwner;

    // 2. Query target member with FOR UPDATE row lock
    const targetRes = await client.query<{
      id: string;
      project_id: string;
      workspace_id: string;
      user_id: string;
      role: ProjectRole;
      status: ProjectMemberStatus;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at
       FROM project_memberships
       WHERE project_id = $1 AND user_id = $2
       FOR UPDATE`,
      [projectId, targetUserId],
    );

    if (targetRes.rows.length === 0) {
      throw HttpError.notFound('Member not found.', 'NOT_FOUND');
    }

    const targetMember = targetRes.rows[0]!;

    // 3. Authority bounds
    if (!isWorkspaceOwner) {
      // Cannot modify self
      if (targetUserId === actor.id) {
        throw HttpError.forbidden('Cannot modify own membership.', 'FORBIDDEN');
      }

      // Cannot modify workspace owner
      if (targetUserId === grant.ownerId) {
        throw HttpError.forbidden('Project managers cannot modify workspace owner.', 'FORBIDDEN');
      }

      // Cannot modify another manager
      if (targetMember.role === 'manager') {
        throw HttpError.forbidden('Project managers cannot modify other managers.', 'FORBIDDEN');
      }
    }

    // 4. Update row to status = 'removed'
    // If actor is not workspace owner, include predicate AND role IN ('member', 'viewer')
    const updateQuery = isWorkspaceOwner
      ? `UPDATE project_memberships
         SET status = 'removed', version = version + 1, updated_at = NOW()
         WHERE project_id = $1 AND user_id = $2
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`
      : `UPDATE project_memberships
         SET status = 'removed', version = version + 1, updated_at = NOW()
         WHERE project_id = $1 AND user_id = $2 AND role IN ('member', 'viewer')
         RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`;

    const updateRes = await client.query<{
      id: string;
      project_id: string;
      workspace_id: string;
      user_id: string;
      role: ProjectRole;
      status: ProjectMemberStatus;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      updateQuery,
      [projectId, targetUserId],
    );

    if (updateRes.rows.length === 0) {
      if (!isWorkspaceOwner) {
        throw HttpError.forbidden('Project managers cannot modify other managers.', 'FORBIDDEN');
      }
      throw HttpError.notFound('Member not found.', 'NOT_FOUND');
    }

    // Look up target user's email and atomically revoke pending invitations for that email in this project
    const userRes = await client.query<{ email: string }>(
      'SELECT email FROM users WHERE id = $1',
      [targetUserId],
    );
    const targetEmail = userRes.rows[0]?.email;
    if (targetEmail) {
      await client.query(
        `UPDATE project_invitations
         SET status = 'revoked', updated_at = NOW()
         WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'`,
        [projectId, targetEmail],
      );
    }

    if (poolClient) {
      await client.query('COMMIT');
    }

    const updated = updateRes.rows[0]!;
    return {
      success: true,
      membership: {
        id: updated.id,
        projectId: updated.project_id,
        userId: updated.user_id,
        role: updated.role,
        status: updated.status,
        version: updated.version,
        createdAt: new Date(updated.created_at).toISOString(),
        updatedAt: new Date(updated.updated_at).toISOString(),
      },
    };
  } catch (err) {
    if (poolClient) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    if (poolClient) {
      poolClient.release();
    }
  }
}
