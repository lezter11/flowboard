import type { MiddlewareHandler } from 'hono';
import { HttpError } from '../errors.ts';
import {
  resolveWorkspaceRole,
  resolveProjectRole,
  verifyProjectAncestry,
  type ResourceType,
} from '../../adapters/rbac.ts';
import { getPool } from '../../adapters/postgres.ts';
import type { Role, ProjectRole } from '@flowboard/contracts';

declare module 'hono' {
  interface ContextVariableMap {
    projectRole?: Role;
    workspaceRole?: 'owner';
  }
}

const ROLE_RANK: Record<Role, number> = {
  owner: 4,
  manager: 3,
  member: 2,
  viewer: 1,
};

export function requireWorkspaceRole(minRole: 'owner' = 'owner'): MiddlewareHandler {
  return async (c, next) => {
    const actor = c.get('actor');
    if (!actor) {
      throw HttpError.unauthorized('Authentication required.');
    }

    const workspaceId = c.req.param('workspaceId') ?? c.req.param('wid');
    if (!workspaceId) {
      throw HttpError.notFound('Workspace not found.');
    }

    const role = await resolveWorkspaceRole(workspaceId, actor.id);
    if (!role) {
      // 404 preserves privacy if missing or unauthorized
      throw HttpError.notFound('Workspace not found.');
    }

    c.set('workspaceRole', role);
    await next();
  };
}

export function requireProjectRole(minRole: ProjectRole): MiddlewareHandler {
  return async (c, next) => {
    const actor = c.get('actor');
    if (!actor) {
      throw HttpError.unauthorized('Authentication required.');
    }

    const projectId = c.req.param('projectId') ?? c.req.param('pid');
    if (!projectId) {
      throw HttpError.notFound('Project not found.');
    }

    const role = await resolveProjectRole(projectId, actor.id);
    if (!role) {
      // Preserves sibling privacy: non-members cannot tell if project exists
      throw HttpError.notFound('Project not found.');
    }

    if (ROLE_RANK[role] < ROLE_RANK[minRole]) {
      throw HttpError.forbidden(`Insufficient permissions for project. Requires at least '${minRole}' role.`);
    }

    c.set('projectRole', role);
    await next();
  };
}

export function requireProjectAncestry(
  resourceType?: ResourceType,
  resourceParam = 'resourceId',
): MiddlewareHandler {
  return async (c, next) => {
    const workspaceId = c.req.param('workspaceId') ?? c.req.param('wid');
    const projectId = c.req.param('projectId') ?? c.req.param('pid');
    const resourceId = c.req.param(resourceParam) ?? c.req.query(resourceParam);

    if (!workspaceId || !projectId) {
      throw HttpError.notFound('Project not found.');
    }

    const pool = getPool();
    await verifyProjectAncestry(
      pool,
      workspaceId,
      projectId,
      resourceId ? (resourceType ? { id: resourceId, type: resourceType } : resourceId) : undefined,
    );

    await next();
  };
}

