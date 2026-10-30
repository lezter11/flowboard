import fs from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { runMigrations } from '../../../../apps/api/src/adapters/migrations.ts';
const url = 'postgres://flowaudit@127.0.0.1:55634/flowaudit';
const source = new URL('../../../../database/migrations/', import.meta.url);
const dest = new URL('./migrations-0010/', import.meta.url);
await fs.mkdir(dest, { recursive: true });
for (const f of (await fs.readdir(source)).filter(f => /^00(0[1-9]|10)_.*\.sql$/.test(f)).sort()) {
  await fs.copyFile(new URL(f, source), new URL(f, dest));
}
const admin = new pg.Pool({ connectionString: url });
try { await admin.query('CREATE DATABASE flowaudit0010'); } finally { await admin.end(); }
const pool = new pg.Pool({ connectionString: 'postgres://flowaudit@127.0.0.1:55634/flowaudit0010', max: 2 });
try {
  const result = await runMigrations(pool, { migrationsDir: dest.pathname });
  console.log('APPLIED_THROUGH_0010', JSON.stringify(result.applied));
  const counts = await pool.query(`SELECT (SELECT count(*) FROM schema_migrations) migrations, (SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE') tables`);
  console.log('BASELINE', JSON.stringify(counts.rows[0]));
  const users = [
    ['u_owner','Owner','owner@example.test'],['u_manager','Manager','manager@example.test'],['u_member','Member','member@example.test'],
    ['u_invitee','Invitee','invitee@example.test']
  ];
  for (const [id,name,email] of users) await pool.query('INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES($1,$2,$3,NOW(),NOW())',[id,email,name]);
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('ws_audit','Northwind','America/Chicago','u_owner',NOW(),NOW())`);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,description,created_at,updated_at) VALUES ('prj_ops','ws_audit','Operations','Migration-survival fixture',NOW(),NOW()),('prj_hr','ws_audit','People','Sibling fixture project',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_memberships(id,project_id,workspace_id,user_id,role,status,created_at,updated_at) VALUES ('pm_manager','prj_ops','ws_audit','u_manager','manager','active',NOW(),NOW()),('pm_member','prj_ops','ws_audit','u_member','member','active',NOW(),NOW())`);
  await pool.query(`INSERT INTO project_invitations(id,project_id,workspace_id,email,role,token_hash,invited_by,status,expires_at,created_at,updated_at) VALUES ('inv_pending','prj_ops','ws_audit','invitee@example.test','viewer','synthetic-hash','u_owner','pending',NOW()+INTERVAL '5 days',NOW(),NOW())`);
  await pool.query(`INSERT INTO boards(id,workspace_id,project_id,name,created_at,updated_at) VALUES ('brd_ops','ws_audit','prj_ops','Operations',NOW(),NOW()),('brd_hr','ws_audit','prj_hr','People',NOW(),NOW())`);
  await pool.query(`INSERT INTO columns(id,workspace_id,project_id,board_id,name,color,category,position,created_at,updated_at) VALUES ('col_todo','ws_audit','prj_ops','brd_ops','To do','#aaa','todo',0,NOW(),NOW()),('col_done','ws_audit','prj_ops','brd_ops','Done','#0a0','done',1,NOW(),NOW()),('col_hr','ws_audit','prj_hr','brd_hr','To do','#aaa','todo',0,NOW(),NOW())`);
  await pool.query(`INSERT INTO cards(id,workspace_id,project_id,board_id,column_id,title,description,priority,due_date,position,state,created_at,updated_at) VALUES ('card_alpha','ws_audit','prj_ops','brd_ops','col_todo','Prepare quarterly plan','Seed body','high','2026-11-15',1000,'active',NOW(),NOW()),('card_beta','ws_audit','prj_ops','brd_ops','col_done','Review access','', 'low','2026-10-30',2000,'active',NOW(),NOW()),('card_hr','ws_audit','prj_hr','brd_hr','col_hr','Hiring plan',NULL,'none',NULL,1000,'active',NOW(),NOW())`);
  await pool.query(`INSERT INTO card_assignees(card_id,user_id,workspace_id,project_id,created_at) VALUES ('card_alpha','u_member','ws_audit','prj_ops',NOW())`);
  await pool.query(`INSERT INTO comments(id,workspace_id,project_id,card_id,author_id,body,created_at,updated_at) VALUES ('com_alpha','ws_audit','prj_ops','card_alpha','u_member','Please review the quarterly plan.',NOW(),NOW())`);
  console.log('SEEDED_0010', JSON.stringify((await pool.query(`SELECT (SELECT count(*) FROM workspaces) workspaces,(SELECT count(*) FROM projects) projects,(SELECT count(*) FROM boards) boards,(SELECT count(*) FROM cards) cards,(SELECT count(*) FROM project_memberships) members,(SELECT count(*) FROM project_invitations) invitations,(SELECT count(*) FROM comments) comments`)).rows[0]));
  const upgrade = await runMigrations(pool, { migrationsDir: new URL('../../../../database/migrations/', import.meta.url).pathname });
  console.log('APPLIED_0011_0016', JSON.stringify(upgrade.applied));
  const survivors = await pool.query(`SELECT (SELECT count(*) FROM workspaces) workspaces,(SELECT count(*) FROM projects) projects,(SELECT count(*) FROM boards) boards,(SELECT count(*) FROM cards) cards,(SELECT count(*) FROM project_memberships) members,(SELECT count(*) FROM project_invitations) invitations,(SELECT count(*) FROM comments) comments,(SELECT count(*) FROM schema_migrations) migrations`);
  console.log('SURVIVORS', JSON.stringify(survivors.rows[0]));
  await pool.query(`INSERT INTO project_links(id,workspace_id,project_id,title,url,position,created_at,updated_at) VALUES ('lnk_good','ws_audit','prj_ops','Runbook','https://example.test/runbook',0,NOW(),NOW())`);
  try { await pool.query(`INSERT INTO project_links(id,workspace_id,project_id,title,url,position,created_at,updated_at) VALUES ('lnk_wrong_ws','ws_audit','prj_hr','Wrong workspace','https://example.test/wrong',0,NOW(),NOW())`); console.log('INVALID_LINK_ACCEPTED'); } catch(e) { console.log('INVALID_LINK_REJECTED', e.code, e.constraint); }
  try { await pool.query(`INSERT INTO project_links(id,workspace_id,project_id,title,url,position,created_at,updated_at) VALUES ('lnk_bad_url','ws_audit','prj_ops','Bad URL','http://example.test',1,NOW(),NOW())`); console.log('INVALID_URL_ACCEPTED'); } catch(e) { console.log('INVALID_URL_REJECTED', e.code, e.constraint); }
  try { await pool.query(`INSERT INTO project_links(id,workspace_id,project_id,title,url,position,created_at,updated_at) VALUES ('lnk_duplicate_position','ws_audit','prj_ops','Duplicate position','https://example.test/dup',0,NOW(),NOW())`); console.log('DUPLICATE_POSITION_ACCEPTED'); } catch(e) { console.log('DUPLICATE_POSITION_REJECTED', e.code, e.constraint); }
  for (const f of (await fs.readdir(source)).filter(f => /^001[1-6]_.*\.sql$/.test(f)).sort()) { await pool.query(await fs.readFile(new URL(f, source), 'utf8')); console.log('REAPPLIED', f); }
} finally { await pool.end(); }
