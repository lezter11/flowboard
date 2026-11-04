// PREPARED ONLY: root must clear final independent/CI gates before executing.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {UAT,args,candidateGuard,connection,ledger26,privateDirectory,verifyArchive,safeEnv,safeFailure,sha256,writeReceipt,requireNewReceipt} from './uat-release-guards.mjs';
let receiptPath,client,stage='arguments';const report={kind:'approved-method encrypted UAT backup; not release approval',projectId:UAT.projectId,branchId:UAT.branchId,startedAt:new Date().toISOString(),actualRestoreExecuted:false};
try {
  const a=args(['candidate','sha','migration-sha','private-dir','receipt']);await requireNewReceipt(a.receipt);receiptPath=a.receipt;assert.equal(process.env.FLOWBOARD_UAT_RELEASE_GATE,'reviewed','root release gate required');
  stage='candidate';const c=await candidateGuard(a.candidate,a.sha,a['migration-sha']);report.sourceCommit=a.sha;report.migrationSha256=a['migration-sha'];
  stage='branch-identity';const {url,endpointId}=await connection();report.endpointId=endpointId;
  client=new c.pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000,statement_timeout:10000,application_name:'flowboard_hosted_mcp_backup_preflight'});await client.connect();await client.query('BEGIN READ ONLY');const state=await ledger26(client,c.files);report.databaseIdentity=state.identity;report.ledger=state.ledger;await client.query('ROLLBACK');await client.end();client=null;
  stage='pg-dump';const version=execFileSync('/opt/homebrew/bin/pg_dump',['--version'],{env:safeEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();assert.match(version,/18\./);report.pgDumpVersion=version;
  const dump=execFileSync('/opt/homebrew/bin/pg_dump',['--format=custom','--no-owner','--no-privileges','--no-password','--lock-wait-timeout=10000'],{env:{...safeEnv(),PGHOST:url.hostname,PGPORT:'5432',PGUSER:UAT.role,PGDATABASE:UAT.database,PGPASSWORD:decodeURIComponent(url.password),PGCONNECT_TIMEOUT:'10',PGSSLMODE:'verify-full',PGSSLROOTCERT:'system'},stdio:['ignore','pipe','pipe'],maxBuffer:64*1024*1024,timeout:90000});
  stage='encrypt';const dir=await privateDirectory(a['private-dir'],{create:true});report.privateDirectory=dir;const key=crypto.randomBytes(32),iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);const encrypted=Buffer.concat([cipher.update(dump),cipher.final()]);const tag=cipher.getAuthTag();
  await fs.writeFile(dir+'/key.bin',key,{flag:'wx',mode:0o600});await fs.writeFile(dir+'/backup.dump.aes256gcm',encrypted,{flag:'wx',mode:0o600});await fs.writeFile(dir+'/manifest.json',JSON.stringify({cipher:'aes-256-gcm',iv:iv.toString('base64'),authTag:tag.toString('base64'),plaintextSha256:sha256(dump),createdAt:new Date().toISOString()},null,2)+'\n',{flag:'wx',mode:0o600});
  report.ciphertextSha256=sha256(encrypted);report.archive='backup.dump.aes256gcm';stage='authenticated-verification';const verification=await verifyArchive(report);assert.equal(verification.archiveBytes,dump.length);const decrypt=crypto.createDecipheriv('aes-256-gcm',key,iv);decrypt.setAuthTag(tag);assert.ok(Buffer.concat([decrypt.update(encrypted),decrypt.final()]).equals(dump));Object.assign(report,verification,{fullAuthenticatedDecryptEquality:true,pgRestoreListExit:0,encryptedOutsideGit:true});await c.recheck();report.status='pass';report.exitCode=0;
}catch(error){Object.assign(report,{status:'fail',exitCode:1,stage,...safeFailure(error)});process.exitCode=1;}
finally{if(client)await client.end().catch(()=>{});}
report.completedAt=new Date().toISOString();if(receiptPath){try{await writeReceipt(receiptPath,report);}catch(error){process.exitCode=1;console.log(JSON.stringify({status:'receipt-write-failed',...safeFailure(error)}));}}
console.log(JSON.stringify({status:report.status,exitCode:process.exitCode??report.exitCode,stage:report.stage,sourceCommit:report.sourceCommit,archiveBytes:report.archiveBytes,actualRestoreExecuted:false,errorClass:report.errorClass,safeCode:report.safeCode}));
