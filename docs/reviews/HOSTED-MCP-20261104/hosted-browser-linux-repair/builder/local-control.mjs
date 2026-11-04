// Bounded local execution control, never imported by product/test source.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=process.cwd(), evidence=fileURLToPath(new URL('./',import.meta.url));
const statePath=path.join(evidence,'private-state-location.txt');
const run=async(command,args,{env={},capture=false}={})=>{await fs.appendFile(path.join(evidence,'execution-commands.jsonl'),JSON.stringify({command,args,cwd:root,envNames:Object.keys(env),capture})+'\n');return new Promise((resolve,reject)=>{let out='';const p=spawn(command,args,{env:{...process.env,...env},stdio:['ignore',capture?'pipe':'inherit',capture?'pipe':'inherit']});if(capture){p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);}p.on('error',reject);p.on('close',code=>resolve({code,out}));});};
const docker=(args,options)=>run('docker',args,options);
const mode=process.argv[2];
if(mode==='prepare'){
 const dir=await fs.mkdtemp('/private/tmp/flowboard-browser-repair-');
 const source=path.join(dir,'source');await fs.mkdir(source);
 const files=execFileSync('git',['ls-files'],{encoding:'utf8'}).trim().split('\n').filter(p=>!p.startsWith('docs/')&&!p.startsWith('artifacts/')&&!p.startsWith('graphify-out/'));
 for(const file of [...files,'scripts/e2e/hosted-mcp-browser-diagnostics.mjs','scripts/e2e/hosted-mcp-browser-diagnostics.test.mjs']){await fs.mkdir(path.dirname(path.join(source,file)),{recursive:true});await fs.copyFile(path.join(root,file),path.join(source,file));}
 for(const p of ['node_modules','apps/api/node_modules','apps/web/node_modules','packages/contracts/node_modules','packages/mcp/node_modules','packages/mcp/dist','apps/api/dist','apps/web/.next'])await fs.mkdir(path.join(source,p),{recursive:true});
 execFileSync('git',['init','-q'],{cwd:source});execFileSync('git',['add','-f','.'],{cwd:source});
 const state={dir,source,password:crypto.randomBytes(32).toString('hex'),pg:'flowboard-browser-repair-pg-20261104',image:'mcr.microsoft.com/playwright:v1.64.1-noble',volume:'flowboard-xlsx-product-deps-20261104'};
 await fs.writeFile(path.join(dir,'state.json'),JSON.stringify(state),{mode:0o600});await fs.writeFile(statePath,path.join(dir,'state.json')+'\n');
 const before=Object.fromEntries(await Promise.all([...new Set(files.concat(['scripts/e2e/hosted-mcp-browser-diagnostics.mjs','scripts/e2e/hosted-mcp-browser-diagnostics.test.mjs']))].sort().map(async p=>[p,crypto.createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')])));
 await fs.writeFile(path.join(evidence,'held-source.json'),JSON.stringify(before,null,2)+'\n');
 console.log(JSON.stringify({prepared:true,files:Object.keys(before).length,source}));process.exit(0);
}
const state=JSON.parse(await fs.readFile((await fs.readFile(statePath,'utf8')).trim(),'utf8'));
const report=path.join(evidence,mode==='mac-bad-executable'?'mac-bad-executable-held':mode);const mounts=['--env','GIT_CONFIG_COUNT=1','--env','GIT_CONFIG_KEY_0=safe.directory','--env','GIT_CONFIG_VALUE_0=/workspace','--mount',`type=bind,src=${state.source},dst=/workspace,readonly`,'--mount',`type=volume,src=${state.volume},dst=/workspace/node_modules,readonly`,'--mount',`type=bind,src=${evidence},dst=/evidence`];
for(const [suffix,target]of [['api','apps/api/node_modules'],['web','apps/web/node_modules'],['contracts','packages/contracts/node_modules'],['mcp','packages/mcp/node_modules'],['mcp-dist','packages/mcp/dist'],['api-build','apps/api/dist']])mounts.push('--mount',`type=volume,src=${state.volume}-${suffix},dst=/workspace/${target},readonly`);
mounts.push('--mount',`type=bind,src=${path.join(state.dir,'node-runtime/node')},dst=/usr/local/bin/node,readonly`);
mounts.push('--mount',`type=bind,src=${path.join(state.dir,'next-cache')},dst=/workspace/apps/web/.next`);
if(mode==='pg'){
 await fs.mkdir(path.join(state.dir,'next-cache'),{recursive:true});
 const r=await docker(['run','-d','--name',state.pg,'-p','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=flowboard_harness','--env','POSTGRES_DB=flowboard_ui_test','postgres:17.11-alpine'],{env:{POSTGRES_PASSWORD:state.password}});if(r.code)process.exit(r.code);
 const p=await docker(['port',state.pg,'5432/tcp'],{capture:true});state.port=Number(p.out.trim().split(':').at(-1));await fs.writeFile((await fs.readFile(statePath,'utf8')).trim(),JSON.stringify(state),{mode:0o600});console.log(JSON.stringify({started:true,port:state.port}));
}else if(mode==='mac'||mode==='mac-bad-executable'){
 await fs.mkdir(report);const env={FLOWBOARD_UI_TEST_DATABASE_URL:`postgres://flowboard_harness:${state.password}@127.0.0.1:${state.port}/flowboard_ui_test`,FLOWBOARD_HOSTED_UI_REPORT_DIR:path.join(report,'report'),NEXT_DIST_DIR:'.next'};
 if(mode==='mac-bad-executable')env.FLOWBOARD_CHROME_EXECUTABLE='/nonexistent/flowboard-test-browser';else delete process.env.FLOWBOARD_CHROME_EXECUTABLE;
 const r=await run('npm',['run','test:hosted-mcp-browser'],{env});console.log(JSON.stringify({mode,exit:r.code}));process.exitCode=r.code;
}else if(mode==='preflight'){
 const r=await docker(['run','--rm','--network','none',...mounts,'-w','/workspace',state.image,'bash','-lc','set -euo pipefail; node -v && git --version && node -p "require(\'@playwright/test/package.json\').version" && node -p "require.resolve(\'next/dist/bin/next\')" && node apps/api/scripts/dependency-patches.mjs --verify && git ls-files apps/web/src | wc -l']);process.exitCode=r.code;
}else if(mode==='identity'){
 const r=await docker(['run','--rm','--network','none',...mounts,'-w','/workspace',state.image,'node','/evidence/linux-identity.mjs']);process.exitCode=r.code;
}else if(mode==='linux'){
 await fs.mkdir(report);const env={FLOWBOARD_UI_TEST_DATABASE_URL:`postgres://flowboard_harness:${state.password}@127.0.0.1:5432/flowboard_ui_test`};
 const r=await docker(['run','--rm','--name','flowboard-browser-repair-linux-20261104','--network',`container:${state.pg}`,'--ipc=host',...mounts,'-w','/workspace','--env','FLOWBOARD_UI_TEST_DATABASE_URL','--env','FLOWBOARD_HOSTED_UI_REPORT_DIR=/evidence/linux/report','--env','NEXT_DIST_DIR=.next',state.image,'npm','run','test:hosted-mcp-browser'],{env});console.log(JSON.stringify({mode,exit:r.code}));process.exitCode=r.code;
}else if(mode==='red'){
 const r=await docker(['run','--rm','--network','none',...mounts,'-w','/workspace','node:24.15.0-bookworm-slim','node','/evidence/baseline-launch-linux.mjs']);console.log(JSON.stringify({mode,exit:r.code}));process.exitCode=r.code;
}else if(mode==='cleanup'){
 const r=await docker(['exec',state.pg,'psql','-U','flowboard_harness','-d','flowboard_ui_test','-tAc',"SELECT count(*) FROM pg_namespace WHERE nspname LIKE 'browser_%'"]);if(r.code)process.exit(r.code);await docker(['stop',state.pg]);await docker(['rm',state.pg]);
}else throw new Error('Unknown bounded operation');
