#!/usr/bin/env python3
"""Repair this release's unit filenames after expanding the root filesystem."""
import datetime
import hashlib
import json
import os
import pathlib
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT = pathlib.Path('/mnt/vdb/yuchai-learning-h5')
RELEASE = ROOT / 'releases/20261010T103733Z'
NAMES = ['yuchai-training-app.service', 'yuchai-training-gateway.service']
ROLES = ['app', 'gateway']
ORIGIN = 'https://gmp-saas-test-api.console.volcengine.com:3048'
PLAN_IDS = [47, 49, 71, 72, 73, 74, 75, 76]


class RecoveryError(Exception):
    pass


def require(value, code):
    if not value:
        raise RecoveryError(code)


def run(arguments, allowed=(0,), timeout=15):
    result = subprocess.run(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            universal_newlines=True, timeout=timeout)
    require(result.returncode in allowed, 'SYSTEMCTL_COMMAND_FAILED')
    return result.stdout.strip()


def unit_text(role):
    application = RELEASE / 'application'
    node = RELEASE / 'runtime/bin/node'
    entry = application / ('server.mjs' if role == 'app' else 'deploy/console-3048/gateway.mjs')
    dependencies = '' if role == 'app' else 'Requires={}\nAfter={}\n'.format(NAMES[0], NAMES[0])
    environment = ('EnvironmentFile={}\n'.format(ROOT / 'config.env') if role == 'app' else
                   'Environment=PORT=3048 UPSTREAM_PORT=5317\n')
    account = 'DynamicUser=yes\n'
    temporary = 'PrivateTmp=yes\n'
    return ('[Unit]\nDescription=Yuchai training {}\nAfter=network-online.target\n'
            'Wants=network-online.target\n{}\n[Service]\nType=simple\n{}'
            'WorkingDirectory={}\n{}ExecStart={} {}\nRestart=on-failure\nRestartSec=3\n'
            'NoNewPrivileges=yes\n{}ProtectHome=yes\nProtectSystem=strict\n'
            'ReadOnlyPaths={}\nCapabilityBoundingSet=\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n'
            'UMask=0077\nTimeoutStopSec=8\nStandardOutput=append:{}/logs/{}.log\n'
            'StandardError=inherit\n\n[Install]\nWantedBy=multi-user.target\n').format(
                role, dependencies, account, application, environment, node, entry, temporary,
                ROOT, RELEASE, role)


