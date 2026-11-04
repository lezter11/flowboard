import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';
const evidence=new URL('./',import.meta.url),location=(await fs.readFile(new URL('private-config-location.txt',evidence),'utf8')).trim(),config=JSON.parse(await fs.readFile(location,'utf8'));
const docker=async(args,{env={},capture=false,allowFailure=false}={})=>await new Promise((resolve,reject)=>{const p=spawn('docker',args,{env:{...process.env,...env},stdio:['ignore',capture?'pipe':'inherit',capture?'pipe':'inherit']});let out='';if(capture){p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>out+=b);}p.on('error',reject);p.on('close',code=>code&&!allowFailure?reject(Error('docker action failed, exit '+code)):resolve({code,out}));});
const selectedSource=process.argv[2]==='candidate'?config.candidateSource:config.source;const sourceMount=['--mount',`type=bind,src=${selectedSource},dst=/workspace,readonly`],depsMount=['--mount',`type=volume,src=${config.volume},dst=/workspace/node_modules`],caMount=['--mount','type=bind,src=/etc/ssl/cert.pem,dst=/etc/ssl/certs/ca-certificates.crt,readonly'];
for(const src of [config.source,config.candidateSource])if(src)for(const p of ['apps/api','apps/web','packages/contracts','packages/mcp'])await fs.mkdir(path.join(src,p,'node_modules'),{recursive:true});
for(const [label,p] of [['api','apps/api'],['web','apps/web'],['contracts','packages/contracts'],['mcp','packages/mcp']])depsMount.push('--mount',`type=volume,src=${config.volume}-${label},dst=/workspace/${p}/node_modules`);
depsMount.push('--mount',`type=volume,src=${config.volume}-mcp-dist,dst=/workspace/packages/mcp/dist`);
const mode=process.argv[2];
if(mode==='setup'){
await docker(['network','create','--internal',config.network]);await docker(['volume','create',config.volume]);
await docker(['run','-d','--name',config.pgName,'--network',config.network,'-p','127.0.0.1::5432','--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=flowboard_harness','--env','POSTGRES_DB=flowboard_import_test','postgres:17.11-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24'],{env:{POSTGRES_PASSWORD:config.password}});
const port=await docker(['port',config.pgName,'5432/tcp'],{capture:true});config.hostPort=Number(port.out.trim().split(':').at(-1));config.hostUrl=`postgres://flowboard_harness:${config.password}@127.0.0.1:${config.hostPort}/flowboard_import_test`;await fs.writeFile(location,JSON.stringify(config),{mode:0o600});
await docker(['run','--rm','--name','flowboard-xlsx-mounted-install-20261104','--cpus','2',...sourceMount,...depsMount,...caMount,'--workdir','/workspace','--env','npm_config_cache=/tmp/npm-cache','node:24.15.0-bookworm-slim','npm','ci','--ignore-scripts','--no-audit','--no-fund']);
console.log(JSON.stringify({setup:true,pgName:config.pgName,network:config.network,dynamicLoopbackPort:config.hostPort,source:config.source,revision:config.revision}));
}else if(mode==='install'){
await docker(['run','--rm','--name','flowboard-xlsx-mounted-install-20261104','--cpus','2',...sourceMount,...depsMount,...caMount,'--workdir','/workspace','--env','npm_config_cache=/tmp/npm-cache','node:24.15.0-bookworm-slim','npm','ci','--ignore-scripts','--no-audit','--no-fund']);
console.log(JSON.stringify({installed:true,source:config.source,revision:config.revision,hostPort:null,networkInternal:true}));
}else if(mode==='build-mcp'){
await docker(['run','--rm','--name','flowboard-xlsx-mounted-mcp-build-20261104','--network','none','--cpus','2',...sourceMount,...depsMount,...caMount,'--workdir','/workspace','node:24.15.0-bookworm-slim','node','node_modules/typescript/bin/tsc','-p','packages/mcp/tsconfig.json']);
}else if(mode==='baseline'||mode==='candidate'){
const url=`postgres://flowboard_harness:${config.password}@127.0.0.1:5432/flowboard_import_test`;
const args=['run','--rm','--name','flowboard-xlsx-mounted-'+mode+'-20261104','--network',`container:${config.pgName}`,'--cpus',process.env.XLSX_DIAGNOSTIC_CPU_QUOTA??'2','--memory','1g',...sourceMount,...depsMount,...caMount,'--workdir','/workspace/apps/api','--env','DATABASE_URL','--env','FLOWBOARD_IMPORT_TEST_DATABASE_URL','--env','NODE_ENV=test','--env','WRANGLER_SEND_METRICS=false','node:24.15.0-bookworm-slim','node'];
args.push('../../docs/reviews/HOSTED-MCP-20261104/linux-xlsx-investigation/mounted-entry.mjs');
const r=await docker(args,{env:{DATABASE_URL:url,FLOWBOARD_IMPORT_TEST_DATABASE_URL:url},allowFailure:true});console.log(JSON.stringify({mode,exitCode:r.code,revision:config.revision,cpuQuota:process.env.XLSX_DIAGNOSTIC_CPU_QUOTA??'2'}));process.exitCode=r.code;
}else throw Error('mode must be setup, baseline or candidate');
