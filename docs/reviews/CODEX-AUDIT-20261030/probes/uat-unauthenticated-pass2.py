#!/usr/bin/env python3
"""At most 12 anonymous GETs; no Cookie or Authorization header is sent."""
import json, subprocess

base = 'https://flowboard-app-uat.pages.dev'
paths = [
    '/', '/signin', '/project?id=audit-guessed',
    '/api/v1/session', '/api/v1/projects', '/api/v1/workspaces',
    '/api/v1/boards/audit-guessed', '/api/v1/cards/audit-guessed',
    '/api/v1/cards/audit-guessed/images', '/api/v1/images/audit-guessed/content',
    '/api/v1/image-uploads/audit-guessed/content', '/api/v1/notifications',
]
results = []
for path in paths:
    p = subprocess.run([
        'curl', '--silent', '--show-error', '--max-time', '10', '--location', '--max-redirs', '1',
        '--request', 'GET', '--dump-header', '-', '--output', '/dev/null',
        '--write-out', '\nAUDIT_STATUS:%{http_code};BYTES:%{size_download}', base + path,
    ], capture_output=True, text=True)
    headers = p.stdout.split('\nAUDIT_STATUS:', 1)[0]
    trailer = p.stdout.split('\nAUDIT_STATUS:', 1)[-1].strip().splitlines()[0] if '\nAUDIT_STATUS:' in p.stdout else ''
    fields = dict(item.split(':', 1) for item in trailer.split(';') if ':' in item)
    def header(name):
        for line in headers.splitlines():
            if line.lower().startswith(name.lower() + ':'):
                return line.split(':', 1)[1].strip()
        return None
    status_text = trailer.partition(';')[0]
    results.append({
        'path': path, 'curlExit': p.returncode,
        'status': int(status_text) if status_text.isdigit() else None,
        'bytes': int(fields['BYTES']) if fields.get('BYTES', '').isdigit() else None,
        'location': header('location'), 'cacheControl': header('cache-control'),
        'contentSecurityPolicy': bool(header('content-security-policy')),
        'nosniff': header('x-content-type-options'), 'xFrameOptions': header('x-frame-options'),
        'stderrClass': 'network_error' if p.returncode else None,
    })
print(json.dumps({'host': base, 'authenticated': False, 'requestCount': len(results), 'results': results}))
