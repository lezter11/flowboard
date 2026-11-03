"""Finalize only after actual current independent gates and browser proof pass."""
from pathlib import Path
from datetime import datetime, timezone
from decimal import Decimal
import json,hashlib,sys,subprocess
root=Path.cwd();base=Path('docs/reviews/FULL-REVALIDATION-20261103');out=base/'round4-foundation-account-review';raw=base/'raw/independent-round4-gates-3'
sys.path.insert(0,str(root/'scripts'))
from generate_review_record import init_draft_from_criteria
run=json.loads((raw/'commands.json').read_text());before=json.loads((raw/'source-before.json').read_text());after=json.loads((raw/'source-after.json').read_text());expiry=json.loads((out/'final-expired-session-browser-1/result.json').read_text())
assert run['status']=='pass' and len(run['commands'])==14 and run['sourceUnchanged'] and before==after
assert all(c['exitCode']==0 for c in run['commands'])
assert expiry['status']=='pass' and expiry['expiryChecksStatus']=='pass' and not expiry['changedSources']
assert len(expiry['privateBoardMatrix'])==3
listed=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z'],text=True).split('\0')
current={p for p in listed if p and (p in before['files'] or p.startswith(('apps/','database/','packages/','scripts/','.github/','docs/reviews/FULL-REVALIDATION-20261103/criteria/')))}
assert current==set(before['files']), 'source input inventory changed after run'

for p,h in before['files'].items(): assert hashlib.sha256(Path(p).read_bytes()).hexdigest()==h,p
now=datetime.now(timezone.utc).isoformat()
coverage=json.loads((out/'per-id-coverage.json').read_text())
coverage['sourceDigest']=before['digest'];coverage['kind']='Fresh independent final local backend evidence; downstream and UAT phases remain separately pending';coverage['gateStatus']='all14pass plus own expired-session/private-board probe pass';coverage['completedAt']=now
coverage['notCovered']=['Real Google/provider consent/renewal, deployed Cloudflare/Hyperdrive/R2/mail/scheduled/Claude-host acceptance remain UAT pending under user local→deploy→hosted sequence.','UI/integration owners still need current backendReviewSHA256 and evidence/UI hashes; this review does not approve their historical handoffs.']
for fid,item in coverage['features'].items():
 item['localStatus']='pass: current local backend scope only';item['verificationStatus']='Fresh read-only source review, own all14 exit0 and current-source browser expiry/privacy proof; original criteria unchanged.'
 item['localEvidence']=[(raw/'commands.json').as_posix(),(out/'final-source-review.md').as_posix(),(raw/'api.log').as_posix()]
 if fid=='ACC-02':item['localEvidence'].append((out/'final-expired-session-browser-1/result.json').as_posix())