def write_receipt(path, receipt):
    descriptor, temporary = tempfile.mkstemp(prefix='.recovery-receipt-', dir=str(RELEASE))
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            json.dump(receipt, output, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def public_json(path, timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open('http://127.0.0.1:3048' + path, timeout=timeout) as response:
        require(response.status == 200, 'LOCAL_API_STATUS_INVALID')
        body = response.read(1024 * 1024 + 1)
        require(len(body) <= 1024 * 1024, 'LOCAL_API_RESPONSE_TOO_LARGE')
        return json.loads(body)


def wait_health():
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            health = public_json('/api/health', min(2, max(0.1, deadline - time.monotonic())))
            require(health.get('mode') == 'live' and health.get('projectId') == 5, 'HEALTH_NOT_LIVE')
            return health
        except (OSError, ValueError, RecoveryError):
            time.sleep(0.2)
    raise RecoveryError('LIVE_HEALTH_TIMEOUT')


def main():
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    require(pathlib.Path('/proc/1/comm').read_text().strip() == 'systemd', 'SYSTEMD_REQUIRED')
    filesystem = os.statvfs('/')
    root_available_bytes = filesystem.f_bavail * filesystem.f_frsize
    require(root_available_bytes > 0, 'ROOT_FILESYSTEM_STILL_FULL')
    failed_path = RELEASE / 'service-install-receipt.json'
    require(failed_path.is_file() and not failed_path.is_symlink(), 'FAILED_RECEIPT_MISSING')
    failed_bytes = failed_path.read_bytes()
    failed = json.loads(failed_bytes)
    require(failed.get('release') == str(RELEASE) and failed.get('services') == NAMES and
            failed.get('bootPersistence') is True and failed.get('status') == 'verification-failed',
            'FAILED_RECEIPT_MISMATCH')
    deployment = json.loads((RELEASE / 'deployment-receipt.json').read_text())
    require(deployment.get('release') == str(RELEASE) and deployment.get('transferId') == RELEASE.name,
            'DEPLOYMENT_RECEIPT_MISMATCH')
    env_path = ROOT / 'config.env'
    require(env_path.is_file() and not env_path.is_symlink() and
            env_path.stat().st_uid == 0 and stat.S_IMODE(env_path.stat().st_mode) == 0o600,
            'PRIVATE_ENV_PERMISSION_INVALID')
    require(not (RELEASE / 'application/.env.local').exists(), 'ENV_LOCAL_MUST_BE_ABSENT')
    old_sources = [ROOT / (role + '.service') for role in ROLES]
    new_sources = [ROOT / name for name in NAMES]
    require(all(len(str(path).encode('utf-8')) < 60 for path in new_sources), 'SYMLINK_TARGET_TOO_LONG')
    links = []
    for role, name, old, new in zip(ROLES, NAMES, old_sources, new_sources):
        require(old.is_file() and not old.is_symlink() and old.read_text() == unit_text(role),
                'OLD_UNIT_CONTENT_MISMATCH')
        if os.path.lexists(str(new)):
            require(new.is_file() and not new.is_symlink() and new.read_text() == unit_text(role),
                    'NEW_UNIT_ALREADY_EXISTS_WITH_DIFFERENT_CONTENT')
        for directory in ('/etc/systemd/system', '/etc/systemd/system/multi-user.target.wants'):
            link = pathlib.Path(directory) / name
            require(link.is_symlink() and os.readlink(str(link)) in (str(old), str(new)),
                    'SERVICE_LINK_TARGET_MISMATCH')
            links.append((link, old, new))
    receipt = {'release': str(RELEASE), 'publicOrigin': ORIGIN, 'publicPort': 3048,
               'internalPort': 5317, 'createdExercises': 0, 'services': NAMES,
               'dynamicUser': True, 'privateTmp': True, 'protectSystem': 'strict',
               'rootAvailableBytesBeforeRecovery': root_available_bytes,
               'bootPersistence': True, 'credentialsConfigured': True,
               'failedReceiptSha256': hashlib.sha256(failed_bytes).hexdigest(),
               'status': 'recovering'}
    try:
        # These two units and all four symlinks were matched to this release above.
        run(['systemctl', 'stop'] + NAMES, allowed=(0, 5))
        for name in NAMES:
            pid = run(['systemctl', 'show', name, '--property=MainPID', '--value'], allowed=(0, 1, 4))
            require(pid in ('', '0'), 'SERVICE_DID_NOT_STOP')
        for port, host in ((5317, '127.0.0.1'), (3048, '0.0.0.0')):
            with socket.socket() as probe:
                probe.bind((host, port))
        for role, source in zip(ROLES, new_sources):
            if not source.exists():
                descriptor = os.open(str(source), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
                with os.fdopen(descriptor, 'w') as output:
                    output.write(unit_text(role))
                    output.flush()
                    os.fsync(output.fileno())
                os.chmod(str(source), 0o644)
        for link, old, new in links:
            target = os.readlink(str(link))
            require(target in (str(old), str(new)), 'SERVICE_LINK_CHANGED_DURING_RECOVERY')
            if target != str(new):
                link.unlink()
                try:
                    os.symlink(str(new), str(link))
                except Exception:
                    # Both targets fit an ext4 fast symlink; restore our own old link if needed.
                    os.symlink(str(old), str(link))
                    raise
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'reset-failed'] + NAMES, allowed=(0, 1))
        run(['systemctl', 'start'] + NAMES)
        receipt['enabledStates'] = {name: run(['systemctl', 'is-enabled', name]) for name in NAMES}
        require(all(state == 'enabled' for state in receipt['enabledStates'].values()),
                'BOOT_ENABLE_VERIFICATION_FAILED')
        receipt['health'] = wait_health()
        plans = public_json('/api/plans', 10)
        ids = sorted(plan.get('id') for plan in plans.get('plans', []))
        require(ids == PLAN_IDS, 'EIGHT_PLAN_VERIFICATION_FAILED')
        receipt.update(planIds=ids, planCount=len(ids))
        receipt['mainPids'] = {name: int(run(['systemctl', 'show', name, '--property=MainPID', '--value']))
                               for name in NAMES}
        receipt['activeStates'] = {name: run(['systemctl', 'show', name, '--property=ActiveState', '--value'])
                                  for name in NAMES}
        receipt['fragmentPaths'] = {name: run(['systemctl', 'show', name, '--property=FragmentPath', '--value'])
                                   for name in NAMES}
        require(all(state == 'active' for state in receipt['activeStates'].values()) and
                all(receipt['mainPids'].values()), 'SERVICE_NOT_ACTIVE')
        require(failed_path.read_bytes() == failed_bytes, 'FAILED_RECEIPT_CHANGED')
        receipt['status'] = 'verified'
    except Exception as error:
        receipt['status'] = 'recovery-failed'
        receipt['errorCode'] = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        raise
    finally:
        receipt['checkedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        write_receipt(RELEASE / 'service-recovery-receipt.json', receipt)
        print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, RecoveryError) else type(error).__name__
        print(json.dumps({'status': 'failed', 'errorCode': code}), file=sys.stderr, flush=True)
        sys.exit(1)
