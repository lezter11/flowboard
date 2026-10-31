import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strongestRole, switcherGroups, switcherLabel } from '../src/lib/project-switcher.ts';

const p = (id: string, name: string, role: 'owner' | 'manager' | 'member' | 'viewer', isOwned: boolean, isArchived = false) => ({ id, name, role, isOwned, isArchived });
const list = [p('1', 'Zeta', 'owner', true), p('2', 'Alpha', 'owner', true), p('3', 'Beta', 'viewer', false), p('4', 'Old', 'owner', true, true), p('5', 'Aardvark', 'manager', false)];

test('groups: Yours and Shared with you, open only, sorted by name', () => {
  const { yours, shared } = switcherGroups(list);
  assert.deepEqual(yours.map((x) => x.name), ['Alpha', 'Zeta']);
  assert.deepEqual(shared.map((x) => x.name), ['Aardvark', 'Beta']);
});

test('a viewer-only person has no manage role, even though they own a hidden container', () => {
  assert.equal(strongestRole([p('3', 'Beta', 'viewer', false)]), 'viewer');
  assert.equal(strongestRole([]), null);
  assert.equal(strongestRole([p('3', 'B', 'member', false), p('5', 'A', 'manager', false)]), 'manager');
});

test('label inside a shared project is the project and the role, never someone else workspace', () => {
  assert.deepEqual(switcherLabel(list[2]!, list), { title: 'Beta', subtitle: 'Viewer', mark: 'BE' });
  assert.deepEqual(switcherLabel(null, list), { title: 'Projects', subtitle: '4 projects', mark: 'PR' });
  assert.equal(switcherLabel(null, []).subtitle, '0 projects');
  assert.equal(switcherLabel(null, [p('1', 'A', 'owner', true)]).subtitle, '1 project');
});
