import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { defaultRestoreColumn, restoreColumns, trashEmptyState } from '../src/lib/restore-destination.ts';
import { describeFailureOf } from '../src/lib/error-catalogue.ts';

const board = [{ id: 'c2', name: 'In progress', position: 2 }, { id: 'c1', name: 'Not started', position: 1 }];

test('the server column list wins; otherwise the board columns, in order', () => {
  assert.deepEqual(restoreColumns({ columns: [{ id: 'x', name: 'Only' }] }, board).map((c) => c.id), ['x']);
  assert.deepEqual(restoreColumns({}, board).map((c) => c.id), ['c1', 'c2']);
  assert.deepEqual(restoreColumns(undefined, undefined), []);
  assert.deepEqual(restoreColumns({ columns: [{ id: 1 }, null, 'x'] }, board).map((c) => c.id), ['c1', 'c2']);
});

test('the first column is preselected, and an empty list selects nothing', () => {
  assert.equal(defaultRestoreColumn(restoreColumns({}, board)), 'c1');
  assert.equal(defaultRestoreColumn([]), '');
});

test('empty states: no projects, a Member with projects, and the normal case', () => {
  assert.equal(trashEmptyState({ ready: false, projects: 0, manageable: 0 }), 'loading');
  assert.equal(trashEmptyState({ ready: true, projects: 0, manageable: 0 }), 'no-projects');
  assert.equal(trashEmptyState({ ready: true, projects: 2, manageable: 0 }), 'not-allowed');
  assert.equal(trashEmptyState({ ready: true, projects: 2, manageable: 1 }), null);
});

test('restore refusals read as next steps, naming the card', () => {
  const need = describeFailureOf({ status: 409, code: 'RESTORE_DESTINATION_REQUIRED' }, { item: 'Fix login' });
  assert.equal(need.title, 'Pick a column to restore into');
  assert.match(need.body, /“Fix login” was in a column that no longer exists/);
  const late = describeFailureOf({ status: 410, code: 'RESTORE_WINDOW_EXPIRED' }, { item: 'Fix login' });
  assert.match(late.body, /24 hours/);
  assert.match(late.body, /“Fix login”/);
});

test('the Trash page retries with the chosen column and shows the right empty states', () => {
  const page = readFileSync(new URL('../src/app/trash/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /toColumnId: pick\.columnId/);
  assert.match(page, /RESTORE_DESTINATION_REQUIRED/);
  assert.match(page, /Trash is for Owners and Managers/);
  assert.match(page, /You have no projects yet/);
  assert.doesNotMatch(page, /Only project owners and managers can view deleted cards/);
});
