import pg from 'pg';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createPool, setGlobalPool } from '../../../../apps/api/src/adapters/postgres.ts';
import { createApp } from '../../../../apps/api/src/http/app.ts';
import { createSession } from '../../../../apps/api/src/adapters/session.ts';

const url = process.env.FLOWBOARD_AUDIT_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('/flowboard_harness')) throw new Error('requires disposable flowboard_harness only');
const pool = createPool(url, 4);
setGlobalPool(pool);
const run = async () => {
  await runMigrations(pool);
  const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12);
  const ids = { owner:`audit_owner_${suffix}`, viewer:`audit_viewer_${suffix}`, ws:`audit_ws_${suffix}`, project:`audit_project_${suffix}`, board:`audit_board_${suffix}`, column:`audit_column_${suffix}`, card:`audit_card_${suffix}` };
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query('INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES ($1,$2,$3,NOW(),NOW()),($4,$5,$6,NOW(),NOW())', [ids.owner,`${ids.owner}@example.invalid`,'Audit owner',ids.viewer,`${ids.viewer}@example.invalid`,'Audit viewer']);
    await c.query('INSERT INTO workspaces(id,name,timezone,owner_id,version,created_at,updated_at) VALUES ($1,$2,$3,$4,1,NOW(),NOW())',[ids.ws,'Audit workspace','UTC',ids.owner]);
    await c.query('INSERT INTO projects(id,workspace_id,name,archived,version,created_at,updated_at) VALUES ($1,$2,$3,FALSE,1,NOW(),NOW())',[ids.project,ids.ws,'Audit project']);
    await c.query('INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,version,created_at,updated_at) VALUES ($1,$2,$3,$4,\'viewer\',\'active\',1,NOW(),NOW())',[`audit_pm_${suffix}`,ids.project,ids.ws,ids.viewer]);
    await c.query('INSERT INTO boards(id,workspace_id,project_id,name,structure_version,snapshot_version,archived,created_at,updated_at) VALUES ($1,$2,$3,$4,1,1,FALSE,NOW(),NOW())',[ids.board,ids.ws,ids.project,'Audit board']);
    await c.query('INSERT INTO board_grants(board_id,project_id,workspace_id,user_id,granted_by) VALUES ($1,$2,$3,$4,$5)',[ids.board,ids.project,ids.ws,ids.viewer,ids.owner]);
    await c.query('INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,0,1,NOW(),NOW())',[ids.column,ids.ws,ids.project,ids.board,'To do','#6b7280','todo']);
    await c.query('INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,priority,position,state,version,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,1000,$8,1,NOW(),NOW())',[ids.card,ids.ws,ids.project,ids.board,ids.column,'Audit card','none','active']);
    const session = await createSession(ids.owner,24,c);
    await c.query('COMMIT');
    const app=createApp();
    const response=await app.request(`http://localhost/api/v1/cards/${ids.card}`,{method:'PATCH',headers:{'content-type':'application/json','cookie':`flowboard_session=${session.id}`,'origin':'http://localhost','idempotency-key':`audit_viewer_${suffix}`},body:JSON.stringify({assigneeIds:[ids.viewer],expectedVersion:1})});
    const body=await response.json();
    console.log(JSON.stringify({status:response.status,viewerAssigned:body?.data?.assigneeIds?.includes(ids.viewer)??false,errorCode:body?.error?.code??null,expected:'422 or rejected per API.md / FEATURE_SPEC.md'}));
  } catch(e) { await c.query('ROLLBACK').catch(()=>{}); throw e; }
  finally { c.release(); }
};
try { await run(); } finally { await pool.end(); }
