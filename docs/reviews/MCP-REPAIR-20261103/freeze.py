"""Freeze task source before independent review. Evidence logs are finalized separately."""
import datetime
import hashlib
import json
from pathlib import Path
import subprocess
import sys

task = Path(__file__).resolve().parent
root = task.parents[2]
roots = [
    'AGENTS.md', 'RULES.md', 'BACKEND_REVIEW_GATE.md', 'PRD.md', 'ARCHITECTURE.md',
    'DESIGN.md', 'TASKS.md', 'PROGRESS.md', 'package.json', 'package-lock.json',
    'tsconfig.json', '.node-version', '.gitignore', '.github/workflows/ci.yml',
    'apps/api/src', 'apps/api/test', 'apps/api/scripts', 'apps/api/package.json',
    'apps/api/tsconfig.build.json', 'apps/api/wrangler.jsonc',
    'apps/web/src', 'apps/web/functions', 'apps/web/test', 'apps/web/public',
    'apps/web/package.json', 'apps/web/next.config.ts', 'apps/web/tsconfig.json',
    'apps/web/postcss.config.mjs', 'apps/web/tailwind.config.ts',
    'apps/web/wrangler.uat.jsonc', 'apps/web/wrangler.prod.jsonc',
    'database/migrations', 'database/compose.local.yaml',
    'packages/contracts/src', 'packages/contracts/test', 'packages/contracts/package.json',
    'packages/mcp/src', 'packages/mcp/test', 'packages/mcp/scripts',
    'packages/mcp/package.json', 'packages/mcp/tsconfig.json', 'packages/mcp/tsconfig.test.json',
    'packages/mcp/README.md', 'scripts/create_pat.ts', 'scripts/check_backend_review.py',
    'scripts/generate_review_record.py', 'scripts/render_feature_checklist.py', 'scripts/stage-pages-functions.mjs',
    'docs/API.md', 'docs/FEATURE_SPEC.md', 'docs/FEATURE_CHECKLIST.md', 'docs/IMPORT_SPEC.md',
    'docs/features.tsv', 'docs/handoffs/README.md', 'docs/ENGINEERING_CHECKLIST.md',
    'docs/references/README.md', 'docs/SECURITY_ROADMAP.md',
    'docs/decisions/2026-10-28-beta-risk-acceptance.md',
    'docs/decisions/2026-10-28-uat-first-release-policy.md',
    'docs/decisions/2026-11-03-mcp-capability-boundary.md',
    'docs/reviews/README.md', 'docs/reviews/record.template.json', 'docs/reviews/criteria.template.json',
    'docs/reviews/MCP-REPAIR-20261103/criteria.json',
    'docs/reviews/MCP-REPAIR-20261103/probes',
    'docs/reviews/MCP-REPAIR-20261103/run-check.py',
    'docs/reviews/MCP-REPAIR-20261103/freeze.py',
    'docs/reviews/MCP-REPAIR-20261103/preflight.md',
    'docs/reviews/MCP-REPAIR-20261103/UAT-TEST-PLAN.md',
]
files = {}
for rel in roots:
    path = root / rel
    assert path.exists(), rel
    for entry in sorted(path.rglob('*')) if path.is_dir() else [path]:
        assert not entry.is_symlink(), 'A scoped symlink is not allowed'
        if entry.is_file():
            files[entry.relative_to(root).as_posix()] = hashlib.sha256(entry.read_bytes()).hexdigest()
digest = hashlib.sha256(json.dumps(files, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
round_number = int(sys.argv[sys.argv.index('--round') + 1]) if '--round' in sys.argv else 1
assert round_number >= 1
destination = task / ('source-manifest.json' if round_number == 1 else f'source-manifest-round-{round_number}.json')
if '--verify' in sys.argv:
    previous = json.loads(destination.read_text())
    assert previous['files'] == files and previous['digest'] == digest, 'SOURCE CHANGED: review invalidated'
    print(f'Source unchanged: {len(files)} files, digest {digest}')
else:
    assert not destination.exists(), 'Never overwrite a frozen source target; preserve a new review round'
    manifest = {
        'kind': 'sha256-manifest',
        'baseRevision': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip(),
        'branch': subprocess.check_output(['git', 'branch', '--show-current'], cwd=root, text=True).strip(),
        'frozenAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'scopeRoots': roots, 'files': files, 'digest': digest,
        'toolVersions': {'node': '24.15.0', 'npm': '11.12.1', 'typescript': '7.0.2', 'pg': '8.23.1',
                         'hono': '4.13.14', 'mcpSdk': '1.32.2', 'next': '15.5.28'},
        'database': {'host': '127.0.0.1', 'port': 55923, 'image': 'postgres:17.11-alpine',
                     'imageId': 'sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'},
    }
    destination.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Frozen {len(files)} source/criteria files: {digest}')
