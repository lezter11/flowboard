from pathlib import Path
import sys,csv,json,hashlib,datetime,shutil
root=Path(__file__).resolve().parents[4];sys.path.insert(0,str(root/'scripts'))
from check_backend_review import validate_review
base=Path('docs/reviews/FULL-REVALIDATION-20261103');out=base/'local-integration-bindings'
sha=lambda p:hashlib.sha256((root/p).read_bytes()).hexdigest()
read=lambda p:json.loads((root/p).read_text())
rows=list(csv.DictReader((root/'docs/features.tsv').open(),delimiter='\t'))
snapshot=read(base/'raw/independent-round4-gates-3/source-before.json');assert all(sha(p)==h for p,h in snapshot['files'].items())
gates=read(base/'raw/independent-round4-gates-3/commands.json');assert gates['status']=='pass' and gates['sourceUnchanged'] and len(gates['commands'])==14 and all(c['exitCode']==0 for c in gates['commands'])
product=read(base/'raw/browser-product-final-round4/result.json');assert len(product['results'])==12 and all(x['status']=='pass' for x in product['results']) and not product['blockedExternal']
assert read(base/'raw/browser-product-final-round4-execution.json')['exitCode']==0
assert all(sha(p)==h for p,h in product['afterHashes'].items())
summary=read(base/'local-handoff-bindings/summary.json');assert summary['backendVerified']==98 and summary['uiVerified']==74
records={};current=[]
for row in rows:
 fid=row['id'];b=read(Path('docs/handoffs/backend')/(fid+'.json'));rp=b['reviewPath'];v=validate_review(rp,root=root,feature_id=fid);assert v.passed,(fid,v.errors);records[rp]=sha(rp)
 ui=None;ui_path=Path('docs/handoffs/ui')/(fid+'.json')
 if row['ui_required']=='yes':
  ui=read(ui_path);assert ui['status']=='verified' and ui['backendReviewSHA256']==sha(rp)
  assert all(sha(e['path'])==e['sha256'] for e in ui['evidence'])
 assert b['status']=='verified'
 ep=out/(fid+'.json');e={'featureId':fid,'acceptance':row['acceptance'],'verificationScope':'local','hostedAcceptance':'pending','functionalSourceDigest':snapshot['digest'],'backendReviewPath':rp,'backendReviewSHA256':sha(rp),'uiHandoffPath':str(ui_path) if ui else None,'uiHandoffSHA256':sha(ui_path) if ui else None,'featureEvidencePath':str(base/'local-handoff-bindings'/(fid+'.json')),'featureEvidenceSHA256':sha(base/'local-handoff-bindings'/(fid+'.json')),'requiredGatesPath':str(base/'raw/independent-round4-gates-3/commands.json'),'requiredGatesSHA256':sha(base/'raw/independent-round4-gates-3/commands.json'),'actualProductBrowserPath':str(base/'raw/browser-product-final-round4/result.json'),'actualProductBrowserSHA256':sha(base/'raw/browser-product-final-round4/result.json'),'decision':'Local integration accepted using current mounted PostgreSQL/Node/workerd and applicable actual UI/helper/browser evidence, with source and phase bindings checked. Real Google/mail/R2/cron/Claude and native browser-menu zoom are not claimed by synthetic checks.'}
 (root/ep).write_text(json.dumps(e,indent=2)+'\n')
 ip=Path('docs/handoffs/integration')/(fid+'.json')
 if (root/ip).exists():
  arc=root/out/'original';arc.mkdir(exist_ok=True);shutil.copy2(root/ip,arc/(fid+'.json'))
 hand={'status':'verified','verificationScope':'local','hostedAcceptance':'pending','backendReviewSHA256':sha(rp),'summary':fid+' local integrated acceptance: current backend/UI proof and immutable source match. Hosted acceptance pending.','limitations':['Local synthetic acceptance only; no production approval or claim that hosted provider tests are complete.'],'evidence':[{'path':str(ep),'sha256':sha(ep),'command':'python3 '+str(out/'bind.py'),'result':'Current source, all14required exits, applicable UI and exact backend review/prerequisite bindings pass; phase local only.','environment':'Node24/PostgreSQL17/real local workerd and Chrome; independent and builder execution attributed in referenced records.'}]}
 if ui:hand['uiHandoffSHA256']=sha(ui_path)
 (root/ip).parent.mkdir(parents=True,exist_ok=True);(root/ip).write_text(json.dumps(hand,indent=2)+'\n');current.append(fid)
assert len(current)==98
r={'localGate':'pass','scope':'Local gates only; applicable hosted acceptance pending','featureCount':98,'backendVerified':98,'requiredUiVerified':74,'localIntegrated':98,'sourceDigest':snapshot['digest'],'reviewRecords':records,'requiredCommands':14,'apiTests':1768,'contractsTests':128,'webTests':332,'mcpTests':17,'artifactTests':1,'productBrowserFlows':12,'productionApproved':False,'allowedDeployment':'UAT only','checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()}
(root/base/'LOCAL-RELEASE-GATE.json').write_text(json.dumps(r,indent=2)+'\n');print(json.dumps(r))
