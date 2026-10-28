import type pg from 'pg';
import { getPool } from './postgres.ts';
import { HttpError } from '../http/errors.ts';
import type {
  Role,
  ProjectRole,
  SessionWorkspaceSummary,
  SessionProjectSummary,
  PersonDisplay,
  ProjectPeoplePurpose,
  ProjectAccessSummary,
} from '@flowboard/contracts';

export type ResourceType =
  | 'board'
  | 'column'
  | 'card'
  | 'comment'
  | 'image'
  | 'upload'
  | 'import';

export interface VerifyAncestryResource {
  id: string;
  type?: ResourceType;
}

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

// ============================================================================
// RBAC-02: Project Ancestry Enforcement
// ============================================================================

const RESOURCE_TABLE_MAP: Record<ResourceType, { table: string; workspaceCol: string; projectCol: string }> = {
  board: { table: 'boards', workspaceCol: 'workspace_id', projectCol: 'project_id' },
  column: { table: 'columns', workspaceCol: 'workspace_id', projectCol: 'project_id' },
  card: { table: 'cards', workspaceCol: 'workspace_id', projectCol: 'project_id' },
  comment: { table: 'comments', workspaceCol: 'workspace_id', projectCol: 'project_id' },
  image: { table: 'card_images', workspaceCol: 'workspace_id', projectCol: 'project_id' },
  upload: { table: 'card_image_uploads', workspaceCol: 'workspace_id', projectCol: 'project_id' },
  import: { table: 'card_imports', workspaceCol: 'workspace_id', projectCol: 'project_id' },
};

function inferResourceType(resourceId: string): ResourceType | undefined {
  if (resourceId.startsWith('brd_') || resourceId.startsWith('board_')) return 'board';
  if (resourceId.startsWith('col_')) return 'column';
  if (resourceId.startsWith('card_') || resourceId.startsWith('crd_')) return 'card';
  if (resourceId.startsWith('cmt_') || resourceId.startsWith('comment_')) return 'comment';
  if (resourceId.startsWith('img_')) return 'image';
  if (resourceId.startsWith('upl_')) return 'upload';
  if (resourceId.startsWith('imp_')) return 'import';
  return undefined;
}

/**
 * Ensures project belongs strictly to workspace.
 * If resource is specified, verifies that the resource strictly belongs to the given project and workspace.
 * Returns 404 NOT_FOUND on any mismatch or missing record to prevent metadata leakage across sibling projects.
 */
export async function verifyProjectAncestry(
  clientOrPool: pg.Pool | pg.ClientBase,
  workspaceId: string,
  projectId: string,
  resource?: string | VerifyAncestryResource,
): Promise<{ projectId: string; workspaceId: string; resourceId?: string; resourceType?: ResourceType }> {
  const pool = clientOrPool ?? getPool();

  // 1. Verify project strictly belongs to workspace
  const prjRes = await pool.query<{ id: string; workspace_id: string }>(
    `SELECT id, workspace_id
     FROM projects
     WHERE id = $1 AND workspace_id = $2`,
    [projectId, workspaceId],
  );

  if (prjRes.rows.length === 0) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  // 2. If no resource passed, ancestry check is satisfied
  if (!resource) {
    return { projectId, workspaceId };
  }

  const resourceId = typeof resource === 'string' ? resource : resource.id;
  const explicitType = typeof resource === 'string' ? undefined : resource.type;
  const resourceType = explicitType ?? inferResourceType(resourceId);

  if (resourceType) {
    const mapping = RESOURCE_TABLE_MAP[resourceType];
    const res = await pool.query<{ workspace_id: string; project_id: string }>(
      `SELECT ${mapping.workspaceCol} AS workspace_id, ${mapping.projectCol} AS project_id
       FROM ${mapping.table}
       WHERE id = $1`,
      [resourceId],
    );

    if (res.rows.length === 0) {
      throw HttpError.notFound('Resource not found.', 'NOT_FOUND');
    }

    const row = res.rows[0]!;
    if (row.workspace_id !== workspaceId || row.project_id !== projectId) {
      throw HttpError.notFound('Resource not found.', 'NOT_FOUND');
    }

    return { projectId, workspaceId, resourceId, resourceType };
  }

  // Unknown prefix: search across candidate entity tables via UNION ALL
  const unionRes = await pool.query<{ res_type: ResourceType; workspace_id: string; project_id: string }>(
    `SELECT 'board'::TEXT AS res_type, workspace_id, project_id FROM boards WHERE id = $1
     UNION ALL
     SELECT 'column'::TEXT AS res_type, workspace_id, project_id FROM columns WHERE id = $1
     UNION ALL
     SELECT 'card'::TEXT AS res_type, workspace_id, project_id FROM cards WHERE id = $1
     UNION ALL
     SELECT 'comment'::TEXT AS res_type, workspace_id, project_id FROM comments WHERE id = $1
     UNION ALL
     SELECT 'image'::TEXT AS res_type, workspace_id, project_id FROM card_images WHERE id = $1
     UNION ALL
     SELECT 'upload'::TEXT AS res_type, workspace_id, project_id FROM card_image_uploads WHERE id = $1
     UNION ALL
     SELECT 'import'::TEXT AS res_type, workspace_id, project_id FROM card_imports WHERE id = $1`,
    [resourceId],
  );

  if (unionRes.rows.length === 0) {
    throw HttpError.notFound('Resource not found.', 'NOT_FOUND');
  }

  const foundRow = unionRes.rows[0]!;
  if (foundRow.workspace_id !== workspaceId || foundRow.project_id !== projectId) {
    throw HttpError.notFound('Resource not found.', 'NOT_FOUND');
  }

  return {
    projectId,
    workspaceId,
    resourceId,
    resourceType: foundRow.res_type,
  };
}

