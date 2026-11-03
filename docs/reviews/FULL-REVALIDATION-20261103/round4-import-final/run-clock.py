import os,subprocess,json,datetime
from pathlib import Path
p=Path(__file__).parent;e=os.environ.copy();e['NODE_ENV']='test';e['WRANGLER_SEND_METRICS']='false'
for k,v in {'DATABASE_URL':'flowboard_harness','FLOWBOARD_ACCESS_TEST_DATABASE_URL':'flowboard_access_test','FLOWBOARD_IMPORT_TEST_DATABASE_URL':'flowboard_import_test','FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL':'flowboard_identity_extra_test','FLOWBOARD_UI_TEST_DATABASE_URL':'flowboard_ui_test','FLOWBOARD_MCP_TEST_DATABASE_URL':'flowboard_mcp_probe'}.items():e[k]='postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55931/'+v
commands=[('cleanup-clock',['node','--test',str(p/'cleanup-clock.test.ts')])]
records=[]
for name,cmd in commands:
 start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 with (p/(name+'.log')).open('w')as out:r=subprocess.run(cmd,env=e,stdout=out,stderr=subprocess.STDOUT)
 records.append({'id':name,'command':' '.join(cmd),'exitCode':r.returncode,'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'evidencePath':str(p/(name+'.log')),'executedBy':'collaboration:/root/round4_import_final','environment':'NODE_ENV=test;6explicit synthetic disposable PostgreSQL URLs127.0.0.1:55931;unique schemas','isolatedSynthetic':True})
 (p/'clock-command.json').write_text(json.dumps(records,indent=2)+'\n');print(name,r.returncode,flush=True)
