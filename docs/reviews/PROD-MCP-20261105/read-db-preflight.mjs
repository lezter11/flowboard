// Read-only production metadata and schema preflight. Credentials stay in memory.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../../package.json',import.meta.url));
const {Client}=require('pg');
const projectId='misty-unit-76664549';
const cli='/Users/shubham/.npm/_npx/c58b2a555394695b/node_modules/neonctl/bin/cli.js';
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['HOME','PATH','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].includes(k)));
const report={kind:'read-only production schema preflight',projectId,startedAt:new Date().toISOString()};
const run=args=>execFileSync(process.execPath,[cli,...args,'--output','json','--no-analytics'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40000});
const get=args=>JSON.parse(run(args));
let client;
try {
 const project=get(['api',`/projects/${projectId}`]);
 report.project={id:project.project?.id??project.id,historyRetentionSeconds:project.project?.history_retention_seconds??project.history_retention_seconds};
 const b=get(['api',`/projects/${projectId}/branches`]);const branches=b.branches??b;
 report.branches=branches.map(x=>({id:x.id,name:x.name,primary:x.primary,default:x.default,currentState:x.current_state}));
 const prod=branches.filter(x=>x.name==='production');assert.equal(prod.length,1,'production branch must be unique');
 report.branchId=prod[0].id;
 const e=get(['api',`/projects/${projectId}/endpoints`]);
 const endpoints=(e.endpoints??e).filter(x=>x.branch_id===report.branchId&&x.type==='read_write');assert.equal(endpoints.length,1);
 assert.equal(endpoints[0].host,'ep-patient-frost-a1kvcqki.ap-southeast-1.aws.neon.tech');
 const raw=run(['connection-string',report.branchId,'--project-id',projectId,'--database-name','neondb','--role-name','neondb_owner']);
 let connection;try{connection=JSON.parse(raw);}catch{connection=raw.trim();}
 const url=new URL(typeof connection==='string'?connection:connection.uri??connection.connection_string);
 assert.equal(url.hostname,endpoints[0].host);assert.equal(url.username,'neondb_owner');assert.equal(url.pathname,'/neondb');url.searchParams.set('sslmode','verify-full');
 report.endpointId=endpoints[0].id;report.directHostVerified=true;
 client=new Client({connectionString:url.toString(),connectionTimeoutMillis:10000,statement_timeout:15000,application_name:'flowboard_prod_release_readonly'});
 await client.connect();await client.query('BEGIN READ ONLY');
 report.identity=(await client.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only")).rows[0];
 assert.equal(report.identity.read_only,'on');
 report.ledger=(await client.query('SELECT version,name FROM schema_migrations ORDER BY version')).rows;
 report.roles=(await client.query("SELECT rolname,rolsuper,rolcreatedb,rolcreaterole,rolcanlogin FROM pg_roles WHERE rolname IN ('neondb_owner','flowboard_runtime','flowboard_migrator','flowboard_reporting') ORDER BY rolname")).rows;
 report.schemaPrivileges=(await client.query("SELECT has_schema_privilege(current_user,'public','CREATE') AS can_create_in_public")).rows[0];
 const tables=['users','workspaces','projects','boards','cards','comments','outbox','card_image_uploads','card_images','board_grants'];report.counts={};
 for(const table of tables){const exists=(await client.query('SELECT to_regclass($1) IS NOT NULL AS exists',['public.'+table])).rows[0].exists;if(exists)report.counts[table]=(await client.query('SELECT count(*)::int AS count FROM '+table)).rows[0].count;}
 await client.query('ROLLBACK');report.status='pass';report.exitCode=0;
}catch(error){report.status='fail';report.exitCode=1;report.errorClass=error.name;report.safeCode=/^[A-Z0-9_]{1,35}$/.test(error.code??'')?error.code:undefined;process.exitCode=1;}
finally{if(client)await client.end().catch(()=>{});}
report.completedAt=new Date().toISOString();
await fs.writeFile(new URL('./production-db-preflight.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{mode:0o600});
console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,branchId:report.branchId,branchCount:report.branches?.length,ledgerCount:report.ledger?.length,roles:report.roles,counts:report.counts,errorClass:report.errorClass,safeCode:report.safeCode}));