// ============================================================================
// RBAC-03: Revocation Versus Writes Lock Protocol
// ============================================================================

/**
 * Within an active write transaction, queries membership row with FOR SHARE lock.
 * If user is workspace owner, verifies workspace ownership.
 * If member has status 'removed', immediately aborts with 404 NOT_FOUND.
 * Ensures no in-flight write can commit after a preceding role revocation has won.
 */
export async function acquireWriteGrantLock(
  client: pg.ClientBase,
  projectId: string,
  userId: string,
  minRole: 'manager' | 'member' = 'member',
  boardId?: string,
): Promise<{ role: Role; isOwner: boolean; ownerId: string }> {
  // 1. Verify project exists and check workspace owner
  const prjRes = await client.query<{ id: string; workspace_id: string; owner_id: string }>(
    `SELECT p.id, p.workspace_id, w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1
     FOR SHARE OF w`,
    [projectId],
  );

  if (prjRes.rows.length === 0) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const projectRow = prjRes.rows[0]!;
  if (boardId) {
    const boardRes = await client.query<{ id: string }>(
      `SELECT id FROM boards
       WHERE id = $1 AND project_id = $2 AND workspace_id = $3`,
      [boardId, projectId, projectRow.workspace_id],
    );
    if (!boardRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
  }
  if (projectRow.owner_id === userId) {
    return { role: 'owner', isOwner: true, ownerId: projectRow.owner_id };
  }

  // 2. Lock membership row in FOR SHARE mode to serialize against concurrent role revocations
  const memberRes = await client.query<{ role: ProjectRole; status: 'active' | 'removed' }>(
    `SELECT role, status
     FROM project_memberships
     WHERE project_id = $1 AND user_id = $2
     FOR SHARE`,
    [projectId, userId],
  );

  if (memberRes.rows.length === 0) {
    throw HttpError.notFound('Project not found or access revoked.', 'NOT_FOUND');
  }

  const member = memberRes.rows[0]!;
  if (member.status === 'removed') {
    throw HttpError.notFound('Project not found or access revoked.', 'NOT_FOUND');
  }

  // 3. A board-scoped write always requires an explicit grant. Missing grant
  // schema is a deployment failure, never permission to fall back to the
  // broader project role.
  if (boardId) {
    const grantRes = await client.query<{ board_id: string }>(
      `SELECT board_id FROM board_grants
       WHERE board_id = $1 AND project_id = $2 AND workspace_id = $3 AND user_id = $4
       FOR SHARE`,
      [boardId, projectId, projectRow.workspace_id, userId],
    );
    if (!grantRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
  }

  // Check the action's role only after checking board visibility, so a user
  // with no board grant gets the same private 404 for every board operation.
  if (member.role === 'viewer') {
    throw HttpError.forbidden('Viewers cannot perform write operations.', 'FORBIDDEN');
  }

  if (minRole === 'manager' && member.role !== 'manager') {
    throw HttpError.forbidden(`Requires manager role for this operation. Current role: ${member.role}.`, 'FORBIDDEN');
  }

  return { role: member.role, isOwner: false, ownerId: projectRow.owner_id };
}

/**
 * Locks the project and optional board context and rejects writes to archived
 * data. The row locks make a future archive transition wait for this mutation
 * (or make this mutation observe the committed archive state first).
 * The board row is locked FOR UPDATE up front: card create/move later update the
 * board version, and taking a shared lock first made two parallel writers
 * deadlock while upgrading it. Writes on one board therefore queue, in a fixed
 * project-then-board order.
 */
export async function acquireWritableProjectContextLock(
  client: pg.ClientBase,
  projectId: string,
  boardId?: string,
): Promise<void> {
  if (boardId) {
    const contextRes = await client.query<{
      project_archived: boolean;
      board_archived: boolean;
    }>(
      `SELECT p.archived AS project_archived, b.archived AS board_archived
       FROM projects p
       JOIN boards b ON b.project_id = p.id
       WHERE p.id = $1 AND b.id = $2
       FOR SHARE OF p
       FOR UPDATE OF b`,
      [projectId, boardId],
    );
    if (!contextRes.rows[0]) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
    if (contextRes.rows[0].project_archived) {
      throw HttpError.conflict('READ_ONLY_CONTEXT', 'Cannot write in an archived project.', {
        reason: 'project_archived',
        contextId: projectId,
      });
    }
    if (contextRes.rows[0].board_archived) {
      throw HttpError.conflict('READ_ONLY_CONTEXT', 'Cannot write on an archived board.', {
        reason: 'board_archived',
        contextId: boardId,
      });
    }
    return;
  }

  const projectRes = await client.query<{ archived: boolean }>(
    'SELECT archived FROM projects WHERE id = $1 FOR SHARE',
    [projectId],
  );
  if (!projectRes.rows[0]) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }
  if (projectRes.rows[0].archived) {
    throw HttpError.conflict('READ_ONLY_CONTEXT', 'Cannot write in an archived project.', {
      reason: 'project_archived',
      contextId: projectId,
    });
  }
}

// ============================================================================
// RBAC-04: Picker and Notification Privacy
// ============================================================================

/**
 * Retrieves eligible people for a project with strict sibling isolation.
 * Purpose 'assignee' returns only active workspace owner and active managers/members.
 * Purpose 'mention' returns active workspace owner and active managers/members/viewers.
 * Purpose 'display' returns all active project identities.
 * Removed members are never returned in picker queries; sibling project members are never returned.
 */
export async function getProjectPeople(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  purpose: ProjectPeoplePurpose = 'display',
  query?: string,
  cursor?: string,
  limit = 50,
  boardId?: string,
  actorId?: string,
): Promise<{ data: PersonDisplay[]; nextCursor: string | null }> {
  const pool = clientOrPool ?? getPool();

  let boardEligibleIds: Set<string> | null = null;
  if (boardId) {
    const board = await pool.query<{ owner_id: string }>(
      `SELECT w.owner_id FROM boards b
       JOIN projects p ON p.id = b.project_id AND p.workspace_id = b.workspace_id
       JOIN workspaces w ON w.id = p.workspace_id
       WHERE b.id = $1 AND b.project_id = $2 AND b.archived = FALSE`,
      [boardId, projectId],
    );
    if (!board.rows[0]) throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    const grants = await pool.query<{ user_id: string }>(
      `SELECT bg.user_id FROM board_grants bg
       JOIN project_memberships pm ON pm.project_id = bg.project_id
         AND pm.user_id = bg.user_id AND pm.status = 'active'
       WHERE bg.board_id = $1 AND bg.project_id = $2`,
      [boardId, projectId],
    );
    boardEligibleIds = new Set([board.rows[0].owner_id, ...grants.rows.map((row) => row.user_id)]);
    if (actorId && !boardEligibleIds.has(actorId)) {
      throw HttpError.notFound('Board not found.', 'NOT_FOUND');
    }
  }

  const res = await pool.query<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    scoped_role: Role;
    status: 'active' | 'removed';
  }>(
    `WITH project_context AS (
       SELECT p.id AS project_id, p.workspace_id, w.owner_id AS workspace_owner_id
       FROM projects p
       JOIN workspaces w ON p.workspace_id = w.id
       WHERE p.id = $1
     ),
     all_candidates AS (
       -- 1. Workspace Owner (has permanent owner privileges in this project)
       SELECT 
         u.id,
         u.display_name,
         u.avatar_url,
         'owner'::TEXT AS scoped_role,
         'active'::TEXT AS status,
         1 AS priority
       FROM project_context pc
       JOIN users u ON pc.workspace_owner_id = u.id
       
       UNION ALL
       
       -- 2. Explicit Project Members
       SELECT 
         u.id,
         u.display_name,
         u.avatar_url,
         pm.role::TEXT AS scoped_role,
         pm.status::TEXT AS status,
         2 AS priority
       FROM project_memberships pm
       JOIN users u ON pm.user_id = u.id
       WHERE pm.project_id = $1
     ),
     deduped AS (
       SELECT DISTINCT ON (id)
         id,
         display_name,
         avatar_url,
         scoped_role,
         status
       FROM all_candidates
       ORDER BY id, priority ASC
     )
     SELECT id, display_name, avatar_url, scoped_role, status
     FROM deduped
     ORDER BY display_name ASC, id ASC`,
    [projectId],
  );

  let people: PersonDisplay[] = res.rows.map((row) => {
    const isActive = row.status === 'active';
    const role = row.scoped_role;
    const isWritableRole = role === 'owner' || role === 'manager' || role === 'member';
    const hasBoardAccess = !boardEligibleIds || boardEligibleIds.has(row.id);

    return {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? null,
      activeInProject: isActive,
      scopedRole: role,
      assignable: isActive && isWritableRole && hasBoardAccess,
      mentionable: isActive && hasBoardAccess,
    };
  });

  // Filter based on purpose
  if (purpose === 'assignee') {
    people = people.filter((p) => p.assignable === true);
  } else if (purpose === 'mention') {
    people = people.filter((p) => p.mentionable === true);
  } else {
    // default 'display'
    people = people.filter((p) => p.activeInProject === true);
  }

  // Filter by search query if provided
  if (query && query.trim().length > 0) {
    const q = query.trim().toLowerCase();
    people = people.filter((p) => p.displayName.toLowerCase().includes(q));
  }

  // Cursor-based pagination
  let startIndex = 0;
  if (cursor) {
    const cursorIdx = people.findIndex((p) => p.id === cursor);
    if (cursorIdx !== -1) {
      startIndex = cursorIdx + 1;
    }
  }

  const paginated = people.slice(startIndex, startIndex + limit);
  const nextCursor = startIndex + limit < people.length ? paginated[paginated.length - 1]?.id ?? null : null;

  return { data: paginated, nextCursor };
}

