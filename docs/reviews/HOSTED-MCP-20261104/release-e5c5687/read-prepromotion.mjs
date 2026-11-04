import fs from 'node:fs/promises';
import pg from 'pg';
import {connection,ledger26,safeFailure,UAT} from '../release-preparation/uat-release-guards.mjs';
let client;const report={kind:'read-only exact UAT metadata before promotion',startedAt:new Date().toISOString(),projectId:UAT.projectId,branchId:UAT.branchId};
try{
 const {url,endpointId}=await connection();report.endpointId=endpointId;
 client=new pg.Client({connectionString:url.toString(),connectionTimeoutMillis:10000,statement_timeout:10000});await client.connect();await client.query('BEGIN READ ONLY');
 const files=(await fs.readdir(new URL('../../../../database/migrations/',import.meta.url))).filter(x=>/^\d{4}_.*\.sql$/.test(x)).sort();
 Object.assign(report,await ledger26(client,files));await client.query('ROLLBACK');report.status='pass';report.exitCode=0;
}catch(e){Object.assign(report,{status:'fail',exitCode:1,...safeFailure(e)});process.exitCode=1;}finally{await client?.end().catch(()=>{});}
report.completedAt=new Date().toISOString();await fs.writeFile(new URL('./uat-ledger-prepromotion.json',import.meta.url),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:report.status,exitCode:report.exitCode,ledgerCount:report.ledger?.length,errorClass:report.errorClass,safeCode:report.safeCode}));
