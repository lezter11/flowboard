import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInvitationSessions, invitationActions, invitationDeliveryText } from '../src/lib/invitation-state.ts';
import type { Invitation } from '@flowboard/contracts';
const row = {id:'i',role:'manager',status:'pending',expiresAt:'2030-01-01',delivery:{status:'failed',canRetry:true}} as Invitation;
test('delivery labels never infer delivery from absent or queued summaries',()=>{
  assert.equal(invitationDeliveryText(undefined),'Email delivery unknown');
  assert.equal(invitationDeliveryText({status:'pending',canRetry:false}),'Email queued');
  assert.equal(invitationDeliveryText({status:'delivered',canRetry:false}),'Email delivered');
});
test('row actions honor manager targets, failed retry hints, expiry and archive',()=>{
  assert.equal(invitationActions('manager',row).resend,false);
  assert.equal(invitationActions('owner',row).retryDelivery,true);
  assert.equal(invitationActions('owner',{...row,delivery:{status:'failed',canRetry:false}}).retryDelivery,false);
  assert.equal(invitationActions('owner',{...row,status:'expired'}).resend,false);
  assert.equal(invitationActions('owner',{...row,status:'expired'}).createNew,true);
  assert.equal(invitationActions('owner',row,true).revoke,false);
  assert.equal(invitationActions('viewer',row).createNew,false);
});
test('same actor/project remount retains unknown request; another actor/project sees no draft',async()=>{
  const sessions=createInvitationSessions(), a=sessions.forProject('alice','project');
  a.update({email:'original@example.com',operation:{action:'resend',id:'old',email:'original@example.com'}});
  await assert.rejects(a.command.run(a.get().operation!,async()=>{throw new TypeError('lost response');}));
  assert.equal(sessions.forProject('alice','project').command.unresolved(),true);
  assert.equal(sessions.forProject('alice','project').get().email,'original@example.com');
  assert.equal(sessions.forProject('bob','project').get().operation,null);
  assert.equal(sessions.forProject('alice','other').get().email,'');
  assert.equal('token' in a.get(),false);
});
