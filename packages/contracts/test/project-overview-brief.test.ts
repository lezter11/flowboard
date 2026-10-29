import assert from 'node:assert/strict';
import test from 'node:test';
import { isSafeHttpsUrl, projectLinkInputSchema, projectOverviewSchema, updateProjectInputSchema } from '../src/index.ts';

test('project links accept only https URLs without credentials or whitespace', () => {
  for (const url of ['https://docs.example.com/spec', 'https://a.example.com/x?y=1#z', 'HTTPS://UPPER.example.com/']) {
    assert.equal(isSafeHttpsUrl(url), true, url);
  }
  for (const url of [
    'http://plain.example.com/',
    'javascript:alert(1)',
    'ftp://files.example.com/',
    'https://user:pw@host.example.com/',
    'https://user@host.example.com/',
    'https://host.example.com/a b',
    'https:///nohost',
    'not a url',
    `https://${'a'.repeat(2000)}.example.com`,
  ]) {
    assert.equal(isSafeHttpsUrl(url), false, url);
  }
});

test('project link input needs a title of 1-100 characters and a safe url', () => {
  assert.ok(projectLinkInputSchema.safeParse({ title: 'Spec', url: 'https://docs.example.com' }).success);
  assert.equal(projectLinkInputSchema.safeParse({ title: '   ', url: 'https://docs.example.com' }).success, false);
  assert.equal(projectLinkInputSchema.safeParse({ title: 'x'.repeat(101), url: 'https://docs.example.com' }).success, false);
  assert.equal(projectLinkInputSchema.safeParse({ title: 'Spec', url: 'http://docs.example.com' }).success, false);
});

test('project update: brief up to 5000, links up to 10, and at least one field', () => {
  const v = { expectedVersion: 1 };
  assert.ok(updateProjectInputSchema.safeParse({ brief: 'Text', ...v }).success);
  assert.ok(updateProjectInputSchema.safeParse({ brief: null, ...v }).success);
  assert.ok(updateProjectInputSchema.safeParse({ links: [], ...v }).success);
  assert.equal(updateProjectInputSchema.safeParse({ brief: 'x'.repeat(5001), ...v }).success, false);
  const eleven = Array.from({ length: 11 }, (_, i) => ({ title: `L${i}`, url: `https://a.example.com/${i}` }));
  assert.equal(updateProjectInputSchema.safeParse({ links: eleven, ...v }).success, false);
  assert.equal(updateProjectInputSchema.safeParse(v).success, false);
});

test('overview response accepts the counts shape and refuses more than 10 activity rows', () => {
  const base = {
    projectId: 'prj_1',
    asOfDate: '2026-10-29',
    readableBoardCount: 1,
    cards: {
      active: 2,
      byCategory: { todo: 1, active: 1, done: 0 },
      overdue: 0,
      dueSoon: 1,
      unassignedOpen: 1,
    },
    assignees: [],
    recentActivity: [],
  };
  assert.ok(projectOverviewSchema.safeParse(base).success);
  const row = { id: 'a', action: 'card.updated', cardId: null, createdAt: '2026-10-29T00:00:00.000Z', actor: { id: 'u', displayName: 'U' } };
  assert.equal(projectOverviewSchema.safeParse({ ...base, recentActivity: Array(11).fill(row) }).success, false);
  assert.ok(projectOverviewSchema.safeParse({ ...base, recentActivity: Array(10).fill(row) }).success);
});
