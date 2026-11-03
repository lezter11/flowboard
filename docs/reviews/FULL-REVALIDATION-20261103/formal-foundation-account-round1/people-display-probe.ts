import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createDevUserAndSession } from '../../../../apps/api/src/adapters/session.ts';
const uri=process.env.FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL!;
const url=new URL(uri);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55931');assert.equal(url.pathname,'/flowboard_identity_extra_test');
const schema='independent_display_'+crypto.randomUUID().replaceAll('-','');
const admin=new pg.Pool({connectionString:uri,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
const pool=new pg.Pool({connectionString:uri,max:4,options:`-c search_path=${schema}`});
try {
 await runMigrations(pool);
 const actors:Record<string,Awaited<ReturnType<typeof createDevUserAndSession>>>={};
 for(const role of ['owner','member','viewer','hidden'])actors[role]=await createDevUserAndSession(`${role}@independent-display.example`,`Synthetic ${role}`,pool);
 await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at)VALUES('ws','Synthetic','UTC',$1,NOW(),NOW())`,[actors.owner.user.id]);
 await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at)VALUES('prj','ws','Synthetic',NOW(),NOW())`);
 for(const [name,role]of [['member','member'],['viewer','viewer'],['hidden','member']])await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at)VALUES($1,'prj','ws',$2,$3,'active',NOW(),NOW())`,['pm_'+name,actors[name].user.id,role]);
 // No boards or board grants exist: neither reader has permission to any board.
 const app=createApp(async()=>{},{pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
 for(const actor of ['member','viewer'])for(const suffix of ['members','people','people?purpose=display','people?purpose=mention']) {
 const response=await app.request(`http://localhost/api/v1/projects/prj/${suffix}`,{headers:{Cookie:`flowboard_session=${actors[actor].session.id}`}});
 const body=await response.json();console.log(JSON.stringify({actor,path:suffix,status:response.status,body}));
 if(suffix==='members')assert.equal(response.status,403);
 else if(suffix==='people?purpose=mention')assert.deepEqual((body as any).data,[]);
 else {assert.equal(response.status,200);assert.ok((body as any).data.some((p:any)=>p.id===actors.hidden.user.id),'unscoped display exposes another member without any board grant');}
 }
 console.log('CONFIRMED: Member and Viewer can enumerate full active project display identities via unscoped people route despite /members denial.');
}finally{await pool.end();await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();}
