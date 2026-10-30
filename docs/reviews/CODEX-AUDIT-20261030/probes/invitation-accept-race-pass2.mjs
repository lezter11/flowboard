import crypto from 'node:crypto';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createPool } from '../../../../apps/api/src/adapters/postgres.ts';
import { createDevUserAndSession } from '../../../../apps/api/src/adapters/session.ts';

const url=process.env.FLOWBOARD_AUDIT_DATABASE_URL;
if(!url||!new URL(url).pathname.endsWith('/flowboard_harness')) throw new Error('requires disposable flowboard_harness only');
const pool=createPool(url,6), s=crypto.randomUUID().replaceAll('-','').slice(0,10), raw=`synthetic-invite-token-${s}`;
try {
  await runMigrations(pool);
  const owner=await createDevUserAndSession(`owner.${s}@example.invalid`,'Owner',pool);
  const invitee=await createDevUserAndSession(`invitee.${s}@example.invalid`,'Invitee',pool);
  const ws=`race_ws_${s}`, pr=`race_pr_${s}`;
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Race','UTC',$2,now(),now())`,[ws,owner.user.id]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,'Race',now(),now())`,[pr,ws]);
  const tokenHash=crypto.createHash('sha256').update(raw).digest('hex');
  await pool.query(`INSERT INTO project_invitations(id,project_id,workspace_id,email,role,token_hash,invited_by,status,expires_at,created_at,updated_at) VALUES($1,$2,$3,$4,'member',$5,$6,'pending',now()+interval '1 day',now(),now())`,[`race_inv_${s}`,pr,ws,invitee.user.email,tokenHash,owner.user.id]);
  const app=createApp(async()=>{}, {pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const request=(key)=>app.request('http://localhost/api/v1/invitations/accept',{method:'POST',headers:{cookie:`flowboard_session=${invitee.session.id}`,origin:'http://localhost','content-type':'application/json','idempotency-key':key,'cf-connecting-ip':key.endsWith('a')?'192.0.2.10':'192.0.2.11'},body:JSON.stringify({token:raw})});
  const responses=await Promise.all([request(`race-${s}-a`),request(`race-${s}-b`)]);
  const parsed=await Promise.all(responses.map(async r=>({status:r.status,body:await r.json()})));
  const state=await pool.query(`SELECT status FROM project_invitations WHERE id=$1`,[`race_inv_${s}`]);
  const memberships=await pool.query(`SELECT count(*)::int AS n FROM project_memberships WHERE project_id=$1 AND user_id=$2 AND status='active'`,[pr,invitee.user.id]);
  console.log(JSON.stringify({statuses:parsed.map(x=>x.status),errorCodes:parsed.map(x=>x.body?.error?.code??null),invitationStatus:state.rows[0]?.status,activeMemberships:memberships.rows[0]?.n,oneSuccess:parsed.filter(x=>x.status===200).length===1}));
} finally { await pool.end(); }
