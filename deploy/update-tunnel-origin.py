#!/usr/bin/python3
"""Synchronize the new demo hostname without logging server credentials."""
import os
import re
import subprocess
import time
import json
import urllib.request
from pathlib import Path

log = Path('/var/lib/yuchai-tunnel/tunnel.log')
origin = None
for _ in range(60):
    if log.exists():
        found = re.search(r'https://[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b', log.read_text())
        if found:
            origin = found.group(0)
            break
    time.sleep(1)
if not origin:
    raise SystemExit('No HTTPS demo hostname returned by cloudflared')

env_path = Path('/etc/yuchai-learning-h5.env')
old_env = env_path.read_text()
lines = [line for line in old_env.splitlines() if not line.startswith('PUBLIC_ORIGIN=')]
new_env = '\n'.join(lines + ['PUBLIC_ORIGIN=' + origin, ''])
entry_path = Path('/etc/nginx/snippets/yuchai-public-entry.conf')
old_entry = entry_path.read_text()
new_entry = (
    'location = /yuchai-training { return 302 ' + origin + '/yuchai-training/; }\n'
    'location ^~ /yuchai-training/ { return 302 ' + origin + '$request_uri; }\n'
    'location = /internal/yuchai-auth { return 404; }\n'
)

def atomic_write(path, contents, mode):
    # Reuse the existing inode for the env file: the service's sandbox binds it.
    if path == env_path:
        with path.open('w') as stream:
            stream.write(contents)
        os.chmod(path, mode)
        return
    tmp = path.with_suffix(path.suffix + '.new')
    tmp.write_text(contents)
    os.chmod(tmp, mode)
    os.replace(tmp, path)

try:
    atomic_write(entry_path, new_entry, 0o644)
    subprocess.run(['/usr/sbin/nginx', '-t'], check=True)
    atomic_write(env_path, new_env, 0o600)
    subprocess.run(['/usr/bin/systemctl', 'restart', 'yuchai-learning-h5'], check=True)
    healthy = False
    for _ in range(12):
        try:
            with urllib.request.urlopen('http://127.0.0.1:5317/api/health', timeout=2) as response:
                health = json.load(response)
            if health.get('mode') == 'live' and health.get('projectId') == 5 and health.get('userId') == 1:
                healthy = True
                break
        except (OSError, ValueError):
            pass
        time.sleep(0.5)
    if not healthy:
        raise RuntimeError('Yuchai application did not pass its loopback health check')
    subprocess.run(['/usr/bin/systemctl', 'reload', 'nginx'], check=True)
except Exception:
    atomic_write(entry_path, old_entry, 0o644)
    atomic_write(env_path, old_env, 0o600)
    subprocess.run(['/usr/bin/systemctl', 'restart', 'yuchai-learning-h5'], check=False)
    raise
Path('/var/lib/yuchai-tunnel/public-url').write_text(origin + '/yuchai-training/\n')
print('Yuchai HTTPS demo entry: ' + origin + '/yuchai-training/', flush=True)
