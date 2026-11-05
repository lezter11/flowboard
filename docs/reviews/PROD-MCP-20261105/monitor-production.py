"""Bounded production tail. Never persist URLs, headers, log messages or exception text."""
import argparse, collections, datetime, json, os, pathlib, selectors, signal, subprocess, time

p=argparse.ArgumentParser();p.add_argument('--version',required=True);p.add_argument('--seconds',type=int,default=900);a=p.parse_args()
assert len(a.version)==36 and all(c in '0123456789abcdef-' for c in a.version)
assert 1<=a.seconds<=900
folder=pathlib.Path(__file__).resolve().parent
final=folder/'production-monitor.json';progress=folder/'production-monitor-progress.json'
assert not final.exists()
env={k:v for k,v in os.environ.items() if k in ['HOME','PATH','TMPDIR']}
env.update(NODE_ENV='production',NODE_OPTIONS='--dns-result-order=ipv4first',WRANGLER_SEND_METRICS='false',WRANGLER_WRITE_LOGS='false',CLOUDFLARE_ACCOUNT_ID='6592b59b0da4771dc346b96c6fdc65fd')
command=['node','/private/tmp/flowboard-prod-release-40e51e1/node_modules/wrangler/wrangler-dist/cli.js','tail','flowboard-api','--format','json','--version-id',a.version]
report={'kind':'bounded redacted production Worker observation, not owner acceptance','worker':'flowboard-api','version':a.version,'requestedSeconds':a.seconds,'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'events':0,'scheduledEvents':0,'scheduledOk':0,'exceptionCount':0,'errorLogCount':0,'http5xx':0,'outcomes':{},'httpStatuses':{},'rawEventDataPersisted':False,'parserOverflows':0,'stderrBytes':0}
start=time.monotonic();buf='';decoder=json.JSONDecoder();child=None
def publish():
 report['observedSeconds']=round(time.monotonic()-start,3)
 tmp=progress.with_suffix('.tmp');tmp.write_text(json.dumps(report,indent=2)+'\n');tmp.replace(progress)
def accept(obj):
 if not isinstance(obj,dict) or 'outcome' not in obj:return
 if obj.get('scriptName') not in [None,'flowboard-api']:return
 report['events']+=1
 outcome=obj.get('outcome');outcome=outcome if outcome in ['ok','exception','exceededCpu','exceededMemory','canceled','unknown','invocationFailure','responseStreamDisconnected'] else 'other'
 report['outcomes'][outcome]=report['outcomes'].get(outcome,0)+1
 report['exceptionCount']+=len(obj.get('exceptions',[]))
 report['errorLogCount']+=sum(x.get('level')=='error' for x in obj.get('logs',[]) if isinstance(x,dict))
 event=obj.get('event') or {}
 if isinstance(event,dict):
  if 'cron' in event or 'scheduledTime' in event:
   report['scheduledEvents']+=1;report['scheduledOk']+=outcome=='ok'
  response=event.get('response') or {}
  status=response.get('status') if isinstance(response,dict) else None
  if isinstance(status,int) and 100<=status<=599:
   key=str(status);report['httpStatuses'][key]=report['httpStatuses'].get(key,0)+1;report['http5xx']+=status>=500
def parse(chunk):
 global buf
 buf+=chunk.decode('utf8',errors='replace')
 while buf:
  i=buf.find('{')
  if i<0:buf='';break
  if i:buf=buf[i:]
  try:obj,n=decoder.raw_decode(buf)
  except json.JSONDecodeError:break
  accept(obj);buf=buf[n:].lstrip()
 if len(buf)>2*1024*1024:buf='';report['parserOverflows']+=1
try:
 child=subprocess.Popen(command,cwd='/private/tmp/flowboard-prod-release-40e51e1/apps/api',env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 sel=selectors.DefaultSelector();sel.register(child.stdout,selectors.EVENT_READ,'stdout');sel.register(child.stderr,selectors.EVENT_READ,'stderr');last=0
 while time.monotonic()-start<a.seconds and child.poll() is None:
  for key,_ in sel.select(timeout=min(2,max(0,a.seconds-(time.monotonic()-start)))):
   chunk=os.read(key.fileobj.fileno(),65536)
   if not chunk:sel.unregister(key.fileobj);continue
   if key.data=='stdout':parse(chunk)
   else:report['stderrBytes']+=len(chunk)
  if time.monotonic()-last>=5:publish();last=time.monotonic()
 report['windowCompleted']=time.monotonic()-start>=a.seconds
finally:
 if child:
  if child.poll() is None:
   child.send_signal(signal.SIGINT)
   try:child.wait(timeout=8)
   except subprocess.TimeoutExpired:child.kill();child.wait(timeout=5)
  report['tailExitCode']=child.returncode
 report['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat();report['cleanup']=child is None or child.poll() is not None
 report['status']='observed-no-errors' if report.get('windowCompleted') and report['events']>0 and report['scheduledOk']>0 and report['exceptionCount']==report['errorLogCount']==report['http5xx']==report['parserOverflows']==0 and all(k=='ok' for k in report['outcomes']) else 'needs-inspection'
 publish()
 with final.open('x') as f:json.dump(report,f,indent=2);f.write('\n')
 print(json.dumps(report))
