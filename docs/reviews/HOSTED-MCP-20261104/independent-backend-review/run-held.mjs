import fs from 'node:fs';import crypto from 'node:crypto';import {spawnSync} from 'node:child_process';import pg from 'pg';
const base='docs/reviews/HOSTED-MCP-20261104/independent-backend-review';
const privateValues=process.env.DATABASE_URL?{}:JSON.parse(fs.readFileSync('/private/tmp/flowboard-hosted-mcp-test-env.json','utf8'));
const env={...process.env,...privateValues,NODE_ENV:'test',WRANGLER_SEND_METRICS:'false'};
const selected=new URL(env.DATABASE_URL);if(!['127.0.0.1','localhost','[::1]'].includes(selected.hostname)||selected.username!=='flowboard_harness'||selected.pathname!=='/flowboard_harness'||!selected.port||['55432','55479'].includes(selected.port)||selected.search)throw new Error('Disposable local harness required.');
const mode=process.argv[2];
const roots=['apps/api/src','apps/api/test','packages/contracts/src','packages/mcp/src','packages/mcp/test'];
const extra=['apps/api/package.json','packages/mcp/package.json','package.json','package-lock.json','database/migrations/0027_hosted_mcp_oauth.sql'];
const walk=p=>fs.readdirSync(p,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(p+'/'+e.name):e.isFile()?[p+'/'+e.name]:[]);
const names=[...roots.flatMap(walk),...extra].sort();
const hashes=()=>Object.fromEntries(names.map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
const before=hashes();fs.writeFileSync(`${base}/held-${mode}-before.json`,JSON.stringify({observedAt:new Date().toISOString(),files:before},null,2)+'\n');
let args;
if(mode==='hosted')args=['--test','--test-concurrency=1','apps/api/test/hosted-oauth.test.ts','apps/api/test/hosted-oauth-cleanup.test.ts','apps/api/test/hosted-oauth-body.test.ts','apps/api/test/hosted-mcp-mounted.test.ts','apps/api/test/hosted-mcp-transport.test.ts','apps/api/test/hosted-mcp-worker.test.ts'];
else if(mode==='reviewer')args=['--test',`${base}/adversarial.test.mjs`];
else if(mode==='compat')args=['--test','--test-concurrency=1','apps/api/test/tokens.test.ts','apps/api/test/token-boundaries.test.ts'];
else throw new Error('Unknown review mode.');
let admin,schema;
if(mode==='compat'){schema=`independent_compat_${process.pid}`;admin=new pg.Pool({connectionString:env.DATABASE_URL,max:1});await admin.query(`CREATE SCHEMA "${schema}"`);env.PGOPTIONS=`-c search_path=${schema}`;}
let result;
try{result=spawnSync(process.execPath,args,{env,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024});fs.writeFileSync(`${base}/held-${mode}.log`,(result.stdout??'')+(result.stderr??''));}
finally{if(admin){await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await admin.end();}}
const after=hashes();const changed=names.filter(p=>before[p]!==after[p]);const evidence={observedAt:new Date().toISOString(),mode,exitCode:result.status??1,changedSourceFiles:changed,files:after};fs.writeFileSync(`${base}/held-${mode}-result.json`,JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({mode,exitCode:result.status??1,changedSourceFiles:changed}));console.log(((result.stdout??'')+(result.stderr??'')).split('\n').slice(-10).join('\n'));process.exitCode=changed.length?2:result.status??1;
