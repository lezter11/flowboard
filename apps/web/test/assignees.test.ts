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

import { describeIneligible, ineligibleFromFailure, noBoardAccess, saveBarText } from '../src/lib/assignees.ts';
import { readFileSync } from 'node:fs';

test('the assignee query carries the card board, and the project-wide query does not', () => {
  const hook = readFileSync(new URL('../src/lib/assignee-people.ts', import.meta.url), 'utf8');
  assert.match(hook, /'assignee', \{ boardId: boardId! \}/);
  assert.match(hook, /enabled && !!projectId && !!boardId/);
  assert.match(hook, /'assignee', boardId \?\? null\]/);
  const drawer = readFileSync(new URL('../src/components/board/card-detail-drawer.tsx', import.meta.url), 'utf8');
  assert.match(drawer, /useAssignablePeople\(card\.projectId, card\.boardId, editable\)/);
  assert.match(drawer, /useProjectPeople\(card\.projectId, canSeeBlocked\)/);
  assert.match(drawer, /canSeeBlocked = editable && \(role === 'owner' \|\| role === 'manager'\)/);
});

test('people without a grant are not selectable: only the board list is offered, the rest are listed as blocked', () => {
  const p = (id: string, name: string, role: string) => ({ id, displayName: name, scopedRole: role, activeInProject: true, assignable: true });
  const projectWide = [p('o', 'Olu', 'owner'), p('m1', 'Mia', 'member'), p('m2', 'Max', 'manager')];
  const onBoard = [p('o', 'Olu', 'owner'), p('m1', 'Mia', 'member')];
  assert.deepEqual(assignableList(onBoard).map((x) => x.id), ['o', 'm1']);
  assert.deepEqual(noBoardAccess(projectWide, onBoard).map((x) => x.id), ['m2']);
  assert.deepEqual(noBoardAccess(onBoard, onBoard), []);
  assert.deepEqual(noBoardAccess(undefined, onBoard), []);
});

test('a 422 names the people: by new code, by today’s details, and not for other failures', () => {
  assert.deepEqual(ineligibleFromFailure({ status: 422, code: 'VALIDATION_ERROR', message: 'x', details: { invalidAssigneeIds: ['a', 'b'] } }), ['a', 'b']);
  assert.deepEqual(ineligibleFromFailure({ status: 422, code: 'ASSIGNEE_NOT_ELIGIBLE', message: 'x', details: { invalidAssigneeIds: ['a'] } }), ['a']);
  assert.deepEqual(ineligibleFromFailure({ status: 422, code: 'VALIDATION_ERROR', message: 'All assignees must be active owners, managers or members with access to this board.' }), []);
  assert.equal(ineligibleFromFailure({ status: 422, code: 'VALIDATION_ERROR', message: 'Title too long' }), null);
  assert.equal(ineligibleFromFailure({ status: 409, code: 'STALE_VERSION', message: 'x' }), null);
});

test('error text names people with and, and falls back to the server sentence', () => {
  assert.equal(describeIneligible(['Sam Lee'], 'srv'), 'Couldn’t assign Sam Lee. They do not have access to this board.');
  assert.equal(describeIneligible(['Sam Lee', 'Ana Rao', 'Shubham Singh (2)'], 'srv'), 'Couldn’t assign Sam Lee, Ana Rao and Shubham Singh (2). They do not have access to this board.');
  assert.equal(describeIneligible([], 'The server says no.'), 'The server says no.');
});

test('the save bar never sits on "Unsaved changes" after a failed save', () => {
  assert.equal(saveBarText({ saving: false, failed: true, dirty: true }), 'Couldn’t save');
  assert.equal(saveBarText({ saving: false, failed: false, dirty: true }), 'Unsaved changes');
  assert.equal(saveBarText({ saving: true, failed: true, dirty: true }), 'Saving…');
  assert.equal(saveBarText({ saving: false, failed: false, dirty: false }), 'All changes saved');
  const drawer = readFileSync(new URL('../src/components/board/card-detail-drawer.tsx', import.meta.url), 'utf8');
  assert.match(drawer, /Remove them and save/);
  assert.match(drawer, /saveBarText\(\{ saving: save\.isPending, failed: save\.isError && dirty, dirty \}\)/);
});

import { peopleLoadError } from '../src/lib/assignees.ts';
test('BOARD_REQUIRED means reload, and a new-contract 422 names people by ineligibleUserIds', () => {
  assert.match(peopleLoadError({ code: 'BOARD_REQUIRED' }), /Reload the page/);
  assert.match(peopleLoadError(null), /Could not load/);
  assert.deepEqual(ineligibleFromFailure({ status: 422, code: 'ASSIGNEE_NOT_ELIGIBLE', message: 'x', details: { ineligibleUserIds: ['a', 'b'], issues: [] } }), ['a', 'b']);
  assert.deepEqual(ineligibleFromFailure({ status: 422, code: 'ASSIGNEE_NOT_ELIGIBLE', message: 'x', details: { ineligibleUserIds: ['n'], invalidAssigneeIds: ['o'] } }), ['n']);
});
