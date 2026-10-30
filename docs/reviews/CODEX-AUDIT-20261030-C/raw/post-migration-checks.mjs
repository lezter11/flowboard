import pg from 'pg';
const pool = new pg.Pool({connectionString:'postgres://flowaudit@127.0.0.1:55634/flowaudit0010'});
try {
  await pool.query(`INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES ('ws_other','Other','UTC','u_owner',NOW(),NOW())`);
  await pool.query(`INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES ('prj_other','ws_other','Other project',NOW(),NOW())`);
  try { await pool.query(`INSERT INTO project_links(id,workspace_id,project_id,title,url,position,created_at,updated_at) VALUES ('lnk_wrong_ws2','ws_audit','prj_other','Wrong workspace','https://example.test/wrong2',0,NOW(),NOW())`); console.log('CROSS_WORKSPACE_LINK_ACCEPTED'); } catch(e) { console.log('CROSS_WORKSPACE_LINK_REJECTED',e.code,e.constraint); }
  const tables=['board_grants','pending_storage_deletions','rate_limit_windows','project_links'];
  const q=await pool.query(`SELECT c.relname AS table_name, con.conname, con.contype, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname=ANY($1) ORDER BY c.relname,con.contype,con.conname`,[tables]);
  console.log('CONSTRAINTS',JSON.stringify(q.rows));
  const ix=await pool.query(`SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename=ANY($1) ORDER BY tablename,indexname`,[tables]);
  console.log('INDEXES',JSON.stringify(ix.rows));
  const nul=await pool.query(`SELECT table_name,column_name,is_nullable,column_default FROM information_schema.columns WHERE table_schema='public' AND table_name=ANY($1) ORDER BY table_name,ordinal_position`,[tables]);
  console.log('COLUMNS',JSON.stringify(nul.rows));
} finally {await pool.end();}
