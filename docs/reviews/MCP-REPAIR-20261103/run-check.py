"""Run one frozen required check with an empty credential environment and preserve its real exit code."""
import datetime
import json
import os
from pathlib import Path
import subprocess
import sys

task = Path(__file__).resolve().parent
root = task.parents[2]
criteria = json.loads((task / 'criteria.json').read_text())
check_id = sys.argv[1]
round_number = int(sys.argv[sys.argv.index('--round') + 1]) if '--round' in sys.argv else 1
assert round_number >= 1
extra_commands = {
    'uat-dry-run': 'npm exec --workspace @flowboard/api -- wrangler deploy --env uat --dry-run --outdir dist/worker-uat',
    'web-tests': 'npm test --workspace @flowboard/web',
}
command = criteria['requiredTests'].get(check_id) or extra_commands[check_id]
task_home = Path('/private/tmp/flowboard-mcp-repair-home')
task_home.mkdir(exist_ok=True)
env = {
    'PATH': os.environ['PATH'], 'HOME': str(task_home), 'TMPDIR': '/private/tmp/',
    'NODE_ENV': 'test', 'WRANGLER_SEND_METRICS': 'false', 'NEXT_TELEMETRY_DISABLED': '1',
    'ALLOW_REMOTE_DB': 'false',
    'DATABASE_URL': 'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55923/flowboard_harness',
    'FLOWBOARD_ACCESS_TEST_DATABASE_URL': 'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55923/flowboard_access_test',
    'FLOWBOARD_MCP_TEST_DATABASE_URL': 'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55923/flowboard_mcp_probe',
}
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
raw = task / ('raw' if round_number == 1 else f'raw-round-{round_number}')
raw.mkdir(exist_ok=True)
env['FLOWBOARD_PROBE_REPORT'] = str(raw / 'acceptance-results.json')
log = raw / f'{check_id}.log'
with log.open('w') as output:
    output.write(f'Command: {command}\nStarted: {started}\nEnvironment: sanitized, synthetic localhost PostgreSQL55923, PostgreSQL17.11-alpine image266d3c257594\n\n')
    output.flush()
    result = subprocess.run(command, shell=True, cwd=root, env=env, stdout=output, stderr=subprocess.STDOUT)
    output.write(f'\nExit code: {result.returncode}\n')
record = {'id': check_id, 'command': command, 'startedAt': started,
          'completedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'exitCode': result.returncode, 'evidencePath': str(log.relative_to(root)),
          'databasePort': 55923, 'databaseImage': 'postgres:17.11-alpine',
          'databaseImageId': 'sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b'}
(raw / f'{check_id}-command.json').write_text(json.dumps(record, indent=2) + '\n')
print(json.dumps(record))
lines = log.read_text().splitlines()
print('\n'.join(lines[-22:]))
sys.exit(result.returncode)
