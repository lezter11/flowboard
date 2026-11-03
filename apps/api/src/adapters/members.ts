import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import type {
  ProjectRole,
  ProjectMemberStatus,
  ProjectMember,
  SessionActor,
} from '@flowboard/contracts';
import { getPool } from './postgres.ts';
import { acquireWriteGrantLock, acquireWritableProjectContextLock } from './rbac.ts';
import { lockProjectQuota, countActiveMembers, countPendingInvitations, quotaExceeded } from './quotas.ts';
import { DEFAULT_LIMITS, type Limits } from '../services/limits.ts';
import { recordActivity } from './activity.ts';

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
  limits: Limits = { ...DEFAULT_LIMITS },
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

    // Quota locks precede all authorization, membership and receipt row locks.
    await lockProjectQuota(client, projectId);

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

    // An archived project still permits removing access, without changing the role.
    if (newStatus !== 'removed' || newRole !== targetMember.role) {
      await acquireWritableProjectContextLock(client, projectId);
    }

    // 4. Optimistic concurrency version check
    if (targetMember.version !== expectedVersion) {
      throw HttpError.conflict('Member was concurrently updated. Refresh and try again.', 'STALE_VERSION');
    }

    if (targetMember.status !== 'active' && newStatus === 'active' && targetUserId !== grant.ownerId) {
      const active = await countActiveMembers(client, projectId);
      const pending = await countPendingInvitations(client, projectId);
      if (active + pending >= limits.membersPerProject) {
        throw quotaExceeded('members', limits.membersPerProject, pending > 0 ? 'revoke_invitation' : 'remove_member', active);
      }
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

    if (newStatus === 'removed') {
      await revokeMemberInvitations(client, projectId, targetUserId, targetMember.workspace_id, actor.id);
    }

    // Project-scope events: only owner and managers read them in the Activity page. Recorded only
    // when the role or status actually changed, in the same transaction as the update.
    const updated = updateRes.rows[0]!;
    if (updated.role !== targetMember.role) {
      await recordActivity(client, {
        workspaceId: targetMember.workspace_id,
        projectId,
        visibilityScope: 'project',
        actorId: actor.id,
        action: 'member_role_changed',
        safeChanges: { userId: targetUserId, fromRole: targetMember.role, toRole: updated.role },
      });
    }
    if (updated.status !== targetMember.status) {
      await recordActivity(client, {
        workspaceId: targetMember.workspace_id,
        projectId,
        visibilityScope: 'project',
        actorId: actor.id,
        action: updated.status === 'removed' ? 'member_removed' : 'member_reinstated',
        safeChanges: { userId: targetUserId, role: updated.role },
      });
    }

    if (poolClient) {
      await client.query('COMMIT');
    }

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

    // Quota locks precede all authorization, membership and receipt row locks.
    await lockProjectQuota(client, projectId);

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

    await revokeMemberInvitations(client, projectId, targetUserId, targetMember.workspace_id, actor.id);

    const updated = updateRes.rows[0]!;
    await recordActivity(client, {
      workspaceId: targetMember.workspace_id,
      projectId,
      visibilityScope: 'project',
      actorId: actor.id,
      action: 'member_removed',
      safeChanges: { userId: targetUserId, role: targetMember.role },
    });
    if (poolClient) {
      await client.query('COMMIT');
    }

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

/** Removal through either endpoint invalidates old invitations in the same transaction. */
async function revokeMemberInvitations(
  client: pg.ClientBase, projectId: string, targetUserId: string, workspaceId: string, actorId: string,
): Promise<void> {
  const user = await client.query<{ email: string }>('SELECT email FROM users WHERE id = $1', [targetUserId]);
  const email = user.rows[0]?.email;
  if (!email) return;
  const revoked = await client.query<{ id: string; role: ProjectRole }>(
    `UPDATE project_invitations SET status = 'revoked', updated_at = NOW()
     WHERE project_id = $1 AND LOWER(email) = LOWER($2) AND status = 'pending'
     RETURNING id, role`, [projectId, email],
  );
  for (const invitation of revoked.rows) {
    await recordActivity(client, {
      workspaceId, projectId, visibilityScope: 'project', actorId, action: 'invitation_revoked',
      safeChanges: { invitationId: invitation.id, role: invitation.role, reason: 'member_removed' },
    });
  }
}
