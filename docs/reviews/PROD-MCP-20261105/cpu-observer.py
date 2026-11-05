"""Aggregate-only Worker tail. Importing this module never starts a tail.

No URLs, headers, arbitrary strings, log messages or exception text enter reports.
Native cpuTime is optional provider data; elapsed observation time is never CPU.
"""
import argparse
import codecs
import datetime
import json
import math
import os
import pathlib
import re
import selectors
import signal
import subprocess
import time
from urllib.parse import unquote, urlsplit

MAX_BUFFER = 2 * 1024 * 1024
OUTCOMES = frozenset(('ok', 'exception', 'exceededCpu', 'exceededMemory', 'canceled',
                      'unknown', 'invocationFailure', 'responseStreamDisconnected'))
JOBS = frozenset(('trash-purge', 'import-retention', 'orphan-uploads', 'pending-storage',
                 'outbox', 'outbox-retention', 'hosted-oauth-retention', 'rate-windows'))
WORKERS = {'uat': 'flowboard-api-uat', 'production': 'flowboard-api'}
VERSION = re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\Z')
LABEL = re.compile(r'[a-z0-9_-]{1,48}\Z')


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def validate(target, version, label, seconds):
    if target not in WORKERS or not VERSION.fullmatch(version) or not LABEL.fullmatch(label):
        raise ValueError('Invalid observer target, version or label')
    if type(seconds) is not int or not 1 <= seconds <= 900:
        raise ValueError('Observation seconds must be between 1 and 900')


def increment(counter, key, amount=1):
    counter[key] = counter.get(key, 0) + amount


def endpoint_family(event):
    request = event.get('request')
    raw = request.get('url') if isinstance(request, dict) else None
    if not isinstance(raw, str):
        return 'other'
    try:
        path = unquote(urlsplit(raw).path)
    except (ValueError, UnicodeError):
        return 'other'
    def under(prefix):
        return path == prefix or path.startswith(prefix + '/')
    if under('/health'):
        return 'health'
    if under('/api/v1/session') or under('/api/v1/auth'):
        return 'session'
    if any(under('/api/v1/mcp/' + child) for child in ('oauth', 'authorization-requests', 'connections')):
        return 'mcp-oauth'
    if under('/api/v1/mcp'):
        return 'mcp'
    for family in ('projects', 'boards', 'cards', 'notifications'):
        if under('/api/v1/' + family):
            return family
    return 'other'


def exception_category(entry):
    # Only fixed keys below can escape this function; never return input text/name.
    message = entry.get('message') if isinstance(entry, dict) else entry
    message = message.lower() if isinstance(message, str) else ''
    if 'cpu time limit' in message or 'exceeded cpu' in message:
        return 'cpu'
    if ('i/o context' in message or 'io context' in message) and ('cancel' in message or 'ended' in message):
        return 'io-context-canceled'
    if 'on behalf of a different request' in message or 'cross-request' in message:
        return 'cross-request-io'
    if any(text in message for text in ('connection closed', 'connection terminated', 'connection is closed')):
        return 'connection-closed'
    return 'other'


def log_labels(log):
    value = log.get('message')
    parts = value if isinstance(value, list) else [value]
    labels = set()
    jobs = set()
    for part in parts:
        if part == 'Idle PostgreSQL connection failed':
            labels.add('handled_idle_postgres_connection_error')
        if isinstance(part, str):
            # Source job labels are tiny objects; arbitrary log payloads earn no parse.
            if len(part) > 16384 or not part.lstrip().startswith('{') or StreamParser.too_deep(part):
                continue
            try:
                entry = json.loads(part)
            except (ValueError, TypeError, RecursionError):
                continue
        else:
            entry = part
        if isinstance(entry, dict) and entry.get('event') == 'scheduled_job_failed':
            labels.add('scheduled_job_failed')
            names = entry.get('jobs')
            if isinstance(names, list):
                jobs.update(name for name in names if isinstance(name, str) and name in JOBS)
    return labels, jobs


def bucket():
    return {'invocations': 0, 'exceptions': 0, 'errorLogs': 0, 'httpStatuses': {},
            'exceptionCategories': {}, 'cpuTerminations': 0, 'outcomes': {}}


