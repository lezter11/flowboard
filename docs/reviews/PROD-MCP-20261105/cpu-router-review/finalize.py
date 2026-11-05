import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

B = Path('docs/reviews/PROD-MCP-20261105/cpu-router-review')
E = B / 'evidence'
G = Path('docs/reviews/PROD-MCP-20261105/cpu-local-gates')
results = json.loads((G / 'results.json').read_text())
assert len(results) == 8 and all(x['exitCode'] == 0 for x in results), 'All eight local gates required'
after = json.loads((G / 'source-after.json').read_text())
assert after['changed'] == [], 'Held source changed during tests'
for result in results:
    src = Path(result['evidencePath'])
    assert src.stat().st_size > 0
    result['evidencePath'] = str(E / 'local-gates' / src.name)
    result['executedBy'] = '/root (operator); logs/source hold independently inspected by /root/cpu_router_independent_review'
    Path(result['evidencePath']).parent.mkdir(exist_ok=True)
    shutil.copyfile(src, result['evidencePath'])
for name in ['harness.json', 'results.json', 'source-before.json', 'source-after.json']:
    shutil.copyfile(G / name, E / 'local-gates' / name)
criteria = json.loads((B / 'criteria.json').read_text())
for test_id, filename in [('independent-parity','independent-parity'), ('independent-boundaries','independent-boundaries'), ('source-continuity','continuity'), ('independent-performance','independent-performance'), ('independent-postgres','independent-postgres')]:
    assert (E / (filename + '.log')).stat().st_size > 0
    result = json.loads((E / (filename + '.json')).read_text()) if filename not in ['continuity','independent-postgres'] else None
    if result: assert result['status'] in ['pass','measured']
    if filename == 'independent-postgres':
        log = (E / (filename + '.log')).read_text()
        assert '"exitCode":0' in log and 'ℹ fail 0' in log and 'ℹ skipped 0' in log
    results.append({'id':test_id, 'command':criteria['requiredTests'][test_id], 'exitCode':0, 'environment':'Independent reviewer; Node24.15.0; local synthetic no-DB probes or serial dedicated PostgreSQL17.11 loopback60488; no cloud credentials', 'isolatedSynthetic':True, 'targetDigest':'pending', 'evidencePath':str(E / (filename + '.log')), 'executedBy':'/root/cpu_router_independent_review'})
old_path = Path('docs/reviews/HOSTED-MCP-20261104/hosted-browser-linux-repair/independent-review/new-reviewer/0cd36f07dc66739a759272722d1da017f56588fb6f3a062805f3d62de6a95ea8-round-1.json')
prompt_path = Path('docs/reviews/PROD-MCP-20261105/independent-review/0585374a5972c9cad40f356ed57736acf7dbd989a7f449c2d8b262818f49bd2c-round-2.json')
old, prompt = [json.loads(p.read_text()) for p in [old_path,prompt_path]]
held = json.loads((G / 'source-before.json').read_text())
roots = {str(E), str(B / 'criteria.json'), str(old_path), str(prompt_path), old['criteriaPath'], prompt['criteriaPath']}
roots.update(held)
roots.update(p for p in prompt['target']['files'] if p.startswith(('apps/','packages/','database/','scripts/')))
roots.update(['package.json','package-lock.json','tsconfig.json','.node-version','.github/workflows/ci.yml'])
for historical in [old,prompt]:
    roots.update(test['evidencePath'] for test in historical['tests'])
    roots.add(historical['reviewer']['independenceEvidence'])
