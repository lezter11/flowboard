import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createOwnProjectInputSchema,
  quotaExceededDetailsSchema,
  QUOTA_EXCEEDED_CODE,
  sessionLimitsSchema,
  sessionProjectSummarySchema,
} from '../src/index.ts';

// B-17 contract: the workspace-less create input, the QUOTA_EXCEEDED details, and the session fields.

test('POST /api/v1/projects input refuses a workspace id: the caller never chooses a workspace', () => {
  assert.ok(createOwnProjectInputSchema.safeParse({ name: 'Launch' }).success);
  assert.equal(createOwnProjectInputSchema.safeParse({ name: 'Launch', workspaceId: 'ws_other' }).success, false);
  assert.equal(createOwnProjectInputSchema.safeParse({ name: '' }).success, false);
});

test('QUOTA_EXCEEDED details carry scope, limit, optional current, and remedy', () => {
  assert.equal(QUOTA_EXCEEDED_CODE, 'QUOTA_EXCEEDED');
  assert.ok(quotaExceededDetailsSchema.safeParse({ scope: 'owned_projects', limit: 3, current: 3, remedy: 'archive_project' }).success);
  assert.ok(quotaExceededDetailsSchema.safeParse({ scope: 'boards_per_project', limit: 5, remedy: 'archive_board' }).success, 'current may be absent');
  assert.ok(quotaExceededDetailsSchema.safeParse({ scope: 'owned_projects_total', limit: 20, current: 20, remedy: 'none' }).success);
  assert.ok(quotaExceededDetailsSchema.safeParse({ scope: 'boards_per_project_total', limit: 25, remedy: 'none' }).success);
  assert.equal(quotaExceededDetailsSchema.safeParse({ scope: 'owned_projects', limit: 3, remedy: 'nope' }).success, false);
  assert.equal(quotaExceededDetailsSchema.safeParse({ scope: 'boards', limit: 5, remedy: 'archive_board' }).success, false);
});

test('session limits and the isOwned flag are optional and additive', () => {
  assert.ok(sessionLimitsSchema.safeParse({
    ownedProjects: { limit: 3, used: 1 },
    boardsPerProject: { limit: 5 },
    membersPerProject: { limit: 50 },
    pendingInvitationsPerProject: { limit: 50 },
  }).success);
  const project = {
    id: 'prj_1', workspaceId: 'ws_1', name: 'Launch', description: null, role: 'owner',
    isArchived: false, version: 1, createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00.000Z',
  };
  assert.ok(sessionProjectSummarySchema.safeParse(project).success, 'without isOwned');
  assert.ok(sessionProjectSummarySchema.safeParse({ ...project, isOwned: true }).success, 'with isOwned');
});
