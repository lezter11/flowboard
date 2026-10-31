import crypto from 'node:crypto';
import type pg from 'pg';
import type { Project } from '@flowboard/contracts';
import { HttpError } from '../http/errors.ts';
import { consumeActorWindows } from './rate-limit-postgres.ts';
import { countOwnedActiveProjects, countOwnedTotalProjects, quotaExceeded } from './quotas.ts';
import type { Limits } from '../services/limits.ts';

/**
 * The one place a project is created or reopened under the own-projects limits (B-18, F-01). Both the
 * new POST /api/v1/projects and the kept POST /api/v1/workspaces/:id/projects call it, so neither
 * route can skip the quota. The caller holds the user quota lock and has checked the replay first.
 */
export async function assertOwnedProjectRoom(client: pg.ClientBase, userId: string, limits: Limits): Promise<void> {
  const used = await countOwnedActiveProjects(client, userId);
  if (used >= limits.ownedProjects) {
    throw quotaExceeded('owned_projects', limits.ownedProjects, 'archive_project', used);
  }
}

/** Only creation increases the total; reopening an existing project does not. */
export async function assertOwnedProjectTotalRoom(client: pg.ClientBase, userId: string, limits: Limits): Promise<void> {
  const used = await countOwnedTotalProjects(client, userId);
  if (used >= limits.ownedProjectsTotal) throw quotaExceeded('owned_projects_total', limits.ownedProjectsTotal, 'none', used);
}

export async function consumeProjectCreateWindows(client: pg.ClientBase, userId: string): Promise<void> {
  await consumeActorWindows(client, userId, ['project-create', 'project-create-hour']);
}

/** The short project key prefix, as the project routes have always derived it. */
export function projectKeyPrefix(name: string): string {
  const letters = name.replace(/[^A-Za-z0-9]/g, '').slice(0, 3).toUpperCase();
  return letters || 'PRJ';
}

interface ProjectRow {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  archived: boolean;
  version: number;
  created_at: Date;
  updated_at: Date;
}

/** Inserts one active project into a workspace the caller owns. The caller has already checked the cap. */
export async function insertProjectRow(
  client: pg.ClientBase,
  workspaceId: string,
  name: string,
  description: string | null,
): Promise<Project> {
  const projectId = 'prj_' + crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const res = await client.query<ProjectRow>(
    `INSERT INTO projects (id, workspace_id, name, description, archived, version, created_at, updated_at, key_prefix)
     VALUES ($1, $2, $3, $4, FALSE, 1, $5, $5, $6)
     RETURNING id, workspace_id, name, description, archived, version, created_at, updated_at`,
    [projectId, workspaceId, name, description, nowIso, projectKeyPrefix(name)],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(500, 'INTERNAL_ERROR', 'Failed to insert project row.');
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    name: row.name,
    description: row.description,
    isArchived: Boolean(row.archived),
    version: row.version,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
