import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import pg from 'pg';
const url=process.env.DATABASE_URL;assert.ok(url);const target=new URL(url);
assert.equal(target.hostname,'127.0.0.1');assert.equal(target.port,'55931');assert.equal(target.pathname,'/flowboard_harness');assert.equal(target.username,'flowboard_harness');
const schema='activity_reference_'+crypto.randomUUID().replaceAll('-','');
const admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
const files=['activity-reference-people','activity-coverage-b5','aud-ntf','discussion-activity-repair','b23-same-name','board-access-activity-notifications'].map(name=>'apps/api/test/'+name+'.test.ts');
console.log(JSON.stringify({executor:'Architect builder',port:target.port,database:'flowboard_harness',schema,files}));
try{
  const child=spawn(process.execPath,['--test-concurrency=1','--test',...files],{stdio:'inherit',env:{...process.env,PGOPTIONS:`-c search_path=${schema}`}});
  const result=await new Promise(resolve=>child.once('exit',(exitCode,signal)=>resolve({exitCode,signal})));
  console.log(JSON.stringify(result));process.exitCode=result.exitCode??1;
}finally{await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();console.log(JSON.stringify({cleanup:'own schema dropped'}));}
