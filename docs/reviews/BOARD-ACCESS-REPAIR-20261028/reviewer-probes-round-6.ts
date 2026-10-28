import assert from 'node:assert/strict';
import pg from 'pg';
import { runMigrations } from '../../../apps/api/src/adapters/migrations.ts';
import { createApp } from '../../../apps/api/src/http/app.ts';
import { createDevUserAndSession } from '../../../apps/api/src/adapters/session.ts';
import { setGlobalPool } from '../../../apps/api/src/adapters/postgres.ts';
const testUrl=process.env['FLOWBOARD_ACCESS_TEST_DATABASE_URL']!;
const url=new URL(testUrl); assert.equal(url.hostname,'127.0.0.1'); assert.equal(url.port,'55479'); assert.equal(url.pathname,'/flowboard_access_test');
const schema=`review6_${crypto.randomUUID().replaceAll('-','')}`;
const admin=new pg.Pool({connectionString:testUrl,max:2}); await admin.query(`CREATE SCHEMA "${schema}"`);
const pool=new pg.Pool({connectionString:testUrl,max:10,options:`-c search_path=${schema}`});
const originalQuery=pool.query.bind(pool);
// Scheduling barrier only: every SQL statement, row, permission check and
// HTTP response is real. Pause before dispatching one later data statement,
// allowing another mounted request to commit in an ordinary async interval.
let pause: {matches:(sql:string)=>boolean,entered:()=>void,release:Promise<void>} | undefined;
(pool as any).query=async (...args:any[])=>{
 const sql=typeof args[0]==='string'?args[0]:args[0].text;
 if(pause?.matches(sql)) {const gate=pause; pause=undefined; gate.entered(); await gate.release;}
 return (originalQuery as any)(...args);
};
function barrier(matches:(sql:string)=>boolean) {
 let enter!:()=>void,release!:()=>void;
 const entered=new Promise<void>(r=>{enter=r}); const released=new Promise<void>(r=>{release=r});
 pause={matches,entered:enter,release:released}; return {entered,release};
}
try {
 await runMigrations(pool);
 const owner=await createDevUserAndSession('r6-owner@test.invalid','Owner',pool);
 const nextOwner=await createDevUserAndSession('r6-next@test.invalid','Next Owner',pool);
 const member=await createDevUserAndSession('r6-member@test.invalid','Private Member',pool);
 await pool.query(`INSERT INTO workspaces (id,name,timezone,owner_id,created_at,updated_at) VALUES ('w','Review','UTC',$1,NOW(),NOW())`,[owner.user.id]);
 await pool.query(`INSERT INTO projects (id,workspace_id,name,created_at,updated_at) VALUES ('p','w','Private Project',NOW(),NOW())`);
 await pool.query(`INSERT INTO project_memberships (id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('pm','p','w',$1,'member','active',NOW(),NOW())`,[member.user.id]);
 await pool.query(`INSERT INTO boards (id,workspace_id,project_id,name,created_at,updated_at) VALUES ('b','w','p','Private Board',NOW(),NOW())`);
 await pool.query(`INSERT INTO board_grants (board_id,project_id,workspace_id,user_id,granted_by) VALUES ('b','p','w',$1,$2)`,[member.user.id,owner.user.id]);
 await pool.query(`INSERT INTO columns (id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES ('col','w','p','b','To Do','blue','todo',0,NOW(),NOW())`);
 await pool.query(`INSERT INTO cards (id,workspace_id,project_id,board_id,column_id,title,priority,position,state,created_at,updated_at) VALUES ('card','w','p','b','col','Private Card','medium',0,'active',NOW(),NOW())`);
 await pool.query(`INSERT INTO comments (id,workspace_id,project_id,card_id,author_id,body,created_at,updated_at) VALUES ('cmt','w','p','card',$1,'Private Comment',NOW(),NOW())`,[owner.user.id]);
 const app=createApp(async()=>{},{pool,deadlineMs:30000});
 const req=(method:string,path:string,session:string,body?:unknown)=>app.request(`http://localhost/api/v1${path}`,{method,headers:{cookie:`flowboard_session=${session}`,'Content-Type':'application/json','Idempotency-Key':`review6-${crypto.randomUUID()}`},...(body?{body:JSON.stringify(body)}:{})});
 async function readResult(probe:string,response:Response) {const body=await response.json(); console.log(JSON.stringify({probe,status:response.status,body})); return body;}
 // Current grant disappears after picker selected eligible board identities.
 let gate=barrier(sql=>sql.includes('WITH project_context AS'));
 let pending=req('GET','/projects/p/people?boardId=b&purpose=mention',member.session.id); await gate.entered;
 let revision=(await pool.query("SELECT access_revision FROM boards WHERE id='b'")).rows[0].access_revision;
 let mutation=await req('DELETE',`/boards/b/grants/${member.user.id}`,owner.session.id,{expectedAccessRevision:revision}); assert.equal(mutation.status,200,await mutation.clone().text());
 assert.equal((await pool.query('SELECT count(*) FROM board_grants WHERE user_id=$1',[member.user.id])).rows[0].count,'0'); gate.release();
 let response=await pending; let body=await readResult('board-people-after-committed-grant-revocation',response); assert.equal(response.status,200); assert.ok(body.data.length>0);
 assert.equal((await req('GET','/projects/p/people?boardId=b&purpose=mention',member.session.id)).status,404);
 // Project people read after committed project revocation.
 gate=barrier(sql=>sql.includes('WITH project_context AS')); pending=req('GET','/projects/p/people',member.session.id); await gate.entered;
 mutation=await req('DELETE',`/projects/p/members/${member.user.id}`,owner.session.id); assert.equal(mutation.status,200,await mutation.clone().text()); gate.release();
 response=await pending; body=await readResult('project-people-after-committed-membership-removal',response); assert.equal(response.status,200); assert.ok(body.data.length>0);
 assert.equal((await req('GET','/projects/p/people',member.session.id)).status,404);
 // Directory can return other people's email after actor is removed.
 await pool.query("UPDATE project_memberships SET status='active' WHERE id='pm'");
 gate=barrier(sql=>sql.includes('pm.id AS membership_id')); pending=req('GET','/projects/p/members',member.session.id); await gate.entered;
 mutation=await req('DELETE',`/projects/p/members/${member.user.id}`,owner.session.id); assert.equal(mutation.status,200,await mutation.clone().text()); gate.release();
 response=await pending; body=await readResult('project-directory-after-committed-membership-removal',response); assert.equal(response.status,200); assert.ok(body.data.some((x:any)=>x.email==='r6-owner@test.invalid'));
 assert.equal((await req('GET','/projects/p/members',member.session.id)).status,404);
 // Workspace project listing retains stale Owner branch after transfer.
 gate=barrier(sql=>sql.includes('FROM projects\n             WHERE workspace_id')); pending=req('GET','/workspaces/w/projects',owner.session.id); await gate.entered;
 let version=(await pool.query("SELECT version FROM workspaces WHERE id='w'")).rows[0].version;
 mutation=await req('POST','/workspaces/w/transfer-ownership',owner.session.id,{targetUserId:nextOwner.user.id,expectedVersion:version}); assert.equal(mutation.status,200,await mutation.clone().text()); gate.release();
 response=await pending; body=await readResult('workspace-project-list-after-committed-owner-transfer',response); assert.equal(response.status,200); assert.equal(body.data[0].name,'Private Project');
 assert.equal((await req('GET','/workspaces/w/projects',owner.session.id)).status,404);
 console.log('Confirmed board picker, project picker, directory and workspace project-list stale authorization. All mutations committed through mounted handlers.');
} finally { pause=undefined; setGlobalPool(null); await pool.end(); await admin.query(`DROP SCHEMA "${schema}" CASCADE`); await admin.end(); }
