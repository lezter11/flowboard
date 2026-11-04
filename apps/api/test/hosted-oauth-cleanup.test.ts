import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test,{before,beforeEach,after} from 'node:test';
import pg from 'pg';
import {getPool,closePool} from '../src/adapters/postgres.ts';
import {runMigrations} from '../src/adapters/migrations.ts';
import {createSession,hashSessionToken} from '../src/adapters/session.ts';
import {startHostedAuthorization,describeHostedAuthorization,decideHostedAuthorization,exchangeHostedCode,refreshHostedTokens,verifyHostedAccessToken,hashHostedSecret} from '../src/adapters/hosted-oauth.ts';
import {cleanupExpiredHostedOAuth} from '../src/services/hosted-oauth-cleanup.ts';
import worker,{closePoolAfterWork} from '../src/runtime/worker.ts';

getPool(); // Standard synthetic database URL guard, before opening any connection.
const schema=`hosted_oauth_cleanup_${process.pid}`;
const pool=new pg.Pool({connectionString:process.env['DATABASE_URL'],max:4,options:`-c search_path=${schema}`});
const origin='https://flowboard.example',resource=origin+'/api/v1/mcp',clientId='mcp_client_cleanup';
const callback='https://claude.ai/api/mcp/auth_callback';
const verifier='a'.repeat(64),challenge=crypto.createHash('sha256').update(verifier).digest('base64url');
let sessionHash='';
before(async()=>{
  await pool.query(`CREATE SCHEMA "${schema}"`);await runMigrations(pool);
  await pool.query("INSERT INTO users(id,email,display_name,created_at,updated_at) VALUES('cleanup_owner','cleanup@example.test','Cleanup owner',now(),now())");
  await pool.query("INSERT INTO workspaces(id,name,timezone,owner_id,created_at,updated_at) VALUES('cleanup_ws','Cleanup','UTC','cleanup_owner',now(),now())");
  await pool.query("INSERT INTO projects(id,workspace_id,name,created_at,updated_at) VALUES('cleanup_project','cleanup_ws','Cleanup project',now(),now())");
  sessionHash=hashSessionToken((await createSession('cleanup_owner',24,pool)).id);
});
beforeEach(async()=>{
  await pool.query('TRUNCATE mcp_oauth_authorization_requests,mcp_oauth_connections,mcp_oauth_clients,rate_limit_windows CASCADE');
  await pool.query('INSERT INTO mcp_oauth_clients(client_id,client_name,redirect_uri) VALUES($1,$2,$3)',[clientId,'Cleanup client',callback]);
});
after(async()=>{await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);await pool.end();await closePool();});
async function pending(){return startHostedAuthorization(pool,{clientId,clientName:'Cleanup client',redirectUri:callback,resource,scopes:['projects:read','boards:read','cards:read','cards:create','offline_access'],state:'synthetic-private-state',codeChallenge:challenge});}
async function family(){
  const request=await pending();const input={...request,userId:'cleanup_owner',sessionHash,binding:request.browserBinding};
  const view=await describeHostedAuthorization(pool,input);const redirect=await decideHostedAuthorization(pool,{...input,csrfToken:view.csrfToken,decision:'allow',projectId:'cleanup_project',issuer:origin});const code=new URL(redirect).searchParams.get('code')!;
  const tokens=await exchangeHostedCode(pool,{code,clientId,redirectUri:callback,resource,verifier});assert.ok('access_token'in tokens);const principal=(await verifyHostedAccessToken(pool,tokens.access_token,resource))!;
  return {...request,code,tokens,principal};
}
async function oldConnection(connectionId:string){await pool.query("UPDATE mcp_oauth_connections SET created_at=clock_timestamp()-INTERVAL '40 days',expires_at=clock_timestamp()-INTERVAL '8 days',revoked_at=NULL,last_used_at=NULL WHERE id=$1",[connectionId]);}
async function expireRequest(requestId:string){await pool.query("UPDATE mcp_oauth_authorization_requests SET created_at=clock_timestamp()-INTERVAL '1 day',expires_at=clock_timestamp()-INTERVAL '1 hour' WHERE request_hash=$1",[hashHostedSecret(requestId)]);}
function scheduledBindings(){const url=new URL(process.env['DATABASE_URL']!);url.searchParams.set('options',`-c search_path=${schema}`);return {HYPERDRIVE:{connectionString:url.toString()},IMAGES:{put:async()=>{throw new Error('Unexpected synthetic storage write');},get:async()=>null,delete:async()=>{}}};}

