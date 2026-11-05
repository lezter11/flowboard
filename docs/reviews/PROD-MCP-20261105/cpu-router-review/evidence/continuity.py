import hashlib
import json
from pathlib import Path

BASE = Path('docs/reviews/PROD-MCP-20261105/cpu-router-review/evidence')
OLD = Path('docs/reviews/HOSTED-MCP-20261104/hosted-browser-linux-repair/independent-review/new-reviewer/0cd36f07dc66739a759272722d1da017f56588fb6f3a062805f3d62de6a95ea8-round-1.json')
PROMPT = Path('docs/reviews/PROD-MCP-20261105/independent-review/0585374a5972c9cad40f356ed57736acf7dbd989a7f449c2d8b262818f49bd2c-round-2.json')

def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def compare(record):
    return [p for p, expected in record['target']['files'].items() if not Path(p).is_file() or digest(p) != expected]

old = json.loads(OLD.read_text())
prompt = json.loads(PROMPT.read_text())
assert old['verdict'] == prompt['verdict'] == 'pass'
assert len(old['featureIds']) == 99 and len(old['criteriaResults']) == 157
old_changes = compare(old)
prompt_changes = compare(prompt)
assert prompt_changes == ['apps/api/src/http/app.ts'], prompt_changes
assert set(old_changes) == {'apps/api/src/http/app.ts', 'apps/api/wrangler.jsonc', 'apps/web/src/components/integrations/connections-panel.tsx', 'apps/web/src/styles/connections.css'}, old_changes
held = json.loads(Path('docs/reviews/PROD-MCP-20261105/cpu-local-gates/source-before.json').read_text())
held_changes = [p for p, expected in held.items() if not Path(p).is_file() or digest(p) != expected]
assert not held_changes, held_changes
assert digest('apps/api/src/http/app.ts') == digest(BASE / 'actual-main-source.txt')
criteria = json.loads(Path(old['criteriaPath']).read_text())
matrix = []
for feature in old['featureIds']:
    matrix.append({
        'featureId': feature,
        'historicalBackendReview': str(OLD),
        'historicalBackendReviewSHA256': digest(OLD),
        'historicalCriteria': [c for c in criteria['mandatoryCriteria'] if c.startswith(feature + ':')],
        'currentRouterApplicability': 'Mounted behavior is affected by shared router selection; current full API, boundary parity and security tests provide fresh local regression evidence. UI/static-only criteria retain historical executions and byte continuity only.',
        'currentGlobalApproval': False,
        'remainingForGlobalClosure': 'Reassess all157 original criteria with explicit current versus historical backend/UI/integration evidence and regenerate owning-role bindings only after that review. This scoped CPU review does not approve99 features.'
    })
result = {'status': 'pass', 'historicalFeatureCount': len(matrix), 'historicalCriteriaCount': len(criteria['mandatoryCriteria']),
    'historicalReview': str(OLD), 'historicalReviewSHA256': digest(OLD), 'historicalChangedFiles': old_changes,
    'promptReview': str(PROMPT), 'promptReviewSHA256': digest(PROMPT), 'promptChangedFiles': prompt_changes,
    'gateHeldSourceFiles': len(held), 'gateHeldSourceChanges': held_changes,
    'newBoundaryTestSHA256': digest('apps/api/test/router-boundaries.test.ts'),
    'unchangedUIProvenance': 'Every UI file in prompt-review842-file target matches. Prior UI/browser executions preserve actual historical source, commands and environments; no fresh execution is implied.',
    'matrix': matrix}
(BASE / 'feature-applicability.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({k: v for k, v in result.items() if k != 'matrix'}))
