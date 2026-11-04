// PREPARED ONLY: exact reviewed0027 only, with a fresh verified encrypted backup.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {UAT,args,candidateGuard,connection,ledger26,verifyArchive,safeFailure,writeReceipt,requireNewReceipt} from './uat-release-guards.mjs';
let receiptPath,client,locked=false,stage='arguments';const report={kind:'exact reviewed additive UAT migration27 only',projectId:UAT.projectId,branchId:UAT.branchId,startedAt:new Date().toISOString(),productionTouched:false};
try {
  const a=args(['candidate','sha','migration-sha','backup-receipt','receipt']);await requireNewReceipt(a.receipt);receiptPath=a.receipt;assert.equal(process.env.FLOWBOARD_UAT_RELEASE_GATE,'reviewed','root release gate required');
  stage='candidate';const c=await candidateGuard(a.candidate,a.sha,a['migration-sha']);report.sourceCommit=a.sha;report.migrationSha256=a['migration-sha'];
  stage='backup';const backup=JSON.parse(await fs.readFile(a['backup-receipt'],'utf8'));assert.equal(backup.status,'pass');assert.equal(backup.exitCode,0);assert.equal(backup.projectId,UAT.projectId);assert.equal(backup.branchId,UAT.branchId);assert.equal(backup.sourceCommit,a.sha);assert.equal(backup.migrationSha256,a['migration-sha']);assert.equal(backup.fullAuthenticatedDecryptEquality,true);assert.equal(backup.pgRestoreListExit,0);assert.equal(backup.ledger.length,26);
  const age=Date.now()-Date.parse(backup.completedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<=30*60*1000,'backup must be ≤30minutes old');report.backupVerification=await verifyArchive(backup);report.backupCiphertextSha256=backup.ciphertextSha256;
  stage='branch-identity';const {url,endpointId}=await connection();report.endpointId=endpointId;client=new c.pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000,statement_timeout:60000,lock_timeout:10000,application_name:'flowboard_hosted_mcp_reviewed_migration27'});await client.connect();
  // Keep the same session-level lock across precondition, runner and postcondition.
  // The existing runner re-enters/unlocks this advisory lock on the same client.
  stage='migration-lock';await client.query('SELECT pg_advisory_lock(hashtext($1))',['flowboard_migrations']);locked=true;
  stage='ledger-precondition';const state=await ledger26(client,c.files);report.databaseIdentity=state.identity;report.before=state.ledger;assert.deepEqual(backup.ledger,state.ledger);await c.recheck();
  stage='apply-reviewed27';const {runMigrations}=await import(pathToFileURL(c.root+'/apps/api/src/adapters/migrations.ts').href);const result=await runMigrations(client,{migrationsDir:c.root+'/database/migrations'});report.applied=result.applied;assert.deepEqual(result.applied,[{version:'0027',name:UAT.migration}]);
  stage='ledger-postcondition';report.after=(await client.query('SELECT version,name FROM schema_migrations ORDER BY version')).rows;assert.equal(report.after.length,27);assert.deepEqual(report.after.slice(0,26),report.before);assert.deepEqual(report.after[26],{version:'0027',name:UAT.migration});await c.recheck();report.status='pass';report.exitCode=0;
}catch(error){Object.assign(report,{status:'fail',exitCode:1,stage,...safeFailure(error)});process.exitCode=1;if(client)try{report.afterFailure=(await client.query('SELECT version,name FROM schema_migrations ORDER BY version')).rows;}catch{}}
finally{if(client){if(locked)await client.query('SELECT pg_advisory_unlock(hashtext($1))',['flowboard_migrations']).catch(()=>{});await client.end().catch(()=>{});}}
report.completedAt=new Date().toISOString();if(receiptPath){try{await writeReceipt(receiptPath,report);}catch(error){process.exitCode=1;console.log(JSON.stringify({status:'receipt-write-failed',...safeFailure(error)}));}}
console.log(JSON.stringify({status:report.status,exitCode:process.exitCode??report.exitCode,stage:report.stage,sourceCommit:report.sourceCommit,applied:report.applied,beforeCount:report.before?.length,afterCount:report.after?.length,errorClass:report.errorClass,safeCode:report.safeCode}));
