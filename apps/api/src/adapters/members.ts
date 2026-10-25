import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import type {
  ProjectRole,
  ProjectMemberStatus,
  ProjectMember,
  SessionActor,
} from '@flowboard/contracts';

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
  let poolClient: pg.PoolClient | undefined;
  let client: pg.ClientBase;

  if (isPool(clientOrPool)) {
    poolClient = await clientOrPool.connect();
    client = poolClient;
  } else {
    client = clientOrPool;
  }

  try {
    if (poolClient) {
      await client.query('BEGIN');
    }

    // 1. Resolve actor's role in the project and workspace owner
    const prjRes = await client.query<{ id: string; workspace_id: string; owner_id: string }>(
      `SELECT p.id, p.workspace_id, w.owner_id
       FROM projects p
       JOIN workspaces w ON p.workspace_id = w.id
       WHERE p.id = $1`,
      [projectId],
    );

    if (prjRes.rows.length === 0) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }

    const projectRow = prjRes.rows[0]!;
    const isWorkspaceOwner = projectRow.owner_id === actor.id;

    if (!isWorkspaceOwner) {
      const actorMemberRes = await client.query<{ role: ProjectRole; status: ProjectMemberStatus }>(
        `SELECT role, status
         FROM project_memberships
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, actor.id],
      );

      if (actorMemberRes.rows.length === 0 || actorMemberRes.rows[0]?.status !== 'active') {
        throw HttpError.notFound('Project not found.', 'NOT_FOUND');
      }

      const actorRole = actorMemberRes.rows[0]?.role;
      if (actorRole !== 'manager') {
        throw HttpError.forbidden('Insufficient permissions to manage project members.', 'FORBIDDEN');
      }
    }

    // 2. Query target member
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
       WHERE project_id = $1 AND user_id = $2`,
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
      if (targetUserId === projectRow.owner_id) {
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
    }

    // 4. Optimistic concurrency update
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
      `UPDATE project_memberships
       SET role = $1, status = $2, version = version + 1, updated_at = NOW()
       WHERE project_id = $3 AND user_id = $4 AND version = $5
       RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`,
      [newRole, newStatus, projectId, targetUserId, expectedVersion],
    );

    if (updateRes.rows.length === 0) {
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

export async function removeProjectMember(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  projectId: string,
  targetUserId: string,
): Promise<{ success: boolean; membership: ProjectMember }> {
  let poolClient: pg.PoolClient | undefined;
  let client: pg.ClientBase;

  if (isPool(clientOrPool)) {
    poolClient = await clientOrPool.connect();
    client = poolClient;
  } else {
    client = clientOrPool;
  }

  try {
    if (poolClient) {
      await client.query('BEGIN');
    }

    // 1. Resolve actor's role in the project and workspace owner
    const prjRes = await client.query<{ id: string; workspace_id: string; owner_id: string }>(
      `SELECT p.id, p.workspace_id, w.owner_id
       FROM projects p
       JOIN workspaces w ON p.workspace_id = w.id
       WHERE p.id = $1`,
      [projectId],
    );

    if (prjRes.rows.length === 0) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }

    const projectRow = prjRes.rows[0]!;
    const isWorkspaceOwner = projectRow.owner_id === actor.id;

    if (!isWorkspaceOwner) {
      const actorMemberRes = await client.query<{ role: ProjectRole; status: ProjectMemberStatus }>(
        `SELECT role, status
         FROM project_memberships
         WHERE project_id = $1 AND user_id = $2`,
        [projectId, actor.id],
      );

      if (actorMemberRes.rows.length === 0 || actorMemberRes.rows[0]?.status !== 'active') {
        throw HttpError.notFound('Project not found.', 'NOT_FOUND');
      }

      const actorRole = actorMemberRes.rows[0]?.role;
      if (actorRole !== 'manager') {
        throw HttpError.forbidden('Insufficient permissions to manage project members.', 'FORBIDDEN');
      }
    }

    // 2. Query target member
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
       WHERE project_id = $1 AND user_id = $2`,
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
      if (targetUserId === projectRow.owner_id) {
        throw HttpError.forbidden('Project managers cannot modify workspace owner.', 'FORBIDDEN');
      }

      // Cannot modify another manager
      if (targetMember.role === 'manager') {
        throw HttpError.forbidden('Project managers cannot modify other managers.', 'FORBIDDEN');
      }
    }

    // 4. Update row to status = 'removed'
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
      `UPDATE project_memberships
       SET status = 'removed', version = version + 1, updated_at = NOW()
       WHERE project_id = $1 AND user_id = $2
       RETURNING id, project_id, workspace_id, user_id, role, status, version, created_at, updated_at`,
      [projectId, targetUserId],
    );

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