class Aggregator:
    def __init__(self, target, version, seconds):
        self.worker = WORKERS[target]
        self.report = {
            'kind': 'bounded aggregate-only Worker observation, not owner acceptance',
            'target': target, 'worker': self.worker, 'version': version,
            'requestedSeconds': seconds, 'startedAt': now(), 'events': 0,
            'scheduledEvents': 0, 'scheduledOk': 0, 'exceptionCount': 0,
            'errorLogCount': 0, 'http5xx': 0, 'cpuTerminationCount': 0,
            'outcomes': {}, 'httpStatuses': {}, 'endpointFamilies': {},
            'exceptionCategories': {}, 'sourceLogLabels': {}, 'scheduledFailedJobs': {},
            'nativeCpuTime': {'available': False, 'fieldCounts': {}, 'count': 0,
                              'sum': 0, 'max': None, 'invalidCount': 0,
                              'units': 'provider-native-unverified'},
            'rawEventDataPersisted': False, 'parserOverflows': 0,
            'parserFailures': 0, 'parserIncomplete': 0, 'invalidEvents': 0,
            'stderrBytes': 0, 'windowCompleted': False, 'interrupted': False,
            'cleanupEscalated': False,
        }

    def accept(self, obj):
        if not isinstance(obj, dict) or 'outcome' not in obj:
            return
        if obj.get('scriptName') not in (None, self.worker):
            return
        r = self.report
        raw_outcome = obj.get('outcome')
        outcome = raw_outcome if isinstance(raw_outcome, str) and raw_outcome in OUTCOMES else 'other'
        event = obj.get('event')
        event = event if isinstance(event, dict) else {}
        exceptions, logs = obj.get('exceptions', []), obj.get('logs', [])
        if not isinstance(exceptions, list) or not isinstance(logs, list):
            r['invalidEvents'] += 1
            exceptions = exceptions if isinstance(exceptions, list) else []
            logs = logs if isinstance(logs, list) else []
        errors = sum(isinstance(log, dict) and log.get('level') == 'error' for log in logs)
        categories = {}
        for entry in exceptions:
            increment(categories, exception_category(entry))
        family = endpoint_family(event)
        status = event.get('response')
        status = status.get('status') if isinstance(status, dict) else None
        status = str(status) if type(status) is int and 100 <= status <= 599 else None
        r['events'] += 1
        r['exceptionCount'] += len(exceptions)
        r['errorLogCount'] += errors
        r['cpuTerminationCount'] += outcome == 'exceededCpu'
        if 'cron' in event or 'scheduledTime' in event:
            r['scheduledEvents'] += 1
            r['scheduledOk'] += outcome == 'ok'
        for group, key in ((r['outcomes'], outcome), (r['endpointFamilies'], family)):
            b = group.setdefault(key, bucket())
            b['invocations'] += 1
            b['exceptions'] += len(exceptions)
            b['errorLogs'] += errors
            b['cpuTerminations'] += outcome == 'exceededCpu'
            increment(b['outcomes'], outcome)
            for category, count in categories.items():
                increment(b['exceptionCategories'], category, count)
            if status:
                increment(b['httpStatuses'], status)
        for category, count in categories.items():
            increment(r['exceptionCategories'], category, count)
        if status:
            increment(r['httpStatuses'], status)
            r['http5xx'] += int(status) >= 500
        for log in logs:
            if not isinstance(log, dict):
                r['invalidEvents'] += 1
                continue
            labels, jobs = log_labels(log)
            for label in labels:
                increment(r['sourceLogLabels'], label)
            for job in jobs:
                increment(r['scheduledFailedJobs'], job)
        cpu = r['nativeCpuTime']
        # Prefer the root field when both appear: one native measurement/event.
        for field, source in (('cpuTime', obj), ('event.cpuTime', event)):
            if 'cpuTime' not in source:
                continue
            value = source['cpuTime']
            try:
                valid = type(value) in (int, float) and math.isfinite(value) and value >= 0 and math.isfinite(cpu['sum'] + value)
            except OverflowError:
                valid = False
            if valid:
                cpu['available'] = True
                increment(cpu['fieldCounts'], field)
                cpu['count'] += 1
                cpu['sum'] += value
                cpu['max'] = value if cpu['max'] is None else max(cpu['max'], value)
            else:
                cpu['invalidCount'] += 1
            break

    def finish(self):
        r = self.report
        # Keep the original strict operations criterion, including scheduled proof.
        clean = (r['windowCompleted'] and not r['interrupted'] and r.get('cleanup')
                 and r['events'] > 0 and r['scheduledOk'] > 0
                 and all(key == 'ok' for key in r['outcomes'])
                 and not any(r[key] for key in ('exceptionCount', 'errorLogCount', 'http5xx',
                     'parserOverflows', 'parserFailures', 'parserIncomplete', 'invalidEvents', 'stderrBytes'))
                 and not r['sourceLogLabels'] and not r['nativeCpuTime']['invalidCount']
                 and not r['cleanupEscalated'] and r.get('tailExitCode') in (None, 0, -signal.SIGINT, 130)
                 and not r.get('observerFailure'))
        r['status'] = 'observed-no-errors' if clean else 'needs-inspection'
        return r


