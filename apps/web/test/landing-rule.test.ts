import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chooseLanding } from '../src/lib/landing-rule.ts';

const own = (id: string, extra = {}) => ({ id, isOwned: true, role: 'owner', ...extra });
const shared = (id: string, role = 'member', extra = {}) => ({ id, isOwned: false, role, ...extra });

// One table, used for the rule itself and (by name) mirrored by both callers.
const TABLE: Array<[string, Parameters<typeof chooseLanding>, unknown]> = [
  ['nobody, nothing', [[], null], { to: '/projects' }],
  ['remembered board wins', [[shared('p1')], { projectId: 'p1', boardId: 'b1' }], { to: '/board?id=b1' }],
  ['remembered project wins', [[shared('p1')], { projectId: 'p1', boardId: null }], { to: '/project?id=p1' }],
  ['shared only, first run: hub with Create visible', [[shared('p1')], null], { to: '/projects' }],
  ['shared only, several: hub', [[shared('p1'), shared('p2', 'viewer')], null], { to: '/projects' }],
  ['one own project: straight in', [[own('p1')], null], { singleProject: 'p1' }],
  ['own plus shared: hub', [[own('p1'), shared('p2')], null], { to: '/projects' }],
  ['two own: hub', [[own('p1'), own('p2')], null], { to: '/projects' }],
  ['archived own is not an open project', [[own('p1', { isArchived: true }), shared('p2')], null], { to: '/projects' }],
  ['old server without isOwned falls back to the role', [[{ id: 'p1', role: 'owner' }], null], { singleProject: 'p1' }],
];
for (const [name, args, expected] of TABLE) test(`landing: ${name}`, () => assert.deepEqual(chooseLanding(...args), expected));

test('the Pages middleware and the client both use the shared rule, not a copy', () => {
  const mw = readFileSync(new URL('../functions/_middleware.ts', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../src/lib/landing.ts', import.meta.url), 'utf8');
  assert.match(mw, /chooseLanding\(projects, last\)/);
  assert.match(client, /chooseLanding\(session\.accessibleProjects, session\.lastLocation\)/);
  assert.doesNotMatch(mw, /open\.length !== 1/);
  assert.doesNotMatch(client, /open\.length !== 1/);
});
