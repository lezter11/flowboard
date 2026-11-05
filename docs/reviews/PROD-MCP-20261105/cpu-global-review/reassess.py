"""Read-only source/evidence reassessment; writes only this review's evidence."""
import datetime, hashlib, json, pathlib, re
ROOT=pathlib.Path.cwd(); OUT=pathlib.Path(__file__).resolve().parent.relative_to(ROOT); E=OUT/'evidence'
BASE=pathlib.Path('docs/reviews/HOSTED-MCP-20261104/hosted-browser-linux-repair/independent-review/new-reviewer')
OLD=BASE/'0cd36f07dc66739a759272722d1da017f56588fb6f3a062805f3d62de6a95ea8-round-1.json'
PROMPT=pathlib.Path('docs/reviews/PROD-MCP-20261105/independent-review/0585374a5972c9cad40f356ed57736acf7dbd989a7f449c2d8b262818f49bd2c-round-2.json')
GATES=pathlib.Path('docs/reviews/PROD-MCP-20261105/cpu-local-gates')
read=lambda p:json.loads((ROOT/p).read_text()); sha=lambda p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest()
old=read(OLD); prompt=read(PROMPT); criteria=read(old['criteriaPath']); oldce=read(BASE/'criterion-evidence.json'); oldapp=read(BASE/'all98-source-applicability.json')
now=datetime.datetime.now(datetime.timezone.utc).isoformat()
def save(name,data): (E/name).write_text(json.dumps(data,indent=2)+'\n')
def compare(files):
 return [{'path':p,'previousSHA256':h,'currentSHA256':sha(p) if (ROOT/p).is_file() else None,'changed':not (ROOT/p).is_file() or sha(p)!=h} for p,h in files.items()]
baseline=compare(old['target']['files']); pdelta=compare(prompt['target']['files']); changes=[x for x in baseline if x['changed']]
sourcebefore=read(GATES/'source-before.json'); sourceafter=read(GATES/'source-after.json')['files'];
assert sourcebefore==sourceafter, 'root gate source drift'
assert all(sha(p)==h for p,h in sourceafter.items()), 'post gate source drift'
assert {x['path'] for x in changes}=={'apps/api/src/http/app.ts','apps/api/wrangler.jsonc','apps/web/src/components/integrations/connections-panel.tsx','apps/web/src/styles/connections.css'}
assert [x['path'] for x in pdelta if x['changed']]==['apps/api/src/http/app.ts'], 'unexpected prompt-review delta'
save('source-continuity.json',{'observedAt':now,'baselineReview':str(OLD),'baselineReviewSHA256':sha(OLD),'baselineFiles':baseline,'changedBaselineFiles':changes,'promptReview':str(PROMPT),'promptReviewSHA256':sha(PROMPT),'promptDelta':[x for x in pdelta if x['changed']],'cpuGatesBeforeAfter':{'paths':len(sourcebefore),'equal':True,'currentFilesEqual':True},'currentProductFiles':sourceafter,'boundary':'Hash equality preserves bytes and execution applicability; it is not a new execution or independent correctness proof.'})
# A per-command record never replaces actual historical command, target, time or environment.
commands=[]
rootresults=read(GATES/'results.json')
current_by_id={t['id']:t for t in rootresults}
replacement={'typecheck':'typecheck','contracts':'contracts','api':'api','mcp':'mcp','build-worker':'build','build-mcp':'mcp','mcp-artifact':'mcp','openapi-staleness':'contract-parity','embedded-migration-parity':'contract-parity','mcp-integration':'native-mcp'}
affected={'api','browser-integration','mcp-integration','production-worker-artifact','build-worker','hosted-browser','hosted-browser-linux','continuity'}
for t in old['tests']:
 id=t['id']; item={'id':id,'requiredCommand':criteria['requiredTests'].get(id),'historicalExecution':t,'historicalLogCurrentSHA256':sha(t['evidencePath']),'executionClaim':'The historical execution fields retain their actual original command/target/environment; no new run is inferred from a new target digest.'}
 if id in replacement:
  fresh=current_by_id[replacement[id]];item.update(disposition='fresh_current_semantic_command_group',freshExecution=fresh,explanation='Actual current command/group is retained verbatim, including npm run test versus npm test or grouped subcommands; it is not relabelled as the old exact string.')
 elif id in {'typecheck-web','web','build-web'}:
  pid={'typecheck-web':'web-typecheck','web':'web-tests','build-web':'web-build'}[id]; ft=next(x for x in prompt['tests'] if x['id']==pid)
  item.update(disposition='retained_prompt_delta_execution_with_current_unchanged_web_inputs',retainedDeltaExecution=ft,explanation='Prompt/config reviewer executed actual changed UI344/type/static build. Those consumed web source/config/contracts/lock bytes are unchanged since that run; CPU app router is not imported by web tests/type/static build. No new run claimed.')
 elif id=='compiled-pages-runtime':
  item.update(disposition='retained_historical_pages_runtime_with_explicit_layer_reassessment',explanation='Actual probe uses compiled Pages Functions/ASSETS and createApp for metadata/session/MCP401; controlled cookie/referrer bridge avoids DB. Unchanged compiled Pages/ASSETS/headers/connect source proof stays historical. Changed createApp layer is covered by fresh mounted response/header parity and actual Pages MCP bridge/native/browser tests. Prompt delta is only scoped Connections rendering/CSS with retained static-build/component and fresh composed24 proof. No whole current compiled-Pages6/6 or whole static-export byte-equality claim.')
 elif id in affected:
  item.update(disposition='pending_current_changed_entrypoint_proof',explanation='Shared app.ts router changed; old command functional closure is not equal. Current source parity and API do not silently become this command. Await an actual current equivalent run or a criterion-specific justified narrower proof.')
 else:
  item.update(disposition='retained_historical_unchanged_functional_inputs',explanation='Relevant parser/patch/fixture/diagnostic or stdio implementation/test/config/dependency bytes match historical inputs. Full current API additionally executes dependency negatives/equivalence. Historical Linux pressure/offline subcommands keep their original architecture/timing and are not current composite execution.')
 commands.append(item)
