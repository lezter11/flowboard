"""Architect-coordinated current-candidate phase acceptance; never invents probe runs."""
from pathlib import Path
import csv, hashlib, json, subprocess, sys, datetime

ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(ROOT / 'scripts'))
from check_backend_review import validate_review

BASE = 'docs/reviews/FULL-REVALIDATION-20261104'
OUT = ROOT / BASE / 'owner-phase-revalidation'
COMMIT = 'd1c81f42fe306c352c9cb10f04883e251ead58bd'
OLD = 'docs/reviews/FULL-REVALIDATION-20261103/local-handoff-bindings'
CI = BASE + '/independent-import-review/ci-complete.json'
LOG = BASE + '/independent-import-review/ci-complete.log'

def read(p): return json.loads((ROOT / p).read_text())
def sha(p): return hashlib.sha256((ROOT / p).read_bytes()).hexdigest()
def write(p, value):
    path = ROOT / p
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')
def proof(p, command, result):
    return {'path': p, 'sha256': sha(p), 'command': command, 'result': result,
            'environment': 'Current Linux CI synthetic PostgreSQL/Node/workerd/Chromium; older extra probes explicitly attributed to their original executors and dates.'}

assert subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip() == COMMIT
ci = read(CI)
assert ci['headSha'] == COMMIT and ci['conclusion'] == 'success' and ci['status'] == 'completed'
steps = {s['name']: s for j in ci['jobs'] for s in j['steps']}
for step in ['Monorepo Typecheck', 'Contracts Tests', 'Web unit tests',
             'MCP tests and installed stdio artifact', 'API Test Suite (Ephemeral Postgres)',
             'Mounted MCP and real workerd integration', 'Next.js Web Build',
             'Browser integration with synthetic local accounts', 'API Worker Build (dry run, no credentials)']:
    assert steps[step]['conclusion'] == 'success', step
log = (ROOT / LOG).read_text()
assert 'tests 1771' in log and 'pass 1771' in log and '"runStatus":"passed"' in log
browser_lines = [s for s in log.splitlines() if '"runStatus":"passed"' in s]
assert len(browser_lines) == 1
browser = json.loads(browser_lines[0][browser_lines[0].index('{'):])
assert not any(r['status'] not in ('pass', 'observed') for r in browser['results'])
# Establish continuity rather than implying old extra browser probes were rerun.
unchanged = subprocess.check_output(['git', 'diff', '--name-only', 'c1ccbf800e1ba5ebbdd8556eb935810a6fc4aef1', COMMIT, '--',
                                     'apps/web', 'packages/contracts', 'scripts/e2e'], cwd=ROOT, text=True)
assert not unchanged.strip(), unchanged
rows = list(csv.DictReader((ROOT / 'docs/features.tsv').open(), delimiter='\t'))
reviews = {}
for rec in read(BASE + '/release-delta-review/final-record-index.json')['reviews']:
    for fid in rec['featureIds']: reviews[fid] = rec['path']
imp = BASE + '/independent-import-review/review.json'
for fid in read(imp)['featureIds']: reviews[fid] = imp
assert set(reviews) == {r['id'] for r in rows}
validated = {}
source_count = 0
for row in rows:
    fid = row['id']
    result = validate_review(reviews[fid], root=ROOT, feature_id=fid)
    assert result.passed, (fid, result.errors)
    validated[fid] = {'reviewPath': reviews[fid], 'reviewSHA256': sha(reviews[fid])}
    previous = read(f'{OLD}/{fid}.json')
    assert previous['acceptance'] == row['acceptance'], fid
    for src in previous['sourceAndTests']:
        assert sha(src['path']) == src['sha256'], (fid, src['path'])
        source_count += 1

# All acceptance checks run before changing any handoff. Preserve starting records.
for row in rows:
    for role in ('backend', 'ui', 'integration'):
        p = f'docs/handoffs/{role}/{row["id"]}.json'
        destination = f'{BASE}/owner-phase-revalidation/previous/{role}/{row["id"]}.json'
        if (ROOT / p).exists() and not (ROOT / destination).exists(): write(destination, read(p))

