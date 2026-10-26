import type pg from 'pg';
import { HttpError } from '../http/errors.ts';
import type {
  Project,
  SessionActor,
  UpdateProjectInput,
  ProjectDirectoryMember,
  PersonDisplay,
  ProjectPeoplePurpose,
  Role,
} from '@flowboard/contracts';
import { getPool } from './postgres.ts';

function isPool(target: pg.Pool | pg.ClientBase): target is pg.Pool {
  return typeof (target as pg.Pool).connect === 'function' && typeof (target as pg.Pool).totalCount === 'number';
}

export interface PaginationOptions {
  limit?: number | undefined;
  cursor?: string | undefined;
}

export interface PaginatedResult<T> {
  data: T[];
  nextCursor: string | null;
}

interface ProjectCursorPayload {
  name: string;
  id: string;
}

export function encodeProjectCursor(item: { name: string; id: string }): string {
  return Buffer.from(JSON.stringify({ name: item.name, id: item.id })).toString('base64url');
}

export function decodeProjectCursor(cursor?: string): ProjectCursorPayload | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === 'string' && typeof parsed.id === 'string') {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * PRJ-02: List projects in a workspace.
 * - Workspace Owner sees all projects, paginated.
 * - Granted members see only active granted projects.
 * - Outsiders get 404 NOT_FOUND (hidden projects leak no name, count, or existence).
 */
export async function getWorkspaceProjects(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  workspaceId: string,
  options: PaginationOptions = {},
): Promise<PaginatedResult<Project>> {
  const pool = clientOrPool ?? getPool();

  const wsRes = await pool.query<{ id: string; owner_id: string }>(
    `SELECT id, owner_id FROM workspaces WHERE id = $1`,
    [workspaceId],
  );
  if (!wsRes.rows[0]) {
    throw HttpError.notFound('Workspace not found.', 'NOT_FOUND');
  }

  const isOwner = wsRes.rows[0].owner_id === actor.id;

  if (!isOwner) {
    const grantCheck = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count 
       FROM project_memberships 
       WHERE workspace_id = $1 AND user_id = $2 AND status = 'active'`,
      [workspaceId, actor.id],
    );
    if (grantCheck.rows[0]?.count === '0') {
      throw HttpError.notFound('Workspace not found or unauthorized.', 'NOT_FOUND');
    }
  }

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursorPayload = decodeProjectCursor(options.cursor);

  let query: string;
  let params: unknown[];

  if (isOwner) {
    query = `SELECT id, workspace_id, name, description, archived, version, created_at, updated_at
             FROM projects
             WHERE workspace_id = $1
               AND ($2::text IS NULL OR (name > $2 OR (name = $2 AND id > $3)))
             ORDER BY name ASC, id ASC
             LIMIT $4`;
    params = [workspaceId, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1];
  } else {
    query = `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at
             FROM projects p
             JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
             WHERE p.workspace_id = $1
               AND ($3::text IS NULL OR (p.name > $3 OR (p.name = $3 AND p.id > $4)))
             ORDER BY p.name ASC, p.id ASC
             LIMIT $5`;
    params = [workspaceId, actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1];
  }

  const res = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    archived: boolean;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(query, params);

  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;

  const projects: Project[] = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }));

  const nextCursor = hasMore && pageRows.length > 0
    ? encodeProjectCursor(pageRows[pageRows.length - 1]!)
    : null;

  return {
    data: projects,
    nextCursor,
  };
}

/**
 * PRJ-02: Lists all accessible projects across workspaces for current user session.
 * - Workspace Owner sees all owned projects across their workspaces.
 * - Members/managers/viewers see only active granted projects.
 * - Outsiders get empty list { data: [], nextCursor: null }.
 */
export async function getAllAccessibleProjects(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  options: PaginationOptions = {},
): Promise<PaginatedResult<Project & { role?: Role }>> {
  const pool = clientOrPool ?? getPool();

  const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
  const cursorPayload = decodeProjectCursor(options.cursor);

  const query = `
    SELECT DISTINCT
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
    WHERE (w.owner_id = $1 OR (pm.user_id = $1 AND pm.status = 'active'))
      AND ($2::text IS NULL OR (p.name > $2 OR (p.name = $2 AND p.id > $3)))
    ORDER BY p.name ASC, p.id ASC
    LIMIT $4
  `;

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
  }>(query, [actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1]);

  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;

  const projects = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    role: row.role,
  }));

  const nextCursor = hasMore && pageRows.length > 0
    ? encodeProjectCursor(pageRows[pageRows.length - 1]!)
    : null;

  return {
    data: projects,
    nextCursor,
  };
}

/**
 * PRJ-03: Update project settings (name, description).
 * - Workspace Owner and Project Manager can update.
 * - Members/Viewers rejected with 403 FORBIDDEN.
 * - Outsiders rejected with 404 NOT_FOUND (sibling privacy).
 * - OCC with expectedVersion: returns 409 STALE_VERSION on mismatch.
 * - Increments version on success.
 */
export async function updateProjectSettings(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  projectId: string,
  input: UpdateProjectInput,
): Promise<Project> {
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
    workspace_owner_id: string;
    member_role: string | null;
    member_status: string | null;
  }>(
    `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at,
            w.owner_id AS workspace_owner_id,
            pm.role AS member_role,
            pm.status AS member_status
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1`,
    [projectId, actor.id],
  );

  const row = res.rows[0];
  if (!row) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const isWorkspaceOwner = row.workspace_owner_id === actor.id;

  if (!isWorkspaceOwner) {
    if (!row.member_role || row.member_status !== 'active') {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }

    if (row.member_role !== 'manager') {
      throw HttpError.forbidden('Insufficient permissions to update project settings.', 'FORBIDDEN');
    }
  }

  if (row.version !== input.expectedVersion) {
    throw HttpError.conflict('Stale project version.', 'STALE_VERSION');
  }

  const updateRes = await pool.query<{
    id: string;
    workspace_id: string;
    name: string;
    description: string | null;
    archived: boolean;
    version: number;
    created_at: Date;
    updated_at: Date;
  }>(
    `UPDATE projects
     SET name = CASE WHEN $1::boolean THEN $2 ELSE name END,
         description = CASE WHEN $3::boolean THEN $4 ELSE description END,
         version = version + 1,
         updated_at = NOW()
     WHERE id = $5 AND version = $6
     RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
    [
      input.name !== undefined,
      input.name ?? null,
      input.description !== undefined,
      input.description ?? null,
      projectId,
      input.expectedVersion,
    ],
  );

  const updatedRow = updateRes.rows[0];
  if (!updatedRow) {
    throw HttpError.conflict('Stale project version.', 'STALE_VERSION');
  }

  return {
    id: updatedRow.id,
    workspaceId: updatedRow.workspace_id,
    name: updatedRow.name,
    description: updatedRow.description,
    isArchived: Boolean(updatedRow.archived),
    version: updatedRow.version,
    createdAt: new Date(updatedRow.created_at).toISOString(),
    updatedAt: new Date(updatedRow.updated_at).toISOString(),
  };
}

/**
 * PRJ-05: Project people directory.
 * - Accessible by Workspace Owner and all project members (manager, member, viewer).
 * - Outsiders get 404 NOT_FOUND.
 * - Returns active project members with user info, plus workspace owner if not explicitly in membership table.
 * - Sibling project members who are not in this project are NEVER returned.
 */
export async function getProjectMembers(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  projectId: string,
): Promise<PaginatedResult<ProjectDirectoryMember>> {
  const pool = clientOrPool ?? getPool();

  const res = await pool.query<{
    id: string;
    workspace_id: string;
    workspace_owner_id: string;
    member_role: string | null;
    member_status: string | null;
  }>(
    `SELECT p.id, p.workspace_id,
            w.owner_id AS workspace_owner_id,
            pm.role AS member_role,
            pm.status AS member_status
     FROM projects p
     JOIN workspaces w ON w.id = p.workspace_id
     LEFT JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2
     WHERE p.id = $1`,
    [projectId, actor.id],
  );

  const row = res.rows[0];
  if (!row) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const isWorkspaceOwner = row.workspace_owner_id === actor.id;

  if (!isWorkspaceOwner) {
    if (!row.member_role || row.member_status !== 'active') {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }
  }

  // Fetch all active memberships for this project only
  const pmRes = await pool.query<{
    membership_id: string;
    role: 'manager' | 'member' | 'viewer';
    status: 'active' | 'removed';
    version: number;
    user_id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
  }>(
    `SELECT 
       pm.id AS membership_id,
       pm.role,
       pm.status,
       pm.version,
       u.id AS user_id,
       u.display_name,
       u.email,
       u.avatar_url
     FROM project_memberships pm
     JOIN users u ON u.id = pm.user_id
     WHERE pm.project_id = $1 AND pm.status = 'active'
     ORDER BY pm.created_at ASC, u.display_name ASC`,
    [projectId],
  );

  // Fetch workspace owner user details
  const ownerRes = await pool.query<{
    id: string;
    display_name: string;
    email: string;
    avatar_url: string | null;
  }>(
    `SELECT u.id, u.display_name, u.email, u.avatar_url
     FROM workspaces w
     JOIN users u ON u.id = w.owner_id
     WHERE w.id = $1`,
    [row.workspace_id],
  );

  const ownerUser = ownerRes.rows[0];
  const members: ProjectDirectoryMember[] = [];

  const ownerInMembers = ownerUser && pmRes.rows.find((r) => r.user_id === ownerUser.id);
  if (ownerUser && !ownerInMembers) {
    members.push({
      id: ownerUser.id,
      userId: ownerUser.id,
      name: ownerUser.display_name,
      displayName: ownerUser.display_name,
      email: ownerUser.email,
      avatarUrl: ownerUser.avatar_url,
      role: 'owner',
      status: 'active',
      version: 1,
      membershipId: `pm_owner_${ownerUser.id}`,
    });
  }

  for (const r of pmRes.rows) {
    const isOwnerUser = ownerUser && r.user_id === ownerUser.id;
    members.push({
      id: r.user_id,
      userId: r.user_id,
      name: r.display_name,
      displayName: r.display_name,
      email: r.email,
      avatarUrl: r.avatar_url,
      role: (isOwnerUser ? 'owner' : r.role) as Role,
      status: 'active',
      version: r.version,
      membershipId: r.membership_id,
    });
  }

  return {
    data: members,
    nextCursor: null,
  };
}

/**
 * Picker / mention helper for project people.
 */
export async function getProjectPeople(
  clientOrPool: pg.Pool | pg.ClientBase,
  actor: SessionActor,
  projectId: string,
  purpose: ProjectPeoplePurpose = 'display',
  query?: string,
): Promise<PaginatedResult<PersonDisplay>> {
  const membersResult = await getProjectMembers(clientOrPool, actor, projectId);
  let people: PersonDisplay[] = membersResult.data.map((m) => ({
    id: m.id,
    displayName: m.name,
    avatarUrl: m.avatarUrl ?? null,
    activeInProject: m.status === 'active',
    scopedRole: m.role,
    assignable: m.role === 'owner' || m.role === 'manager' || m.role === 'member',
    mentionable: true,
  }));

  if (query) {
    const qLower = query.toLowerCase();
    people = people.filter((p) => p.displayName.toLowerCase().includes(qLower));
  }

  if (purpose === 'assignee') {
    people = people.filter((p) => p.assignable);
  }

  return {
    data: people,
    nextCursor: null,
  };
}