class StreamParser:
    def __init__(self, aggregator):
        self.aggregator = aggregator
        self.buffer = ''
        self.decoder = codecs.getincrementaldecoder('utf8')(errors='replace')
        self.json_decoder = json.JSONDecoder()
        self.pending_since = None

    @staticmethod
    def too_deep(text):
        # Bound JSON object allocation even on Python decoders without a depth cap.
        depth, quoted, escaped = 0, False, False
        for character in text:
            if quoted:
                if escaped:
                    escaped = False
                elif character == '\\':
                    escaped = True
                elif character == '"':
                    quoted = False
            elif character == '"':
                quoted = True
            elif character in '[{':
                depth += 1
                if depth > 64:
                    return True
            elif character in ']}':
                depth -= 1
        return False

    def feed(self, chunk):
        # Input reads are bounded too. Reject rather than truncate/parse a suffix.
        if len(chunk) > MAX_BUFFER or len(self.buffer.encode('utf8')) + len(chunk) > MAX_BUFFER:
            self.aggregator.report['parserOverflows'] += 1
            self.buffer = ''
            self.decoder.reset()
            self.pending_since = None
            return
        self.buffer += self.decoder.decode(chunk)
        if len(self.buffer.encode('utf8')) > MAX_BUFFER:
            self.aggregator.report['parserOverflows'] += 1
            self.buffer = ''
            self.decoder.reset()
            self.pending_since = None
            return
        while self.buffer:
            index = self.buffer.find('{')
            if index < 0:
                self.buffer = ''  # CLI banners are discarded in memory.
                self.pending_since = None
                break
            self.buffer = self.buffer[index:]
            if self.too_deep(self.buffer):
                self.aggregator.report['parserFailures'] += 1
                self.buffer = ''
                self.pending_since = None
                break
            try:
                obj, end = self.json_decoder.raw_decode(self.buffer)
            except json.JSONDecodeError:
                if self.pending_since is None:
                    self.pending_since = time.monotonic()
                break
            except (ValueError, RecursionError):
                self.aggregator.report['parserFailures'] += 1
                self.buffer = ''
                self.pending_since = None
                break
            self.aggregator.accept(obj)
            self.buffer = self.buffer[end:].lstrip()
            self.pending_since = None

    def expire(self):
        if self.pending_since is not None and time.monotonic() - self.pending_since >= 15:
            self.aggregator.report['parserFailures'] += 1
            self.buffer = ''
            self.decoder.reset()
            self.pending_since = None

    def finish(self):
        if self.buffer or self.decoder.getstate()[0]:
            self.aggregator.report['parserIncomplete'] += 1
        self.buffer = ''
        self.decoder.reset()


def tail_command(repo, target, version):
    return ['node', str(repo / 'node_modules/wrangler/wrangler-dist/cli.js'),
            'tail', WORKERS[target], '--format', 'json', '--version-id', version]


def tail_environment():
    env = {key: value for key, value in os.environ.items() if key in ('HOME', 'PATH', 'TMPDIR')}
    env.update(NODE_ENV='production', NODE_OPTIONS='--dns-result-order=ipv4first',
               WRANGLER_SEND_METRICS='false', WRANGLER_WRITE_LOGS='false',
               CLOUDFLARE_ACCOUNT_ID='6592b59b0da4771dc346b96c6fdc65fd')
    return env


