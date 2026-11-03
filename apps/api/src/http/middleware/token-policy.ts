import type { Context } from 'hono';
import type { TokenScope } from '@flowboard/contracts';
import { getPool } from '../../adapters/postgres.ts';
import { HttpError } from '../errors.ts';

/** A capability allowlist, deliberately independent of cookie-authenticated UI routes. */
export const PERSONAL_ACCESS_TOKEN_ROUTES = [
  { method: 'GET', path: '/api/v1/projects', scope: 'projects:read', resource: 'directory' },
  { method: 'GET', path: '/api/v1/projects/:projectId/boards', scope: 'boards:read', resource: 'project' },
  { method: 'GET', path: '/api/v1/boards/:boardId/metadata', scope: 'boards:read', resource: 'board' },
  { method: 'GET', path: '/api/v1/projects/:projectId/cards/search', scope: 'cards:read', resource: 'project' },
  { method: 'GET', path: '/api/v1/cards/:cardId', scope: 'cards:read', resource: 'card' },
  { method: 'POST', path: '/api/v1/boards/:boardId/cards', scope: 'cards:create', resource: 'board' },
] as const satisfies ReadonlyArray<{ method: string; path: string; scope: TokenScope; resource: string }>;

/** Match the actual URL: route parameters are not populated in global Hono middleware. */
export function matchPersonalAccessTokenRoute(method: string, path: string) {
  for (const policy of PERSONAL_ACCESS_TOKEN_ROUTES) {
    if (method !== policy.method) continue;
    const pattern = new RegExp(`^${policy.path.replace(/:[A-Za-z]+/g, '([^/]+)')}$`);
    const match = path.match(pattern);
    if (!match) continue;
    let resourceId: string | undefined;
    if (match[1] !== undefined) {
      try { resourceId = decodeURIComponent(match[1]); } catch { return null; }
      // An encoded separator must not change the destination after this policy check.
      if (!resourceId || /[/\\\u0000-\u0020\u007f]/.test(resourceId) || resourceId === '.' || resourceId === '..') return null;
    }
    return { policy, resourceId };
  }
  return null;
}

export async function enforcePersonalAccessTokenPolicy(c: Context): Promise<void> {
  const matched = matchPersonalAccessTokenRoute(c.req.method, new URL(c.req.url).pathname);
  if (!matched) throw HttpError.forbidden('Personal access tokens cannot access this operation.', 'TOKEN_OPERATION_FORBIDDEN');
  if (!c.get('tokenScopes')?.includes(matched.policy.scope)) {
    throw HttpError.forbidden(`Token lacks required scope: ${matched.policy.scope}`, 'TOKEN_SCOPE_REQUIRED');
  }

  const projectRestriction = c.get('tokenProjectId');
  if (!projectRestriction || matched.policy.resource === 'directory') return;

  let projectId = matched.resourceId;
  if (matched.policy.resource === 'board') {
    const result = await getPool().query<{ project_id: string }>(
      'SELECT project_id FROM boards WHERE id = $1', [matched.resourceId],
    );
    projectId = result.rows[0]?.project_id;
  } else if (matched.policy.resource === 'card') {
    const result = await getPool().query<{ project_id: string }>(
      `SELECT b.project_id FROM cards c JOIN boards b
       ON b.id = c.board_id AND b.project_id = c.project_id AND b.workspace_id = c.workspace_id
       WHERE c.id = $1`, [matched.resourceId],
    );
    projectId = result.rows[0]?.project_id;
  }
  if (!projectId) throw HttpError.notFound('Resource not found.', 'NOT_FOUND');
  if (projectId !== projectRestriction) {
    throw HttpError.forbidden('Token is restricted to a different project.', 'TOKEN_PROJECT_FORBIDDEN');
  }
}
