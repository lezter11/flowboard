import assert from 'node:assert/strict';
import test from 'node:test';
import { ACTIVITY_ACTIONS } from '../src/activity-actions.ts';

// B-5: the UI maps each action name to a sentence, so names must be unique and stable snake_case.
test('activity action names are unique lowercase snake_case', () => {
  assert.equal(new Set(ACTIVITY_ACTIONS).size, ACTIVITY_ACTIONS.length, 'duplicate action name');
  for (const action of ACTIVITY_ACTIONS) {
    assert.match(action, /^[a-z]+(_[a-z]+)*$/, `${action} is not snake_case`);
  }
});

test('the names the UI was promised are present', () => {
  for (const action of ['column_added', 'invitation_sent', 'member_removed', 'board_created', 'project_links_updated']) {
    assert.ok((ACTIVITY_ACTIONS as readonly string[]).includes(action), `${action} missing`);
  }
});
