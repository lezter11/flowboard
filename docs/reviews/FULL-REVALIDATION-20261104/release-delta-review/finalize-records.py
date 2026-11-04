#!/usr/bin/env python3
"""Finalize independently judged reviews after explicit consumption of complete CI and IMP pass.
Requires already-reviewed local evidence metadata arguments; performs no remote commands or handoff edits.
"""
import argparse,hashlib,json,pathlib,sys,datetime
from decimal import Decimal
ROOT=pathlib.Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'scripts'))
from check_backend_review import validate_review
from generate_review_record import build_manifest
OUT=pathlib.Path(__file__).resolve().parent
P=OUT.relative_to(ROOT).as_posix()
CANDIDATE='d1c81f42fe306c352c9cb10f04883e251ead58bd'
p=argparse.ArgumentParser();p.add_argument('--consumed-ci',required=True);p.add_argument('--import-review',required=True);a=p.parse_args()
ci=json.loads((ROOT/a.consumed_ci).read_text());imp=json.loads((ROOT/a.import_review).read_text());snapshot=json.loads((OUT/'source-applicability-before.json').read_text())
assert ci['candidateCommit']==CANDIDATE and ci['runId']=='41777804549'
assert ci['status']=='completed' and ci['conclusion']=='success' and ci['reviewerConsumedFullLogs'] is True
assert imp['verdict']=='pass' and validate_review(a.import_review,root=ROOT,feature_id='IMP-01').passed
assert ci['independentImportReviewConsumed'] is True
for f,h in snapshot['files'].items(): assert hashlib.sha256((ROOT/f).read_bytes()).hexdigest()==h,f
own=json.loads((OUT/'own-command-results.json').read_text());assert all(r['exitCode']==0 for r in own)
oldgate=json.loads((ROOT/'docs/reviews/FULL-REVALIDATION-20261103/LOCAL-RELEASE-GATE.json').read_text())
oldrecords={path:json.loads((ROOT/path).read_text()) for path in oldgate['reviewRecords']}
# All current functional sources, criteria and all consumed independent peer proof are
# explicit file roots. Outputs are never included in their own manifests.
roots=set(snapshot['files'])|{a.consumed_ci,a.import_review,'docs/reviews/FULL-REVALIDATION-20261103/LOCAL-RELEASE-GATE.json'}
for path,old in oldrecords.items(): roots.add(path);roots.update(old['target']['files'])
roots.update(imp['target']['files'])
roots.update(ci['evidencePaths'])
for f in ['independence.md','source-applicability-before.json','source-applicability-after.json','per-id-applicability.json','pre-ci-assessment.md','final-assessment.md','own-command-results.json','portable-tempdir-lifecycle.log','xml-text-regressions.log','xml-differential.log','xml-differential.mjs','finalize-records.py']:
 roots.add(P+'/'+f)
