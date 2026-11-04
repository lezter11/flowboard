import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';

export const UAT=Object.freeze({projectId:'misty-unit-76664549',branchId:'br-polished-term-a172b6x5',host:'ep-shy-fire-a1we7145.ap-southeast-1.aws.neon.tech',database:'neondb',role:'neondb_owner',migration:'0027_hosted_mcp_oauth.sql',migrationSha256:'067ee87e4e41d837e74a15424ba0e0db254989c3f3f05713b3019c539a3a0afd'});
export const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
export const safeEnv=()=>Object.fromEntries(Object.entries(process.env).filter(([k])=>['HOME','PATH','TMPDIR','SSL_CERT_FILE','SSL_CERT_DIR'].includes(k)));
export function args(allowed){const values={};const input=process.argv.slice(2);assert.equal(input.length%2,0);for(let i=0;i<input.length;i+=2){assert.ok(input[i].startsWith('--'));const key=input[i].slice(2);assert.ok(allowed.includes(key)&&!Object.hasOwn(values,key),'unknown/duplicate option');assert.ok(input[i+1]);values[key]=input[i+1];}for(const key of allowed)assert.ok(values[key],`missing --${key}`);return values;}
export function safeFailure(error){return {errorClass:/^[A-Za-z]{1,40}$/.test(error?.name??'')?error.name:'Error',safeCode:/^[A-Z0-9_]{1,35}$/.test(error?.code??'')?error.code:undefined,childExit:Number.isInteger(error?.status)?error.status:undefined};}
export async function writeReceipt(file,report){assert.ok(path.isAbsolute(file));await fs.writeFile(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
export async function requireNewReceipt(file){assert.ok(path.isAbsolute(file));assert.equal((await fs.lstat(path.dirname(file))).isDirectory(),true);try{await fs.lstat(file);}catch(e){if(e.code==='ENOENT')return;throw e;}throw new Error('ReceiptExists');}
export async function candidateGuard(candidate,sha,migrationSha){
  assert.match(sha,/^[a-f0-9]{40}$/);assert.equal(migrationSha,UAT.migrationSha256,'migration bytes differ from prepared reviewed27; require new preparation/review');
  const root=await fs.realpath(candidate);assert.ok(root.startsWith('/private/tmp/flowboard-hosted-release-'),'isolated candidate required');
  const git=a=>execFileSync('git',a,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  assert.equal(git(['rev-parse','HEAD']),sha);assert.equal(git(['status','--porcelain']),'','candidate must be clean');
  assert.equal(spawnSync('git',['symbolic-ref','-q','HEAD'],{cwd:root,stdio:'ignore'}).status,1,'detached candidate required');
  const files=(await fs.readdir(root+'/database/migrations')).filter(x=>/^\d{4}_.*\.sql$/.test(x)).sort();assert.equal(files.length,27);for(let i=0;i<27;i++)assert.equal(files[i].split('_')[0],String(i+1).padStart(4,'0'));
  assert.equal(files[26],UAT.migration);assert.equal(sha256(await fs.readFile(root+'/database/migrations/'+UAT.migration)),migrationSha);
  const require=createRequire(root+'/package.json');return {root,sha,files,pg:require('pg'),recheck:async()=>{assert.equal(git(['rev-parse','HEAD']),sha);assert.equal(git(['status','--porcelain']),'');assert.equal(sha256(await fs.readFile(root+'/database/migrations/'+UAT.migration)),migrationSha);}};
}
export async function connection(){
  const cli=process.env.FLOWBOARD_NEON_CLI??'/Users/shubham/.npm/_npx/c58b2a555394695b/node_modules/neonctl/bin/cli.js';
  const get=a=>execFileSync(process.execPath,[cli,...a,'--output','json','--no-analytics'],{env:safeEnv(),encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:40000});
  const data=JSON.parse(get(['api',`/projects/${UAT.projectId}/endpoints`]));const endpoints=(data.endpoints??data).filter(x=>x.branch_id===UAT.branchId&&x.type==='read_write');assert.equal(endpoints.length,1);assert.equal(endpoints[0].host,UAT.host);
  const raw=get(['connection-string',UAT.branchId,'--project-id',UAT.projectId,'--database-name',UAT.database,'--role-name',UAT.role]);
  let uri;try{const x=JSON.parse(raw);uri=typeof x==='string'?x:x.uri??x.connection_string;}catch{uri=raw.trim();}
  const url=new URL(uri);assert.equal(url.hostname,UAT.host);assert.equal(url.pathname,'/'+UAT.database);assert.equal(url.username,UAT.role);assert.ok(!url.hostname.includes('-pooler'));url.searchParams.set('sslmode','verify-full');return {url,endpointId:endpoints[0].id};
}
export async function ledger26(client,files){
  const identity=(await client.query("SELECT current_database() AS database,current_user AS role,current_setting('server_version') AS version")).rows[0];assert.equal(identity.database,UAT.database);assert.equal(identity.role,UAT.role);assert.match(identity.version,/^18\./);
  const ledger=(await client.query('SELECT version,name FROM schema_migrations ORDER BY version')).rows;assert.equal(ledger.length,26,'unexpected ledger; no write allowed');for(let i=0;i<26;i++){assert.equal(ledger[i].version,String(i+1).padStart(4,'0'));assert.equal(ledger[i].name,files[i]);}return {identity,ledger};
}
export async function privateDirectory(dir,{create=false}={}){
  const base=await fs.realpath('/Users/shubham/.codex/flowboard-uat-backups');const resolved=path.resolve(dir);assert.equal(path.dirname(resolved),base,'backup must be direct child of private external backup root');assert.match(path.basename(resolved),/^hosted-mcp-[a-zA-Z0-9-]{8,100}$/);
  if(create)await fs.mkdir(resolved,{mode:0o700});const st=await fs.lstat(resolved);assert.ok(st.isDirectory()&&!st.isSymbolicLink());assert.equal(st.mode&0o777,0o700);return resolved;
}
async function privateFile(dir,name){const p=path.join(dir,name),st=await fs.lstat(p);assert.ok(st.isFile()&&!st.isSymbolicLink());assert.equal(st.mode&0o777,0o600);return fs.readFile(p);}
export async function verifyArchive(receipt){
  const dir=await privateDirectory(receipt.privateDirectory);const [encrypted,key,raw]=await Promise.all([privateFile(dir,'backup.dump.aes256gcm'),privateFile(dir,'key.bin'),privateFile(dir,'manifest.json')]);
  assert.equal(sha256(encrypted),receipt.ciphertextSha256);assert.equal(key.length,32);const meta=JSON.parse(raw);assert.equal(meta.cipher,'aes-256-gcm');
  const decipher=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(meta.iv,'base64'));decipher.setAuthTag(Buffer.from(meta.authTag,'base64'));const plain=Buffer.concat([decipher.update(encrypted),decipher.final()]);assert.equal(sha256(plain),meta.plaintextSha256);
  const toc=execFileSync('/opt/homebrew/bin/pg_restore',['--list'],{input:plain,env:safeEnv(),stdio:['pipe','pipe','pipe'],encoding:'utf8',maxBuffer:4*1024*1024,timeout:30000});
  return {archiveBytes:plain.length,tocItems:toc.split('\n').filter(x=>/^\d+;/.test(x)).length,actualRestoreExecuted:false};
}
