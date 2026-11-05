// PREPARED ONLY. Root executes after independent review; never deletes branches or falls back.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { PROD,parseArgs,requireNewReceipt,writeReceipt,candidateGuard,branch,verifyProductionBranch,verifyBackupBranch,cliJson,safeFailure,classifyCreateFailure } from './prod-guards.mjs';

let receiptPath,stage='arguments';const report={kind:'production-data-branch-backup',projectId:PROD.projectId,parentBranchId:PROD.branchId,startedAt:new Date().toISOString(),schemaOnly:false,computeCreated:false,localDataCopied:false};
try {
  const args=parseArgs(['candidate','sha','receipt']);await requireNewReceipt(args.receipt);receiptPath=args.receipt;assert.equal(process.env.FLOWBOARD_PROD_RELEASE_GATE,'reviewed','root production gate required');
  stage='frozen-candidate';const candidate=await candidateGuard(args.candidate,args.sha);report.sourceCommit=args.sha;
  stage='production-parent';verifyProductionBranch(branch(PROD.branchId));
  const name='production-backup-2026-11-05-mcp-pre-'+crypto.randomBytes(6).toString('hex');report.requestedName=name;
  stage='create-branch';report.createCommand=['branches','create','--project-id',PROD.projectId,'--name',name,'--parent',PROD.branchId,'--no-secrets','--no-compute'];
  const response=cliJson(report.createCommand);const created=response.branch??response;assert.match(created.id??'',/^br-[a-z0-9-]+$/);report.createdBranchId=created.id;
  stage='verify-ready';let actual;
  for(let attempt=0;attempt<10;attempt++){actual=branch(created.id);if(actual.current_state==='ready')break;await new Promise(resolve=>setTimeout(resolve,1000));}
  report.backupBranch=verifyBackupBranch(actual,name);const endpointResponse=cliJson(['api','/projects/'+PROD.projectId+'/endpoints']);const backupEndpoints=(endpointResponse.endpoints??endpointResponse).filter(item=>item.branch_id===created.id);assert.equal(backupEndpoints.length,0,'backup must not have compute');report.verifiedEndpointCount=0;await candidate.recheck();report.status='pass';report.exitCode=0;
} catch(error) {report.status=stage==='create-branch'?classifyCreateFailure(error):'fail';report.exitCode=1;report.stage=stage;Object.assign(report,safeFailure(error));process.exitCode=1;}
report.completedAt=new Date().toISOString();if(receiptPath)try{await writeReceipt(receiptPath,report);}catch(error){process.exitCode=1;report.status='receipt-write-failed';Object.assign(report,safeFailure(error));}
console.log(JSON.stringify({status:report.status,exitCode:process.exitCode??report.exitCode,stage:report.stage,backupBranchId:report.backupBranch?.id,createdBranchId:report.createdBranchId,ready:report.backupBranch?.currentState==='ready',errorClass:report.errorClass,safeCode:report.safeCode,childExit:report.childExit}));
