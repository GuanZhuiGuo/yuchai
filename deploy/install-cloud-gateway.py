#!/usr/bin/python3
"""Install the additive Nginx gateway, preserving the existing portal site."""
import hashlib
import shutil
import subprocess
from pathlib import Path

release = Path('/opt/yuchai-learning-h5/current').resolve().parent
deploy = release / 'application/deploy'
portal = release / 'portal'
site = Path('/etc/nginx/conf.d/mia-portal.conf')
server = Path('/opt/mia-portal/app/server.py')
expected = {
    site: '079fa9d6fda51b34f130f75689e2a125693def5e2390f29d60a9dd1c22d003b0',
    server: 'b7c2b5b114b169042d2318686016320b019f2f63c55d1ee2e3931307a6a14c9a',
}
for path, digest in expected.items():
    if hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        raise SystemExit('Remote baseline changed: ' + str(path))

backup = Path('/opt/yuchai-learning-h5/backups/20261009T091342Z')
backup.mkdir(mode=0o700, parents=True, exist_ok=True)
for source, name in [(site, 'mia-portal.conf'), (server, 'portal-server.py')]:
    target = backup / name
    if not target.exists():
        shutil.copy2(source, target)

snippets = Path('/etc/nginx/snippets')
snippets.mkdir(exist_ok=True)
copies = [
    (portal / 'nginx-yuchai-map.conf', Path('/etc/nginx/conf.d/00-yuchai-map.conf')),
    (portal / 'nginx-yuchai-training.conf', snippets / 'yuchai-training.conf'),
    (deploy / 'nginx-yuchai-gateway.conf', Path('/etc/nginx/conf.d/yuchai-gateway.conf')),
    (deploy / 'nginx-yuchai-portal-proxy.conf', snippets / 'yuchai-portal-proxy.conf'),
    (deploy / 'yuchai-training-tunnel.service', Path('/etc/systemd/system/yuchai-training-tunnel.service')),
    (deploy / 'update-tunnel-origin.py', Path('/usr/local/sbin/yuchai-update-tunnel-origin')),
]
entry = snippets / 'yuchai-public-entry.conf'
entry.write_text(
    'location = /yuchai-training { return 302 /yuchai-training/; }\n'
    'location ^~ /yuchai-training/ { return 503; }\n'
    'location = /internal/yuchai-auth { return 404; }\n'
)
for source, target in copies:
    shutil.copyfile(source, target)
    target.chmod(0o755 if target.name == 'yuchai-update-tunnel-origin' else 0o644)

try:
    subprocess.run(['patch', '--dry-run', '-p2', '-i', str(portal / 'portal-server.patch')], cwd=server.parent, check=True)
    subprocess.run(['patch', '-p2', '-i', str(portal / 'portal-server.patch')], cwd=server.parent, check=True)
    subprocess.run(['python3', '-m', 'py_compile', str(server)], check=True)
    content = site.read_text()
    marker = '    client_max_body_size 20m;'
    if content.count(marker) != 1:
        raise RuntimeError('Expected one portal server block')
    site.write_text(content.replace(marker, marker + '\n\n    include /etc/nginx/snippets/yuchai-public-entry.conf;'))
    subprocess.run(['nginx', '-t'], check=True)
    subprocess.run(['systemctl', 'restart', 'mia-portal'], check=True)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
except Exception:
    shutil.copy2(backup / 'portal-server.py', server)
    shutil.copy2(backup / 'mia-portal.conf', site)
    for path in [Path('/etc/nginx/conf.d/00-yuchai-map.conf'), Path('/etc/nginx/conf.d/yuchai-gateway.conf')]:
        path.unlink(missing_ok=True)
    subprocess.run(['systemctl', 'restart', 'mia-portal'], check=False)
    subprocess.run(['nginx', '-t'], check=False)
    subprocess.run(['systemctl', 'reload', 'nginx'], check=False)
    raise
print('Additive Yuchai gateway installed; HTTPS tunnel has not been started yet.')
