import assert from 'node:assert/strict';
import test from 'node:test';
import { getSessionResponseSchema, updateLastLocationInputSchema } from '../src/index.ts';

test('session response accepts lastLocation as null, absent or a project/board pair', () => {
  const base = {
    actor: { id: 'usr_1', email: 'a@flowboard.example', displayName: 'A', avatarUrl: null },
    ownedWorkspaces: [],
    accessibleProjects: [],
  };
  assert.ok(getSessionResponseSchema.safeParse({ data: { ...base } }).success);
  assert.ok(getSessionResponseSchema.safeParse({ data: { ...base, lastLocation: null } }).success);
  assert.ok(getSessionResponseSchema.safeParse({ data: { ...base, lastLocation: { projectId: 'p_1', boardId: null } } }).success);
  assert.ok(getSessionResponseSchema.safeParse({ data: { ...base, lastLocation: { projectId: 'p_1', boardId: 'b_1' } } }).success);
});

test('last-location input is strict: unknown fields and empty ids are refused', () => {
  assert.ok(updateLastLocationInputSchema.safeParse({ projectId: 'p_1' }).success);
  assert.ok(updateLastLocationInputSchema.safeParse({ projectId: 'p_1', boardId: null }).success);
  assert.equal(updateLastLocationInputSchema.safeParse({ projectId: 'p_1', role: 'owner' }).success, false);
  assert.equal(updateLastLocationInputSchema.safeParse({ projectId: '' }).success, false);
});