save('command-provenance.json',{'observedAt':now,'originalRequiredTests':criteria['requiredTests'],'commands':commands,'freshRootGroups':rootresults,'allFreshRootGroupsExitZero':all(t['exitCode']==0 for t in rootresults),'neverClaimed':'No current hostedCI/UAT/production/real-provider approval, no new Linux pressure/offline run, no execution of retained commands by this reassessment script.'})
# Per-feature references are freshly checked, not copied as approvals.
features=[]
for f in oldapp['features']:
 refs=[]
 for r in f['sourceReferences']:
  p=r['path']; h=sha(p);refs.append({'path':p,'historicalSHA256':r['sha256'],'currentSHA256':h,'equal':h==r['sha256']})
 features.append({k:f[k] for k in ['featureId','area','acceptance','dependsOn','uiRequired']}|{'sourceReferences':refs,'changedReferences':[r for r in refs if not r['equal']],'currentBackendEntryChanged':True,'oldUIExecutionIsHistorical':True,'currentGlobalApproval':False})
save('all98-current-source.json',{'observedAt':now,'features':features,'featureCount':len(features),'referenceChecks':sum(len(f['sourceReferences']) for f in features),'changedReferences':sum(len(f['changedReferences']) for f in features),'note':'Empty original references for foundation features do not prove their implementation; fresh API/runtime/contracts and actual entrypoint/SQL/migration source are separately required.'})
api=(ROOT/GATES/'api.log').read_text().splitlines(); featuremap={f['featureId']:f for f in features}
# Explicit source/test families. Each criterion also retains its exact unique acceptance statement and matching fresh log lines.
family={
 'FND':(['http/app.ts','runtime/node.ts','runtime/worker.ts','adapters/postgres.ts'],['node','worker','observability','runtime-safety-repair','migrations','openapi-parity']),
 'ACC':(['http/routes/session.ts','http/routes/google-auth.ts','http/routes/workspaces.ts','adapters/session.ts','adapters/personal-workspace.ts'],['acc-lifecycle','acc01-session','acc04-workspaces','google-auth-system','identity-repair','b17-personal-workspace']),
 'PRJ':(['http/routes/projects.ts','adapters/projects.ts','adapters/rbac.ts'],['prj01-projects','prj02-prj05','project-lifecycle-occ','people-directory-policy']),
 'INV':(['http/routes/invitations.ts','http/routes/members.ts','adapters/invitations.ts','adapters/members.ts','adapters/invitation-delivery.ts'],['inv01-inv03','inv04-inv08','inv06-inv07','invitation-repair','b10-invitation-email','lock-order-interleave']),
 'RBAC':(['http/middleware/auth.ts','http/middleware/rbac.ts','adapters/rbac.ts','http/routes/board-grants.ts'],['rbac01-matrix','rbac-advanced','route-auth-matrix','cookie-mutation-matrix','board-access','lock-order-interleave']),
 'BRD':(['http/routes/boards.ts','adapters/boards.ts','adapters/rbac.ts'],['brd01-brd07','board-concurrency','board-snapshot-privacy','boards-lifecycle-repair','board-description-default-board']),
 'CRD':(['http/routes/cards.ts','adapters/cards.ts','services/assignee-locks.ts'],['crd01-crd11','card-assignee-concurrency','move-undo-repair','lifecycle-undo','cards-discussion-boundary']),
 'COM':(['http/routes/comments.ts','adapters/comments.ts','services/comment-retention.ts'],['com-del','comment-edit-retention','comment-move-replay','discussion-activity-repair']),
 'ATT':(['http/routes/images.ts','adapters/images.ts','adapters/storage.ts','services/image-validator.ts','services/image-verifier-worker.ts'],['att01-att07','image-full-verifier','image-storage-atomicity','image-integrity-repair','image-integrity-worker','image-admission-worker']),
 'DEL':(['http/routes/trash.ts','adapters/trash.ts','services/trash-purge.ts'],['com-del','lifecycle-retention-repair','trash-restore-placement','board-access-boards-imports-trash']),
 'AUD':(['http/routes/activity.ts','adapters/activity.ts','services/activity-people.ts'],['aud-ntf','activity-coverage-b5','activity-reference-people','board-access-activity-notifications','b14-outbox-privacy']),
 'NTF':(['http/routes/notifications.ts','adapters/notifications.ts','services/outbox-retention.ts'],['aud-ntf','outbox-recovery','board-access-activity-notifications']),
 'QRY':(['http/routes/cards.ts','adapters/cards.ts','http/routes/session.ts'],['qry01-qry03','my-tasks-repair','cursor-integrity-repair','board-access-cards-images']),
 'UX':(['http/app.ts','runtime/worker.ts'],['ux-integration','runtime-safety-repair','lifecycle-retention-repair']),
 'IMP':(['http/routes/imports.ts','adapters/imports.ts','services/excel-parser.ts','services/import-xml.ts','services/import-retention.ts'],['imp01-imp06','import-repair','import-worker-template','import-xml-mounted','import-marker-validation','import-receipt-mapping']),
 'OAUTH':(['http/routes/hosted-oauth.ts','adapters/hosted-oauth.ts','services/hosted-oauth-cleanup.ts','http/middleware/hosted-oauth-body.ts','runtime/worker.ts'],['hosted-oauth','hosted-oauth-body','hosted-oauth-cleanup','hosted-mcp-mounted']),
 'TRANSPORT':(['http/routes/hosted-mcp.ts','http/hosted-mcp-context.ts','services/hosted-mcp-transport.ts','runtime/worker.ts','http/app.ts'],['hosted-mcp-mounted','hosted-mcp-transport','hosted-mcp-worker']),
 'HUI':(['http/routes/hosted-oauth.ts','http/routes/hosted-mcp.ts'],['hosted-oauth','hosted-mcp-mounted','google-connect-resume']),
 'LNX':(['services/excel-parser.ts','services/import-xml.ts','http/routes/imports.ts'],['dependency-parser-equivalence','dependency-patches','import-worker-template','import-xml-native-boundaries']),
 'BROWSER':(['http/app.ts'],['router-boundaries']),
}
backendnotes={
'FND':'Pinned Node/workerd adapters and real PostgreSQL paths execute in the fresh full suite; contracts137 and schema/migration checks are current. The request-local router is the only new API behavior.',
'ACC':'Session/Google callback/workspace identity logic is byte-preserved. Fresh mounted account and identity regressions cover session authority and retirement; browser drafting/display remains a separately retained UI execution.',
'PRJ':'Project routes and scoped PostgreSQL adapters are byte-preserved; fresh project lifecycle/OCC/directory suites execute on the new router. No old workspace-wide access assumption is inherited.',
'INV':'Invitation/member/secret-delivery/lock logic is byte-preserved. Fresh mounted authorization, token rotation/revocation and separate-connection interleaving tests run against PostgreSQL; real mail provider delivery remains outside local scope.',
'RBAC':'Authority helpers and route guards are byte-preserved; fresh exhaustive route, cookie and board-access suites plus independent decoded/middleware parity address changed dispatch. Metadata privacy is not inferred from merely having a helper.',
'BRD':'Board source/snapshot/order/lifecycle code is byte-preserved. Fresh mounted board grants, ancestry, versions, snapshot and concurrency tests exercise the actual current router; UI ordering/layout requires its own actual browser provenance.',
'CRD':'Card source and transactional receipts/locks are byte-preserved. Fresh mounted lifecycle, assignment, separate-connection race, movement/replay and undo suites cover the server; drawer/draft/keyboard behavior remains UI evidence.',
'COM':'Comments/mentions/tombstones/retention source is byte-preserved. Fresh mounted comment and discussion privacy/atomicity/replay suites cover current dispatch; composer state remains a UI/browser assertion.',
'ATT':'Private image stages/verification/storage lifetime and authorization source are byte-preserved. Full fresh API includes Node/workerd codec, admission, private fetch and lifecycle negatives. Production IMAGE_VERIFIER binding is separately reviewed source/config, not provider-entitlement proof.',
'DEL':'Trash source, exact cutoff, fences and storage deletion logic are byte-preserved. Fresh current mounted restore/purge/lifecycle race tests run on real PostgreSQL; original actual cutoff evidence retains its exact timestamp/runtime.',
'AUD':'Activity source and retention projections are byte-preserved; fresh mounted scope/privacy/historical identity/lifecycle tests execute. No raw token/secret logging claim rests only on a column hash.',
'NTF':'Notification/outbox source and fenced consumer are byte-preserved. Fresh PostgreSQL inbox/revocation/idempotency/recovery suites cover current mounted/runtime behavior; real elapsed long-duration delivery is not claimed.',
'QRY':'Search/My tasks/filter/cursor authorization is byte-preserved; fresh current mounted query/cursor/board-access suites verify current role and pagination. One selected project remains required.',
'UX':'Server envelope and Node/workerd portions execute fresh; layout, keyboard, focus and client reconciliation need actual prior UI/browser evidence plus changed entrypoint revalidation. Test title UX-05 alone is only a small local snapshot timing assertion, not a capacity benchmark.',
'IMP':'Import parser/patch/limits/fixtures/transaction/markers are byte-preserved. Fresh full API includes unchanged maximum Worker template and differential/adversarial parsing plus real PostgreSQL preview/commit/retry/race tests. Historical Linux pressure/install timings remain historical, not a current Linux rerun.',
'OAUTH':'OAuth route/adapter/body/cleanup/token-family code is byte-preserved. Fresh mounted PostgreSQL tests cover browser/CSRF/client/resource/lifetime/race/family revocation and actual Worker work retention on the current router; no real provider authentication is inferred.',
'TRANSPORT':'Transport/private Request identity/five strict tools are byte-preserved. Fresh actual mounted OAuth→MCP and actual workerd plus native PAT suites cover the changed app dispatch, limits, replay, revocation and retained work.',
'HUI':'Consent source is byte-preserved; Connections inserts only reviewed static prompt help/CSS. Historical HUI execution stays attached to its original target. New current full hosted browser proof is needed for the changed router and composed Connections UI.',
'LNX':'Parser/backport/fixture/deadline/patch tooling bytes are preserved and fresh API reruns their tests. Original Linux architecture, five cold pressure samples, clean offline installs and source-map measurements keep their original execution identities; new router timing is separate.',
'BROWSER':'Platform selection/diagnostic source/assertions/timeouts are unchanged. Historical Mac/Linux/bad-executable proof is preserved; current changed app requires fresh complete flow proof rather than rebinding old whole-envelope execution.',
}
# Specific independent review observations, including deliberately constrained claims.
special={
4:'Current app retains all middleware ordering and request-local context; no global app/pool cache was added. Router boundary tests and independent mounted response/header parity supply the introduced-change proof.',
7:'The global independent record is not yet finalized. Scoped CPU and prior prompt reviews are supporting inputs, not automatic99-feature approval.',
8:'Existing role-owned UI/integration handoffs still bind the old review file hash. This review cannot write those bindings; Architect must consume genuinely reassessed source/executions after a valid new backend pass.',
15:'Legacy ACC-07 test title still says ownership transfer, but current requirement is retirement. Direct typed410 routes/no state mutation and hidden affordance source are the relevant assertions; no transfer feature is approved.',
62:'A new production binding in wrangler is configuration only; current local workerd verifier tests use synthetic bindings. Finalized private image behavior remains a current local assertion, not deployed image processing.',
69:'Restore exact-time semantics need database time and fencing tests, not a browser countdown. Fresh lifecycle suite and preserved SQL enforce cutoff; UI deadline is guidance.',
91:'Fresh relative Node CPU measurement and actual local workerd corroboration are separate from database warm/cold benchmark history. Hosted exceededCpu on oldB66 is an actual release failure and cannot be waived by any local timing.',
120:'Fresh API includes actual workerd protocol initialize/list/call/notification and mounted production Worker OAuth create/replay; synthetic Node transport alone would not close this criterion.',
126:'Root fresh8 groups cover API1966/contracts137/MCP/package/native/build/type/parity. Web344/type/static build have actual unchanged prompt-delta execution provenance. Full original command strings remain historical in command-provenance.json.',
140:'Actual Pages Functions proxy/metadata/public headers source is unchanged. Original compiled Pages6/6 used a controlled bridge, distinct from API. Current prompt delta alters Connections static rendering; its static build/component probe does not itself relabel original compiled Pages6/6 as fresh.',
141:'Current native MCP22groups and API actual OAuth→MCP pass; the general browser product flow still needs current changed-entrypoint test:browser proof.',
145:'The original Linux five cold controlled-pressure executions are preserved with their actual target and ARM64 environment. No current pressure execution is claimed. Unchanged parser inputs and current maximum-fixture API tests are distinct proof layers.',
147:'LNX-06 fresh17 execution is a historical milestone on the original XML-repair target. Current applicability requires current command closures; changed app invalidates blanket634-file equality. Current grouped reruns and pending browser/artifact proof are recorded explicitly.',
148:'Original98+HOSTED and full157statements are individually present in this reassessment. Final formal global approval waits for missing current proofs and source hold; old numeric scores are not imported.',
151:'Historical full Linux24 is not current new-router execution. A new Linux24 or a precisely justified unchanged browser-selection assertion plus new platform-neutral current flow proof must be declared; final exact-candidate nativeCI remains separate.',
152:'Historical Darwin24/bad executable proof preserves old target, current runner/helper unchanged. Fresh current Darwin24 is pending; no current invalid-executable rerun is implied.',
154:'Current CPU source-before/after382file equality is verified. Planning snapshots avoid freezing mutable root operator notes. Fresh browser/source holds must also match before finalization.',
155:'Original17command strings and157statements preserved verbatim. Per-command changed dependencies are explicit, including createApp in old browser/artifact runs. All98source references are rehashed individually.',
156:'The old custom Linux overall envelope is not current. Parser/patch/fixture/caps/lock proof is retained while the current app router is explicitly changed; a new read-only comparison must name that difference rather than assert unchanged API inputs.',
157:'Only read-only local source/evidence checks were performed by this reviewer. No Actions/cloud/account/billing/production permission was exercised, and no readiness claim is made.',
}
rows=[]
for i,statement in enumerate(criteria['mandatoryCriteria'],1):
 m=re.match(r'([A-Z]+)-([0-9]+)',statement);prefix=m.group(1) if m else 'RBAC';fid=m.group(0) if m else None;f=featuremap.get(fid);src,tests=family.get(prefix,family['RBAC']);paths=['apps/api/src/'+p for p in src]+['apps/api/test/'+p+'.test.ts' for p in tests]
 for p in paths:assert (ROOT/p).is_file(),p
 matching=[]
 if fid:
  forms={fid,fid.replace('-','')}
  matching=[{'line':n,'text':s} for n,s in enumerate(api,1) if any(x in s for x in forms) and ('✔' in s or 'PASS' in s)]
 family_titles=[]
 for p in paths:
  if '/test/' not in p:continue
  for title in re.findall(r"(?:test|describe|it)\(\s*['\"]([^'\"]+)['\"]",(ROOT/p).read_text()):
   for n,s in enumerate(api,1):
    if title in s and '✔' in s:family_titles.append({'testSource':p,'line':n,'text':s});break
 changed=['apps/api/src/http/app.ts']
 if prefix in {'HUI','UX'}:changed+=['apps/web/src/components/integrations/connections-panel.tsx','apps/web/src/styles/connections.css','apps/web/src/components/integrations/mcp-prompt-help.tsx']
 if prefix in {'ATT','FND','LNX'}:changed+=['apps/api/wrangler.jsonc']
 pending=[]
 if i in {7,148}:pending+=['Final independent scoped CPU approval and global record/source hold']
 if i==8:pending+=['Role-owned consumer must bind exact new passing review and current UI/integration evidence; no automatic handoff resurrection']
 if prefix=='HUI' and i!=140:pending+=['Current full hosted synthetic browser24 receipt']
 if i in {87,88,89,90,141,147}:pending+=['Current legacy browser command or justified complete equivalent for changed mounted entrypoint']
 if i in {126,147}:pending+=['Current production artifact/guard/map evidence for changed Worker/config']
 if i==151:pending+=['Current Linux platform full-flow proof or declared bounded platform-continuity reasoning; final exactcandidateCI before release']
 if i==152:pending+=['Current Darwin full24 receipt']
 rows.append({'sequence':i,'criterion':statement,'featureId':fid if f else ('HOSTED-MCP' if prefix in {'HUI','OAUTH','TRANSPORT','LNX','BROWSER'} else None),'localConclusion':'incomplete' if pending else 'supported_subject_to_final_independent_record','reason':special.get(i,backendnotes.get(prefix,backendnotes['RBAC'])),'changedReachableSurfaces':changed,'preservedSourceAndTestReferences':[{'path':p,'sha256':sha(p),'equalsHistoricalManifest':old['target']['files'].get(p)==sha(p)} for p in paths],'freshCurrentEvidencePaths':[str(GATES/'api.log'),str(GATES/'router-boundaries.log'),str(GATES/'source-after.json')],'freshCurrentAPIMatchingLines':matching[:18],'freshCurrentAPIFamilyTestLines':family_titles[:16],'uiRequired':f['uiRequired'] if f else prefix=='HUI','uiSourceReferenceReport':str(E/'all98-current-source.json'),'historicalCriterionEvidence':oldce[statement],'historicalEvidenceIsNewExecution':False,'remainingProof':pending,'globalApproval':False})
save('criteria-reassessment.json',{'observedAt':now,'status':'incomplete','criteriaPath':old['criteriaPath'],'criterionCount':len(rows),'originalStatementsPreserved':True,'criteria':rows,'scoresAssigned':False,'boundary':'Per-criterion source/execution reassessment only until required new receipts arrive. Historical pass fields nested inside original evidence are provenance, not this reviewers verdict.'})
save('status.json',{'observedAt':now,'verdict':'incomplete','featureCount':99,'criterionCount':157,'categoryScores':None,'weightedScore':None,'sourceChanges':len(changes),'freshAPI':{'tests':1966,'pass':1966,'fail':0,'skipped':0},'needs':['Final scopedCPU record','current Mac hosted24','current legacy browser proof','current production artifact/guard/map proof','current Linux flow or bounded continuity disposition','owner-role hashbindings after pass'],'scope':'Current local99 reassessment; no CI/UAT/production/provider readiness claim'})
print(json.dumps({'criteria':len(rows),'features':len(features),'references':sum(len(f['sourceReferences']) for f in features),'sourceChanges':len(changes),'pendingCriteria':sum(bool(r['remainingProof']) for r in rows),'freshGates':len(rootresults)}))
