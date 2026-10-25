import type pg from 'pg';
import { getPool } from './postgres.ts';
import type {
  Role,
  ProjectRole,
  SessionWorkspaceSummary,
  SessionProjectSummary,
} from '@flowboard/contracts';

export async function resolveWorkspaceRole(
  workspaceId: string,
  userId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<'owner' | null> {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query<{ owner_id: string }>(
    'SELECT owner_id FROM workspaces WHERE id = $1',
    [workspaceId],
  );

  if (res.rows.length === 0) {
    return null;
  }

  return res.rows[0]?.owner_id === userId ? 'owner' : null;
}

export async function resolveProjectRole(
  projectId: string,
  userId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<Role | null> {
  const pool = clientOrPool ?? getPool();

  // 1. Check workspace owner inheritance (Owner has owner rights in all owned projects)
  const prjRes = await pool.query<{ id: string; owner_id: string }>(
    `SELECT p.id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1`,
    [projectId],
  );

  if (prjRes.rows.length === 0) {
    return null;
  }

  if (prjRes.rows[0]?.owner_id === userId) {
    return 'owner';
  }

  // 2. Check explicit active project membership
  const memberRes = await pool.query<{ role: ProjectRole }>(
    `SELECT role
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2 AND status = 'active'`,
    [projectId, userId],
  );

  if (memberRes.rows.length === 0) {
    return null;
  }

  const role = memberRes.rows[0]?.role;
  return role ?? null;
}

export async function getOwnedWorkspaces(
  userId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionWorkspaceSummary[]> {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query<{
    id: string;
    name: string;
    timezone: string;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, timezone, version, created_at, updated_at
     FROM workspaces
     WHERE owner_id = $1
     ORDER BY name ASC`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    name: row.name,
    timezone: row.timezone,
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}

export async function getAccessibleProjects(
  userId: string,
  clientOrPool?: pg.Pool | pg.ClientBase,
): Promise<SessionProjectSummary[]> {
  const pool = clientOrPool ?? getPool();
  const res = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    archived: boolean;
    version: number;
    created_at: Date;
    updated_at: Date;
    role: Role;
  }>(
    `SELECT 
       p.id,
       p.workspace_id,
       p.name,
       p.description,
       p.archived,
       p.version,
       p.created_at,
       p.updated_at,
       CASE 
         WHEN w.owner_id = $1 THEN 'owner'
         ELSE pm.role
       END AS role
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     LEFT JOIN project_memberships pm 
       ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
     WHERE w.owner_id = $1 OR (pm.user_id = $1 AND pm.status = 'active')
     ORDER BY p.name ASC`,
    [userId],
  );

  return res.rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description ?? null,
    role: row.role,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));
}
