// Reviewed fixed command list; disposable local data only. Never deploys or pushes.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../../../../',import.meta.url));
const base=path.join(root,'docs/reviews/FULL-REVALIDATION-20261103');
const run=process.env.FLOWBOARD_GATE_RUN??'final-local-gates-1';
assert.match(run,/^[a-z0-9-]+$/);
const output=path.join(base,'raw',run);await fs.mkdir(output,{recursive:false});
assert.equal(process.env.NODE_ENV,'test');
assert.notEqual(process.env.ALLOW_REMOTE_DB,'true');
const databases={DATABASE_URL:'flowboard_harness',FLOWBOARD_ACCESS_TEST_DATABASE_URL:'flowboard_access_test',FLOWBOARD_IMPORT_TEST_DATABASE_URL:'flowboard_import_test',FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL:'flowboard_identity_extra_test',FLOWBOARD_UI_TEST_DATABASE_URL:'flowboard_ui_test',FLOWBOARD_MCP_TEST_DATABASE_URL:'flowboard_mcp_probe'};
const databaseEvidence={};let port;
for(const [key,name]of Object.entries(databases)){
  assert.ok(process.env[key],`Missing ${key}`);const u=new URL(process.env[key]);
  assert.ok(['postgres:','postgresql:'].includes(u.protocol));assert.equal(u.hostname,'127.0.0.1');assert.equal(u.username,'flowboard_harness');assert.equal(u.pathname,'/'+name);assert.equal(u.search,'');assert.ok(u.port&&!['55432','55479'].includes(u.port));
  port??=u.port;assert.equal(u.port,port);databaseEvidence[key]={host:u.hostname,port:u.port,database:name,user:u.username};
}
const sourcePrefixes=['apps/','database/','packages/','scripts/','.github/'];
// Mutable execution status is captured separately so writing truthful progress or
// generated handoffs cannot invalidate approval of unchanged functional source.
const statusNames=['TASKS.md','PROGRESS.md','docs/FEATURE_CHECKLIST.md'];
const sourceNames=new Set(['AGENTS.md','RULES.md','BACKEND_REVIEW_GATE.md','PRD.md','ARCHITECTURE.md','DESIGN.md','package.json','package-lock.json','tsconfig.json','.node-version','.gitignore','docs/API.md','docs/FEATURE_SPEC.md','docs/IMPORT_SPEC.md','docs/features.tsv','docs/ENGINEERING_CHECKLIST.md','docs/references/README.md','docs/handoffs/README.md','docs/openapi.json','docs/SECURITY_ROADMAP.md','docs/reviews/README.md']);
sourceNames.add(path.relative(root,fileURLToPath(import.meta.url)));
sourceNames.add('docs/reviews/FULL-REVALIDATION-20261103/round4-repair/criteria.json');
sourceNames.add('docs/reviews/FULL-REVALIDATION-20261103/round4-repair/criteria-amendment-before-implementation.md');
async function sourceManifest(){
  const listed=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const selected=[...new Set(listed.filter(p=>sourceNames.has(p)||sourcePrefixes.some(prefix=>p.startsWith(prefix))||p.startsWith('docs/reviews/FULL-REVALIDATION-20261103/criteria/')))].sort();
  const files={};for(const p of selected){const full=path.join(root,p);assert.equal((await fs.lstat(full)).isSymbolicLink(),false,`Source symlink: ${p}`);files[p]=crypto.createHash('sha256').update(await fs.readFile(full)).digest('hex');}
  return{files,digest:crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex')};
}
const before=await sourceManifest();await fs.writeFile(path.join(output,'source-before.json'),JSON.stringify(before,null,2)+'\n');
await fs.writeFile(path.join(output,'status-before.json'),JSON.stringify(Object.fromEntries(await Promise.all(statusNames.map(async p=>[p,crypto.createHash('sha256').update(await fs.readFile(path.join(root,p))).digest('hex')]))),null,2)+'\n');
const container='flowboard-full-revalidation-20261103';
const containerImage=execFileSync('docker',['inspect','--format','{{.Config.Image}} {{.Image}}',container],{encoding:'utf8'}).trim();
const ports=JSON.parse(execFileSync('docker',['inspect','--format','{{json .NetworkSettings.Ports}}',container],{encoding:'utf8'}));
assert.ok(ports['5432/tcp']?.some(p=>p.HostIp==='127.0.0.1'&&p.HostPort===port),'Disposable database listener does not match owned container');
const report={kind:'local readiness evidence; no feature closure, provider or UAT approval',startedAt:new Date().toISOString(),baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),sourceDigest:before.digest,sourceFileCount:Object.keys(before.files).length,node:process.version,npm:execFileSync('npm',['--version'],{encoding:'utf8'}).trim(),container,containerImage,databaseEvidence,commands:[]};
const steps=[
  ['typecheck',['run','typecheck']],['typecheck-web',['run','typecheck:web']],
  ['contracts',['test','--workspace','@flowboard/contracts']],['web',['test','--workspace','@flowboard/web']],
  ['mcp',['test','--workspace','@flowboard/mcp']],['build-mcp',['run','build','--workspace','@flowboard/mcp']],['mcp-artifact',['run','test:artifact','--workspace','@flowboard/mcp']],
  ['openapi-staleness',['run','openapi:check']],['embedded-migration-parity',['run','migrations:embed:check']],
  ['api',['test','--workspace','@flowboard/api']],['build-worker',['run','build','--workspace','@flowboard/api']],
  ['build-web',['run','build:web']],['browser-integration',['run','test:browser']],['mcp-integration',['run','test:mcp-integration']],
];
async function save(){await fs.writeFile(path.join(output,'commands.json'),JSON.stringify(report,null,2)+'\n');}
let failed=false;
for(const [id,args]of steps){
  const check=await sourceManifest();if(check.digest!==before.digest){report.sourceChangedBefore=id;failed=true;break;}
  const log=path.join(output,id+'.log'),handle=await fs.open(log,'wx');
  const command={id,command:'npm '+args.join(' '),startedAt:new Date().toISOString(),evidencePath:path.relative(root,log)};report.commands.push(command);await save();
  const env={...process.env,NEXT_EXPORT:'true',NEXT_TELEMETRY_DISABLED:'1',WRANGLER_SEND_METRICS:'false',FLOWBOARD_BROWSER_REPORT_DIR:path.join(output,'browser'),FLOWBOARD_PROBE_REPORT:path.join(output,'mcp-integration.json'),FLOWBOARD_RUNTIME_EVIDENCE_PATH:path.join(output,'runtime-validation.json'),FLOWBOARD_AUTH_MATRIX_EVIDENCE_PATH:path.join(output,'route-auth-matrix.json'),FLOWBOARD_COOKIE_MATRIX_EVIDENCE_PATH:path.join(output,'cookie-mutation-matrix.json')};
  const child=spawn('npm',args,{cwd:root,env,stdio:['ignore',handle.fd,handle.fd]});
  const result=await new Promise(resolve=>{child.once('error',error=>resolve({exitCode:null,errorClass:error.name}));child.once('exit',(code,signal)=>resolve({exitCode:code,signal}));});
  await handle.close();Object.assign(command,result,{completedAt:new Date().toISOString()});
  const text=await fs.readFile(log,'utf8');command.nodeTestCounts=Object.fromEntries([...text.matchAll(/^ℹ (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
  await save();console.log(JSON.stringify({id,...result,counts:command.nodeTestCounts}));
  if(result.exitCode!==0){failed=true;break;}
}
const after=await sourceManifest();await fs.writeFile(path.join(output,'source-after.json'),JSON.stringify(after,null,2)+'\n');
report.completedAt=new Date().toISOString();report.sourceUnchanged=after.digest===before.digest;report.status=!failed&&report.sourceUnchanged&&report.commands.length===steps.length?'pass':'fail';await save();
if(report.status!=='pass')process.exitCode=1;
