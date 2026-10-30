import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://flowaudit@127.0.0.1:55634/flowaudit', connectionTimeoutMillis: 3000 });
try {
  const role = await pool.query(`SELECT current_user AS role, r.rolsuper, r.rolcreatedb, r.rolcreaterole, has_database_privilege(current_user, current_database(), 'CREATE') AS db_create FROM pg_roles r WHERE r.rolname = current_user`);
  const server = await pool.query('SELECT version() AS version');
  const checks = {};
  await pool.query('BEGIN');
  for (const [name, sql] of Object.entries({
    create: 'CREATE TABLE audit_privilege_probe (id integer)',
    alter: 'ALTER TABLE audit_privilege_probe ADD COLUMN x integer',
    truncate: 'TRUNCATE audit_privilege_probe',
    drop: 'DROP TABLE audit_privilege_probe',
  })) {
    try { await pool.query(sql); checks[name] = 'allowed'; }
    catch (e) { checks[name] = `denied ${e.code}`; }
  }
  await pool.query('ROLLBACK');
  console.log(JSON.stringify({ server: server.rows[0].version, role: role.rows[0], ddl: checks }));
} finally { await pool.end(); }