(out/'final-per-id-coverage.json').write_text(json.dumps(coverage,indent=2)+'\n')
(out/'final-command-results.json').write_text(json.dumps({'executor':'collaboration:/root/round4_foundation_executor','all14':run,'additionalBrowser':{'command':'node docs/reviews/FULL-REVALIDATION-20261103/round4-foundation-account-review/final-expired-session-browser.mjs','exitCode':0,'evidencePath':(out/'final-expired-session-browser-1/result.json').as_posix(),'environment':'clean NODE_ENV=test; all six explicit synthetic loopback55931URLs; local Chrome44931/44932','providerRenewal':'not tested; synthetic replacement session only'},'priorAttempts':['raw/independent-round4-gates-1 preflight Docker sandbox refusal before tests','raw/independent-round4-gates-2 API1766/1768 exit1; immutable; two stale smoke assertions reconciled before final judgment'],'sourceBeforeAfter':before['digest'],'sourceFileCount':len(before['files'])},indent=2)+'\n')
manifest={'kind':'Current639functional inputs independently rehashed after own expiry browser proof','checkedAt':now,'files':before['files'],'digest':before['digest']}
(out/'final-source-after-browser.json').write_text(json.dumps(manifest,indent=2)+'\n')
common=[(out/p).as_posix()for p in ['final-independence.md','final-source-review.md','final-per-id-coverage.json','final-command-results.json','final-source-after-browser.json','candidate-3-delta.json','coordinator-clarification.md','required-api-failures.md','consumed-builder-evidence.json','final-expired-session-browser.mjs','finalize-records.py']]
common += [(out/'final-expired-session-browser-1').as_posix(),(out/'final-expired-session-browser.log').as_posix(),raw.as_posix(),(base/'raw/independent-round4-gates-2/commands.json').as_posix(),(base/'raw/independent-round4-gates-2/api.log').as_posix(),(base/'raw/independent-round4-gates-2/source-before.json').as_posix(),(base/'raw/independent-round4-gates-2/source-after.json').as_posix()]
common += [i['path'] for i in json.loads((out/'consumed-builder-evidence.json').read_text())['items']]
baseEvidence=[(out/'final-source-review.md').as_posix(),(out/'final-per-id-coverage.json').as_posix(),(raw/'api.log').as_posix()]
weights={'security':30,'correctness':25,'integrity':15,'tests':15,'maintainability':10,'operations':5}
reasons={
'security':'Current-identity-first snapshot repair, explicit-Bearer precedence, session hashing/expiry, strict same-app OAuth redirects and cookie-origin refusal traced through mounted app. Actual103-operation/465-cell bearer matrix and48-operation/348-check cookie matrix have0failures; own private-board anonymous/expired/outsider and expired-UI refusal passed. Provider/deployed acceptance remains separately pending; no perfect score is inferred.',
'correctness':'Original per-ID local acceptance traced to mounted contracts/handlers and actual passing all14commands. Both Node/workerd1000-row10-page walks and333 filtered search controls, strict unsupported-alias rejection, current smoke authenticated controls and own expiry draft recovery passed. Prior two stale smoke failures retained and reconciled without changing criteria/handlers.',
'integrity':'Real PostgreSQL clean/upgrade/failure-rollback/concurrent migration tests, personal-workspace eight-client serialization, directory demotion/read races, current role/grant/ancestry/replay controls passed. State/version/activity/receipt/outbox invariants use actual mounted transaction paths rather than sequential mock claims.',
 'tests':'This reviewer independently ran all14 exact mandatory commands with exit0, explicit synthetic loopback databases and unchanged639file before/after inventory. Structured Node/workerd/runtime/role/cookie evidence retained; own Chrome expiry/privacy proof passed. Gate2failed evidence remains and no old builder count is relabeled as own execution.',
'maintainability':'Shared strict contract and modular runtime/adapter boundaries, pinned lockfile/toolchain and generated OpenAPI/embedded SQL parity support portability. Broad coupled global-pool fallback and historical comments/test naming retain maintenance cost; current contextual binding and lifecycle controls are tested, so this is below perfect rather than a mandatory defect.',
'operations':'Actual bounded body/socket/refusal/deadline/DB rollback and down-DB behavior, no-secret safe errors, cleanup and measured SQL counts exercised in local Node/workerd. MyTasks13queries at one/five boards demonstrates bounded growth on the synthetic sample. Hosted CPU/billing/Hyperdrive/R2/mail/cron and broad load benchmarks remain unclaimed UAT checks.'}
for group,scores in [('foundation',{'security':'9.1','correctness':'9.1','integrity':'9.0','tests':'9.1','maintainability':'8.7','operations':'8.5'}),('account',{'security':'9.2','correctness':'9.1','integrity':'9.1','tests':'9.1','maintainability':'8.7','operations':'8.5'})]:
 criterion=(base/f'criteria/{group}.json').as_posix();d=init_draft_from_criteria(criterion)
 d['startedAt']=run['startedAt'];d['completedAt']=now
 d['implementer']={'actorId':'collaboration:/root','sessionId':'collaboration:/root','model':'GPT-6 family; exact provider model ID unavailable'}
 d['reviewer']={'actorId':'collaboration:/root/round4_foundation_executor','sessionId':'collaboration:/root/round4_foundation_executor','model':'GPT-6 family; exact provider model ID unavailable','independent':True,'freshContext':True,'implementedTarget':False,'independenceEvidence':(out/'final-independence.md').as_posix(),'providerSessionId':'unavailable; orchestration identity recorded honestly'}
 d['target']['scopeRoots']=sorted(set(list(before['files'])+common))
 d['tests']=[{'id':c['id'],'command':c['command'],'exitCode':c['exitCode'],'environment':'macOS arm64; Node24.15/npm11.12.1; owned PostgreSQL17.11-alpine127.0.0.1:55931 six explicit synthetic databases; actual local Chrome/workerd; clean NODE_ENV=test','isolatedSynthetic':True,'targetDigest':'COMPUTED_ON_FINALIZE','evidencePath':c['evidencePath'],'counts':c.get('nodeTestCounts',{})}for c in run['commands']]
 d['tests'].append({'id':'independent-expired-session-private-board','command':'node docs/reviews/FULL-REVALIDATION-20261103/round4-foundation-account-review/final-expired-session-browser.mjs','exitCode':0,'environment':'clean synthetic loopback55931UI database random schema; local Chrome44931/44932; real provider renewal unclaimed','isolatedSynthetic':True,'targetDigest':'COMPUTED_ON_FINALIZE','evidencePath':(out/'final-expired-session-browser.log').as_posix()})
 for cat in weights:d['categories'][cat]={'weight':weights[cat],'score':scores[cat],'reason':reasons[cat],'evidencePaths':baseEvidence+([(raw/'runtime-validation.json').as_posix()]if cat=='operations'else[])}
 d['findings']=[{'id':'PB-03-shared-private-snapshot','severity':'high','description':'Prior auth-before-existence defect exposed existing401/missing404 to expired/anonymous callers. Source now mounts authMiddleware before snapshot service at apps/api/src/http/routes/boards.ts:211.','disposition':'resolved','rationale':'Current permanent query-recording regression passed, plus own current-source browser/private-board matrix anonymous401/expired401/outsider404 equality with no data and authorized positive controls. Prior failure evidence preserved.','mandatory':True,'blocking':True},{'id':'PB-03-legacy-smoke-expectations','severity':'medium','description':'Prior gate2 aborted Node/Worker smoke tests at old anonymous private-board404 assertions, preventing later positive controls.','disposition':'resolved','rationale':'Independently verified only node.test.ts/worker.test.ts changed; actual unmounted path404 remains and protected missing-board401 is explicit. Full current API passed; old gate2 remains exit1 with no waiver.','mandatory':True,'blocking':True}]
 d['hardBlockers']=[];d['coverageGaps']=[];d['verdict']='pass'
 d['scopeInterpretation']='Local backend phase only under frozen user local-pass→UAT-deploy→hosted-check sequence. Required UI/integration hashes are later independently owned phase obligations; this review does not assert they are approved or close hosted/provider behavior.'
 d['hostedPending']=['Google consent/renewal','real private R2 durability','mail provider/outbox delivery','hosted scheduled cleanup','Hyperdrive/Cloudflare resource/billing/CPU behavior','actual Claude-host MCP acceptance']
 d['functionalSourceDigest']=before['digest'];d['priorAttemptEvidence']=(out/'required-api-failures.md').as_posix();d['weightedScore']=str(sum(Decimal(scores[c])*weights[c]for c in weights)/100)
 draft=out/f'draft-{group}-round4.json';draft.write_text(json.dumps(d,indent=2)+'\n')
 result=subprocess.run([sys.executable,'scripts/generate_review_record.py',draft.as_posix(),'-o',(out/f'review-{group}-round4.json').as_posix(),'--validate'],capture_output=True,text=True)
 (out/f'validate-{group}-round4.log').write_text(result.stdout+result.stderr)
 print(result.stdout,end='');print(result.stderr,end='');assert result.returncode==0
