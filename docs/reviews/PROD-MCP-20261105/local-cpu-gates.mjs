// Local synthetic gates only. No cloud credentials, services or production databases.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import pg from 'pg';
const base='docs/reviews/PROD-MCP-20261105/cpu-local-gates';fs.mkdirSync(base,{recursive:true});
const privateFile='/private/tmp/flowboard-cpu-gate-private.json',port=60488;
const image='postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const safeEnv=()=>({...Object.fromEntries(Object.entries(process.env).filter(([k])=>['HOME','PATH','TMPDIR','LANG','SSL_CERT_FILE','SSL_CERT_DIR'].includes(k))),NODE_OPTIONS:'--dns-result-order=ipv4first',WRANGLER_SEND_METRICS:'false',WRANGLER_WRITE_LOGS:'false'});
const docker=(args,extra={})=>execFileSync('docker',args,{env:{...safeEnv(),...extra},encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000}).trim();
const names={DATABASE_URL:'flowboard_harness',FLOWBOARD_ACCESS_TEST_DATABASE_URL:'flowboard_access_test',FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL:'flowboard_identity_extra_test',FLOWBOARD_IMPORT_TEST_DATABASE_URL:'flowboard_import_test',FLOWBOARD_UI_TEST_DATABASE_URL:'flowboard_ui_test',FLOWBOARD_MCP_TEST_DATABASE_URL:'flowboard_mcp_probe'};
const snapshot=()=>Object.fromEntries(execFileSync('git',['ls-files','--cached','--others','--exclude-standard','--','apps/api','packages','database/migrations','scripts','package.json','package-lock.json','tsconfig.json'],{encoding:'utf8'}).trim().split('\n').filter(Boolean).sort().map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const mode=process.argv[2];
if(mode==='prepare'){
 assert.ok(!fs.existsSync(privateFile),'Existing private fixture must be inspected');
 const password=crypto.randomBytes(24).toString('hex'),container='flowboard-cpu-20261105-'+process.pid;
 const id=docker(['run','--detach','--rm','--name',container,'--publish',`127.0.0.1:${port}:5432`,'--memory','256m','--cpus','1','--env','POSTGRES_USER=flowboard_harness','--env','POSTGRES_DB=flowboard_harness','--env','POSTGRES_PASSWORD',image],{POSTGRES_PASSWORD:password});
 const values=Object.fromEntries(Object.entries(names).map(([k,name])=>[k,`postgresql://flowboard_harness:${password}@127.0.0.1:${port}/${name}`]));let client,ready=false;
 try {
  for(let i=0;i<60;i++){client=new pg.Client({connectionString:values.DATABASE_URL,connectionTimeoutMillis:1000});try{await client.connect();ready=true;break;}catch{await client.end().catch(()=>{});await new Promise(r=>setTimeout(r,250));}}
  assert.ok(ready,'Disposable PostgreSQL not ready');for(const name of Object.values(names).slice(1))await client.query('CREATE DATABASE '+name+' OWNER flowboard_harness');await client.end();
  fs.writeFileSync(privateFile,JSON.stringify({container,id,port,image,values}),{mode:0o600,flag:'wx'});
  const report={container,id,port,image,imageIdentity:docker(['image','inspect',image,'--format','{{.Id}}']),databases:Object.values(names),bind:'127.0.0.1',memory:'256m',cpus:1,hostVolumes:false,exitCode:0,createdAt:new Date().toISOString()};fs.writeFileSync(base+'/harness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 } catch(error){docker(['rm','--force',container]);throw new Error('Disposable fixture preparation failed; container removed');}
}else if(mode==='tests'){
 const c=JSON.parse(fs.readFileSync(privateFile,'utf8'));assert.equal(c.port,port);const before=snapshot();fs.writeFileSync(base+'/source-before.json',JSON.stringify(before,null,2)+'\n');
 const env={...safeEnv(),...c.values,NODE_ENV:'test'};
 const checks=[['router-boundaries','node --test --test-concurrency=1 apps/api/test/router-boundaries.test.ts'],['typecheck','npm run typecheck'],['contracts','npm test --workspace @flowboard/contracts'],['contract-parity','npm run openapi:check && npm run migrations:embed:check'],['mcp','npm test --workspace @flowboard/mcp && NODE_ENV=production npm run build --workspace @flowboard/mcp && npm run test:artifact --workspace @flowboard/mcp'],['api','npm run test --workspace @flowboard/api'],['native-mcp','npm run test:mcp-integration'],['build','NODE_ENV=production npm run build']];
 const results=[];
 for(const [id,command]of checks){const evidencePath=base+'/'+id+'.log',fd=fs.openSync(evidencePath,'w'),startedAt=new Date().toISOString();console.log(JSON.stringify({starting:id}));const exitCode=await new Promise(resolve=>{const p=spawn(command,{shell:true,env,stdio:['ignore',fd,fd]});p.on('error',()=>resolve(1));p.on('exit',code=>resolve(code??1));});fs.closeSync(fd);results.push({id,command,exitCode,startedAt,completedAt:new Date().toISOString(),evidencePath,environment:`Disposable PostgreSQL17.11 loopback:${port}, source-held Node/workerd; no cloud credentials`,isolatedSynthetic:true});fs.writeFileSync(base+'/results.json',JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({finished:id,exitCode}));if(exitCode!==0)break;}
 const after=snapshot();const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(p=>before[p]!==after[p]);fs.writeFileSync(base+'/source-after.json',JSON.stringify({files:after,changed},null,2)+'\n');console.log(JSON.stringify({commands:results.length,required:checks.length,sourceChanges:changed}));process.exitCode=results.length!==checks.length||results.some(r=>r.exitCode!==0)||changed.length?1:0;
}else if(mode==='cleanup'){
 const c=JSON.parse(fs.readFileSync(privateFile,'utf8'));docker(['stop','--time','10',c.container]);fs.unlinkSync(privateFile);fs.writeFileSync(base+'/cleanup.json',JSON.stringify({container:c.container,stopped:true,autoRemoved:true,privateFixtureRemoved:true,completedAt:new Date().toISOString()},null,2)+'\n');console.log(JSON.stringify({stopped:true,privateFixtureRemoved:true}));
}else throw new Error('Use prepare, tests, or cleanup');
