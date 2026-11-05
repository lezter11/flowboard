import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const here=new URL('.',import.meta.url);
const {createApp:defaultCreate}=await import(new URL('current-app.mjs',here));
const {createApp:linearCreate}=await import(new URL('current-linear-app.mjs',here));
const options={pool:{query(){throw new Error('Unexpected database call');}},storage:null};
const a=defaultCreate(async()=>{},options),b=linearCreate(async()=>{},options);
assert.deepEqual(a.routes.map(r=>[r.method,r.path]),b.routes.map(r=>[r.method,r.path]));
function signature(app,method,path){const match=app.router.match(method,path);return match[0].map(entry=>{const route=entry[0][1],params={};for(const [k,v]of Object.entries(entry[1]).sort(([a],[b])=>a.localeCompare(b)))params[k]=match[1]?match[1][v]:v;return {routeIndex:app.routes.indexOf(route),params};});}
const paths=new Set(['/', '/api/v1/mcp','/api/v1/mcp/child','/api/v1/mcp/oauth','/api/v1/mcp/oauth/token','/.well-known/oauth-authorization-server','/health/live']);
for(const {path}of a.routes){const concrete=path.replace(/:([\w]+)/g,'fixture').replaceAll('*','fixture');paths.add(concrete);paths.add(concrete+'/');paths.add(concrete+'/extra');}
const findings=[];let cases=0;
for(const path of paths)for(const method of ['GET','POST','PUT','PATCH','DELETE','OPTIONS','HEAD','BREW']){cases++;const x=signature(a,method,path),y=signature(b,method,path);if(JSON.stringify(x)!==JSON.stringify(y))findings.push({method,path,default:x,linear:y});}
const result={status:findings.length?'differences-found':'pass',routeEntries:a.routes.length,cases,differences:findings.length,firstDifferences:findings.slice(0,12),allDifferences:findings,limits:'Pure router selection/parameter/order comparison of current source; no live/DB calls, no authenticated behavior acceptance.'};await fs.writeFile(new URL('router-parity.json',here),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
