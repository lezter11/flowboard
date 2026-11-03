import os, json, subprocess, datetime, pathlib, uuid
base=pathlib.Path(__file__).resolve().parent
root=base.parents[3]
env=os.environ.copy(); env.update(NODE_ENV="test",WRANGLER_SEND_METRICS="false")
for key,db in [("DATABASE_URL","flowboard_harness"),("FLOWBOARD_ACCESS_TEST_DATABASE_URL","flowboard_access_test"),("FLOWBOARD_IMPORT_TEST_DATABASE_URL","flowboard_import_test"),("FLOWBOARD_IDENTITY_EXTRA_TEST_DATABASE_URL","flowboard_identity_extra_test"),("FLOWBOARD_UI_TEST_DATABASE_URL","flowboard_ui_test"),("FLOWBOARD_MCP_TEST_DATABASE_URL","flowboard_mcp_probe")]:
 env[key]="postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55931/"+db
# Legacy getPool suites use a separate independent schema; lifecycleFixture suites additionally create/drop their own.
schema="review_cards_activity_"+uuid.uuid4().hex
env["PGOPTIONS"]="-c search_path="+schema
setup="import pg from 'pg';const p=new pg.Pool({connectionString:process.env.DATABASE_URL,options:''});try{await p.query('CREATE SCHEMA '+process.argv[1])}finally{await p.end()}"
cleanup=setup.replace("'CREATE SCHEMA '+process.argv[1]","'DROP SCHEMA '+process.argv[1]+' CASCADE'")
subprocess.run(["node","--input-type=module","-e",setup,schema],env=env,cwd=root,check=True)
commands=[
("independent-adversarial",["node","--test",str(base/"adversarial.test.ts")]),
("focused-boundaries",["node","--test-concurrency=1","--test",*["apps/api/test/"+n+".test.ts" for n in ["cards-discussion-boundary","card-assignee-concurrency","comment-edit-retention","activity-reference-people","discussion-activity-repair","outbox-recovery","move-undo-repair","my-tasks-repair","cursor-integrity-repair","lifecycle-retention-repair"]]]),
("adjacent-shared",["node","--test-concurrency=1","--test",*["apps/api/test/"+n+".test.ts" for n in ["crd01-crd11","card-key-counts-creator","com-del","aud-ntf","qry01-qry03","board-access-cards-images","board-access-activity-notifications","board-notification-scope-draft","board-activity-scope-draft","comment-move-replay","lock-order-interleave","activity-coverage-b5","b9-mention-access"]]]),
("web-focused",["node","--test",*["apps/web/test/"+n+".test.ts" for n in ["discussion-notification-repair","activity-details","comment-state","card-drafts","checkpoint-regressions","poller","board-pages","board-merge"]]])
]
results=[]
try:
 for name,argv in commands:
  started=datetime.datetime.now(datetime.timezone.utc).isoformat()
  with open(base/(name+".log"),"wb") as f: result=subprocess.run(argv,env=env,cwd=root,stdout=f,stderr=subprocess.STDOUT)
  row=dict(id=name,command=" ".join(argv),exitCode=result.returncode,startedAt=started,finishedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),environment="NODE_ENV=test; six explicitly selected owned PostgreSQL55931 databases; PGOPTIONS search_path="+schema+"; lifecycle fixtures own random schemas; synthetic records",evidencePath=str((base/(name+".log")).relative_to(root)))
  results.append(row); (base/"focused-commands.json").write_text(json.dumps(results,indent=2)+"\n");print(json.dumps(row),flush=True)
  if result.returncode: break
finally:
 subprocess.run(["node","--input-type=module","-e",cleanup,schema],env=env,cwd=root,check=True)