files,digest=build_manifest(ROOT,sorted(roots))
weights={'security':30,'correctness':25,'integrity':15,'tests':15,'maintainability':10,'operations':5}
# These are this reviewer's separately judged category evaluations, with deductions
# explained in final-assessment.md and each category reason; no old score is read.
scores={
'foundation':['9.1','9.0','9.0','8.9','8.4','8.0'],
'account':['9.2','9.0','9.0','8.8','8.3','8.0'],
'projects-access-invitations':['9.1','8.9','9.0','8.8','8.1','7.8'],
'boards':['9.1','9.0','9.1','8.8','8.2','8.0'],
'cards-comments':['9.1','9.0','9.1','8.8','8.2','8.0'],
'images-trash':['9.1','9.0','9.1','8.8','8.2','7.8'],
'activity-discovery-ux':['9.1','9.0','9.0','8.8','8.1','7.9']}
reasons={
'security':'Current route/session/PAT/project+board authority, cookie-origin and input boundaries are unchanged and fully byte-compared to genuine independent peer approval. Complete current Linux role/privacy/refusal matrices pass. XML fast path preserves original-only decoding, with own8060exact comparisons plus current separate IMP mounted/authority/Worker acceptance. Deduction: local synthetic identity/provider proof cannot establish deployed-provider safety; no security guarantee claimed.',
'correctness':'Every feature ID has its unchanged acceptance, reachable source/test/actual UI trace and current shared-dependency analysis in per-id-applicability.json. Full current exact14commands pass, including complete API/web/contracts/browser/MCP and both builds. Portable fixtures retain assertions; max-text checks are stronger. Prior specialized browser/probes are retained with original date/executor, not relabeled new execution. Deductions preserve bounded supported profile and documented recovery limitations.',
'integrity':'Migrations/constraints/transactions/lock/receipt/activity/outbox/fencing code is byte-identical. Current complete isolated PostgreSQL suite covers existing separate-connection/OCC/revocation/restore/purge/atomicity paths, and current IMP auditor independently verifies imports. Historical independent extra trigger-fenced/PNG/demotion probes retain exact source-continuity attribution. DB-clock test uses existing deliberate seam with exact cleanup/redaction assertions; strict24h boundary tests unchanged. No fresh historical-probe execution invented.',
'tests':'Reviewed exact completed successful candidate Linux job and every14required command/log; all exact commands exit0 and mandatory steps are present. Own7temporary lifecycle checks,3newregressions and8060differential cases pass. Current full IMP independent tests consumed. Deduction from9 reflects reuse of unchanged-input peer exploratory/browser/race proofs rather than independently rerunning those extras in this session; their old identities/timestamps/environments remain explicit. No old required command substituted for current CI.',
'maintainability':'One bounded original-input amp-only native decoder branch and standard os.tmpdir/path.join substitutions; unchanged pinned dependency/workflow/tooling parity and explicit unique-temp cleanup. Full source/evidence inventory freezes reachable dependencies. Deductions for long shared transaction/adapters/manual constrained XML paths and legacy global fixtures; no new abstraction or runtime split introduced.',
'operations':'Current Node/workerd protocol/body/deadline/SQL rollback/admission/native verifier and resource cleanup suites pass on Linux. Temp root supports host-selected location, unique0700creation and cleanup independently checked. Existing safe deadlock/retry and project lost-reply recovery weaknesses remain nonmandatory, with deductions. Historic synthetic query/performance numbers remain historical; no hosted CPU/heap/Hyperdrive/R2/mail/scheduler/production claim.'}
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
outputs=[]
for oldpath,old in oldrecords.items():
 name=pathlib.Path(old['criteriaPath']).stem
 if name=='import':continue
 criteria=json.loads((ROOT/old['criteriaPath']).read_text())
 assert set(ci['tests'])==set(criteria['requiredTests'])
 tests=[]
 for tid,cmd in criteria['requiredTests'].items():
  t=dict(ci['tests'][tid]);assert t['command']==cmd and t['exitCode']==0 and t['isolatedSynthetic'] is True
  t.update({'id':tid,'targetDigest':digest});tests.append(t)
 categories={k:{'weight':weights[k],'score':score,'reason':reasons[k]+' Domain: '+name+'.','evidencePaths':[P+'/final-assessment.md',P+'/per-id-applicability.json',a.consumed_ci,oldpath,a.import_review]} for k,score in zip(weights,scores[name])}
 total=sum(Decimal(v['score'])*v['weight'] for v in categories.values())/Decimal(100)
 findings=[dict(f,provenance='Inherited nonmandatory/resolved/rejected observation from '+oldpath+'; source unchanged and disposition independently accepted with current CI/IMP regression evidence.') for f in old['findings']]
 assert not any(f.get('disposition')=='open' and (f.get('mandatory') or f.get('blocking')) for f in findings)
 rec={'schemaVersion':1,'criteriaVersion':'backend-review-v1','featureIds':criteria['featureIds'],'criteriaPath':old['criteriaPath'],'startedAt':ci['reviewStartedAt'],'completedAt':now,'implementer':{'actorId':'collaboration:/root','sessionId':'collaboration:/root','model':'GPT-6 family; exact provider model ID unavailable'},'reviewer':{'actorId':'collaboration:/root/urgent_release_rebinding_review','sessionId':'collaboration:/root/urgent_release_rebinding_review','model':'GPT-6 family; exact provider model ID unavailable','independent':True,'freshContext':True,'implementedTarget':False,'independenceEvidence':P+'/independence.md'},'target':{'kind':'sha256-manifest','scopeRoots':sorted(roots),'files':files,'digest':digest,'candidateCommit':CANDIDATE},'criteriaResults':{s:'pass' for s in criteria['mandatoryCriteria']},'tests':tests,'categories':categories,'weightedScore':str(total),'findings':findings,'hardBlockers':[],'coverageGaps':[],'verdict':'pass','acceptanceScope':'Local current-candidate differential backend acceptance; complete unchanged feature behavior adopted from byte-verified independent prior peer evidence plus current fullCI and current IMP delta acceptance. No claim this reviewer reran historical extra probes or reread every unchanged source line. Backend/UI/integration owner revalidation and hosted acceptance remain separately required.','historicalEvidenceApplicability':{'oldReviewPath':oldpath,'oldReviewSHA256':hashlib.sha256((ROOT/oldpath).read_bytes()).hexdigest(),'unchangedSourceAndEvidenceComparison':P+'/source-applicability-before.json','currentPerIdReasoning':P+'/per-id-applicability.json','oldProbeExecutionNotReattributed':True},'currentCI':{'runId':ci['runId'],'candidateCommit':CANDIDATE,'consumedEvidence':a.consumed_ci},'currentIndependentImportReview':a.import_review}
 output=P+'/'+name+'-'+digest+'-round-1.json';(ROOT/output).write_text(json.dumps(rec,indent=2)+'\n');v=validate_review(output,root=ROOT,feature_id=criteria['featureIds'][0]);outputs.append({'path':output,'featureIds':criteria['featureIds'],'score':str(total),'valid':v.passed,'errors':v.errors});assert v.passed,v.errors
(OUT/'final-record-index.json').write_text(json.dumps({'candidateCommit':CANDIDATE,'sourceDigest':snapshot['digest'],'recordManifestDigest':digest,'reviews':outputs},indent=2)+'\n')
print(json.dumps(outputs,indent=2))
