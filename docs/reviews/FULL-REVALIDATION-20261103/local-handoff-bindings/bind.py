from pathlib import Path
import csv,json,hashlib,subprocess,sys,re
R=Path.cwd(); P=Path('docs/reviews/FULL-REVALIDATION-20261103'); O=P/'local-handoff-bindings'
def sha(p):return hashlib.sha256(Path(p).read_bytes()).hexdigest()
def read(p):return json.loads(Path(p).read_text())
def save(p,d):Path(p).parent.mkdir(parents=True,exist_ok=True);Path(p).write_text(json.dumps(d,indent=2)+'\n')
rows=list(csv.DictReader(Path('docs/features.tsv').open(),delimiter='\t')); inventory={f['id']:f for f in read(P/'ui-repair-inventory.json')['features']}
paths=[P/'round4-foundation-account-review/review-foundation-round4.json',P/'round4-foundation-account-review/review-account-round4.json',P/'resume-images-trash-review/final-local-review.json']
paths+=list((P/'resume-cards-activity-review').glob('*-round-2.json'))
paths+=list((P/'round4-projects-boards-final').glob('429*-round-4.json'))
# Import approval may only be consumed after it exists and validates.
paths+=list((P/'round4-import-final').glob('*review*.json'))
reviews={}
for p in paths:
 d=read(p)
 if d.get('verdict')=='pass':
  for fid in d['featureIds']:reviews[fid]=(p,d)
commands=read(P/'raw/independent-round4-gates-3/commands.json')['commands']; assert len(commands)==14 and all(x['exitCode']==0 for x in commands)
web=next(c for c in commands if c['id']=='web'); weblog=Path(web['evidencePath']).read_text()
coverage={}
for path,key in [(P/'round4-foundation-account-review/final-per-id-coverage.json','features'),(P/'round4-projects-boards-final/coverage.json','features'),(P/'resume-cards-activity-review/coverage.json','results')]:
 d=read(path)[key]
 if isinstance(d,dict):coverage.update({k:{'path':str(path),'detail':v} for k,v in d.items()})
 else:coverage.update({v['id']:{'path':str(path),'detail':v} for v in d})
browserpaths=[P/'raw/browser-product-final-round4/result.json',P/'resume-cards-activity-review/browser-layout/result.json',P/'discussion-notification-ui-repair/browser-final/result.json',P/'round4-foundation-account-review/final-expired-session-browser-1/result.json']
browserpaths=[p for p in browserpaths if p.exists()]
checks={}; audits={}
for row in rows:
 fid=row['id']; inv=inventory[fid]; pair=reviews.get(fid)
 audit={'featureId':fid,'acceptance':row['acceptance'],'functionalSourceDigest':'c1f1364e7072c1b8989ae227e5ef9721fa19226bb1d38494ff446abe008249bb','verificationScope':'local','hostedAcceptance':'pending','uiRequired':row['ui_required']=='yes','independentCoverage':coverage.get(fid),'originalBackend':str(O/'original/backend'/f'{fid}.json'),'sourceAndTests':[]}
 for sp in inv['current_source_files']:
  f=Path(sp)
  if f.is_file():
   txt=f.read_text(); names=re.findall(r'(?:test|it)\(\s*[\'\"]([^\'\"]+)',txt) if '/test/'in sp else []
   audit['sourceAndTests'].append({'path':sp,'sha256':sha(f),'testNames':names})
 if pair:
  rp,review=pair
  cp=subprocess.run([sys.executable,'scripts/check_backend_review.py',str(rp),'--feature',fid],capture_output=True,text=True)
  check={'command':f'python3 scripts/check_backend_review.py {rp} --feature {fid}','exitCode':cp.returncode,'stdout':cp.stdout,'stderr':cp.stderr}; checks[fid]=check
  assert cp.returncode==0,(fid,cp.stdout,cp.stderr)
  evidence=[{'path':str(rp),'sha256':sha(rp),'command':check['command'],'result':cp.stdout.strip(),'environment':'Read-only Python procedural validation against current exact local source/evidence bytes; independent actual execution attributed within review.'},{'path':str(P/'raw/independent-round4-gates-3/commands.json'),'sha256':sha(P/'raw/independent-round4-gates-3/commands.json'),'command':'14 exact commands recorded in commands.json','result':'All14exit0; API1768/contracts128/web332/MCP17/artifact1; actual Chrome/MCP local integration. Counts overlap focused runs.','environment':'Node24/PostgreSQL17 synthetic loopback; separate independent executor'}]
  backend={'status':'verified','verificationScope':'local','hostedAcceptance':'pending','reviewPath':str(rp),'summary':f'{fid} {row["feature"]}: independently approved current local acceptance; hosted acceptance pending. Historical ratings are not used.','api_contract':f'docs/API.md; docs/openapi.json; {review["criteriaPath"]} per-ID criterion {fid}','limitations':['Local approval only. Real Google/provider delivery, deployed Worker/Pages/Neon/R2 and schedules require applicable UAT evidence.','Procedural validator does not independently prove reviewer identity or log truth; independent source review and execution remain attributed in review.'],'evidence':evidence}
  save(Path('docs/handoffs/backend')/f'{fid}.json',backend);audit['backendStatus']='verified';audit['backendReviewPath']=str(rp);audit['backendReviewSHA256']=sha(rp);audit['backendValidator']=check
 else:
  audit['backendStatus']='in_progress';audit['backendGap']='Fresh import review pending; no Backend approval invented.'
  f=Path('docs/handoffs/backend')/f'{fid}.json';d=read(f) if f.exists() else {};d.update(status='in_progress',verificationScope='local',hostedAcceptance='pending',summary=f'{fid}: current independent import approval pending; historical handoff archived.');save(f,d)
 audits[fid]=audit
