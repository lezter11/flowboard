import crypto from 'node:crypto';
import { createApp } from '/private/tmp/flowboard-audit-99ae250/apps/api/src/http/app.ts';
import { runMigrations } from '/private/tmp/flowboard-audit-99ae250/apps/api/src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '/private/tmp/flowboard-audit-99ae250/apps/api/src/adapters/postgres.ts';
import { createDevUserAndSession } from '/private/tmp/flowboard-audit-99ae250/apps/api/src/adapters/session.ts';
import { insertProjectRow } from '/private/tmp/flowboard-audit-99ae250/apps/api/src/adapters/own-projects.ts';
import { countOwnedActiveProjects } from '/private/tmp/flowboard-audit-99ae250/apps/api/src/adapters/quotas.ts';
const dbUrl = process.env.FLOWBOARD_AUDIT_DATABASE_URL;
if (!dbUrl || !new URL(dbUrl).pathname.endsWith('/flowboard_harness') || new URL(dbUrl).hostname !== '127.0.0.1') throw new Error('refusing non-disposable database');
const pool = createPool(dbUrl, 8); setGlobalPool(pool); await runMigrations(pool);
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
try {
  const owner = await createDevUserAndSession(`owner.${suffix}@example.invalid`, 'Audit source', pool);
  const target = await createDevUserAndSession(`target.${suffix}@example.invalid`, 'Audit target', pool);
  const workspaceId = `audit_transfer_${suffix}`; const targetWorkspaceId = `audit_target_${suffix}`;
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,version,created_at,updated_at) VALUES($1,'Audit transfer','UTC',$2,1,now(),now()),($3,'Audit target','UTC',$4,1,now(),now())`, [workspaceId,owner.user.id,targetWorkspaceId,target.user.id]);
  for (let i=0;i<3;i++) await insertProjectRow(pool,targetWorkspaceId,`Target project ${i+1}`,null);
  await insertProjectRow(pool,workspaceId,'Transferred project',null);
  const before = await countOwnedActiveProjects(pool,target.user.id);
  const app = createApp(async()=>{}, {pool,rateLimiter:()=>({limit:async()=>({success:true})}),windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const res = await app.request(`/api/v1/workspaces/${workspaceId}/transfer-ownership`,{method:'POST',headers:{'content-type':'application/json','cookie':`flowboard_session=${owner.session.id}`,'idempotency-key':`audit-transfer-${suffix}`,'origin':'http://localhost'},body:JSON.stringify({targetUserId:target.user.id,expectedVersion:1})});
  const body=await res.json();
  const after=await countOwnedActiveProjects(pool,target.user.id);
  console.log(JSON.stringify({httpStatus:res.status,quotaBefore:before,quotaAfter:after,ownerChanged:body?.data?.ownerId===target.user.id,expectedLimit:3}));
} finally { await pool.end(); }
