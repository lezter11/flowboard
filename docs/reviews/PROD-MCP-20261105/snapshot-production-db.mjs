// Read-only aggregate monitoring. Never select query text, application bodies or credentials.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import pg from 'pg';
import {connection,safeFailure} from './operations/prod-guards.mjs';
const phase=process.argv[2];assert.ok(['start','final'].includes(phase));
const file=new URL('./production-db-'+phase+'.json',import.meta.url);let client;
const report={kind:'read-only production database monitoring aggregates',phase,startedAt:new Date().toISOString()};
try {
 const {url,endpointId}=await connection();report.endpointId=endpointId;
 client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'flowboard_prod_release_monitor_readonly'});await client.connect();await client.query('BEGIN READ ONLY');
 report.readOnly=(await client.query("SELECT current_setting('transaction_read_only') AS value")).rows[0].value;assert.equal(report.readOnly,'on');
 report.ledger=(await client.query('SELECT version,name FROM schema_migrations ORDER BY version')).rows;assert.equal(report.ledger.length,27);
 report.sessions=(await client.query("SELECT COUNT(*) AS total,COUNT(*) FILTER(WHERE state='active') AS active,COUNT(*) FILTER(WHERE wait_event_type='Lock') AS lock_waits,COUNT(*) FILTER(WHERE state='idle in transaction' AND xact_start<clock_timestamp()-INTERVAL '60 seconds') AS long_idle_transactions FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()")).rows[0];
 report.counts=(await client.query('SELECT (SELECT count(*) FROM cards) AS cards,(SELECT count(*) FROM card_images) AS images,(SELECT count(*) FROM projects) AS projects,(SELECT count(*) FROM boards) AS boards')).rows[0];
 await client.query('ROLLBACK');report.status='pass';report.exitCode=0;
} catch(error){report.status='fail';report.exitCode=1;Object.assign(report,safeFailure(error));process.exitCode=1;}
finally{await client?.end().catch(()=>{});}
report.completedAt=new Date().toISOString();await fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,phase,ledgerCount:report.ledger?.length,sessions:report.sessions,errorClass:report.errorClass}));