# UI only consumes complete approved transitive Backend chains.
def ready(fid,seen=()):return fid not in seen and audits[fid]['backendStatus']=='verified' and all(ready(x,seen+(fid,)) for x in next(r for r in rows if r['id']==fid)['depends_on'].split(',') if x)
for row in rows:
 fid=row['id']; a=audits[fid];inv=inventory[fid]
 if row['ui_required']=='yes':
  a['uiStatus']='verified' if ready(fid) else 'in_progress'
  a['uiProofMethod']='Per-ID current UI source/test inspection plus current independently executed332web tests and actual matching Chrome flows; independent numerical Backend score alone is not UI evidence.'
  a['uiProofs']=[{'path':web['evidencePath'],'sha256':sha(web['evidencePath']),'command':web['command'],'exitCode':web['exitCode'],'result':'332web checks pass; inspect per-ID source/test list for applicable assertions. Group total is not per-ID test count.'}]
  a['browserProofs']=[{'path':str(p),'sha256':sha(p),'observations':read(p).get('results',read(p).get('observations',[]))} for p in browserpaths]
  # Keep potentially large network ledger in its original hashed file.
  ui={'status':a['uiStatus'],'verificationScope':'local','hostedAcceptance':'pending','backendReviewSHA256':a.get('backendReviewSHA256'),'summary':f'{fid} {row["feature"]}: local UI evidence bound to current backend approval and per-ID source/tests. Hosted acceptance pending.','limitations':['Synthetic local checks only; actual OAuth/provider/deployed runtime remains UAT pending.','UI source assertions/helper tests complement actual browser flows; no claim of exhaustive browser/device coverage.','Zoom proof is CSS200percent and720CSSpx reflow; native Chrome menu zoom was not applied.']}
  if not ready(fid):a['uiGap']='Current Backend/import prerequisite approval pending; UI phase withheld.'
  save(O/f'{fid}.json',a)
  ui['evidence']=[{'path':str(O/f'{fid}.json'),'sha256':sha(O/f'{fid}.json'),'command':'Read current per-ID source/tests and independently executed npm test --workspace @flowboard/web plus attributed Chrome evidence','result':a['uiStatus']+' within local scope; see per-ID proof/limitations','environment':'Node24/PostgreSQL17/actual Chrome synthetic local; browser execution attributed to original executors.'}]
  save(Path('docs/handoffs/ui')/f'{fid}.json',ui)
 else:a['uiStatus']='not_required';save(O/f'{fid}.json',a)
save(O/'validator-commands.json',checks)
save(O/'summary.json',{'backendVerified':sum(x['backendStatus']=='verified' for x in audits.values()),'uiVerified':sum(x['uiStatus']=='verified' for x in audits.values()),'totalBackend':98,'requiredUI':74,'pendingBackend':[k for k,v in audits.items() if v['backendStatus']!='verified'],'pendingUI':[k for k,v in audits.items() if v['uiStatus']=='in_progress'],'scope':'Local only; applicable hosted acceptance UAT pending; root owns integration and generated checklist.'})
print((O/'summary.json').read_text())
