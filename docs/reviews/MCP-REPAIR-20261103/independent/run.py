import datetime, json, os, pathlib, subprocess, sys
base = pathlib.Path(__file__).resolve().parent
root = base.parents[3]
commands = {
 'adversarial':'node docs/reviews/MCP-REPAIR-20261103/independent/adversarial.mjs',
 'independent-probes':'node docs/reviews/MCP-REPAIR-20261103/probes/acceptance.mjs',
 'typecheck':'npm run typecheck',
 'contracts':'npm test --workspace @flowboard/contracts',
 'mcp':'npm test --workspace @flowboard/mcp',
 'build-mcp':'npm run build --workspace @flowboard/mcp',
 'mcp-artifact':'npm run test:artifact --workspace @flowboard/mcp',
}
check = sys.argv[1]
env = {'PATH':os.environ['PATH'], 'HOME':'/private/tmp/flowboard-mcp-independent-home',
 'TMPDIR':'/private/tmp/', 'NODE_ENV':'test', 'WRANGLER_SEND_METRICS':'false',
 'NEXT_TELEMETRY_DISABLED':'1', 'ALLOW_REMOTE_DB':'false',
 'DATABASE_URL':'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55923/flowboard_mcp_probe',
 'FLOWBOARD_MCP_TEST_DATABASE_URL':'postgres://flowboard_harness:flowboard_local_only@127.0.0.1:55923/flowboard_mcp_probe',
 'FLOWBOARD_PROBE_REPORT':str(base/'acceptance-results.json')}
pathlib.Path(env['HOME']).mkdir(exist_ok=True)
start = datetime.datetime.now(datetime.timezone.utc).isoformat()
with (base/f'{check}.log').open('w') as log:
 log.write(f'Command: {commands[check]}\nStarted: {start}\nIndependent reviewer /root/mcp_gate_review; sanitized environment; synthetic localhost PostgreSQL55923 only\n\n'); log.flush()
 result = subprocess.run(commands[check], shell=True, cwd=root, env=env, stdout=log, stderr=subprocess.STDOUT)
 log.write(f'\nExit code: {result.returncode}\n')
record = {'id':check,'command':commands[check],'startedAt':start,'completedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exitCode':result.returncode,'evidencePath':str((base/f'{check}.log').relative_to(root))}
(base/f'{check}-command.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record)); print('\n'.join((base/f'{check}.log').read_text().splitlines()[-15:])); sys.exit(result.returncode)
