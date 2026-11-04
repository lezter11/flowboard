#!/usr/bin/env python3
"""User-run macOS UAT setup helper. Offline; never prints or requests a secret."""
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import uuid

TOKEN = re.compile(r'flw_pat_[0-9a-f]{64}')


def install(config_path, server_path, node_path, token):
    """Merge exactly one server; retain other settings and a private backup."""
    if not TOKEN.fullmatch(token):
        raise ValueError('Clipboard does not contain a Flowboard token. Run the browser step first.')
    config_path = Path(config_path)
    if config_path.is_symlink():
        raise ValueError('Claude config is a symbolic link; preserve it and configure that setup separately.')
    prior = config_path.read_bytes() if config_path.exists() else None
    config = json.loads(prior) if prior is not None else {}
    if not isinstance(config, dict) or not isinstance(config.get('mcpServers', {}), dict):
        raise ValueError('Existing Claude configuration has an unexpected shape; it was not changed.')
    config.setdefault('mcpServers', {})['flowboard-uat'] = {
        'command': str(node_path),
        'args': [str(server_path)],
        'env': {
            'FLOWBOARD_API_URL': 'https://flowboard-app-uat.pages.dev',
            'FLOWBOARD_API_TOKEN': token,
        },
    }
    config_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    if prior is not None:
        backup = config_path.with_name(config_path.name + '.flowboard-backup-' + uuid.uuid4().hex)
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'wb') as output:
            output.write(prior)
    fd, temporary = tempfile.mkstemp(prefix='.flowboard-config-', dir=config_path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as output:
            os.fchmod(output.fileno(), 0o600)
            json.dump(config, output, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, config_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)
    assert stat.S_IMODE(config_path.stat().st_mode) == 0o600


def main():
    if sys.platform != 'darwin':
        raise ValueError('This helper is for macOS Claude Desktop.')
    root = Path(__file__).resolve().parents[2]
    server = root / 'packages/mcp/dist/index.js'
    if not server.is_file():
        raise ValueError('Build the local package first: npm run build --workspace @flowboard/mcp')
    node = shutil.which('node')
    if not node:
        raise ValueError('Node24.15+ is required but is not on PATH.')
    version = subprocess.run([node, '--version'], capture_output=True, text=True, check=True, timeout=5).stdout.strip()
    match = re.fullmatch(r'v(\d+)\.(\d+)\.(\d+)', version)
    if not match or int(match[1]) != 24 or int(match[2]) < 15:
        raise ValueError('Use Node24.15 or newer within Node24.')
    token = subprocess.run(['/usr/bin/pbpaste'], capture_output=True, text=True, check=True, timeout=5).stdout.strip()
    config = Path.home() / 'Library/Application Support/Claude/claude_desktop_config.json'
    install(config, server, node, token)
    # Clear only the token we consumed, retaining any newer clipboard contents.
    current = subprocess.run(['/usr/bin/pbpaste'], capture_output=True, text=True, check=True, timeout=5).stdout.strip()
    if current == token:
        subprocess.run(['/usr/bin/pbcopy'], input='', text=True, check=True, timeout=5)
    print('Flowboard UAT added. Other Claude settings preserved; prior config privately backed up if present.')
    print('Fully quit and reopen Claude Desktop. The token was not printed.')
    print('Save this nonsecret operationId for one demo create and identical retries: ' + str(uuid.uuid4()))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        if isinstance(error, ValueError) and not isinstance(error, json.JSONDecodeError):
            print('Setup stopped: ' + str(error), file=sys.stderr)
        else:
            print('Setup stopped safely (' + type(error).__name__ + '). No credential was printed.', file=sys.stderr)
        sys.exit(1)
