import os,json,subprocess,datetime,pathlib,sys
base=pathlib.Path(__file__).resolve().parent
root=base.parents[3]
env=os.environ.copy();env.update(NODE_ENV='test',WRANGLER_SEND_METRICS='false',FLOWBOARD_REVIEW_GATE_RUN=sys.argv[1])
for key,db in [('DATABASE_URL','flowboard_harness'),('FLOWBOARD_ACCESS_TEST_DATABASE_URL','flowboard_access_test'),('FLOWBOARD_IMPORT_TEST_DATABASE_URL','flowboard_import_test'),('FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL','flowboard_identity_extra_test'),('FLOWBOARD_UI_TEST_DATABASE_URL','flowboard_ui_test'),('FLOWBOARD_MCP_TEST_DATABASE_URL','flowboard_mcp_probe')]:
 env[key]='postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55931/'+db
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
argv=['node',str(base/'browser-layout.mjs')]
with open(base/'browser-layout.log','xb') as f:r=subprocess.run(argv,env=env,cwd=root,stdout=f,stderr=subprocess.STDOUT)
row=dict(command='node docs/reviews/FULL-REVALIDATION-20261103/resume-cards-activity-review/browser-layout.mjs',exitCode=r.returncode,startedAt=started,completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),sourceManifest='docs/reviews/FULL-REVALIDATION-20261103/raw/'+sys.argv[1]+'/source-before.json',environment='NODE_ENV=test; all six owned loopback55931 harness databases; own random flowboard_ui_test schema; isolated actual Chrome profile; localhost44931/44932; Next development rendering; no external services',evidencePath='docs/reviews/FULL-REVALIDATION-20261103/resume-cards-activity-review/browser-layout.log')
(base/'browser-command.json').write_text(json.dumps(row,indent=2)+'\n');print(json.dumps(row));sys.exit(r.returncode)
