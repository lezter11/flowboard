import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityDetails, describeActivity } from '../src/lib/activity.ts';

test('assignment-only edits have an assignment description and referenced names without directory lookup', () => {
  const item = { action: 'card_updated', safeChanges: { assignees: { added: ['a'], removed: ['gone'] } }, referencedPeople: [{ id:'a', displayName:'Alex', nameSuffix:2, avatarUrl:null, activeInProject:true }] };
  assert.match(describeActivity(item).text, /assignees/);
  assert.deepEqual(activityDetails(item), [{ label:'Assigned', value:'Alex (2)' }, { label:'Unassigned', value:'Former project member' }]);
});
test('safe field edits and from/to moves are readable without dumping unknown payload fields', () => {
  assert.deepEqual(activityDetails({ action:'card_updated', safeChanges:{ title:{old:'Before',new:'After'}, description:{old:'',new:'<script>alert(1)</script>'}, priority:{old:'low',new:'high'}, dueDate:{old:null,new:'2026-11-03'}, secret:'NEVER DISPLAY', commentBody:'NEVER DISPLAY' } }), [
    {label:'Title',before:'Before',after:'After'}, {label:'Description',before:'Empty',after:'<script>alert(1)</script>'}, {label:'Priority',before:'low',after:'high'}, {label:'Due date',before:'None',after:'2026-11-03'},
  ]);
  assert.deepEqual(activityDetails({action:'card_moved',safeChanges:{fromColumnTitle:'Todo',toColumnTitle:'Done',fromColumnId:'private-id'}}),[{label:'Column',before:'Todo',after:'Done'}]);
});
test('purged/redacted history and comment payloads never resurrect copied text or names', () => {
  for(const flag of ['purged','redacted']) assert.deepEqual(activityDetails({action:'card_updated',safeChanges:{[flag]:true,title:{old:'SECRET',new:'SECRET'},assignees:{added:['a']}}}),[]);
  assert.deepEqual(activityDetails({action:'comment_updated',safeChanges:{body:'SECRET',title:{old:'SECRET',new:'SECRET'}}}),[]);
  assert.deepEqual(activityDetails({action:'card_updated',safeChanges:{title:{old:{body:'SECRET'},new:{body:'SECRET'}}}}),[]);
});
test('history values and assignee sets are bounded; unresolved legacy references use generic names', () => {
  const rows=activityDetails({action:'card_updated',safeChanges:{description:{old:'x'.repeat(40000),new:'new'},assigneeIds:{old:['old'],new:['new']}}});
  assert.ok(rows[0]!.before!.length<=20001);
  assert.deepEqual(rows.slice(1),[{label:'Assignees',before:'Former project member',after:'Former project member'}]);
  assert.deepEqual(activityDetails({action:'card_updated',safeChanges:{assigneeIds:['legacy-unresolved']}}),[{label:'Assignees',value:'Former project member'}]);
});