def observe(aggregator, command, cwd, env, publish, stop=None, cleanup_seconds=8):
    """Run a direct child; tests inject synthetic child commands, never a tail."""
    stop = stop if stop is not None else {'signal': None}
    r = aggregator.report
    parser = StreamParser(aggregator)
    child = None
    selector = selectors.DefaultSelector()
    start = time.monotonic()
    last_publish = start
    try:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        for pipe, name in ((child.stdout, 'stdout'), (child.stderr, 'stderr')):
            os.set_blocking(pipe.fileno(), False)
            selector.register(pipe, selectors.EVENT_READ, name)
        while not stop['signal']:
            elapsed = time.monotonic() - start
            if elapsed >= r['requestedSeconds']:
                r['windowCompleted'] = child.poll() is None
                break
            if not selector.get_map():
                break
            for key, _ in selector.select(timeout=min(0.25, r['requestedSeconds'] - elapsed)):
                try:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(key.fileobj)
                elif key.data == 'stdout':
                    parser.feed(chunk)
                else:
                    r['stderrBytes'] += len(chunk)
            parser.expire()
            if time.monotonic() - last_publish >= 5:
                r['observedSeconds'] = round(time.monotonic() - start, 3)
                publish(r)
                last_publish = time.monotonic()
    except (OSError, ValueError, RuntimeError):
        r['observerFailure'] = True  # Never retain exception text or raw stderr.
    finally:
        r['interrupted'] = bool(stop['signal'])
        if r['interrupted']:
            r['windowCompleted'] = False
        r['observedSeconds'] = round(time.monotonic() - start, 3)
        parser.finish()
        if child is not None:
            if child.poll() is None:
                try:
                    child.send_signal(signal.SIGINT)
                    try:
                        child.wait(timeout=cleanup_seconds)
                    except subprocess.TimeoutExpired:
                        r['cleanupEscalated'] = True
                        child.kill()
                        child.wait(timeout=5)
                except (OSError, subprocess.TimeoutExpired):
                    r['observerFailure'] = True
            r['tailExitCode'] = child.returncode
            for pipe in (child.stdout, child.stderr):
                pipe.close()
        selector.close()
        r['cleanup'] = child is None or child.poll() is not None
        r['completedAt'] = now()
    r['observerExitCode'] = 128 + stop['signal'] if stop['signal'] else (0 if r['windowCompleted'] and not r.get('observerFailure') else 2)
    aggregator.finish()
    publish(r)
    return r['observerExitCode']


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', choices=tuple(WORKERS), required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--label', required=True)
    parser.add_argument('--seconds', type=int, default=900)
    args = parser.parse_args(argv)
    try:
        validate(args.target, args.version, args.label, args.seconds)
    except ValueError:
        parser.error('Invalid target/version/label or seconds outside 1..900')
    folder = pathlib.Path(__file__).resolve().parent
    repo = folder.parents[2]
    stem = f'cpu-observer-{args.target}-{args.label}'
    final, progress, temporary, lock = (folder / (stem + suffix) for suffix in ('.json', '-progress.json', '.tmp', '.lock'))
    if any(os.path.lexists(path) for path in (final, progress, temporary, lock)):
        parser.error('Observer label already used; choose a fresh label')
    with lock.open('x'):
        pass
    def publish(report):
        with temporary.open('x') as output:
            json.dump(report, output, indent=2, allow_nan=False)
            output.write('\n')
        temporary.replace(progress)
    stop = {'signal': None}
    def interrupted(number, _frame):
        stop['signal'] = number
    previous = {number: signal.signal(number, interrupted) for number in (signal.SIGINT, signal.SIGTERM)}
    try:
        aggregator = Aggregator(args.target, args.version, args.seconds)
        code = observe(aggregator, tail_command(repo, args.target, args.version), repo / 'apps/api', tail_environment(), publish, stop)
        with final.open('x') as output:
            json.dump(aggregator.report, output, indent=2, allow_nan=False)
            output.write('\n')
        print(json.dumps(aggregator.report, allow_nan=False))
        return code
    except (OSError, ValueError, RuntimeError):
        # A storage/observer failure must never print exception text or a traceback.
        print(json.dumps({'status': 'needs-inspection', 'observerFailure': True,
                          'rawEventDataPersisted': False}))
        return 128 + stop['signal'] if stop['signal'] else 2
    finally:
        for number, handler in previous.items():
            signal.signal(number, handler)
        lock.unlink()


if __name__ == '__main__':
    raise SystemExit(main())