for row in rows:
    fid = row['id']; review = validated[fid]['reviewPath']; review_sha = validated[fid]['reviewSHA256']
    previous_path = f'{OLD}/{fid}.json'; previous = read(previous_path)
    record_path = f'{BASE}/owner-phase-revalidation/{fid}.json'
    record = {'featureId': fid, 'acceptance': row['acceptance'], 'candidateCommit': COMMIT,
              'actor': '/root Architect coordinating Backend/UI/integration acceptance',
              'verificationScope': 'local', 'hostedAcceptance': 'pending',
              'backendReviewPath': review, 'backendReviewSHA256': review_sha,
              'uiRequired': row['ui_required'] == 'yes', 'sourceAndTests': previous['sourceAndTests'],
              'sourceComparison': 'Every per-ID source/test SHA matches the prior accepted UI inventory; global web/contracts/browser harness has zero Git diff from c1 to candidate.',
              'originalPerIdEvidence': {'path': previous_path, 'sha256': sha(previous_path)},
              'currentCI': {'metadata': CI, 'metadataSHA256': sha(CI), 'log': LOG, 'logSHA256': sha(LOG),
                            'runId': 41777804549, 'all14RequiredCommandsPass': True},
              'currentBrowserAcceptance': browser,
              'decision': 'Current local acceptance: applicable current Linux tests/browser flows plus byte-identical per-ID UI implementation and new independently approved backend. Original extra product/expiry/layout probes retain their historical dates/environments and are not represented as newly executed.',
              'limits': ['No real provider, deployed storage/Hyperdrive, real timer, Claude client or production acceptance implied.',
                         'Current browser diagnostic is 14 pass + 2 observations, not exhaustive browser acceptance; retained extra historical probes apply only through verified byte continuity.'],
              'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    write(record_path, record)
    backend = read(f'docs/handoffs/backend/{fid}.json')
    backend.update(status='verified', verificationScope='local', hostedAcceptance='pending', reviewPath=review,
                   summary=f'{fid}: current-candidate independent Backend acceptance; hosted acceptance pending.')
    backend['evidence'] = [proof(review, f'python3 scripts/check_backend_review.py {review} --feature {fid}', 'Current feature-specific independent review validation passed.'),
                           proof(CI, 'Current GitHub Linux workflow all14 required commands', 'Completed successful exact candidate d1c81f4; full logs referenced in owner evidence.')]
    write(f'docs/handoffs/backend/{fid}.json', backend)
    if row['ui_required'] == 'yes':
        ui = read(f'docs/handoffs/ui/{fid}.json')
        ui.update(status='verified', verificationScope='local', hostedAcceptance='pending', backendReviewSHA256=review_sha,
                  summary=f'{fid}: current local UI acceptance via source continuity, fresh Linux UI/browser checks and current backend approval; UAT pending.')
        ui['evidence'] = [proof(record_path, f'python3 {BASE}/owner-phase-revalidation/revalidate.py', 'Per-ID source/tests, current backend, current Linux UI/browser evidence and historical extra-probe applicability checked.')]
        write(f'docs/handoffs/ui/{fid}.json', ui)
    integration = read(f'docs/handoffs/integration/{fid}.json')
    integration.update(status='verified', verificationScope='local', hostedAcceptance='pending', backendReviewSHA256=review_sha,
                       summary=f'{fid}: current local integrated acceptance, fresh backend/source/UI/CI bindings; UAT pending.')
    if row['ui_required'] == 'yes': integration['uiHandoffSHA256'] = sha(f'docs/handoffs/ui/{fid}.json')
    integration['evidence'] = [proof(record_path, f'python3 {BASE}/owner-phase-revalidation/revalidate.py', 'Current feature/source/backend/UI checks and successful complete Linux gates verified; hosted acceptance remains pending.')]
    write(f'docs/handoffs/integration/{fid}.json', integration)

summary = {'candidateCommit': COMMIT, 'backendValidated': len(validated),
           'uiRequiredValidated': sum(r['ui_required'] == 'yes' for r in rows),
           'localIntegrationValidated': len(rows), 'perIdSourceHashesChecked': source_count,
           'currentLinuxRunId': 41777804549, 'currentBrowserPass': sum(r['status'] == 'pass' for r in browser['results']),
           'currentBrowserObserved': sum(r['status'] == 'observed' for r in browser['results']),
           'reviews': validated, 'hostedAcceptance': 'pending', 'productionApproved': False}
write(BASE + '/owner-phase-revalidation/summary.json', summary)
print(json.dumps({k: v for k, v in summary.items() if k != 'reviews'}, indent=2))
