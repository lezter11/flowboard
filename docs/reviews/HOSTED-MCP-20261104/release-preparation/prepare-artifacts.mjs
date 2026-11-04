// Preparation only. Never uploads, migrates or contacts a database.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
const [candidate,sha,stage]=process.argv.slice(2);
assert.ok(candidate&&stage&&/^[0-9a-f]{40}$/.test(sha??''),'usage: node prepare-artifacts.mjs <clean-detached-candidate> <full-SHA> <new-private-tmp-stage>');
const root=await fs.realpath(candidate),stagePath=path.resolve(stage);
assert.ok(root.startsWith('/private/tmp/flowboard-'),'candidate must be isolated under /private/tmp/flowboard-');
assert.ok(stagePath.startsWith('/private/tmp/flowboard-')&&!stagePath.startsWith(root+'/'),'separate private/tmp stage required');
// Build artifacts must never inherit the test harness's NODE_ENV or database credentials.
const buildEnv=Object.fromEntries(Object.entries(process.env).filter(([key])=>['HOME','PATH','TMPDIR','LANG','SSL_CERT_FILE','SSL_CERT_DIR','NODE_OPTIONS'].includes(key)));
const run=(cmd,args,cwd=root,env={})=>execFileSync(cmd,args,{cwd,env:{...buildEnv,NODE_ENV:'production',NEXT_DIST_DIR:'.next',NEXT_TELEMETRY_DISABLED:'1',WRANGLER_SEND_METRICS:'false',...env},stdio:'inherit'});
const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
assert.equal(git(['rev-parse','HEAD']),sha);assert.equal(git(['status','--porcelain']),'','candidate must be clean');
assert.equal(spawnSync('git',['symbolic-ref','-q','HEAD'],{cwd:root,stdio:'ignore'}).status,1,'candidate must be detached');
await fs.access(root+'/node_modules/.package-lock.json');
const apiConfig=await fs.readFile(root+'/apps/api/wrangler.jsonc','utf8');
assert.ok(apiConfig.includes('7a1e3a69f51e41b1a8c46e0be263b814')&&apiConfig.includes('flowboard-images-uat'));
const pagesConfig=await fs.readFile(root+'/apps/web/wrangler.uat.jsonc','utf8');
assert.ok(pagesConfig.includes('flowboard-api-uat')&&pagesConfig.includes('flowboard-app-uat'));
await fs.mkdir(stagePath,{mode:0o700});
const steps=[];const step=(label,cmd,args,cwd=root,env={})=>{const start=new Date().toISOString();run(cmd,args,cwd,env);steps.push({label,command:[cmd,...args],cwd,startedAt:start,exitCode:0});};
step('MCP package build','npm',['run','build','--workspace','@flowboard/mcp']);
step('API build','npm',['run','build','--workspace','@flowboard/api']);
step('UAT Worker dry-run',process.execPath,[root+'/node_modules/wrangler/bin/wrangler.js','deploy','--env','uat','--dry-run','--outdir','dist/worker-uat'],root+'/apps/api');
// The whitelist excludes all inherited NEXT_PUBLIC_* overrides; the release is same-origin.
step('Next static build','npm',['run','build:web'],root,{NEXT_EXPORT:'true'});
await fs.cp(root+'/apps/web/out',stagePath+'/out',{recursive:true,errorOnExist:true});
step('Recursive Pages Functions staging',process.execPath,[root+'/scripts/stage-pages-functions.mjs',root+'/apps/web',stagePath]);
await fs.copyFile(root+'/apps/web/wrangler.uat.jsonc',stagePath+'/wrangler.jsonc');
assert.equal(git(['status','--porcelain']),'','tracked source changed during build');
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function map(dir){const result={};async function walk(at){for(const e of await fs.readdir(at,{withFileTypes:true})){if(e.name==='node_modules')continue;const p=path.join(at,e.name);if(e.isDirectory())await walk(p);else{assert.ok(e.isFile(),'symlink/unexpected artifact');const b=await fs.readFile(p);result[path.relative(dir,p)]={bytes:b.length,sha256:hash(b)};}}}await walk(dir);return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));}
const worker=await map(root+'/apps/api/dist/worker-uat'),pages=await map(stagePath);
const report={status:'prepared-not-deployed',buildMode:'production',inheritedDatabaseEnvironment:false,sourceCommit:sha,candidate:root,pagesStage:stagePath,steps,worker,pages,workerDigest:hash(JSON.stringify(worker)),pagesDigest:hash(JSON.stringify(pages)),createdAt:new Date().toISOString(),limits:['No deployment, migration, backup or hosted acceptance performed.','Dry-run and builds do not replace the independent/CI release gates.']};
await fs.writeFile(stagePath+'/artifact-manifest.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({status:report.status,sourceCommit:sha,pagesStage:stagePath,workerFiles:Object.keys(worker).length,pagesFiles:Object.keys(pages).length,workerDigest:report.workerDigest,pagesDigest:report.pagesDigest}));