export async function getEligibleAssignees(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  query?: string,
  boardId?: string,
): Promise<PersonDisplay[]> {
  const { data } = await getProjectPeople(clientOrPool, projectId, 'assignee', query, undefined, 100, boardId);
  return data;
}

export async function getEligibleMentionees(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  query?: string,
  boardId?: string,
): Promise<PersonDisplay[]> {
  const { data } = await getProjectPeople(clientOrPool, projectId, 'mention', query, undefined, 100, boardId);
  return data;
}

export async function getHistoricalPersonDisplay(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  userId: string,
): Promise<PersonDisplay | null> {
  const pool = clientOrPool ?? getPool();

  const prjRes = await pool.query<{ owner_id: string }>(
    `SELECT w.owner_id
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     WHERE p.id = $1`,
    [projectId],
  );

  if (prjRes.rows.length > 0 && prjRes.rows[0]?.owner_id === userId) {
    const userRes = await pool.query<{ id: string; display_name: string; avatar_url: string | null }>(
      'SELECT id, display_name, avatar_url FROM users WHERE id = $1',
      [userId],
    );
    if (userRes.rows.length === 0) return null;
    const u = userRes.rows[0]!;
    return {
      id: u.id,
      displayName: u.display_name,
      avatarUrl: u.avatar_url,
      activeInProject: true,
      scopedRole: 'owner',
      assignable: true,
      mentionable: true,
    };
  }

  const memRes = await pool.query<{
    id: string;
    display_name: string;
    avatar_url: string | null;
    role: ProjectRole;
    status: 'active' | 'removed';
  }>(
    `SELECT u.id, u.display_name, u.avatar_url, pm.role, pm.status
     FROM project_memberships pm
     JOIN users u ON pm.user_id = u.id
     WHERE pm.project_id = $1 AND pm.user_id = $2`,
    [projectId, userId],
  );

  if (memRes.rows.length === 0) {
    return null;
  }

  const row = memRes.rows[0]!;
  const isActive = row.status === 'active';
  const role = row.role;
  const isWritable = role === 'manager' || role === 'member';

  return {
    id: row.id,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
    activeInProject: isActive,
    scopedRole: role,
    assignable: isActive && isWritable,
    mentionable: isActive,
  };
}

