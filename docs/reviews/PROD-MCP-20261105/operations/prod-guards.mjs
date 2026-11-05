// PREPARED ONLY. No import-time network or database work; root executes reviewed helpers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

export const PROD = Object.freeze({projectId:'misty-unit-76664549',branchId:'br-orange-union-a1kqetvn',host:'ep-patient-frost-a1kvcqki.ap-southeast-1.aws.neon.tech',database:'neondb',role:'neondb_owner'});
export const CLI = '/Users/shubham/.npm/_npx/c58b2a555394695b/node_modules/neonctl/bin/cli.js';
export const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
export const safeEnv = () => ({...Object.fromEntries(Object.entries(process.env).filter(([key]) => ['HOME','PATH','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].includes(key))),NODE_OPTIONS:'--dns-result-order=ipv4first'});
export function safeFailure(error) {return {errorClass:/^[A-Za-z]{1,40}$/.test(error?.name??'')?error.name:'Error',safeCode:/^[A-Z0-9_]{1,35}$/.test(error?.code??'')?error.code:undefined,childExit:Number.isInteger(error?.status)?error.status:undefined};}
export function classifyCreateFailure(error) {
  // Inspect bounded captured diagnostics privately; return only a fixed classification.
  const privateText = String(error?.stderr??'') + String(error?.stdout??'');
  return /(?:branch.{0,100}(?:limit|quota)|(?:maximum|limit|quota).{0,100}branch|branches_limit_exceeded)/is.test(privateText)?'branch-quota-blocked':'creation-failed';
}
export function parseArgs(allowed,input=process.argv.slice(2)) {const result={};assert.equal(input.length%2,0);for(let i=0;i<input.length;i+=2){assert.ok(input[i].startsWith('--'));const key=input[i].slice(2);assert.ok(allowed.includes(key)&&!Object.hasOwn(result,key),'unknown/duplicate argument');assert.ok(input[i+1]);result[key]=input[i+1];}for(const key of allowed)assert.ok(result[key],'missing required argument');return result;}
export async function requireNewReceipt(file) {assert.ok(path.isAbsolute(file));const parent=await fs.realpath(path.dirname(file));assert.equal(parent,path.dirname(file),'receipt parent must be canonical');assert.ok((await fs.lstat(parent)).isDirectory());try{await fs.lstat(file);}catch(error){if(error.code==='ENOENT')return;throw error;}throw new Error('ReceiptExists');}
export async function writeReceipt(file,value) {await fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
export const cliJson = args => {const raw=execFileSync(process.execPath,[CLI,...args,'--output','json','--no-analytics'],{env:safeEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:4*1024*1024});return JSON.parse(raw);};
export const branch = id => {const response=cliJson(['api','/projects/'+PROD.projectId+'/branches/'+id]);return response.branch??response;};
export function verifyProductionBranch(value) {assert.equal(value.id,PROD.branchId);assert.equal(value.name,'production');assert.ok(!value.deleted_at);return value;}
export function verifyBackupBranch(value,expectedName,now=Date.now()) {
  assert.match(value.id??'',/^br-[a-z0-9-]+$/);assert.notEqual(value.id,PROD.branchId);assert.equal(value.parent_id,PROD.branchId);assert.equal(value.name,expectedName);assert.match(expectedName,/^production-backup-2026-11-05-mcp-pre-[a-f0-9]{12}$/);assert.equal(value.current_state,'ready');
  const age=now-Date.parse(value.created_at);assert.ok(Number.isFinite(age)&&age>=-5000&&age<=30*60*1000,'backup branch must be newly created within30minutes');assert.ok(!value.deleted_at);
  return {id:value.id,parentId:value.parent_id,name:value.name,currentState:value.current_state,createdAt:value.created_at,parentLsn:value.parent_lsn??null,parentTimestamp:value.parent_timestamp??null};
}
export function verifyBackupReceipt(receipt,sha,now=Date.now()) {
  assert.equal(receipt.kind,'production-data-branch-backup');assert.equal(receipt.status,'pass');assert.equal(receipt.exitCode,0);assert.equal(receipt.projectId,PROD.projectId);assert.equal(receipt.parentBranchId,PROD.branchId);assert.equal(receipt.sourceCommit,sha);assert.equal(receipt.schemaOnly,false);assert.equal(receipt.computeCreated,false);assert.equal(receipt.verifiedEndpointCount,0);
  const age=now-Date.parse(receipt.completedAt);assert.ok(Number.isFinite(age)&&age>=0&&age<=30*60*1000,'successful backup receipt must be <=30minutes old');assert.ok(receipt.backupBranch);return receipt;
}
export function verifyLedger(rows,expected,count) {assert.equal(rows.length,count,'unexpected ledger length; no automatic resume');for(let i=0;i<count;i++){assert.equal(rows[i].version,expected[i].version);assert.equal(rows[i].name,expected[i].name);}return rows;}
export async function inventory(dir,expected) {
  const entries=await fs.readdir(dir,{withFileTypes:true});const relevant=entries.filter(entry=>/^(\d+)_([a-zA-Z0-9_\-]+)\.sql$/.test(entry.name));
  assert.ok(relevant.every(entry=>entry.isFile()&&!entry.isSymbolicLink()),'matching migration path must be a regular file');
  const names=relevant.map(entry=>entry.name).sort((a,b)=>a.localeCompare(b));assert.deepEqual(names,expected.map(item=>item.name),'actual runner migration inventory differs');
  for(const item of expected)assert.equal(sha256(await fs.readFile(path.join(dir,item.name))),item.sha256,'migration bytes differ');return names;
}
export async function candidateGuard(candidate,sha) {
  assert.match(sha,/^[a-f0-9]{40}$/);const root=await fs.realpath(candidate);assert.ok(root.startsWith('/private/tmp/flowboard-'),'isolated private/tmp candidate required');
  const expected=JSON.parse(await fs.readFile(new URL('./migration-manifest.json',import.meta.url),'utf8'));assert.equal(expected.files.length,27);for(let i=0;i<27;i++)assert.equal(expected.files[i].version,String(i+1).padStart(4,'0'));
  const git=args=>execFileSync('git',args,{cwd:root,env:safeEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  async function recheck(){assert.equal(git(['rev-parse','HEAD']),sha);assert.equal(git(['status','--porcelain']),'','candidate must be clean');assert.equal(spawnSync('git',['symbolic-ref','-q','HEAD'],{cwd:root,env:safeEnv(),stdio:'ignore'}).status,1,'detached candidate required');await inventory(path.join(root,'database/migrations'),expected.files);
    for(const item of expected.files)assert.equal(sha256(execFileSync('git',['show',sha+':database/migrations/'+item.name],{cwd:root,env:safeEnv(),stdio:['ignore','pipe','pipe']})),item.sha256,'migration commit differs');}
  await recheck();const require=createRequire(path.join(root,'package.json'));return {root,sha,expected:expected.files,pg:require('pg'),recheck};
}
export async function connection() {
  verifyProductionBranch(branch(PROD.branchId));const response=cliJson(['api','/projects/'+PROD.projectId+'/endpoints']);const endpoints=(response.endpoints??response).filter(item=>item.branch_id===PROD.branchId&&item.type==='read_write');assert.equal(endpoints.length,1);assert.equal(endpoints[0].host,PROD.host);
  const raw=execFileSync(process.execPath,[CLI,'connection-string',PROD.branchId,'--project-id',PROD.projectId,'--database-name',PROD.database,'--role-name',PROD.role,'--output','json','--no-analytics'],{env:safeEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000,maxBuffer:1024*1024});
  let uri;try{const parsed=JSON.parse(raw);uri=typeof parsed==='string'?parsed:parsed.uri??parsed.connection_string;}catch{uri=raw.trim();}
  const url=new URL(uri);assert.ok(['postgres:','postgresql:'].includes(url.protocol));assert.equal(url.hostname,PROD.host);assert.equal(url.port||'5432','5432');assert.equal(url.pathname,'/'+PROD.database);assert.equal(url.username,PROD.role);assert.ok(!url.hostname.includes('-pooler'));assert.ok(url.password);url.searchParams.set('sslmode','verify-full');return {url,endpointId:endpoints[0].id};
}
const COUNT_TABLES=['users','workspaces','projects','boards','columns','cards','comments','notifications','outbox','card_image_uploads','card_images','project_links','board_grants','card_imports','card_import_rows','rate_limit_windows'];
export async function counts(client){const result={};for(const table of COUNT_TABLES){const value=await client.query('SELECT COUNT(*)::text AS count FROM '+table);result[table]=value.rows[0].count;}return result;}
export async function identity(client) {const value=(await client.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version")).rows[0];assert.equal(value.database,PROD.database);assert.equal(value.role,PROD.role);assert.match(value.version,/^18\./);return value;}
export async function normalizedColumnConflicts(client) {const result=await client.query('SELECT COUNT(*)::int AS conflicts FROM (SELECT board_id,LOWER(BTRIM(name)) FROM columns GROUP BY board_id,LOWER(BTRIM(name)) HAVING COUNT(*)>1) AS conflicting_groups');assert.equal(result.rows[0].conflicts,0,'normalized column names conflict; no migration permitted');return 0;}
