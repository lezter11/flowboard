#!/usr/bin/env python3
"""Consume a fresh passing review; retain per-feature continuity and local-only evidence."""
import argparse, csv, datetime, hashlib, json, subprocess, sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'scripts'))
from check_backend_review import validate_review
from phase_guard import reserve_phase

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,x):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(x,indent=2)+'\n')
p=argparse.ArgumentParser();p.add_argument('--review',required=True);p.add_argument('--apply',action='store_true');a=p.parse_args()
review_path=ROOT/a.review; review=read(review_path)
features=list(csv.DictReader((ROOT/'docs/features.tsv').open(),delimiter='\t'))
assert len(features)==98
result=validate_review(a.review,root=ROOT)
assert result.passed,result.errors
assert {f['id'] for f in features}|{'HOSTED-MCP'} <= set(review['featureIds'])
assert len(review['tests'])>=19 and all(t['exitCode']==0 for t in review['tests'])
review_sha=sha(review_path); target=review['target']['files']; base=Path(__file__).resolve().parent
previous=ROOT/'docs/reviews/PROD-MCP-20261105/cpu-owner-phase'
phase=[]
execution_index=base/'review-test-executions.json'
execution_bytes=(json.dumps({'reviewPath':a.review,'tests':review['tests'],'policy':'Full original execution/provenance retained exactly; current applicability does not mean a fresh rerun.'},indent=2)+'\n').encode()
execution_sha=hashlib.sha256(execution_bytes).hexdigest()
commands=[]
for t in review['tests']:
 row={k:t[k] for k in ('id','command','exitCode','evidencePath','environment','executionKind','targetDigest','originalExecutionTarget','currentApplicabilityPath') if k in t}
 row['fullExecutionRecord']={'path':str(execution_index.relative_to(ROOT)),'sha256':execution_sha,'id':t['id']}
 commands.append(row)
for f in features:
 fid=f['id']; old=read(previous/(fid+'.json')); current=[]
 for item in old['sourceAndTests']:
  relative=item['path']; actual=sha(ROOT/relative)
  assert target.get(relative)==actual,('Per-ID source not covered by current review',fid,relative)
  current.append({'path':relative,'previousSHA256':item['sha256'],'sha256':actual,'changedSincePreviousPhase':actual!=item['sha256']})
 phase.append({'featureId':fid,'acceptance':f['acceptance'],'uiRequired':f['ui_required']=='yes','verificationScope':'local','hostedAcceptance':'pending','backendReviewPath':a.review,'backendReviewSHA256':review_sha,'sourceAndTests':current,'currentRequiredTests':commands,'historicalPhase':{'path':str((previous/(fid+'.json')).relative_to(ROOT)),'sha256':sha(previous/(fid+'.json'))},'decision':'Architect consumed the fresh independent preserved-baseline plus rollout-banner reassessment. Every test preserves executionKind and a hash-bound full original execution record; source applicability is distinct from a fresh run.','limitations':['Local synthetic verification; actual Google/Claude, deployed storage, long-duration timers and production acceptance are separate.','New exact-candidate CI and hosted rollout remain release conditions; the known idle-PG baseline warning stays disclosed and unresolved. No clean production/runtime acceptance is implied.'],'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
print(json.dumps({'checkOnly':not a.apply,'featuresValidated':98,'requiredUI':sum(x['uiRequired'] for x in phase),'reviewSHA256':review_sha,'sourceReferencesChecked':sum(len(x['sourceAndTests']) for x in phase)}))
if not a.apply:sys.exit(0)
assert not (base/'summary.json').exists(),'Preserve prior phase evidence; use a new owner phase for another revision.'
reserve_phase(base, [f['id'] for f in features], a.review)
write(execution_index,json.loads(execution_bytes))
command=f'python3 {Path(__file__).relative_to(ROOT)} --review {a.review} --apply'
for x in phase:
 fid=x['featureId']; phase_path=base/(fid+'.json'); write(phase_path,x)
 evidence={'path':str(phase_path.relative_to(ROOT)),'sha256':sha(phase_path),'command':command,'result':'Fresh review validated for this ID; current per-ID source/test hashes checked against the review manifest; current local criteria reassessed; fresh and retained original executions are explicitly distinguished.','environment':'See the independent review for exact local PostgreSQL/Node/workerd/Chrome environment and command outcomes. No hosted/provider acceptance implied.'}
 limits=x['limitations']
 for role in ['backend','ui','integration']:
  existing=ROOT/f'docs/handoffs/{role}/{fid}.json'
  if existing.exists():write(base/f'previous-handoffs/{role}/{fid}.json',read(existing))
 write(ROOT/f'docs/handoffs/backend/{fid}.json',{'status':'verified','verificationScope':'local','hostedAcceptance':'pending','reviewPath':a.review,'summary':f'{fid}: independently reviewed current local implementation; hosted acceptance pending.','api_contract':f'docs/API.md; docs/openapi.json; docs/features.tsv {fid}','limitations':limits,'evidence':[evidence]})
 if x['uiRequired']:
  write(ROOT/f'docs/handoffs/ui/{fid}.json',{'status':'verified','verificationScope':'local','hostedAcceptance':'pending','backendReviewSHA256':review_sha,'summary':f'{fid}: local UI/source acceptance under independent baseline continuity plus scoped banner review, actual current frontend/Pages proof and explicitly retained historical execution records.','limitations':limits,'evidence':[evidence]})
 integration={'status':'verified','verificationScope':'local','hostedAcceptance':'pending','backendReviewSHA256':review_sha,'summary':f'{fid}: current local integrated acceptance under fresh review; hosted acceptance pending.','limitations':limits,'evidence':[evidence]}
 if x['uiRequired']:integration['uiHandoffSHA256']=sha(ROOT/f'docs/handoffs/ui/{fid}.json')
 write(ROOT/f'docs/handoffs/integration/{fid}.json',integration)
write(base/'summary.json',{'reviewPath':a.review,'reviewSHA256':review_sha,'backendValidated':98,'requiredUIValidated':sum(x['uiRequired'] for x in phase),'localIntegrationValidated':98,'sourceReferencesChecked':sum(len(x['sourceAndTests']) for x in phase),'verificationScope':'local','hostedAcceptance':'pending','historicalHandoffsPreserved':True,'recordedAt':datetime.datetime.now(datetime.timezone.utc).isoformat()})
subprocess.run([sys.executable,'scripts/render_feature_checklist.py'],cwd=ROOT,check=True)
text=(ROOT/'docs/FEATURE_CHECKLIST.md').read_text()
assert 'Backend verified: **98**' in text and 'UI verified: **74**' in text and 'Integrated: **98**' in text
