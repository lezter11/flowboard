import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { HonoRequest } from 'hono/request';
const here=new URL('.',import.meta.url),origin='https://flowboard-app.pages.dev';
const {createApp:defaultCreate}=await import(new URL('current-app.mjs',here));
const {createApp:trieCreate}=await import(new URL('current-trie-app.mjs',here));
process.env.NODE_ENV='test';let unexpectedQueries=0;
const options={pool:{query(){unexpectedQueries++;throw new Error('Unexpected database call');}},storage:null};
const a=defaultCreate(async()=>{},options),b=trieCreate(async()=>{},options);const env={APP_ORIGIN:origin};
function signature(app,method,path){const match=app.router.match(method,path),request=new HonoRequest(new Request(origin+path,{method}),path,match);return match[0].map((entry,index)=>{request.routeIndex=index;const params=Object.fromEntries(Object.entries(request.param()).sort(([a],[b])=>a.localeCompare(b)));return {routeIndex:app.routes.indexOf(entry[0][1]),params};});}
let decodedCases=0;for(const route of a.routes){if(!route.path.includes(':'))continue;const path=route.path.replace(/:([\w]+)/g,(_,name)=>'value_'+name+'%20encoded').replaceAll('*','fixture');for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD']){assert.deepEqual(signature(a,method,path),signature(b,method,path));decodedCases++;}}
const paths=['/health/live','/health/live/','/api/v1/session','/api/v1/session/','/api/v1/mcp','/api/v1/mcp/','/api/v1/mcp/child','/api/v1/mcp/oauth/register','/api/v1/mcp/oauth/register/','/api/v1/mcp/oauth/token','/.well-known/oauth-authorization-server','/.well-known/oauth-authorization-server/'];
const results=[];
for(const path of paths)for(const method of ['GET','POST','DELETE','OPTIONS','HEAD','PUT']){
 const init={method,headers:{accept:'application/json, text/event-stream',origin,'x-request-id':'synthetic-parity'}};if(!['GET','HEAD','OPTIONS'].includes(method)){init.headers['content-type']='application/json';init.body='{}';}
 const summarize=async(app)=>{const r=await app.fetch(new Request(origin+path,init),env);return {status:r.status,body:await r.text(),headers:Object.fromEntries([...r.headers].filter(([k])=>!['server-timing','x-response-time'].includes(k)))};};
 const actual=await summarize(a),candidate=await summarize(b);assert.deepEqual(candidate,actual,method+' '+path);results.push({method,path,status:actual.status});
}
assert.equal(unexpectedQueries,0);
const result={status:'pass',decodedParameterCases:decodedCases,mountedAnonymousCases:results.length,allStatusBodySecurityHeadersEqual:true,unexpectedDatabaseCalls:unexpectedQueries,liveCalls:0,results,limits:'Synthetic Node no-DB negative/public paths only. Does not replace mounted PostgreSQL authorization/concurrency/runtime regression suites.'};await fs.writeFile(new URL('mounted-router-parity.json',here),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
