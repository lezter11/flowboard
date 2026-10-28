import assert from 'node:assert/strict';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { setGlobalPool } from '../../../apps/api/src/adapters/postgres.ts';
const testUrl=process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL']!;
const url=new URL(testUrl); assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55479'); assert.equal(url.pathname,'/flowboard_access_test');
const schema=`review7_${crypto.randomUUID().replaceAll('-','')}`;
const admin=new pg.Pool({connectionString:testUrl,max:2}); await admin.query(`CREATE SCHEMA "${schema}"`);
const pool=new pg.Pool({connectionString:testUrl,max:10,options:`-c search_path=${schema}`});
const proto=pg.Client.prototype as any; const original=proto.query;
let pause: {matches:(sql:string)=>boolean,entered:()=>void,release:Promise<void>} | undefined;
proto.query=function (...args:any[]) {
 const sql=typeof args[0]==='string'?args[0]:args[0]?.text??'';
 if(pause?.matches(sql)) {const gate=pause; pause=undefined; gate.entered(); return gate.release.then(() => original.apply(this,args));}
 return original.apply(this,args);
};
function barrier(matches:(sql:string)=>boolean) {
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>{enter=r}); const released=new Promise<void>(r=>{release=r});
 pause={matches,entered:enter,release:released}; return {entered,release};
}
try {
 await runMigrations(pool);
 const owner=await createDevUserAndSession('r7-owner@test.invalid','Owner',pool);
 const next=await createDevUserAndSession('r7-next@test.invalid','Next',pool);
 const member=await createDevUserAndSession('r7-member@test.invalid','Member',pool);
 await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','Review','UTC',$1,NOW(),NOW())`,[owner.user.id]);
 await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','Private Project',NOW(),NOW())`);
 await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('pm','p','w',$1,'member','active',NOW(),NOW())`,[member.user.id]);
 const app=createApp(async()=>{},{pool,deadlineMs:30000});
 const req=(method:string,path:string,session:string,body?:unknown,key=`review7-${crypto.randomUUID()}`)=>app.request(`http://localhost/api/v1${path}`,{method,headers:{cookie:`flowboard_session=${session}`,'Content-Type':'application/json','Idempotency-Key':key},...(body?{body:JSON.stringify(body)}:{})});
 async function transfer(){const version=(await pool.query("SELECT version FROM workspaces WHERE id='w'")).rows[0].version; const r=await req('POST','/workspaces/w/transfer-ownership',owner.session.id,{targetUserId:next.user.id,expectedVersion:version}); assert.equal(r.status,200,await r.clone().text()); assert.equal((await pool.query("SELECT owner_id FROM workspaces WHERE id='w'")).rows[0].owner_id,next.user.id);}
 async function restore(){await pool.query("UPDATE workspaces SET owner_id=$1,version=version+1 WHERE id='w'",[owner.user.id]);}
 async function output(probe:string,r:Response){console.log(JSON.stringify({probe,status:r.status,body:await r.clone().json()}));}
 // All SQL/HTTP behavior is real; barriers only choose an async interleaving before dispatching mutation SQL.
 for(const operation of ['archive','reopen']) {
  await restore(); await pool.query("UPDATE projects SET archived=$1 WHERE id='p'",[operation==='reopen']);
  const gate=barrier(sql=>sql.includes('UPDATE projects')&&sql.includes(operation==='archive'?'archived = TRUE':'archived = FALSE'));
  const pending=req('POST',`/projects/p/${operation}`,owner.session.id);
  await Promise.race([gate.entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('barrier timeout')),3000))]);
  try {await transfer();} finally {gate.release();}
  const r=await pending; await output(`project-${operation}-after-committed-ownership-transfer`,r); assert.equal(r.status,200); assert.equal((await pool.query("SELECT archived FROM projects WHERE id='p'")).rows[0].archived,operation==='archive');
  assert.equal((await req('POST',`/projects/p/${operation}`,owner.session.id)).status,404);
 }
 await restore();
 const gate=barrier(sql=>sql.includes('INSERT INTO projects (id, workspace_id'));
 const pending=req('POST','/workspaces/w/projects',owner.session.id,{name:'Created by former Owner'}); await gate.entered;
 try {await transfer();} finally {gate.release();}
 const created=await pending; await output('project-create-after-committed-ownership-transfer',created); assert.equal(created.status,201);
 assert.equal((await req('POST','/workspaces/w/projects',owner.session.id,{name:'fresh denied'})).status,404);
 await restore();
 const key='review7-membership-replay'; const body={role:'viewer',status:'active',expectedVersion:1};
 const first=await req('PATCH',`/projects/p/members/${member.user.id}`,owner.session.id,body,key); assert.equal(first.status,200,await first.clone().text());
 await transfer();
 const replay=await req('PATCH',`/projects/p/members/${member.user.id}`,owner.session.id,body,key); await output('membership-receipt-after-owner-lost-all-project-access',replay); assert.equal(replay.status,200); assert.equal((await replay.json()).replayed,true);
 assert.equal((await req('GET','/projects/p',owner.session.id)).status,404);
 await restore();
 const deleteKey='review7-delete-replay';
 const removed=await req('DELETE',`/projects/p/members/${member.user.id}`,owner.session.id,undefined,deleteKey); assert.equal(removed.status,200);
 await transfer();
 const deleteReplay=await req('DELETE',`/projects/p/members/${member.user.id}`,owner.session.id,undefined,deleteKey); await output('membership-delete-receipt-after-owner-lost-project-access',deleteReplay); assert.equal(deleteReplay.status,200); assert.equal((await deleteReplay.json()).replayed,true);
 await restore(); await pool.query("UPDATE projects SET archived=FALSE WHERE id='p'");
 const inviteBody={email:'private-invite@test.invalid',role:'member'};
 const invite=await req('POST','/projects/p/invitations',owner.session.id,inviteBody,'review7-invitation-key'); assert.equal(invite.status,201,await invite.clone().text());
 const listGate=barrier(sql=>sql.includes('FROM project_invitations')&&sql.includes('ORDER BY created_at DESC'));
 const listPending=req('GET','/projects/p/invitations',owner.session.id); await listGate.entered;
 try {await transfer();} finally {listGate.release();}
 const list=await listPending; await output('invitation-directory-after-committed-ownership-transfer',list); assert.equal(list.status,200); assert.ok((await list.json()).data.some((x:any)=>x.email===inviteBody.email));
 assert.equal((await req('GET','/projects/p/invitations',owner.session.id)).status,404);
 const inviteReplay=await req('POST','/projects/p/invitations',owner.session.id,inviteBody,'review7-invitation-key'); await output('invitation-create-receipt-after-owner-lost-project-access',inviteReplay); assert.equal(inviteReplay.status,201);
 await restore();
 const inviteGate=barrier(sql=>sql.includes('INSERT INTO project_invitations'));
 const invitePending=req('POST','/projects/p/invitations',owner.session.id,{email:'after-transfer@test.invalid',role:'manager'}); await inviteGate.entered;
 try {await transfer();} finally {inviteGate.release();}
 const inviteAfter=await invitePending; await output('manager-invitation-created-after-committed-ownership-transfer',inviteAfter); assert.equal(inviteAfter.status,201);
 console.log('Confirmed three project lifecycle/create writes after committed ownership transfer and project membership receipt disclosure after revocation. No target code edits.');
} finally {pause=undefined; proto.query=original; setGlobalPool(null); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end();}