test('cleanup leaves active family and active undecided browser binding unchanged and is repeatable',async()=>{
  const active=await family(),browser=await pending();const before=(await pool.query('SELECT * FROM mcp_oauth_authorization_requests WHERE request_hash=$1',[hashHostedSecret(browser.requestId)])).rows[0];
  const result=await cleanupExpiredHostedOAuth(pool);assert.equal(result.connectionsDeleted,0);assert.equal(result.requestsDeleted,0);
  assert.ok(await verifyHostedAccessToken(pool,active.tokens.access_token,resource));const after=(await pool.query('SELECT * FROM mcp_oauth_authorization_requests WHERE request_hash=$1',[hashHostedSecret(browser.requestId)])).rows[0];assert.deepEqual(after,before);assert.deepEqual(await cleanupExpiredHostedOAuth(pool),{connectionsDeleted:0,requestsDeleted:0,requestsRedacted:0,clientsDeleted:0});
});
test('expired code/request and spent refresh hashes remain through the live family and still detect reuse',async()=>{
  const active=await family();const rotated=await refreshHostedTokens(pool,{refreshToken:active.tokens.refresh_token!,clientId,resource});assert.ok('access_token'in rotated);
  await pool.query("UPDATE mcp_oauth_refresh_tokens SET created_at=clock_timestamp()-INTERVAL '10 days',expires_at=clock_timestamp()-INTERVAL '1 day' WHERE token_hash=$1",[hashHostedSecret(active.tokens.refresh_token!)]);
  await expireRequest(active.requestId);await pool.query("UPDATE mcp_oauth_authorization_codes SET created_at=clock_timestamp()-INTERVAL '1 day',expires_at=clock_timestamp()-INTERVAL '1 hour' WHERE connection_id=$1",[active.principal.connectionId]);
  await cleanupExpiredHostedOAuth(pool);assert.equal((await pool.query('SELECT id FROM mcp_oauth_authorization_codes WHERE connection_id=$1',[active.principal.connectionId])).rowCount,1);assert.equal((await pool.query('SELECT id FROM mcp_oauth_refresh_tokens WHERE connection_id=$1',[active.principal.connectionId])).rowCount,2);
  assert.deepEqual(await refreshHostedTokens(pool,{refreshToken:active.tokens.refresh_token!,clientId,resource}),{error:'invalid_grant'});assert.equal(await verifyHostedAccessToken(pool,rotated.access_token,resource),null);
  const second=await family();await expireRequest(second.requestId);await cleanupExpiredHostedOAuth(pool);assert.deepEqual(await exchangeHostedCode(pool,{code:second.code,clientId,redirectUri:callback,resource,verifier}),{error:'invalid_grant'});assert.equal(await verifyHostedAccessToken(pool,second.tokens.access_token,resource),null);
});
test('old terminal family deletion cascades a real self-referencing refresh chain and removes only orphan expired requests',async()=>{
  const old=await family();let token=old.tokens.refresh_token!;
  for(let n=0;n<3;n++){const next=await refreshHostedTokens(pool,{refreshToken:token,clientId,resource});assert.ok('access_token'in next);token=next.refresh_token!;}
  assert.equal((await pool.query('SELECT id FROM mcp_oauth_refresh_tokens')).rowCount,4);await oldConnection(old.principal.connectionId);await expireRequest(old.requestId);
  const result=await cleanupExpiredHostedOAuth(pool);assert.equal(result.connectionsDeleted,1);assert.equal(result.requestsDeleted,1);for(const table of ['mcp_oauth_connections','mcp_oauth_authorization_codes','mcp_oauth_access_tokens','mcp_oauth_refresh_tokens'])assert.equal((await pool.query(`SELECT id FROM ${table}`)).rowCount,0);
  assert.deepEqual(await cleanupExpiredHostedOAuth(pool),{connectionsDeleted:0,requestsDeleted:0,requestsRedacted:0,clientsDeleted:0});
});
test('seven-day terminal identity retention and last-use backstop prevent early deletion',async()=>{
  const recent=await family();await pool.query("UPDATE mcp_oauth_connections SET created_at=clock_timestamp()-INTERVAL '40 days',expires_at=clock_timestamp()+INTERVAL '1 day',revoked_at=clock_timestamp()-INTERVAL '6 days' WHERE id=$1",[recent.principal.connectionId]);
  const used=await family();await oldConnection(used.principal.connectionId);await pool.query("UPDATE mcp_oauth_connections SET last_used_at=clock_timestamp()-INTERVAL '1 day' WHERE id=$1",[used.principal.connectionId]);
  const old=await family();await oldConnection(old.principal.connectionId);
  const result=await cleanupExpiredHostedOAuth(pool);assert.equal(result.connectionsDeleted,1);const remaining=await pool.query('SELECT id FROM mcp_oauth_connections ORDER BY id');assert.deepEqual(new Set(remaining.rows.map(r=>r.id)),new Set([recent.principal.connectionId,used.principal.connectionId]));
});
test('batch limits and SKIP LOCKED bound each cleanup stage without waiting for an in-flight family',async()=>{
  const families=[];for(let i=0;i<4;i++){const f=await family();await oldConnection(f.principal.connectionId);families.push(f);}
  for(let i=0;i<5;i++)await expireRequest((await pending()).requestId);
  const locked=await pool.connect();await locked.query('BEGIN');await locked.query('SELECT id FROM mcp_oauth_connections WHERE id=$1 FOR UPDATE',[families[0]!.principal.connectionId]);
  try{const result=await cleanupExpiredHostedOAuth(pool,{batchSize:2});assert.equal(result.connectionsDeleted,2);assert.equal(result.requestsDeleted,2);assert.ok(result.requestsRedacted<=2);assert.equal((await pool.query('SELECT id FROM mcp_oauth_connections WHERE id=$1',[families[0]!.principal.connectionId])).rowCount,1);}
  finally{await locked.query('ROLLBACK');locked.release();}
});
test('cleanup enforces its hard cap and rejects invalid maintenance batch sizes',async()=>{
  await pool.query(`INSERT INTO mcp_oauth_authorization_requests(id,request_hash,client_id,client_name,redirect_uri,resource,scopes,state,code_challenge,browser_binding_hash,expires_at,created_at)
    SELECT 'cap_pending_'||n,lpad(n::text,64,'0'),$1,'Cap client',$2,$3,ARRAY['projects:read'],'synthetic-state',$4,repeat('a',64),clock_timestamp()-INTERVAL '1 hour',clock_timestamp()-INTERVAL '1 day'
    FROM generate_series(1,101)n`,[clientId,callback,resource,challenge]);
  const result=await cleanupExpiredHostedOAuth(pool,{batchSize:1000});assert.equal(result.requestsDeleted,100);assert.equal((await pool.query('SELECT id FROM mcp_oauth_authorization_requests')).rowCount,1);
  for(const batchSize of [0,-1,1.5,NaN,Infinity])await assert.rejects(cleanupExpiredHostedOAuth(pool,{batchSize}),/positive integer/);
  assert.equal((await pool.query('SELECT id FROM mcp_oauth_authorization_requests')).rowCount,1);assert.equal((await cleanupExpiredHostedOAuth(pool)).requestsDeleted,1);
});
test('expired retained requests lose browser/session/CSRF/state while active bindings remain',async()=>{
  const retained=await family(),active=await pending();await expireRequest(retained.requestId);
  await pool.query('UPDATE mcp_oauth_authorization_requests SET state=$2,session_hash=$2,csrf_hash=$3,browser_binding_hash=$3 WHERE request_hash=$1',[hashHostedSecret(retained.requestId),'synthetic-legacy-secret','a'.repeat(64)]);
  const result=await cleanupExpiredHostedOAuth(pool);assert.equal(result.requestsRedacted,1);assert.equal(result.requestsDeleted,0);const cleaned=(await pool.query('SELECT state,session_hash,csrf_hash,browser_binding_hash FROM mcp_oauth_authorization_requests WHERE request_hash=$1',[hashHostedSecret(retained.requestId)])).rows[0];assert.deepEqual(cleaned,{state:null,session_hash:null,csrf_hash:null,browser_binding_hash:'0'.repeat(64)});assert.equal((await pool.query('SELECT browser_binding_hash FROM mcp_oauth_authorization_requests WHERE request_hash=$1',[hashHostedSecret(active.requestId)])).rows[0].browser_binding_hash,hashHostedSecret(active.browserBinding));
});
test('expired registration cleanup retains live connections and active authorization requests',async()=>{
  await family();await pool.query("UPDATE mcp_oauth_clients SET expires_at=clock_timestamp()-INTERVAL '1 day'");
  await pool.query('INSERT INTO mcp_oauth_clients(client_id,client_name,redirect_uri,expires_at) VALUES($1,$2,$3,clock_timestamp()-INTERVAL \'1 day\')',['mcp_client_unused','Unused',callback]);
  const result=await cleanupExpiredHostedOAuth(pool);assert.equal(result.clientsDeleted,1);assert.equal((await pool.query('SELECT client_id FROM mcp_oauth_clients WHERE client_id=$1',[clientId])).rowCount,1);
  await pool.query('TRUNCATE mcp_oauth_authorization_requests,mcp_oauth_connections CASCADE');await pending();assert.equal((await cleanupExpiredHostedOAuth(pool)).clientsDeleted,0);
});
test('actual Worker schedule performs OAuth cleanup without a browser request',async()=>{
  const old=await family();await oldConnection(old.principal.connectionId);await expireRequest(old.requestId);await worker.scheduled({},scheduledBindings());assert.equal((await pool.query('SELECT id FROM mcp_oauth_connections')).rowCount,0);assert.equal((await pool.query('SELECT id FROM mcp_oauth_authorization_requests')).rowCount,0);
});
test('OAuth cleanup failure rolls back its work and later actual scheduled jobs still run and report failure',async()=>{
  const old=await family();await oldConnection(old.principal.connectionId);await pool.query("INSERT INTO rate_limit_windows(bucket,client_key,window_start,request_count) VALUES('auth','synthetic-old-key',0,1)");
  await pool.query("CREATE FUNCTION fail_oauth_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic_cleanup_failure'; END $$");await pool.query('CREATE TRIGGER fail_oauth_cleanup BEFORE DELETE ON mcp_oauth_connections FOR EACH ROW EXECUTE FUNCTION fail_oauth_cleanup()');
  const logs:string[]=[];const original=console.error;console.error=(line:unknown)=>{logs.push(String(line));};
  try{await assert.rejects(worker.scheduled({},scheduledBindings()),/synthetic_cleanup_failure/);assert.equal((await pool.query('SELECT id FROM mcp_oauth_connections WHERE id=$1',[old.principal.connectionId])).rowCount,1);assert.equal((await pool.query('SELECT bucket FROM rate_limit_windows')).rowCount,0);assert.match(logs.join('\n'),/hosted-oauth-retention/);assert.doesNotMatch(logs.join('\n'),/synthetic-private-state/);}
  finally{console.error=original;await pool.query('DROP TRIGGER fail_oauth_cleanup ON mcp_oauth_connections');await pool.query('DROP FUNCTION fail_oauth_cleanup()');}
});
test('Worker pool remains open through timed-out work and closes after fulfilled and rejected lifetimes',async()=>{
  let complete!:()=>void,reject!:(error:Error)=>void,closed=0;
  const image=new Promise<void>(resolve=>{complete=resolve;}),mcp=new Promise<void>((_resolve,refuse)=>{reject=refuse;});
  const retained:Promise<unknown>[]=[];
  await closePoolAfterWork({end:async()=>{closed++;}},[image,mcp],{waitUntil:promise=>{retained.push(promise);}});
  assert.equal(closed,0);assert.equal(retained.length,1);complete();await Promise.resolve();assert.equal(closed,0);reject(new Error('synthetic request settlement'));
  await retained[0];assert.equal(closed,1);
});
test('Worker pool cleanup awaits work without execution context and closes immediately when none remains',async()=>{
  let complete!:()=>void,closed=0;const work=new Promise<void>(resolve=>{complete=resolve;});
  const closing=closePoolAfterWork({end:async()=>{closed++;}},[work]);await Promise.resolve();assert.equal(closed,0);complete();await closing;assert.equal(closed,1);
  await closePoolAfterWork({end:async()=>{closed++;}},[]);assert.equal(closed,2);
});
