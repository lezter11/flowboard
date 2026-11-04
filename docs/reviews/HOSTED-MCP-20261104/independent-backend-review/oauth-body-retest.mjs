import fs from 'node:fs';import assert from 'node:assert/strict';import pg from 'pg';
import {createApp} from '../../../../apps/api/src/http/app.ts';import {getPool,setGlobalPool,closePool} from '../../../../apps/api/src/adapters/postgres.ts';
if(!process.env.DATABASE_URL)Object.assign(process.env,JSON.parse(fs.readFileSync('/private/tmp/flowboard-hosted-mcp-test-env.json','utf8')));process.env.NODE_ENV='test';getPool();
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});setGlobalPool(pool);
for(const [bytes,expected] of [[17000,413],[10,504]]){
  let cancelled=false,lifetime;
  const app=createApp(async()=>{},{pool,mcpPublicOrigin:'https://flowboard.example',deadlineMs:30,onMcpWorkLifetime:w=>{lifetime=w;},rateLimiter:()=>undefined,windowCounter:()=>({consume:async()=>({count:1,retryAfterSeconds:60})})});
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(' '.repeat(bytes)));},cancel(){cancelled=true;return new Promise(()=>{});}});
  const response=await Promise.race([app.request('https://flowboard.example/api/v1/mcp/oauth/register',{method:'POST',headers:{'content-type':'application/json'},body,duplex:'half'}),new Promise(resolve=>setTimeout(()=>resolve(null),200))]);
  assert.ok(response,'must refuse unfinished stream before manual close');assert.equal(response.status,expected);assert.equal(cancelled,true);assert.ok(lifetime);await Promise.race([lifetime,new Promise((_,reject)=>setTimeout(()=>reject(new Error('lifetime did not settle')),200))]);
  console.log(JSON.stringify({streamedBytes:bytes,responseBeforeManualClose:true,status:response.status,cancelled,settledDespiteStalledCancel:true}));
}
await closePool();