// ============================================================================
// RBAC-05: Project Inheritance Disclosure
// ============================================================================

export async function getProjectAccessSummary(
  clientOrPool: pg.Pool | pg.ClientBase,
  projectId: string,
  actorId: string,
  authorizedBoardIds?: string[] | null,
): Promise<ProjectAccessSummary> {
  const pool = clientOrPool ?? getPool();

  const prjRes = await pool.query<{
    project_id: string;
    project_name: string;
    workspace_id: string;
    workspace_name: string;
    workspace_owner_id: string;
    workspace_owner_name: string;
    workspace_owner_avatar: string | null;
  }>(
    `SELECT 
       p.id AS project_id,
       p.name AS project_name,
       p.workspace_id,
       w.name AS workspace_name,
       w.owner_id AS workspace_owner_id,
       u.display_name AS workspace_owner_name,
       u.avatar_url AS workspace_owner_avatar
     FROM projects p
     JOIN workspaces w ON p.workspace_id = w.id
     JOIN users u ON w.owner_id = u.id
     WHERE p.id = $1`,
    [projectId],
  );

  if (prjRes.rows.length === 0) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  const projectRow = prjRes.rows[0]!;

  // Verify actor has access to this project
  const actorRole = await resolveProjectRole(projectId, actorId, pool);
  if (!actorRole) {
    throw HttpError.notFound('Project not found.', 'NOT_FOUND');
  }

  // Count only boards visible to this actor. A project member may have no
  // board grants, and the total number of hidden boards is private.
  const boardCountRes = await pool.query<{ board_count: string }>(
    `SELECT COUNT(*)::INT AS board_count
     FROM boards b
     WHERE b.project_id = $1 AND b.archived = FALSE
       AND ($4::text[] IS NULL OR b.id = ANY($4::text[]))
       AND ($3::boolean OR EXISTS (
         SELECT 1 FROM board_grants bg
         JOIN project_memberships pm ON pm.project_id = bg.project_id
           AND pm.user_id = bg.user_id AND pm.status = 'active'
         WHERE bg.board_id = b.id AND bg.project_id = b.project_id
           AND bg.workspace_id = b.workspace_id AND bg.user_id = $2
       ))`,
    [projectId, actorId, actorRole === 'owner', authorizedBoardIds ?? null],
  );

  // Active memberships summary
  const memberStatsRes = await pool.query<{ role: string; count: number }>(
    `SELECT role, COUNT(*)::INT AS count
     FROM project_memberships
     WHERE project_id = $1 AND status = 'active'
     GROUP BY role`,
    [projectId],
  );

  const roleCounts: Record<string, number> = { manager: 0, member: 0, viewer: 0 };
  for (const r of memberStatsRes.rows) {
    roleCounts[r.role] = Number(r.count);
  }

  return {
    projectId: projectRow.project_id,
    projectName: projectRow.project_name,
    workspaceId: projectRow.workspace_id,
    workspaceName: projectRow.workspace_name,
    workspaceOwner: {
      id: projectRow.workspace_owner_id,
      displayName: projectRow.workspace_owner_name,
      avatarUrl: projectRow.workspace_owner_avatar,
      role: 'owner',
      inherited: true,
      disclosure: 'Workspace owner holds full administrative authority across all boards in this project.',
    },
    actor: {
      id: actorId,
      role: actorRole,
      inheritedFrom: actorRole === 'owner' ? 'workspace_owner' : 'project_membership',
    },
    boardInheritance: {
      model: 'explicit_board_grants',
      allBoardsInherit: false,
      hasBoardOnlyExceptions: true,
      boardCount: Number(boardCountRes.rows[0]?.board_count ?? 0),
      disclosure: 'Project membership alone does not grant board access. This count includes only boards you can open; the workspace Owner can open all boards.',
    },
    memberSummary: {
      activeManagers: roleCounts['manager'] ?? 0,
      activeMembers: roleCounts['member'] ?? 0,
      activeViewers: roleCounts['viewer'] ?? 0,
      totalActiveMembers: (roleCounts['manager'] ?? 0) + (roleCounts['member'] ?? 0) + (roleCounts['viewer'] ?? 0),
    },
  };
}

