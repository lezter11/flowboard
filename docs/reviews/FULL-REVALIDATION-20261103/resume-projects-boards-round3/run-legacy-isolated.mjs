import pg from 'pg';
import {spawn} from 'node:child_process';
import crypto from 'node:crypto';
const schema='pb_round3_'+crypto.randomUUID().replaceAll('-','');
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});
const files=['prj01-projects','prj02-prj05','brd01-brd07','rbac-advanced','b18-own-projects','b18-backstops-session','b22-invitation-caps','inv01-inv03','inv04-inv08','inv06-inv07'];
try{
 await pool.query(`CREATE SCHEMA "${schema}"`);console.log(JSON.stringify({kind:'independent isolated legacy suite',schema,files,port:new URL(process.env.DATABASE_URL).port}));
 const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['--test-concurrency=1','--test',...files.map(f=>'apps/api/test/'+f+'.test.ts')],{env:{...process.env,PGOPTIONS:`-c search_path=${schema}`},stdio:'inherit'});child.on('error',reject);child.on('exit',resolve);});
 process.exitCode=code??1;
}finally{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();}
