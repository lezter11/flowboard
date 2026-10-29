import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createBoardInputSchema,
  boardSchema,
  updateBoardInputSchema,
  updateProjectInputSchema,
  projectSchema,
} from '../src/index.ts';

test('board create accepts an optional description up to 2000 characters', () => {
  assert.ok(createBoardInputSchema.safeParse({ name: 'Launch' }).success);
  assert.ok(createBoardInputSchema.safeParse({ name: 'Launch', description: 'Plan' }).success);
  assert.ok(createBoardInputSchema.safeParse({ name: 'Launch', description: 'x'.repeat(2000) }).success);
  assert.equal(createBoardInputSchema.safeParse({ name: 'Launch', description: 'x'.repeat(2001) }).success, false);
});

test('board update needs at least one of name or description; null clears the description', () => {
  const version = { expectedVersion: 3 };
  assert.ok(updateBoardInputSchema.safeParse({ name: 'Renamed', ...version }).success);
  assert.ok(updateBoardInputSchema.safeParse({ description: 'Text', ...version }).success);
  assert.ok(updateBoardInputSchema.safeParse({ description: null, ...version }).success);
  assert.equal(updateBoardInputSchema.safeParse(version).success, false);
  assert.equal(updateBoardInputSchema.safeParse({ description: 'x'.repeat(2001), ...version }).success, false);
  assert.equal(updateBoardInputSchema.safeParse({ name: '   ', ...version }).success, false);
});

test('board read model accepts description as a string, null or absent', () => {
  const board = {
    id: 'brd_1', workspaceId: 'ws_1', projectId: 'prj_1', name: 'B', isArchived: false,
    structureVersion: 1, snapshotVersion: 1,
    createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
  };
  assert.ok(boardSchema.safeParse(board).success);
  assert.ok(boardSchema.safeParse({ ...board, description: null }).success);
  assert.ok(boardSchema.safeParse({ ...board, description: 'Plan' }).success);
});

test('project update accepts defaultBoardId as an id or null, and at least one field', () => {
  assert.ok(updateProjectInputSchema.safeParse({ defaultBoardId: 'brd_1', expectedVersion: 0 }).success);
  assert.ok(updateProjectInputSchema.safeParse({ defaultBoardId: null, expectedVersion: 0 }).success);
  assert.equal(updateProjectInputSchema.safeParse({ defaultBoardId: '', expectedVersion: 0 }).success, false);
  assert.equal(updateProjectInputSchema.safeParse({ expectedVersion: 0 }).success, false);
});

test('project read model accepts defaultBoardId as an id, null or absent', () => {
  const project = {
    id: 'prj_1', workspaceId: 'ws_1', name: 'P', description: null, isArchived: false, version: 1,
    createdAt: '2026-10-29T00:00:00.000Z', updatedAt: '2026-10-29T00:00:00.000Z',
  };
  assert.ok(projectSchema.safeParse(project).success);
  assert.ok(projectSchema.safeParse({ ...project, defaultBoardId: null }).success);
  assert.ok(projectSchema.safeParse({ ...project, defaultBoardId: 'brd_1' }).success);
});
