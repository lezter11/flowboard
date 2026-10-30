import crypto from 'node:crypto';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
import { createPool } from '../../../../apps/api/src/adapters/postgres.ts';
import { deliverInvitationRow } from '../../../../apps/api/src/adapters/invitation-delivery.ts';

const url = process.env.FLOWBOARD_AUDIT_DATABASE_URL;
if (!url || !new URL(url).pathname.endsWith('/flowboard_harness')) throw new Error('requires disposable flowboard_harness only');
const pool = createPool(url, 2);
const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 10);
const token = `synthetic-token-${suffix}`;
const recipient = `synthetic-recipient-${suffix}@example.invalid`;
const bodyMarker = `synthetic-body-${suffix}`;
const logLines = [];
const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
const capture = (...args) => logLines.push(args.map((x) => String(x)).join(' '));
try {
  await runMigrations(pool);
  const ownerId = `au_mail_${suffix}`;
  const workspaceId = `au_mail_ws_${suffix}`;
  const projectId = `au_mail_prj_${suffix}`;
  await pool.query(`INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES($1,$2,'Audit mail',now(),now())`, [ownerId, `${ownerId}@example.invalid`]);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES($1,'Mail audit','UTC',$2,now(),now())`, [workspaceId,ownerId]);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES($1,$2,'Mail audit project',now(),now())`, [projectId,workspaceId]);
  const outboxId = `au_mail_outbox_${suffix}`;
  const payload = { token, email:recipient, projectName:bodyMarker, inviterName:'Audit inviter', role:'member', expiresAt:'2026-11-01T00:00:00.000Z' };
  await pool.query(`INSERT INTO outbox(id,workspace_id,project_id,event_type,payload,status,next_retry_at,created_at) VALUES($1,$2,$3,'invitation.created',$4::jsonb,'pending',now(),now())`, [outboxId,workspaceId,projectId,JSON.stringify(payload)]);
  console.log = capture; console.warn = capture; console.error = capture; console.info = capture;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = (await client.query(`SELECT id,payload FROM outbox WHERE id=$1 FOR UPDATE`, [outboxId])).rows[0];
    const outcome = await deliverInvitationRow(client,row,{appOrigin:'https://flowboard.example',send:async (message) => ({status:'sent',providerMessageId:'synthetic-provider-id'})});
    await client.query('COMMIT');
    const stored = (await pool.query(`SELECT status,payload FROM outbox WHERE id=$1`, [outboxId])).rows[0];
    const logText = logLines.join('\n');
    process.stdout.write(JSON.stringify({
      outcome:outcome.kind,
      status:stored.status,
      tokenRetained:Object.hasOwn(stored.payload,'token'),
      recipientRetained:stored.payload.email === recipient,
      bodyMarkerRetained:stored.payload.projectName === bodyMarker,
      logContainsToken:logText.includes(token),
      logContainsRecipient:logText.includes(recipient),
      logContainsBodyMarker:logText.includes(bodyMarker),
      persistedKeys:Object.keys(stored.payload).sort(),
    }));
  } catch (error) { await client.query('ROLLBACK').catch(()=>{}); throw error; }
  finally { client.release(); }
} finally {
  console.log = saved.log; console.warn = saved.warn; console.error = saved.error; console.info = saved.info;
  await pool.end();
}
