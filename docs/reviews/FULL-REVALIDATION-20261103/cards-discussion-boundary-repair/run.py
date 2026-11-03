import os, subprocess, sys, pathlib, json, datetime
root=pathlib.Path(__file__).resolve().parents[4]
base=pathlib.Path(__file__).resolve().parent
name=sys.argv[1]; cmd=sys.argv[2:]
env={k:os.environ[k] for k in ['PATH','HOME','TMPDIR'] if k in os.environ}
env.update(NODE_ENV='test',WRANGLER_SEND_METRICS='false')
for key,db in {'DATABASE_URL':'flowboard_harness','FLOWBOARD_ACCESS_TEST_DATABASE_URL':'flowboard_access_test','FLOWBOARD_IMPORT_TEST_DATABASE_URL':'flowboard_import_test','FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL':'flowboard_identity_extra_test','FLOWBOARD_UI_TEST_DATABASE_URL':'flowboard_ui_test','FLOWBOARD_MCP_TEST_DATABASE_URL':'flowboard_mcp_probe'}.items():env[key]='postgresql://flowboard_harness:flowboard_local_only@127.0.0.1:55931/'+db
with (base/(name+'.log')).open('w') as log:
 p=subprocess.run(cmd,cwd=root,env=env,stdout=log,stderr=subprocess.STDOUT)
record={'command':cmd,'cwd':str(root),'port':55931,'image':'postgres:17.11-alpine','exitCode':p.returncode,'log':name+'.log','at':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(base/(name+'.json')).write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record));print((base/(name+'.log')).read_text()[-4000:]);sys.exit(p.returncode)