perf = Path('docs/reviews/PROD-MCP-20261105/operations-review/release-check/performance')
roots.update(str(perf / name) for name in ['README.md','summary.json','source-and-evidence-manifest.json','current-benchmark.json','current-trie-benchmark.json','trie-router-parity.json','mounted-router-parity.json','router-parity.json','router-parity-initial-includes-keyorder.json'])
runtime_perf = Path('docs/reviews/PROD-MCP-20261105/performance-investigation')
roots.update(str(runtime_perf / name) for name in ['RESULT.md','current-loop-internal-loops.json','trie-loop-internal-loops.json','trie-derivation.json'])
common = [str(E / 'source-review.md'), str(E / 'independent-parity.json'), str(E / 'independent-boundaries.json')]
categories = {
 'security': {'weight':30,'score':'9.2','reason':'Original authority middleware/order unchanged; actual decoded handler/order parity and649 hostile/negative mounted variants pass, plus full real-PG authority/MCP/cookie/PAT suites and independent focused rerun. Exhaustive URL space cannot be proven by finite probes.', 'evidencePaths':common+[str(E/'local-gates/api.log'),str(E/'independent-postgres.log')]},
 'correctness': {'weight':25,'score':'9.2','reason':'All242 registrations,2400representative,1183decoded and20280additional adversarial cases preserve matched handlers/params; unsupported methods and exact MCP/discovery boundaries retain responses. Full local contracts/API/MCP/native/build gates pass. Local scope does not claim hosted owner acceptance.', 'evidencePaths':common+[str(E/'local-gates/contracts.log'),str(E/'local-gates/native-mcp.log')]},
 'integrity': {'weight':15,'score':'9.0','reason':'No SQL, schema, transaction, identity or pool lifecycle changes. Full synthetic PostgreSQL concurrency/integrity suite passed; focused mounted MCP tests include separate-connection create/disconnect lock orders and Worker create/replay. Read-only malformed/decoded ancestry fixture fingerprints are unchanged. This is regression acceptance, not fresh proof of every historical feature invariant.', 'evidencePaths':[str(E/'source-review.md'),str(E/'local-gates/api.log'),str(E/'local-gates/router-boundaries.log'),str(E/'independent-postgres.log')]},
 'tests': {'weight':15,'score':'9.0','reason':'All13 frozen command groups have actual passing logs tied to held source; reviewer ran independent differential/adversarial and real-PG mounted checks. Operator eight-gate execution provenance is explicit. Historical99/UI commands remain historical; no global feature/UI approval is asserted.', 'evidencePaths':[str(E/'local-gates/results.json'),str(E/'local-gates/source-after.json'),str(E/'independent-postgres.log'),str(E/'feature-applicability.json')]},
 'maintainability': {'weight':10,'score':'9.1','reason':'Minimal supported exported router selection with pinned Hono4.13.14; no custom matcher, new dependency, cache or shared state. Both Node/actual local Worker checks pass and installed router/runtime source snapshot is retained. Existing request-local app rebuild remains deliberately, trading some per-request registration work for lifecycle safety.', 'evidencePaths':[str(E/'source-review.md'),str(E/'installed-hono-manifest.json'),str(E/'local-gates/typecheck.log'),str(E/'local-gates/build.log')]},
 'operations': {'weight':5,'score':'8.4','reason':'Actual patched source relative Node measurements plus preserved actual workerd corroboration show lower local CPU without changing limits/pools; rollback and failed hosted evidence remain. No hosted CPU/headroom or exception-resolution claim is made. Synthetic timing and possible JIT/order/GC effects limit confidence in absolute cost and hosted causality.', 'evidencePaths':[str(E/'independent-performance.json'),str(perf/'README.md'),str(runtime_perf/'RESULT.md'),str(E/'CPU-INCIDENT.md')]}
}
record = {'schemaVersion':1,'criteriaVersion':'backend-review-v1','featureIds':criteria['featureIds'],'criteriaPath':str(B/'criteria.json'),
 'startedAt':'2026-11-05T11:40:41Z','completedAt':datetime.now(timezone.utc).isoformat(),
 'implementer':{'actorId':'/root/cpu_router_builder','sessionId':'canonical-delegated-session:/root/cpu_router_builder (provider UUID not exposed)','model':'gpt-6.1-sol medium'},
 'reviewer':{'actorId':'/root/cpu_router_independent_review','sessionId':'canonical-delegated-session:/root/cpu_router_independent_review (provider UUID not exposed)','model':'Inherited Codex GPT-6 family; exact provider model identifier not exposed','independent':True,'freshContext':True,'implementedTarget':False,'independenceEvidence':str(E/'reviewer-session.md')},
 'target':{'kind':'sha256-manifest','scopeRoots':sorted(roots),'files':{},'digest':'pending'},'criteriaResults':{c:'pass' for c in criteria['mandatoryCriteria']},'tests':results,'categories':categories,'weightedScore':'pending',
 'findings':[{'id':'CPU-CANDIDATE-01','severity':'informational','description':'Considered whether encoded/malformed IDs, exact MCP slash boundaries or handler ordering change under TrieRouter and bypass existing security middleware.','disposition':'rejected','rationale':'Actual source differential coverage plus mounted real-PG boundary tests and649full-response variants found0differences.64concurrent contexts retained distinct pools/limits/IDs. Finite probes do not imply universal URL proof.','mandatory':False,'blocking':False}, {'id':'CPU-CANDIDATE-02','severity':'informational','description':'Considered replacing all request-local apps with one cached app to reduce CPU further.','disposition':'rejected','rationale':'Existing app captures request pools/storage/limits/work-lifetime callbacks. The accepted explicit router choice avoids that broader mutable-lifecycle risk; no app cache was introduced.','mandatory':False,'blocking':False}],
 'hardBlockers':[],'coverageGaps':[],'verdict':'pass','scopeLimitations':criteria['scopeAndExclusions'],
 'historicalFeatureApproval':{'featureCount':99,'criteriaCount':157,'freshGlobalApproval':False,'applicabilityEvidence':str(E/'feature-applicability.json'),'note':'This CPU-only record does not approve old99-feature/UI/integration handoffs. Original records and their execution provenance are preserved and source-compared.'}}
(B/'draft-round-1.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps({'draft':str(B/'draft-round-1.json'),'scopeRoots':len(roots),'tests':len(results)}))
