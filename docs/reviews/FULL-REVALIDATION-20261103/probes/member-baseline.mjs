import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import pg from 'pg';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createSession } from '../../../../apps/api/src/adapters/session.ts';
import { DEFAULT_LIMITS } from '../../../../apps/api/src/services/limits.ts';

const uri=process.env.DATABASE_URL;
assert.equal(new URL(uri).host,'127.0.0.1:55931');
assert.equal(new URL(uri).pathname,'/flowboard_harness');
const pool=new pg.Pool({connectionString:uri,max:6});
const s=crypto.randomUUID().replaceAll('-',''), owner='owner_'+s, active='active_'+s, removed='removed_'+s, ws='ws_'+s, project='p_'+s;
try {
 await runMigrations(pool);
 for(const id of [owner,active,removed]) await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES($1,$2,'Synthetic member probe',NOW(),NOW())`,[id,id+'@example.invalid']);
 await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Probe','UTC',$2,NOW(),NOW())`,[ws,owner]);
 await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,'Probe',NOW(),NOW())`,[project,ws]);
 for(const [id,status] of [[active,'active'],[removed,'removed']]) await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at) VALUES($1,$2,$3,$4,'member',$5,1,NOW(),NOW())`,['pm_'+id,project,ws,id,status]);
 const session=await createSession(owner,24,pool);
 const app=createApp(async()=>{}, {pool,limits:{...DEFAULT_LIMITS,membersPerProject:1},rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
 async function patch(id,role,status,version) {
  const r=await app.request('http://localhost/api/v1/projects/'+project+'/members/'+id,{method:'PATCH',headers:{cookie:'flowboard_session='+session.id,'content-type':'application/json',origin:'http://localhost','idempotency-key':crypto.randomUUID()},body:JSON.stringify({role,status,expectedVersion:version})});
  const body=await r.json(); return {status:r.status,code:body.error?.code};
 }
 const reactivated=await patch(removed,'member','active',1);
 const count=await pool.query(`SELECT count(*)::int AS n FROM project_memberships WHERE project_id=$1 AND status='active'`,[project]);
 await pool.query('UPDATE projects SET archived=TRUE WHERE id=$1',[project]);
 const archivedUpdate=await patch(active,'viewer','active',1);
 const role=await pool.query('SELECT role FROM project_memberships WHERE project_id=$1 AND user_id=$2',[project,active]);
 const result={baselineCommit:'917706ae0433df471c72736be4d548eb022236c4',reactivation:{...reactivated,configuredSeatLimit:1,activeMembers:count.rows[0].n},archivedMutation:{...archivedUpdate,persistedRole:role.rows[0].role},environment:'Synthetic mounted handlers; PostgreSQL17.11 on loopback55931'};
 await fs.writeFile(new URL('../raw/member-baseline.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify(result));
} finally {await pool.end();}
