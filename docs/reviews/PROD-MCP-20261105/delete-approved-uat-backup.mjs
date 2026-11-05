// One-time owner-approved deletion. No other branch can be selected.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {PROD,CLI,cliJson,safeEnv,safeFailure,requireNewReceipt,writeReceipt} from './operations/prod-guards.mjs';
const targetId='br-lingering-field-a1hfhs5o',targetName='uat-backup-2026-10-28',uatId='br-polished-term-a172b6x5';
const receipt=new URL('./approved-uat-backup-deletion.json',import.meta.url).pathname;
const report={kind:'explicitly owner-approved old UAT backup deletion',projectId:PROD.projectId,targetId,targetName,ownerApproval:'User selected Delete that old UAT backup (Recommended), 2026-11-05',startedAt:new Date().toISOString(),otherBranchesDeleted:false};
const list=()=>{const r=cliJson(['api',`/projects/${PROD.projectId}/branches`]);return r.branches??r;};
let stage='preconditions';
try {
 await requireNewReceipt(receipt);const before=list();const t=before.find(x=>x.id===targetId);assert.ok(t);assert.equal(t.name,targetName);assert.equal(t.parent_id,uatId);assert.ok(!t.primary&&!t.default&&!t.protected);assert.equal(before.filter(x=>x.parent_id===targetId).length,0);
 const productionBackup=before.filter(x=>x.name==='production-backup-2026-10-31-d24-pre');assert.equal(productionBackup.length,1);const kept=[PROD.branchId,uatId,productionBackup[0].id];assert.ok(kept.every(id=>before.some(x=>x.id===id)));assert.ok(!kept.includes(targetId));
 const er=cliJson(['api',`/projects/${PROD.projectId}/endpoints`]);const endpoints=er.endpoints??er;const old=endpoints.filter(x=>x.branch_id===targetId);assert.equal(old.length,1);assert.equal(old[0].id,'ep-silent-math-a1encs7i');assert.ok(endpoints.filter(x=>[PROD.branchId,uatId].includes(x.branch_id)).every(x=>x.id!==old[0].id&&x.host!==old[0].host));
 report.beforeBranchCount=before.length;report.preservedBranchIds=kept;report.backupComputeId=old[0].id;
 stage='delete-approved-target';report.command=['branches','delete',targetId,'--project-id',PROD.projectId];
 execFileSync(process.execPath,[CLI,...report.command,'--output','json','--no-analytics'],{env:safeEnv(),stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:1024*1024});
 stage='verify-deleted';let after;for(let i=0;i<10;i++){after=list();if(!after.some(x=>x.id===targetId))break;await new Promise(r=>setTimeout(r,1000));}
 assert.ok(!after.some(x=>x.id===targetId));assert.ok(kept.every(id=>after.some(x=>x.id===id)));assert.equal(after.length,before.length-1);report.afterBranchCount=after.length;report.targetAbsent=true;report.preservedBranchesPresent=true;report.status='pass';report.exitCode=0;
}catch(error){report.status='fail';report.exitCode=1;report.stage=stage;Object.assign(report,safeFailure(error));process.exitCode=1;try{const current=list();report.targetAbsentAfterFailure=!current.some(x=>x.id===targetId);}catch{}report.failureInstruction='Inspect live state; never blindly retry deletion or select another branch.';}
report.completedAt=new Date().toISOString();await writeReceipt(receipt,report);console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,targetId,targetAbsent:report.targetAbsent,preservedBranchesPresent:report.preservedBranchesPresent,stage:report.stage,errorClass:report.errorClass}));
