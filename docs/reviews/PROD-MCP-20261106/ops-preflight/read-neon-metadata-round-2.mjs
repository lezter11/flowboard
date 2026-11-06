// Read-only metadata only: no connection URI, role/password command, database client or application request.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const PROJECT='misty-unit-76664549',CLI='/Users/shubham/.npm/_npx/c58b2a555394695b/node_modules/neonctl/bin/cli.js';
const PROD='br-orange-union-a1kqetvn',UAT='br-polished-term-a172b6x5',TARGET='br-damp-poetry-a1gfbcvn';
const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>['HOME','PATH','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].includes(key))),NODE_OPTIONS:'--dns-result-order=ipv4first'};
const read=resource=>JSON.parse(execFileSync(process.execPath,[CLI,'api',resource,'--output','json','--no-analytics'],{env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:4*1024*1024}));
const report={kind:'read-only filtered Neon project/branch/endpoint metadata, no database connection',startedAt:new Date().toISOString(),projectId:PROJECT,providerGetCount:0,applicationDataRead:false,credentialValuesRead:false,mutations:false};
try{
 const p=read('/projects/'+PROJECT);report.providerGetCount++;const project=p.project??p;assert.equal(project.id,PROJECT);
 report.project={id:project.id,name:project.name,historyRetentionSeconds:project.history_retention_seconds};
 const rawBranches=read('/projects/'+PROJECT+'/branches');report.providerGetCount++;
 const rawEndpoints=read('/projects/'+PROJECT+'/endpoints');report.providerGetCount++;
 const branches=rawBranches.branches??rawBranches,endpoints=rawEndpoints.endpoints??rawEndpoints;
 assert.ok(Array.isArray(branches)&&Array.isArray(endpoints));report.branchCount=branches.length;
 report.branches=branches.map(b=>({id:b.id,name:b.name,parentId:b.parent_id??null,currentState:b.current_state,createdAt:b.created_at,primary:b.primary,default:b.default,protected:b.protected,deleted:Boolean(b.deleted_at),children:branches.filter(c=>c.parent_id===b.id).map(c=>c.id),endpoints:endpoints.filter(e=>e.branch_id===b.id).map(e=>({id:e.id,host:e.host,type:e.type,currentState:e.current_state}))}));
 const find=id=>{const b=report.branches.find(x=>x.id===id);assert.ok(b);return b;};
 const prod=find(PROD),uat=find(UAT),target=find(TARGET);assert.equal(prod.name,'production');assert.equal(uat.name,'uat');
 assert.equal(prod.endpoints.find(e=>e.type==='read_write')?.id,'ep-patient-frost-a1kvcqki');assert.equal(uat.endpoints.find(e=>e.type==='read_write')?.id,'ep-shy-fire-a1we7145');
 assert.equal(target.name,'uat-backup-2026-10-29-d6');assert.equal(target.parentId,UAT);assert.equal(target.currentState,'ready');assert.equal(target.deleted,false);assert.equal(target.children.length,0);
 for(const key of ['primary','default','protected'])assert.equal(target[key],false);
 assert.equal(target.endpoints.length,1);assert.equal(target.endpoints[0].id,'ep-bold-hill-a1mlmaly');assert.equal(target.endpoints[0].type,'read_write');assert.equal(target.endpoints[0].currentState,'idle');
 const backups=['br-fancy-dream-a15hpqam','br-summer-firefly-a1sw1w66'];for(const id of backups){const b=find(id);assert.equal(b.parentId,PROD);assert.equal(b.deleted,false);}
 report.exactApprovedTarget=target;report.requiredPreservedBranchIds=[PROD,UAT,...backups];report.otherBranchIdsToPreserve=branches.filter(x=>x.id!==TARGET).map(x=>x.id).sort();report.status='metadata-preconditions-pass';report.exitCode=0;
}catch(error){report.status='metadata-preconditions-fail';report.exitCode=1;report.errorClass=['Error','AssertionError','SyntaxError','TypeError'].includes(error?.name)?error.name:'Error';process.exitCode=1;}
report.completedAt=new Date().toISOString();await fs.writeFile(new URL('./neon-provider-metadata-round-2.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,projectId:PROJECT,branchCount:report.branchCount,providerGetCount:report.providerGetCount,targetId:report.exactApprovedTarget?.id,requiredPreservedBranchIds:report.requiredPreservedBranchIds,errorClass:report.errorClass}));
