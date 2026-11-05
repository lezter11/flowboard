"""Pure synthetic parser/privacy/process tests. Never invokes Wrangler or a database."""
import importlib.util
import json
import pathlib
import signal
import subprocess
import sys
import tempfile
import time
import unittest

SOURCE = pathlib.Path(__file__).with_name('cpu-observer.py')
spec = importlib.util.spec_from_file_location('cpu_observer', SOURCE)
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)
VERSION = '12345678-1234-1234-1234-123456789abc'
PRIVATE = 'SYNTHETIC_PRIVATE_NEVER_PERSIST'


def event(outcome='ok', **extra):
    return {'scriptName': 'flowboard-api-uat', 'outcome': outcome, 'logs': [], 'exceptions': [], **extra}


class ObserverTests(unittest.TestCase):
    def aggregate(self):
        return observer.Aggregator('uat', VERSION, 1)

    def test_fragmented_concatenated_events_redact_every_untrusted_field(self):
        a = self.aggregate()
        parser = observer.StreamParser(a)
        fixtures = [event(event={'request': {'url': 'https://example.invalid/api/v1/cards/' + PRIVATE + '?token=' + PRIVATE,
            'headers': {'Authorization': PRIVATE, 'Cookie': PRIVATE}}, 'response': {'status': 503}},
            exceptions=[{'name': PRIVATE, 'message': PRIVATE}], logs=[{'level': 'error', 'message': [PRIVATE]}]),
            event('exceededCpu', event={'request': {'url': 'https://example.invalid/api/v1/mcp?code=' + PRIVATE}},
                  exceptions=[{'message': 'CPU time limit exceeded ' + PRIVATE}], cpuTime=12.5),
            event(PRIVATE, event={'cron': PRIVATE, 'scheduledTime': PRIVATE}, cpuTime=0),
            event(scriptName='foreign-' + PRIVATE),
            event(event={'request': {'url': 'https://example.invalid/api/v1/session/' + PRIVATE}, 'cpuTime': 7})]
        wire = ('CLI startup\n' + ''.join(json.dumps(obj, indent=2) for obj in fixtures)).encode()
        for index in range(0, len(wire), 11):
            parser.feed(wire[index:index + 11])
        parser.finish()
        r = a.report
        self.assertEqual(r['events'], 4)
        self.assertEqual(r['cpuTerminationCount'], 1)
        self.assertEqual(r['outcomes']['ok']['exceptions'], 1)
        self.assertEqual(r['outcomes']['ok']['errorLogs'], 1)
        self.assertEqual(r['endpointFamilies']['cards']['httpStatuses'], {'503': 1})
        self.assertEqual(r['endpointFamilies']['mcp']['cpuTerminations'], 1)
        self.assertEqual(r['endpointFamilies']['mcp']['outcomes'], {'exceededCpu': 1})
        self.assertEqual(r['exceptionCategories'], {'other': 1, 'cpu': 1})
        self.assertEqual(r['nativeCpuTime']['count'], 3)
        self.assertEqual(r['nativeCpuTime']['sum'], 19.5)
        self.assertEqual(r['nativeCpuTime']['max'], 12.5)
        self.assertEqual(r['nativeCpuTime']['fieldCounts'], {'cpuTime': 2, 'event.cpuTime': 1})
        saved = json.dumps(r)
        for private in (PRIVATE, 'Authorization', 'Cookie', 'https://', '?token=', 'CLI startup'):
            self.assertNotIn(private, saved)

    def test_endpoint_family_allowlist_and_prefix_boundaries(self):
        paths = {'/health/ready': 'health', '/api/v1/auth/google/callback': 'session',
                 '/api/v1/mcp': 'mcp', '/api/v1/%6dcp': 'mcp',
                 '/api/v1/mcp/oauth/token': 'mcp-oauth', '/api/v1/mcp/connections/id': 'mcp-oauth',
                 '/api/v1/mcp/authorization-requests/id': 'mcp-oauth',
                 '/api/v1/projects/id': 'projects', '/api/v1/boards/id': 'boards',
                 '/api/v1/cards/id': 'cards', '/api/v1/notifications/id': 'notifications',
                 '/api/v1/cards-private/id': 'other', '/unknown': 'other'}
        for path, expected in paths.items():
            self.assertEqual(observer.endpoint_family({'request': {'url': 'https://example.invalid' + path + '?secret=' + PRIVATE}}), expected)
        self.assertEqual(observer.endpoint_family({'request': {'url': 'http://['}}), 'other')

    def test_fixed_exception_and_exact_source_log_labels(self):
        a = self.aggregate()
        a.accept(event('exception', exceptions=[{'message': text + PRIVATE} for text in (
            'CPU time limit exceeded ', 'The I/O context associated with this object has been canceled. ',
            'Cannot perform I/O on behalf of a different request. ', 'Connection terminated unexpectedly ', 'arbitrary ')],
            logs=[{'level': 'error', 'message': ['Idle PostgreSQL connection failed']},
                  {'level': 'error', 'message': ['Idle PostgreSQL connection failed ' + PRIVATE]},
                  {'level': 'error', 'message': [json.dumps({'event': 'scheduled_job_failed', 'jobs': ['trash-purge', PRIVATE, 'outbox', 'outbox'], 'error': PRIVATE})]},
                  {'level': 'warn', 'message': [{'event': 'scheduled_job_failed', 'jobs': [PRIVATE]}]}]))
        r = a.report
        self.assertEqual(r['exceptionCategories'], {'cpu': 1, 'io-context-canceled': 1, 'cross-request-io': 1, 'connection-closed': 1, 'other': 1})
        self.assertEqual(r['sourceLogLabels'], {'handled_idle_postgres_connection_error': 1, 'scheduled_job_failed': 2})
        self.assertEqual(r['scheduledFailedJobs'], {'outbox': 1, 'trash-purge': 1})
        self.assertEqual(r['errorLogCount'], 3)
        self.assertEqual(r['cpuTerminationCount'], 0)  # A message category is not a provider CPU termination.
        self.assertNotIn(PRIVATE, json.dumps(r))

    def test_parser_bound_depth_timeout_and_incomplete(self):
        a = self.aggregate()
        parser = observer.StreamParser(a)
        parser.feed(b'{' + b'x' * observer.MAX_BUFFER)
        self.assertEqual(a.report['parserOverflows'], 1)
        self.assertEqual(parser.buffer, '')
        parser.feed(b'{"deep":' + b'[' * 100000)
        self.assertEqual(a.report['parserFailures'], 1)
        parser.feed(b'{"unfinished":')
        parser.pending_since = time.monotonic() - 16
        parser.expire()
        self.assertEqual(a.report['parserFailures'], 2)
        parser.feed(b'{"outcome":')
        parser.finish()
        self.assertEqual(a.report['parserIncomplete'], 1)

    def test_invalid_utf8_cannot_expand_buffer_past_cap_and_quoted_braces_are_safe(self):
        a = self.aggregate()
        parser = observer.StreamParser(a)
        parser.feed(b'{"message":"' + b'\xff' * (observer.MAX_BUFFER // 2))
        self.assertEqual(a.report['parserOverflows'], 1)
        self.assertEqual(parser.buffer, '')
        wire = json.dumps(event(logs=[{'level': 'log', 'message': ['{' * 100 + '"\\' + PRIVATE]}])).encode()
        for index in range(0, len(wire), 7):
            parser.feed(wire[index:index + 7])
        parser.finish()
        self.assertEqual(a.report['events'], 1)
        self.assertEqual(a.report['parserFailures'], 0)
        self.assertNotIn(PRIVATE, json.dumps(a.report))

    def test_invalid_shapes_and_cpu_fields_never_become_report_keys(self):
        a = self.aggregate()
        for cpu in (True, '12', float('nan'), float('inf'), -1, {'secret': PRIVATE}):
            a.accept(event(cpuTime=cpu))
        a.accept(event(outcome={'secret': PRIVATE}, logs={}, exceptions=PRIVATE))
        a.accept(event(logs=[PRIVATE]))
        self.assertEqual(a.report['nativeCpuTime']['available'], False)
        self.assertEqual(a.report['nativeCpuTime']['count'], 0)
        self.assertEqual(a.report['nativeCpuTime']['invalidCount'], 6)
        self.assertEqual(a.report['invalidEvents'], 2)
        self.assertIn('other', a.report['outcomes'])
        self.assertNotIn(PRIVATE, json.dumps(a.report, allow_nan=False))

    def test_cleanliness_stays_strict_even_when_cpu_termination_zero(self):
        a = self.aggregate()
        a.accept(event(event={'cron': '* * * * *'}))
        a.report.update(windowCompleted=True, cleanup=True)
        self.assertEqual(a.finish()['status'], 'observed-no-errors')
        a.accept(event(logs=[{'level': 'error', 'message': ['Idle PostgreSQL connection failed']}]))
        self.assertEqual(a.report['cpuTerminationCount'], 0)
        self.assertEqual(a.finish()['status'], 'needs-inspection')
        for change in ({'windowCompleted': False}, {'scheduledOk': 0}, {'stderrBytes': 1}, {'parserFailures': 1}, {'interrupted': True}):
            b = self.aggregate()
            b.accept(event(event={'cron': '* * * * *'}))
            b.report.update(windowCompleted=True, cleanup=True)
            b.report.update(change)
            self.assertEqual(b.finish()['status'], 'needs-inspection')

    def test_validation_and_direct_cli_environment(self):
        observer.validate('uat', VERSION, 'probe_1', 900)
        for args in (('prod', VERSION, 'a', 1), ('uat', '../bad', 'a', 1), ('uat', VERSION, '../a', 1),
                     ('uat', VERSION, 'x' * 49, 1), ('uat', VERSION, 'UPPER', 1), ('uat', VERSION, 'a', 0), ('uat', VERSION, 'a', 901)):
            with self.assertRaises(ValueError):
                observer.validate(*args)
        command = observer.tail_command(pathlib.Path('/synthetic'), 'production', VERSION)
        self.assertEqual(command, ['node', '/synthetic/node_modules/wrangler/wrangler-dist/cli.js', 'tail', 'flowboard-api', '--format', 'json', '--version-id', VERSION])
        self.assertFalse(any('sampling' in arg for arg in command))
        self.assertEqual(observer.tail_environment()['WRANGLER_WRITE_LOGS'], 'false')
        self.assertNotIn('CLOUDFLARE_API_TOKEN', observer.tail_environment())

    def test_synthetic_child_normal_window_and_stderr_redaction(self):
        a = self.aggregate()
        wire = json.dumps(event(event={'cron': '* * * * *'}))
        command = [sys.executable, '-c', f'import sys,time; print({wire!r},flush=True); sys.stderr.write({PRIVATE!r}); sys.stderr.flush(); time.sleep(30)']
        publications = []
        code = observer.observe(a, command, None, None, lambda report: publications.append(json.dumps(report)))
        self.assertEqual(code, 0)
        self.assertTrue(a.report['windowCompleted'])
        self.assertTrue(a.report['cleanup'])
        self.assertEqual(a.report['events'], 1)
        self.assertEqual(a.report['stderrBytes'], len(PRIVATE))
        self.assertEqual(a.report['status'], 'needs-inspection')
        self.assertNotIn(PRIVATE, ''.join(publications))

    def test_synthetic_child_early_exit_and_launch_failure(self):
        for command in ([sys.executable, '-c', 'raise SystemExit(7)'], ['/nonexistent/synthetic-observer-child']):
            a = self.aggregate()
            self.assertEqual(observer.observe(a, command, None, None, lambda _r: None), 2)
            self.assertFalse(a.report['windowCompleted'])
            self.assertTrue(a.report['cleanup'])
            self.assertEqual(a.report['status'], 'needs-inspection')

    def test_synthetic_child_ignoring_sigint_is_killed(self):
        a = self.aggregate()
        command = [sys.executable, '-c', 'import signal,time; signal.signal(signal.SIGINT, signal.SIG_IGN); time.sleep(30)']
        self.assertEqual(observer.observe(a, command, None, None, lambda _r: None, cleanup_seconds=0.05), 0)
        self.assertEqual(a.report['tailExitCode'], -signal.SIGKILL)
        self.assertTrue(a.report['cleanup'])
        self.assertTrue(a.report['cleanupEscalated'])
        self.assertEqual(a.report['status'], 'needs-inspection')

    def test_main_sigint_preserves_exit130_incomplete_and_only_safe_owned_files(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = pathlib.Path(directory) / 'docs/reviews/synthetic'
            folder.mkdir(parents=True)
            (pathlib.Path(directory) / 'apps/api').mkdir(parents=True)
            wrapper = f'''import importlib.util,sys
s=importlib.util.spec_from_file_location('observer',{str(SOURCE)!r});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.__file__={str(folder / 'cpu-observer.py')!r}
m.tail_command=lambda *args:[sys.executable,'-c','import time; time.sleep(30)']
raise SystemExit(m.main(['--target','uat','--version',{VERSION!r},'--label','synthetic-interrupt','--seconds','30']))
'''
            child = subprocess.Popen([sys.executable, '-c', wrapper], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            deadline = time.monotonic() + 5
            while not list(folder.glob('*.lock')) and time.monotonic() < deadline:
                time.sleep(0.01)
            time.sleep(0.1)
            child.send_signal(signal.SIGINT)
            out, err = child.communicate(timeout=12)
            self.assertEqual(child.returncode, 130)
            self.assertEqual(err, b'')
            report = json.loads(out)
            self.assertTrue(report['cleanup'])
            self.assertTrue(report['interrupted'])
            self.assertFalse(report['windowCompleted'])
            self.assertEqual(report['observerExitCode'], 130)
            self.assertEqual(report['status'], 'needs-inspection')
            self.assertEqual(sorted(path.name for path in folder.iterdir()), ['cpu-observer-uat-synthetic-interrupt-progress.json', 'cpu-observer-uat-synthetic-interrupt.json'])
            self.assertEqual(json.loads((folder / 'cpu-observer-uat-synthetic-interrupt.json').read_text()), report)


if __name__ == '__main__':
    unittest.main(verbosity=2)
