// PREPARED ONLY. Separate two-request read-only check of the already identified production Worker.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const [flag,value,outFlag,out]=process.argv.slice(2);assert.equal(flag,'--execute');assert.equal(value,'deployed-reviewed-production');assert.equal(outFlag,'--report');assert.ok(out);
const base=fileURLToPath(new URL('.',import.meta.url)),file=path.resolve(out);assert.ok(file.startsWith(base)&&file!==base);try{await fs.lstat(file);throw new Error('ReportExists');}catch(e){if(e.code!=='ENOENT')throw e;}
const origin='https://flowboard-api.web-app-cloud.workers.dev';const report={kind:'two anonymous GET health checks of known production Worker; no OAuth acceptance',origin,startedAt:new Date().toISOString(),maxRequests:2,requestCount:0,results:[],credentialsUsed:false,mutations:false};
async function boundedBody(r){let count=0;const chunks=[];if(r.body){const reader=r.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;if(count>65536){void reader.cancel().catch(()=>{});throw new Error('ResponseCap');}chunks.push(value);}}finally{reader.releaseLock();}}return Buffer.concat(chunks);}
for(const [name,p,expected] of [['live','/health/live','ok'],['ready','/health/ready','ready']]){
  report.requestCount++;assert.ok(report.requestCount<=2);try{const r=await fetch(new URL(p,origin),{method:'GET',redirect:'manual',credentials:'omit',headers:{accept:'application/json'},signal:AbortSignal.timeout(15000)});const raw=await boundedBody(r);let data;try{data=JSON.parse(raw.toString('utf8'));}catch{}const checks={status200:r.status===200,exactStatus:data?.data?.status===expected,json:/application\/json/i.test(r.headers.get('content-type')??''),notRedirect:!r.headers.has('location')};report.results.push({id:name,status:r.status,checks,pass:Object.values(checks).every(x=>x===true)});}catch(e){report.results.push({id:name,pass:false,errorClass:/^[A-Za-z]{1,35}$/.test(e.name??'')?e.name:'Error'});}
}
report.completedAt=new Date().toISOString();report.passed=report.results.filter(x=>x.pass).length;report.failed=report.results.length-report.passed;report.exitCode=report.failed?1:0;await fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify({requestCount:report.requestCount,passed:report.passed,failed:report.failed,exitCode:report.exitCode}));process.exitCode=report.exitCode;
