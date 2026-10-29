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
import { acquireWriteGrantLock } from './rbac.ts';
import { readableDefaultBoardJoin, readReadableDefaultBoardId } from './default-board.ts';

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

  const rawLimit =
    typeof options.limit === 'number' && !Number.isNaN(options.limit) && options.limit >= 1
      ? options.limit
      : 50;
  const limit = Math.min(rawLimit, 100);
  const cursorPayload = decodeProjectCursor(options.cursor);

  let query: string;
  let params: unknown[];

  if (isOwner) {
    query = `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at,
                    dbd.id AS default_board_id
             FROM projects p
             JOIN workspaces w ON w.id = p.workspace_id
             ${readableDefaultBoardJoin('$2')}
             WHERE p.workspace_id = $1
               AND ($3::text IS NULL OR (p.name > $3 OR (p.name = $3 AND p.id > $4)))
             ORDER BY p.name ASC, p.id ASC
             LIMIT $5`;
    params = [workspaceId, actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1];
  } else {
    query = `SELECT p.id, p.workspace_id, p.name, p.description, p.archived, p.version, p.created_at, p.updated_at,
                    dbd.id AS default_board_id
             FROM projects p
             JOIN workspaces w ON w.id = p.workspace_id
             JOIN project_memberships pm ON pm.project_id = p.id AND pm.user_id = $2 AND pm.status = 'active'
             ${readableDefaultBoardJoin('$2')}
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
    default_board_id: string | null;
  }>(query, params);

  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;

  const projects: Project[] = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    defaultBoardId: row.default_board_id,
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

  const rawLimit =
    typeof options.limit === 'number' && !Number.isNaN(options.limit) && options.limit >= 1
      ? options.limit
      : 50;
  const limit = Math.min(rawLimit, 100);
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
      dbd.id AS default_board_id,
      CASE 
        WHEN w.owner_id = $1 THEN 'owner'
        ELSE pm.role
      END AS role
    FROM projects p
    JOIN workspaces w ON p.workspace_id = w.id
    LEFT JOIN project_memberships pm 
      ON pm.project_id = p.id AND pm.user_id = $1 AND pm.status = 'active'
    ${readableDefaultBoardJoin('$1')}
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
    default_board_id: string | null;
  }>(query, [actor.id, cursorPayload?.name ?? null, cursorPayload?.id ?? null, limit + 1]);

  const hasMore = res.rows.length > limit;
  const pageRows = hasMore ? res.rows.slice(0, limit) : res.rows;

  const projects = pageRows.map((row) => ({
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    defaultBoardId: row.default_board_id,
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

/** Project links in display order. Callers must already have passed the project read check. */
export async function getProjectLinks(
  client: pg.ClientBase | pg.Pool,
  projectId: string,
): Promise<Array<{ id: string; title: string; url: string; position: number }>> {
  const res = await client.query<{ id: string; title: string; url: string; position: number }>(
    'SELECT id, title, url, position FROM project_links WHERE project_id = $1 ORDER BY position ASC',
    [projectId],
  );
  return res.rows;
}

/**
 * PRJ-03: Update project settings (name, description, brief, links, defaultBoardId).
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

    // 1. Acquire write grant lock: checks workspace owner or acquires FOR SHARE lock on project_memberships.
    // Throws 404 NOT_FOUND if project not found, actor not in project, or actor is removed.
    // Throws 403 FORBIDDEN if actor is viewer or lacks manager role.
    const grant = await acquireWriteGrantLock(client, projectId, actor.id, 'manager');

    // The landing board is Owner only. A manager may still change name and description.
    if (input.defaultBoardId !== undefined && !grant.isOwner) {
      throw HttpError.forbidden('Only the project owner can change the default board.', 'FORBIDDEN');
    }

    // 2. Fetch current project version to check OCC
    const prjRes = await client.query<{ version: number }>(
      `SELECT version FROM projects WHERE id = $1`,
      [projectId],
    );

    if (prjRes.rows.length === 0) {
      throw HttpError.notFound('Project not found.', 'NOT_FOUND');
    }

    if (prjRes.rows[0]!.version !== input.expectedVersion) {
      throw HttpError.conflict('Stale project version.', 'STALE_VERSION');
    }

    // 2b. A landing board must belong to this project and be active. FOR SHARE makes a concurrent
    // board archive wait until this transaction ends, so the check cannot race it.
    if (input.defaultBoardId) {
      const boardRes = await client.query<{ archived: boolean }>(
        `SELECT archived FROM boards WHERE id = $1 AND project_id = $2 FOR SHARE`,
        [input.defaultBoardId, projectId],
      );
      if (!boardRes.rows[0]) {
        throw HttpError.notFound('Board not found.', 'NOT_FOUND');
      }
      if (boardRes.rows[0].archived) {
        throw HttpError.unprocessable('BOARD_ARCHIVED', 'The default board must be an active board.');
      }
    }

    // 3. Execute OCC update within the active write transaction
    const updateRes = await client.query<{
      id: string;
      workspace_id: string;
      name: string;
      description: string | null;
      brief: string | null;
      archived: boolean;
      version: number;
      created_at: Date;
      updated_at: Date;
    }>(
      `UPDATE projects
       SET name = CASE WHEN $1::boolean THEN $2 ELSE name END,
           description = CASE WHEN $3::boolean THEN $4 ELSE description END,
           brief = CASE WHEN $5::boolean THEN $6::text ELSE brief END,
           default_board_id = CASE WHEN $7::boolean THEN $8::text ELSE default_board_id END,
           version = version + 1,
           updated_at = NOW()
       WHERE id = $9 AND version = $10
       RETURNING id, workspace_id, name, description, brief, archived, version, created_at, updated_at`,
      [
        input.name !== undefined,
        input.name ?? null,
        input.description !== undefined,
        input.description ?? null,
        input.brief !== undefined,
        input.brief ?? null,
        input.defaultBoardId !== undefined,
        input.defaultBoardId ?? null,
        projectId,
        input.expectedVersion,
      ],
    );

    const updatedRow = updateRes.rows[0];
    if (!updatedRow) {
      throw HttpError.conflict('Stale project version.', 'STALE_VERSION');
    }

    // 4. Links are a whole list: replace it when the caller sent one. The count and URL rules were
    // already checked by the contract schema; the table CHECKs are a second line of defence.
    if (input.links !== undefined) {
      await client.query('DELETE FROM project_links WHERE project_id = $1', [projectId]);
      const nowIso = new Date().toISOString();
      for (const [position, link] of input.links.entries()) {
        await client.query(
          `INSERT INTO project_links (id, workspace_id, project_id, title, url, position, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [`plk_${crypto.randomUUID()}`, updatedRow.workspace_id, projectId, link.title, link.url, position, nowIso],
        );
      }
    }

    // The caller is the owner here, so this is the landing board id as they can read it.
    const defaultBoardId = await readReadableDefaultBoardId(client, projectId, actor.id);
    const links = await getProjectLinks(client, projectId);

    if (poolClient) {
      await client.query('COMMIT');
    }

    return {
      id: updatedRow.id,
      workspaceId: updatedRow.workspace_id,
      name: updatedRow.name,
      description: updatedRow.description,
      defaultBoardId,
      brief: updatedRow.brief,
      links,
      isArchived: Boolean(updatedRow.archived),
      version: updatedRow.version,
      createdAt: new Date(updatedRow.created_at).toISOString(),
      updatedAt: new Date(updatedRow.updated_at).toISOString(),
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
