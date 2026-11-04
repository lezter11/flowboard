import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync,spawn} from 'node:child_process';import pg from 'pg';
const base='docs/reviews/HOSTED-MCP-20261104/independent-backend-review';
const privatePath='/private/tmp/flowboard-hosted-independent-gate.json';
const mode=process.argv[2];
const names={DATABASE_URL:'flowboard_harness',FLOWBOARD_ACCESS_TEST_DATABASE_URL:'flowboard_access_test',FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL:'flowboard_identity_extra_test',FLOWBOARD_IMPORT_TEST_DATABASE_URL:'flowboard_import_test'};
function docker(args,env){const r=spawnSync('docker',args,{env,encoding:'utf8',timeout:120000});if(r.status!==0)throw new Error('Disposable review Docker command failed.');return r.stdout.trim();}
const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):e.isFile()?[p+'/'+e.name]:[]);
const sourceFiles=()=>[...['apps/api/src','apps/api/test','apps/api/scripts','packages/contracts/src','packages/contracts/test','packages/mcp/src','packages/mcp/test','packages/mcp/scripts','database/migrations'].flatMap(walk),...['package.json','package-lock.json','tsconfig.json','apps/api/package.json','apps/api/tsconfig.build.json','apps/api/wrangler.jsonc','packages/contracts/package.json','packages/mcp/package.json','packages/mcp/tsconfig.json','packages/mcp/tsconfig.test.json','scripts/generate-openapi.ts','scripts/sync-embedded-migrations.ts','docs/openapi.json','docs/HOSTED_MCP_SPEC.md','docs/reviews/HOSTED-MCP-20261104/backend/criteria.json','docs/reviews/HOSTED-MCP-20261104/backend/run-focused.mjs',base+'/backend-criteria.json',base+'/backend-phase.md',base+'/adversarial.test.mjs',base+'/run-backend-gate.mjs']].sort();
function snapshot(){return Object.fromEntries(sourceFiles().map(p=>[p,hash(p)]));}
if(mode==='prepare'){
  if(fs.existsSync(privatePath))throw new Error('An independent review harness checkpoint already exists; inspect before replacement.');
  const container='flowboard-hosted-independent-'+process.pid,image='postgres:17.11-alpine',password=crypto.randomBytes(32).toString('hex');
  docker(['run','--detach','--rm','--name',container,'--publish','127.0.0.1::5432','--env','POSTGRES_USER=flowboard_harness','--env','POSTGRES_DB=flowboard_harness','--env','POSTGRES_PASSWORD',image],{...process.env,POSTGRES_PASSWORD:password});
  let ready=false;
  try{
    const binding=docker(['port',container,'5432/tcp']);const port=Number(binding.split(':').at(-1));if(!/^127\.0\.0\.1:\d+$/.test(binding)||!port)throw new Error('Review database must bind only dynamic loopback.');
    const values=Object.fromEntries(Object.entries(names).map(([key,db])=>[key,`postgresql://flowboard_harness:${password}@127.0.0.1:${port}/${db}`]));
    let admin;
    for(let i=0;i<60;i++){admin=new pg.Client({connectionString:values.DATABASE_URL,connectionTimeoutMillis:1000});try{await admin.connect();ready=true;break;}catch{await admin.end().catch(()=>{});await new Promise(resolve=>setTimeout(resolve,250));}}
    if(!ready)throw new Error('Disposable review PostgreSQL did not become ready.');
    for(const db of Object.values(names).slice(1))await admin.query(`CREATE DATABASE "${db}" OWNER flowboard_harness`);await admin.end();
    const imageIdentity=docker(['image','inspect',image,'--format','{{.Id}}']);
    fs.writeFileSync(privatePath,JSON.stringify({container,image,port,values}),{mode:0o600});
    fs.writeFileSync(`${base}/gate-harness.json`,JSON.stringify({createdAt:new Date().toISOString(),container,image,imageIdentity,port,bind:'127.0.0.1',hostVolumes:false,databases:Object.values(names)},null,2)+'\n');console.log(JSON.stringify({prepared:true,container,image,port,databases:4,hostVolumes:false}));
  }catch(error){docker(['rm','--force',container]);throw error;}
}else if(mode==='tests'){
  const config=JSON.parse(fs.readFileSync(privatePath,'utf8'));const env={...process.env,...config.values,NODE_ENV:'test',WRANGLER_SEND_METRICS:'false'};delete env.PGOPTIONS;
  const before=snapshot();fs.writeFileSync(`${base}/gate-source-before.json`,JSON.stringify({observedAt:new Date().toISOString(),files:before},null,2)+'\n');
  const criteria=JSON.parse(fs.readFileSync(`${base}/backend-criteria.json`,'utf8'));const results=[];
  for(const [id,command] of Object.entries(criteria.requiredTests)){
    const output=fs.openSync(`${base}/gate-${id}.log`,'w');const startedAt=new Date().toISOString();console.log(JSON.stringify({starting:id,command}));
    const exitCode=await new Promise(resolve=>{const child=spawn(command,{shell:true,env,stdio:['ignore',output,output]});child.on('error',()=>resolve(1));child.on('exit',code=>resolve(code??1));});fs.closeSync(output);
    const result={id,command,exitCode,startedAt,completedAt:new Date().toISOString(),environment:`Disposable PostgreSQL17.11 container ${config.container} on loopback:${config.port}; actual Node/workerd where exercised.`,isolatedSynthetic:true,evidencePath:`${base}/gate-${id}.log`};results.push(result);fs.writeFileSync(`${base}/gate-test-results.json`,JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({finished:id,exitCode}));
    if(exitCode!==0){console.log('Required check failed; remaining commands remain unexecuted until diagnosis.');break;}
  }
  const after=snapshot();const paths=[...new Set([...Object.keys(before),...Object.keys(after)])];const changed=paths.filter(p=>before[p]!==after[p]);fs.writeFileSync(`${base}/gate-source-after.json`,JSON.stringify({observedAt:new Date().toISOString(),files:after,changedSourceFiles:changed},null,2)+'\n');console.log(JSON.stringify({checksExecuted:results.length,checksRequired:Object.keys(criteria.requiredTests).length,changedSourceFiles:changed}));process.exitCode=changed.length||results.length!==Object.keys(criteria.requiredTests).length||results.some(r=>r.exitCode!==0)?1:0;
}else if(mode==='cleanup'){
  const config=JSON.parse(fs.readFileSync(privatePath,'utf8'));docker(['stop','--time','10',config.container]);fs.unlinkSync(privatePath);fs.writeFileSync(`${base}/gate-cleanup.json`,JSON.stringify({completedAt:new Date().toISOString(),container:config.container,stopped:true,autoRemoved:true,privateConfigurationDeleted:true},null,2)+'\n');console.log(JSON.stringify({cleaned:true,container:config.container}));
}else throw new Error('Specify prepare, tests or cleanup.');
