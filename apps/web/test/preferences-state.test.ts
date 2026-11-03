import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeGoogleAvatar, validTimezone, createWorkspaceDrafts, workspaceDraftDirty } from '../src/lib/preferences-state.ts';
import { api } from '../src/lib/api.ts';
import type { SessionWorkspaceSummary } from '@flowboard/contracts';
test('avatar accepts only credential-free HTTPS Google-managed image origins',()=>{
  assert.equal(safeGoogleAvatar('https://lh3.googleusercontent.com/a/avatar?s=96'),'https://lh3.googleusercontent.com/a/avatar?s=96');
  for(const value of ['https://evil.example/a','http://lh3.googleusercontent.com/a','https://lh3.googleusercontent.com.evil.example/a','https://user:pass@lh3.googleusercontent.com/a','https://lh3.googleusercontent.com:8443/a','data:image/svg+xml,test','javascript:alert(1)',null])assert.equal(safeGoogleAvatar(value),null);
});
test('workspace timezone validates supported calendar context without browser fallback',()=>{assert.equal(validTimezone('Asia/Kolkata'),true);assert.equal(validTimezone('Pacific/Kiritimati'),true);assert.equal(validTimezone('UTC'),true);assert.equal(validTimezone('MadeUp/Timezone'),false);assert.equal(validTimezone(''),false);});
test('workspace draft keeps baseline version and text on poll conflict; explicit latest-version recovery retains values',()=>{
  const store=createWorkspaceDrafts();const original={id:'w',name:'Workspace',timezone:'UTC',version:2} as SessionWorkspaceSummary;const a=store.forWorkspace('a',original);a.update({name:'My workspace'});const next={...original,name:'Teammate edit',version:3};a.observe(next);assert.equal(a.get().name,'My workspace');assert.equal(a.get().expectedVersion,2);a.useLatestVersion(next);assert.equal(a.get().name,'My workspace');assert.equal(a.get().expectedVersion,3);assert.equal(workspaceDraftDirty(a.get()),true);a.observe({...next,name:'My workspace',version:4});assert.equal(workspaceDraftDirty(a.get()),false);assert.equal(store.forWorkspace('b',original).get().name,'Workspace');
});
test('workspace PATCH sends original expectedVersion and explicit name/timezone only',async()=>{
  const old=globalThis.fetch;let sent:RequestInit|undefined;let path='';globalThis.fetch=async(url,init)=>{path=String(url);sent=init;return Response.json({data:{id:'w',name:'New',timezone:'Asia/Kolkata',version:3}});};
  try{await api.updateWorkspace('w /1',{name:'New',timezone:'Asia/Kolkata',expectedVersion:2});assert.equal(path,'/api/v1/workspaces/w%20%2F1');assert.equal(sent?.method,'PATCH');assert.deepEqual(JSON.parse(String(sent?.body)),{name:'New',timezone:'Asia/Kolkata',expectedVersion:2});}finally{globalThis.fetch=old;}
});
