import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../../',import.meta.url));
const require=createRequire(root+'package.json');
const {Client}=require('pg');
const cli=process.env.FLOWBOARD_NEON_CLI??'/Users/shubham/.npm/_npx/c58b2a555394695b/node_modules/neonctl/bin/cli.js';
const report={kind:'read-only UAT identity/ledger; not feature acceptance',projectId:'misty-unit-76664549',branchId:'br-polished-term-a172b6x5',observedAt:new Date().toISOString(),command:'node docs/reviews/HOSTED-MCP-20261104/release-preparation/read-uat-ledger.mjs'};
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>['HOME','PATH','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].includes(k)));
let client;
try {
  const get=(args)=>execFileSync(process.execPath,[cli,...args,'--output','json','--no-analytics'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40000});
  const meta=JSON.parse(get(['api',`/projects/${report.projectId}/endpoints`]));
  const endpoints=(meta.endpoints??meta).filter(x=>x.branch_id===report.branchId&&x.type==='read_write');assert.equal(endpoints.length,1);
  const output=get(['connection-string',report.branchId,'--project-id',report.projectId,'--database-name','neondb','--role-name','neondb_owner']);
  let uri;try{const x=JSON.parse(output);uri=typeof x==='string'?x:x.uri??x.connection_string;}catch{uri=output.trim();}
  const u=new URL(uri);assert.equal(u.hostname,'ep-shy-fire-a1we7145.ap-southeast-1.aws.neon.tech');assert.equal(u.hostname,endpoints[0].host);assert.equal(u.pathname,'/neondb');assert.equal(u.username,'neondb_owner');u.searchParams.set('sslmode','verify-full');
  report.endpointId=endpoints[0].id;report.directEndpointVerified=true;
  client=new Client({connectionString:u.toString(),connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'flowboard_hosted_mcp_readonly_preflight'});
  await client.connect();await client.query('BEGIN READ ONLY');
  report.databaseIdentity=(await client.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version,current_setting('transaction_read_only') AS read_only")).rows[0];assert.equal(report.databaseIdentity.database,'neondb');assert.equal(report.databaseIdentity.read_only,'on');
  report.ledger=(await client.query('SELECT version,name,applied_at FROM schema_migrations ORDER BY version')).rows;
  const files=(await fs.readdir(root+'database/migrations')).filter(x=>/^\d+_.*\.sql$/.test(x)).sort();
  assert.ok(report.ledger.every(x=>files.includes(x.name)));
  const versions=new Set(report.ledger.map(x=>x.version));report.pendingFiles=files.filter(x=>!versions.has(x.split('_')[0]));
  await client.query('ROLLBACK');report.status='pass';report.exitCode=0;
}catch(error){report.status='fail';report.exitCode=1;report.errorClass=error.name;report.safeCode=/^[A-Z0-9_]{1,35}$/.test(error.code??'')?error.code:undefined;process.exitCode=1;}
finally{if(client)await client.end().catch(()=>{});}
report.limits='Metadata and schema ledger only; no application rows or credentials saved. Historical ledger has no SQL checksums.';
await fs.writeFile(new URL('./uat-ledger.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,ledgerCount:report.ledger?.length,pendingFiles:report.pendingFiles,errorClass:report.errorClass,safeCode:report.safeCode}));
