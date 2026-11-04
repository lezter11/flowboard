"""Read-only current functional-input continuity; never reruns inherited commands."""
import hashlib,json,pathlib,subprocess,datetime
root=pathlib.Path.cwd()
base=root/'docs/reviews/HOSTED-MCP-20261104/linux-xlsx-repair/independent-review'
old=json.loads((base/'6b9865a09c1deb21b79942fb2014cb21fedde9972a0351b285c83fe3014fda01-round-1.json').read_text())
run=base/'runs/2026-11-04T15-59-37.444Z'
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
held=json.loads((run/'source-before.json').read_text())['files']
excluded={'scripts/e2e/hosted-mcp-browser.mjs','package.json'}
changes=[p for p,h in held.items() if p not in excluded and sha(root/p)!=h]
pkg=json.loads((root/'package.json').read_text()); original=json.loads(subprocess.check_output(['git','show','e5c5687aadfac676699e35015477d2c3d4df72b3:package.json']))
semantic_original=json.loads(json.dumps(original));semantic_current=json.loads(json.dumps(pkg))
for p in [semantic_original,semantic_current]:p['scripts'].pop('test:hosted-mcp-browser')
assert semantic_original==semantic_current,'Root package changed beyond hosted browser wiring'
assert not changes,changes
closure={p:h for p,h in held.items() if p not in excluded}
reasons={
 'typecheck':'Root typecheck lifecycle verifies dependency patch, builds MCP, runs root tsconfig apps/api and contracts TypeScript plus MCP typecheck; mjs hosted runner is outside all includes.',
 'typecheck-web':'Web tsc includes web TS/TSX; no hosted runner import or lifecycle.',
 'api':'API pretest verifies patch/builds MCP; test script database safety then serial test/*.test.ts, support helpers and Node/workerd configs. No hosted runner import/execution.',
 'contracts':'Contracts workspace test glob/types/contracts; no hosted runner import or lifecycle.',
 'web':'Web test/*.test.ts and imported web/contracts sources; no hosted runner import or lifecycle.',
 'mcp':'MCP test/*.test.ts/imported source/dependency config; no hosted runner.',
 'build-worker':'API prebuild patch verification/MCP build; tsc build includes API src; Wrangler dry-run/map verification uses API entry, contracts/MCP and tracked patch. Hosted mjs excluded.',
 'build-web':'Root deps verification then Next build from web source/functions/public/config; no hosted runner import.',
 'build-mcp':'MCP tsc and finalize-build helper; no hosted runner.',
 'mcp-artifact':'Installed stdio artifact test uses MCP build/package/dependencies; no hosted runner.',
 'openapi-staleness':'Generator reads contracts/schema/docs; no hosted runner or modified root script.',
 'embedded-migration-parity':'Sync helper reads database canonical migration and embedded module; no hosted runner.',
 'browser-integration':'Legacy diagnostic runner plus server fixture/imported mounted API/web/contracts, Chromium config; hosted runner is not imported/executed.',
 'mcp-integration':'MCP acceptance runner/server fixture/imported mounted API/MCP/workerd; hosted runner not imported/executed.',
 'compiled-pages-runtime':'Pages probe/stage helper, web source/functions/public/config/export and mounted API/contracts; no hosted runner. Historical artifact hashes separately compared.',
 'production-worker-artifact':'Production probe uses API Worker bundle/source map/build mode plus fixture helper; no hosted runner. Historical artifact hashes separately compared.',
 'dependency-negatives':'Direct test/dependency patch helper/vendor patches/lock/package metadata; no hosted runner.',
}
commands=[]
for t in old['tests']:
 if t['id'] not in reasons:continue
 commands.append({'id':t['id'],'command':t['command'],'originalExecution':t,'currentApplicability':'functional input bytes equal; historical execution retained, not newly executed','functionalClosure':list(closure),'functionalClosureDigest':hashlib.sha256(json.dumps(closure,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'rootPackageSemanticEquality':'All fields and lifecycle scripts identical except test:hosted-mcp-browser; that script is not called by this command.','exclusionReason':reasons[t['id']]})
assert len(commands)==17
all98=json.loads((run/'all98-source-applicability.json').read_text())
feature_rows=[]
for f in all98['features']:
 refs=[]
 for r in f['sourceReferences']:
  p=r['path'];actual=sha(root/p);expected=r['currentSHA256'];assert actual==expected,(p,actual,expected);refs.append({'path':p,'sha256':actual,'equalsOriginalExecution':True})
 feature_rows.append({**{k:f[k] for k in ['featureId','area','acceptance','dependsOn','uiRequired']},'sourceReferences':refs,'functionalSourceUnchanged':True,'evidenceBinding':'Current source continuity with explicitly inherited actual original command evidence; new held Mac/Linux hosted browser and diagnostics required separately.'})
artifacts={}
for label,files in [('staticExport',json.loads((run/'static-out.json').read_text())['files']),('installedParser',json.loads((run/'dependency-state-before.json').read_text()))]:
 mismatches=[p for p,h in files.items() if not (root/p).exists() or sha(root/p)!=h];artifacts[label]={'count':len(files),'mismatches':mismatches,'originalHashes':files}
prod=json.loads((run/'production-worker-result.json').read_text());bundle=root/prod['originalBundle'];artifacts['workerBundle']={'path':prod['originalBundle'],'expected':prod['originalBundleSHA256'],'actual':sha(bundle) if bundle.exists() else None}
report={'observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':'Fresh functional-source continuity attestation; inherited commands NOT executed again','baselineCommit':'e5c5687aadfac676699e35015477d2c3d4df72b3','originalReviewPath':str(base.relative_to(root)/'6b9865a09c1deb21b79942fb2014cb21fedde9972a0351b285c83fe3014fda01-round-1.json'),'sourceCompared':len(closure),'sourceMismatches':changes,'heldCurrentInputs':{p:sha(root/p) for p in held},'perCommand':commands,'all98':feature_rows,'artifactComparisons':artifacts,'linuxCompositeDisposition':'Old overall19th linux-product-gate global envelope includes changed runner and cannot be rebound. Original actual API/parser/pressure/offline/install/map results remain historical. All unchanged functional source/config/lock/fixture/limit/patch files and installed parser bytes compared here; changed hosted runner is never consumed by those subcommands. This attestation is new and distinct from original composite exit0.'}
out=pathlib.Path(__file__).parent/'continuity.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'sourceCompared':len(closure),'inheritedCommands':len(commands),'features':len(feature_rows),'sourceMismatches':changes,'artifactMismatches':{k:v.get('mismatches') for k,v in artifacts.items()},'workerBundleSame':artifacts['workerBundle']['actual']==artifacts['workerBundle']['expected']}))
