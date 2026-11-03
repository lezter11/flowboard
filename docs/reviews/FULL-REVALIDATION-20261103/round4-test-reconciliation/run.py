import os,subprocess,sys,pathlib,json,datetime,uuid,hashlib
base=pathlib.Path(__file__).resolve().parent;root=base.parents[3]
name=sys.argv[1];command=sys.argv[2:]
env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR'] if k in os.environ};env.update(NODE_ENV='test',WRANGLER_SEND_METRICS='false')
for key,db in {'DATABASE_URL':'flowboard_harness','FLOWBOARD_ACCESS_TEST_DATABASE_URL':'flowboard_access_test','FLOWBOARD_IMPORT_TEST_DATABASE_URL':'flowboard_import_test','FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL':'flowboard_identity_extra_test','FLOWBOARD_UI_TEST_DATABASE_URL':'flowboard_ui_test','FLOWBOARD_MCP_TEST_DATABASE_URL':'flowboard_mcp_probe'}.items():env[key]='postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55931/'+db
schema='round4_test_'+uuid.uuid4().hex
def admin(action):
 code="import pg from 'pg';const p=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1});try{await p.query('"+action+' SCHEMA "'+schema+'"'+(' CASCADE'if action=='DROP'else'')+"');}finally{await p.end()}"
 result=subprocess.run(['node','--input-type=module','-e',code],env=env,cwd=root,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 if result.stdout:print(result.stdout)
 return result.returncode
created=admin('CREATE');assert created==0
# libpq process environment is inherited by the global legacy pg pool. Explicit fixture
# connection options still select their own separately created random schema.
env['PGOPTIONS']='-c search_path='+schema
for key,file in {'FLOWBOARD_AUTH_MATRIX_EVIDENCE_PATH':'route-matrix','FLOWBOARD_COOKIE_MATRIX_EVIDENCE_PATH':'cookie-matrix','FLOWBOARD_RUNTIME_EVIDENCE_PATH':'runtime'}.items():env[key]=str(base/(name+'-'+file+'.json'))
owned=['apps/api/test/support/route-auth-fixture.ts','apps/api/test/runtime-validation.test.ts','apps/api/test/rate-limit-postgres.test.ts']
def hashes():return{p:hashlib.sha256((root/p).read_bytes()).hexdigest()for p in owned}
before=hashes();started=datetime.datetime.now(datetime.timezone.utc).isoformat()
try:
 with(base/(name+'.log')).open('w')as log:result=subprocess.run(command,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
finally:
 env.pop('PGOPTIONS',None);cleanup=admin('DROP')
record={'command':command,'cwd':str(root),'startedAt':started,'endedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode,'port':55931,'image':'postgres:17.11-alpine','imageId':'sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b','legacySchema':schema,'createSchemaExit':created,'dropSchemaExit':cleanup,'log':name+'.log','beforeHashes':before,'afterHashes':hashes(),'ownedSourceUnchanged':before==hashes()}
(base/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record));print((base/(name+'.log')).read_text()[-6500:]);sys.exit(result.returncode if result.returncode else cleanup)
