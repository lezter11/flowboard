import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ASSIGNEES, assignableList, canAddAssignee, ineligibleIds, namesFor, pickerState } from '../src/lib/assignees.ts';

const person = (id: string, displayName: string, scopedRole: string, extra = {}) => ({ id, displayName, scopedRole, activeInProject: true, assignable: scopedRole !== 'viewer', ...extra });
const project = [person('v', 'Vera', 'viewer'), person('m', 'Mo', 'member'), person('o', 'Olu', 'owner'), person('g', 'Gus', 'manager'), person('x', 'Gone', 'member', { activeInProject: false })];

test('fresh board: the Owner is offered even though the snapshot has nobody', () => {
  const list = assignableList([person('o', 'Olu', 'owner')]);
  assert.deepEqual(list.map((p) => p.id), ['o']);
});

test('Viewers and people who left are never offered, owner first then managers then members', () => {
  assert.deepEqual(assignableList(project).map((p) => p.id), ['o', 'g', 'm']);
});

test('a server that forgets to flag a viewer is still filtered', () => {
  assert.deepEqual(assignableList([{ id: 'v', displayName: 'V', scopedRole: 'viewer', activeInProject: true }]).length, 0);
});

test('picker states: loading, error, empty, ready', () => {
  assert.equal(pickerState({ isPending: true, isError: false }, []), 'loading');
  assert.equal(pickerState({ isPending: false, isError: true }, []), 'error');
  assert.equal(pickerState({ isPending: false, isError: false }, []), 'empty');
  assert.equal(pickerState({ isPending: false, isError: false }, [1]), 'ready');
});

test('chip names keep people already on cards from the snapshot, and current project people win', () => {
  const snap = new Map([['old', person('old', 'Former', 'member', { activeInProject: false })], ['m', person('m', 'Old name', 'member')]]);
  const names = namesFor(snap, [person('m', 'Mo', 'member')]);
  assert.equal(names.get('old')?.displayName, 'Former');
  assert.equal(names.get('m')?.displayName, 'Mo');
});

test('can’t-be-assigned: judged against the project list once loaded, against the snapshot before that', () => {
  const list = assignableList(project);
  const snap = new Map([['v', person('v', 'Vera', 'viewer')], ['m', person('m', 'Mo', 'member')]]);
  assert.deepEqual(ineligibleIds(['v', 'm', 'gone'], list, true, snap), ['v', 'gone']);
  // still loading or failed: nobody is wrongly flagged, but a known viewer still is
  assert.deepEqual(ineligibleIds(['v', 'm', 'unknown'], [], false, snap), ['v']);
});

test('the 20-assignee cap', () => {
  assert.equal(canAddAssignee(MAX_ASSIGNEES - 1), true);
  assert.equal(canAddAssignee(MAX_ASSIGNEES), false);
});
