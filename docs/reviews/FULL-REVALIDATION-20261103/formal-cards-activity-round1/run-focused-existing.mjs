import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import pg from 'pg';
const url=process.env.DATABASE_URL;assert.ok(url);const parsed=new URL(url);assert.equal(parsed.hostname,'127.0.0.1');assert.equal(parsed.port,'55931');assert.equal(parsed.pathname,'/flowboard_harness');assert.equal(parsed.username,'flowboard_harness');
const schema='independent_cards_'+crypto.randomUUID().replaceAll('-','');
const admin=new pg.Pool({connectionString:url,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);
const files=['discussion-activity-repair','aud-ntf','activity-coverage-b5','b9-mention-access','board-access-activity-notifications','board-access-cards-images','com-del','comment-move-replay','move-undo-repair','my-tasks-repair','outbox-recovery','qry01-qry03','lock-order-interleave'].map(n=>'apps/api/test/'+n+'.test.ts');
console.log(JSON.stringify({executor:'collaboration:/root/formal_cards_activity_round1',database:{host:parsed.hostname,port:parsed.port,name:parsed.pathname},schema,PGOPTIONS:`-c search_path=${schema}`,files}));
try {
 const child=spawn(process.execPath,['--test-concurrency=1','--test',...files],{stdio:'inherit',env:{...process.env,PGOPTIONS:`-c search_path=${schema}`}});
 const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
 const code=await new Promise(resolve=>child.on('exit',code=>resolve(code)));clearTimeout(timer);
 console.log(JSON.stringify({testExit:code}));process.exitCode=code??1;
}finally {await admin.query(`DROP SCHEMA "${schema}" CASCADE`);await admin.end();console.log(JSON.stringify({cleanup:'own schema dropped'}));}
