from pathlib import Path
import json, hashlib
root=Path.cwd()
operation=root/'docs/reviews/PROD-MCP-20261105/operations'
expected=json.loads((operation/'migration-manifest.json').read_text())['files']
uat=json.loads((root/'docs/reviews/FULL-REVALIDATION-20261104/uat-preparation/migrations-d1c81f4.json').read_text())
oauth=json.loads((root/'docs/reviews/HOSTED-MCP-20261104/release-dce1a67/migration-receipt.json').read_text())
prior=json.loads((root/'docs/reviews/HOSTED-MCP-20261104/independent-backend-review/f8dd31431a65dd6b28ca238f6060a55b2ccfacfe7372f15a9b0ca44116a42421-final-manual-round-4.json').read_text())
for item in expected:
 actual=hashlib.sha256((root/'database/migrations'/item['name']).read_bytes()).hexdigest()
 assert actual==item['sha256']
 assert prior['target']['files']['database/migrations/'+item['name']]==actual
 if int(item['version'])<=26: assert uat['migrationSHA256'][item['name']]==actual
 else: assert oauth['migrationSha256']==actual
runner='apps/api/src/adapters/migrations.ts'
assert prior['target']['files'][runner]==hashlib.sha256((root/runner).read_bytes()).hexdigest()
assert uat['status']=='pass' and len(uat['before'])==19 and len(uat['after'])==26 and len(uat['applied'])==7
assert oauth['status']=='pass' and oauth['exitCode']==0 and len(oauth['before'])==26 and len(oauth['after'])==27 and len(oauth['applied'])==1
initial=json.loads((root/'docs/reviews/PROD-MCP-20261105/operations-review/initial-source-manifest.json').read_text())
changed=[p for p,h in initial.items() if hashlib.sha256((root/p).read_bytes()).hexdigest()!=h]
assert not changed, changed
print(json.dumps({'status':'pass','migrationCount':27,'historicalUatTransition':[19,26,27],'migrationAndRunnerBytesMatchPriorIndependentReview':True,'initialReviewedInputsUnchanged':True,'historicalEvidenceOnly':True,'productionTouched':False},indent=2))
