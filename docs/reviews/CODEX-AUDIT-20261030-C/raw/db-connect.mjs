import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://flowaudit@127.0.0.1:55634/flowaudit', connectionTimeoutMillis: 3000 });
try {
  const { rows } = await pool.query(`SELECT current_database() AS db, current_user AS role, r.rolsuper, r.rolcreatedb, r.rolcreaterole, r.rolcanlogin, has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_schema FROM pg_roles r WHERE r.rolname = current_user`);
  console.log(JSON.stringify(rows[0]));
} finally { await pool.end(); }
