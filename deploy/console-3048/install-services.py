#!/usr/bin/env python3
"""Install only this console release; credentials enter via private file or stdin."""
import argparse
import datetime
import errno
import json
import os
import pathlib
import shlex
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import time
import urllib.parse
import urllib.request


ROOT = pathlib.Path('/mnt/vdb/yuchai-learning-h5')
DEFAULT_RELEASE = ROOT / 'releases/20261010T103733Z'
DEFAULT_ORIGIN = 'https://gmp-saas-test-api.console.volcengine.com:3048'
PLAN_IDS = [47, 49, 71, 72, 73, 74, 75, 76]
KEY_NAMES = ['SPARRING_OPENAPI_ACCESS_KEY', 'SPARRING_OPENAPI_SECRET_KEY']
UNIT_NAMES = ['yuchai-training-app.service', 'yuchai-training-gateway.service']


class InstallError(Exception):
    pass


def require(value, code):
    if not value:
        raise InstallError(code)


def command(arguments, timeout=15, allowed=(0,)):
    result = subprocess.run(arguments, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            universal_newlines=True, timeout=timeout)
    require(result.returncode in allowed, 'SYSTEMCTL_COMMAND_FAILED')
    return result.stdout.strip()


def private_write(path, content):
    descriptor, temporary = tempfile.mkstemp(prefix='.' + path.name + '-', dir=str(path.parent))
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, str(path))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def valid_origin(value):
    parsed = urllib.parse.urlsplit(value)
    require(parsed.scheme in ('http', 'https') and parsed.hostname and
            not parsed.username and not parsed.password and
            not parsed.path and not parsed.query and not parsed.fragment,
            'PUBLIC_ORIGIN_INVALID')
    try:
        parsed.port
    except ValueError:
        raise InstallError('PUBLIC_ORIGIN_INVALID')
    require('\n' not in value and '\r' not in value, 'PUBLIC_ORIGIN_INVALID')
    return value


def safe_value(value):
    require(isinstance(value, str) and value and len(value) <= 4096 and
            not any(character in value for character in ('\n', '\r', '\x00')),
            'CREDENTIAL_INPUT_INVALID')
    return value


def env_quote(value):
    return '"' + value.replace('\\', '\\\\').replace('"', '\\"') + '"'


def load_private_env(path):
    require(not path.is_symlink() and path.is_file(), 'PRIVATE_ENV_MISSING')
    metadata = path.stat()
    require(metadata.st_uid == 0 and stat.S_IMODE(metadata.st_mode) == 0o600,
            'PRIVATE_ENV_PERMISSION_INVALID')
    values = {}
    for line in path.read_text().splitlines():
        if not line.strip() or line.lstrip().startswith('#'):
            continue
        require('=' in line, 'PRIVATE_ENV_FORMAT_INVALID')
        name, raw_value = line.split('=', 1)
        require(name in KEY_NAMES + ['PUBLIC_ORIGIN', 'PORT'] and name not in values,
                'PRIVATE_ENV_FORMAT_INVALID')
        try:
            parsed = shlex.split(raw_value, posix=True)
        except ValueError:
            raise InstallError('PRIVATE_ENV_FORMAT_INVALID')
        require(len(parsed) == 1, 'PRIVATE_ENV_FORMAT_INVALID')
        values[name] = safe_value(parsed[0])
    require(all(name in values for name in KEY_NAMES), 'PRIVATE_ENV_KEYS_MISSING')
    return values


def prepare_env(path, origin, credentials_stdin):
    if credentials_stdin:
        raw = sys.stdin.read(16385)
        require(len(raw) <= 16384, 'CREDENTIAL_INPUT_TOO_LARGE')
        try:
            payload = json.loads(raw)
            values = {name: safe_value(payload[name]) for name in KEY_NAMES}
        except (ValueError, KeyError, TypeError):
            raise InstallError('CREDENTIAL_INPUT_INVALID')
        values.update(PUBLIC_ORIGIN=origin, PORT='5317')
        if path.exists() or path.is_symlink():
            require(load_private_env(path) == values, 'PRIVATE_ENV_ALREADY_EXISTS_WITH_DIFFERENT_VALUES')
        else:
            private_write(path, ''.join(name + '=' + env_quote(values[name]) + '\n'
                                        for name in KEY_NAMES + ['PUBLIC_ORIGIN', 'PORT']))
        del raw, payload
    values = load_private_env(path)
    require(values.get('PUBLIC_ORIGIN', origin) == origin and values.get('PORT', '5317') == '5317',
            'PRIVATE_ENV_DEPLOYMENT_MISMATCH')
    if 'PUBLIC_ORIGIN' not in values or 'PORT' not in values:
        values.update(PUBLIC_ORIGIN=origin, PORT='5317')
        private_write(path, ''.join(name + '=' + env_quote(values[name]) + '\n'
                                    for name in KEY_NAMES + ['PUBLIC_ORIGIN', 'PORT']))
    return values


def process_arguments(pid):
    try:
        data = pathlib.Path('/proc/{}/cmdline'.format(pid)).read_bytes()
        return [part.decode('utf-8', errors='strict') for part in data.split(b'\x00') if part]
    except FileNotFoundError:
        return []


def verify_process(pid, arguments):
    require(isinstance(pid, int) and pid > 1, 'DETACHED_PID_INVALID')
    current = process_arguments(pid)
    require(not current or current == arguments, 'DETACHED_PID_COMMAND_MISMATCH')
    if current:
        require(os.path.realpath('/proc/{}/exe'.format(pid)) == os.path.realpath(arguments[0]),
                'DETACHED_PID_EXECUTABLE_MISMATCH')
    return bool(current)


def stop_detached(processes):
    # Validate every PID before sending any signal; never locate or kill by port/name.
    for pid, arguments in processes:
        verify_process(pid, arguments)
    for pid, arguments in reversed(processes):
        if verify_process(pid, arguments):
            os.kill(pid, signal.SIGTERM)
    deadline = time.monotonic() + 6
    while time.monotonic() < deadline:
        if not any(verify_process(pid, arguments) for pid, arguments in processes):
            return
        time.sleep(0.1)
    for pid, arguments in processes:
        if verify_process(pid, arguments):
            os.kill(pid, signal.SIGKILL)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        if not any(verify_process(pid, arguments) for pid, arguments in processes):
            return
        time.sleep(0.1)
    raise InstallError('DETACHED_PROCESS_DID_NOT_STOP')


def unit_text(role, release, env_path):
    application = release / 'application'
    node = release / 'runtime/bin/node'
    entry = application / ('server.mjs' if role == 'app' else 'deploy/console-3048/gateway.mjs')
    dependencies = '' if role == 'app' else 'Requires={}\nAfter={}\n'.format(UNIT_NAMES[0], UNIT_NAMES[0])
    environment = ('EnvironmentFile={}\n'.format(env_path) if role == 'app' else
                   'Environment=PORT=3048 UPSTREAM_PORT=5317\n')
    return ('[Unit]\nDescription=Yuchai training {}\nAfter=network-online.target\n'
            'Wants=network-online.target\n{}\n[Service]\nType=simple\nDynamicUser=yes\n'
            'WorkingDirectory={}\n{}ExecStart={} {}\nRestart=on-failure\nRestartSec=3\n'
            'NoNewPrivileges=yes\nPrivateTmp=yes\nProtectHome=yes\nProtectSystem=strict\n'
            'ReadOnlyPaths={}\nCapabilityBoundingSet=\nRestrictAddressFamilies=AF_UNIX AF_INET AF_INET6\n'
            'UMask=0077\nTimeoutStopSec=8\nStandardOutput=append:{}/logs/{}.log\n'
            'StandardError=inherit\n\n[Install]\nWantedBy=multi-user.target\n').format(
                role, dependencies, application, environment, node, entry, ROOT, release, role)


def register_units(unit_files, created_links):
    root_directory = pathlib.Path('/etc/systemd/system')
    wants_directory = root_directory / 'multi-user.target.wants'
    try:
        wants_directory.mkdir(exist_ok=True)
        for name, source in zip(UNIT_NAMES, unit_files):
            for target in (root_directory / name, wants_directory / name):
                # Short data paths keep ext4 symlink targets eligible for inode storage.
                os.symlink(str(source), str(target))
                created_links.append(target)
        return True, 'persistent-data-unit-links'
    except OSError as error:
        if error.errno != errno.ENOSPC:
            raise
        for target in reversed(created_links):
            target.unlink()
        created_links[:] = []
        runtime_sources = ROOT / 'runtime-unit-links'
        runtime_sources.mkdir(exist_ok=False)
        for name, source in zip(UNIT_NAMES, unit_files):
            named_source = runtime_sources / name
            os.symlink(str(source), str(named_source))
            command(['systemctl', 'link', '--runtime', str(named_source)])
            runtime_target = pathlib.Path('/run/systemd/system') / name
            require(runtime_target.is_symlink(), 'RUNTIME_UNIT_LINK_NOT_CREATED')
            created_links.append(runtime_target)
        return False, 'runtime-data-unit-links-root-enospc'


def public_json(path, timeout):
    # Bypass shell/inherited proxy settings; the gateway must be reached over loopback.
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
            require(health.get('mode') == 'live' and health.get('projectId') == 5,
                    'HEALTH_NOT_LIVE')
            return health
        except (OSError, ValueError, InstallError):
            time.sleep(0.2)
    raise InstallError('LIVE_HEALTH_TIMEOUT')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--release', default=str(DEFAULT_RELEASE))
    parser.add_argument('--public-origin', default=DEFAULT_ORIGIN)
    parser.add_argument('--credentials-stdin', action='store_true',
                        help='Read AK/SK JSON from stdin and write the private 0600 env file')
    options = parser.parse_args()
    release = pathlib.Path(options.release).resolve()
    origin = valid_origin(options.public_origin)
    require(release.parent == ROOT / 'releases', 'RELEASE_OUTSIDE_DEPLOYMENT_ROOT')
    require(os.geteuid() == 0, 'ROOT_REQUIRED')
    require(pathlib.Path('/proc/1/comm').read_text().strip() == 'systemd', 'SYSTEMD_REQUIRED')
    require(os.statvfs('/').f_bavail > 0, 'ROOT_FILESYSTEM_STILL_FULL')
    application = release / 'application'
    node = str(release / 'runtime/bin/node')
    require(os.access(node, os.X_OK) and (application / 'server.mjs').is_file() and
            (application / 'deploy/console-3048/gateway.mjs').is_file(), 'RELEASE_FILES_MISSING')
    require(not (application / '.env.local').exists(), 'APPLICATION_ENV_LOCAL_MUST_BE_ABSENT')
    deployment = json.loads((release / 'deployment-receipt.json').read_text())
    require(deployment.get('release') == str(release) and deployment.get('transferId') == release.name,
            'DEPLOYMENT_RECEIPT_MISMATCH')
    processes = [(deployment.get('applicationPid'), [node, str(application / 'server.mjs')]),
                 (deployment.get('gatewayPid'), [node, str(application / 'deploy/console-3048/gateway.mjs')])]
    require(processes[0][0] != processes[1][0], 'DETACHED_PID_DUPLICATED')
    for pid, arguments in processes:
        verify_process(pid, arguments)
    for name in UNIT_NAMES:
        require(command(['systemctl', 'show', name, '--property=LoadState', '--value'],
                        allowed=(0, 1, 4)) == 'not-found', 'SERVICE_ALREADY_EXISTS')
        for directory in ('/etc/systemd/system', '/run/systemd/system',
                          '/etc/systemd/system/multi-user.target.wants'):
            require(not os.path.lexists(os.path.join(directory, name)), 'SERVICE_LINK_ALREADY_EXISTS')
    unit_files = [ROOT / name for name in UNIT_NAMES]
    require(all(not os.path.lexists(str(path)) for path in unit_files) and
            not (ROOT / 'runtime-unit-links').exists(), 'DATA_UNIT_FILE_ALREADY_EXISTS')
    env_path = ROOT / 'config.env'
    values = prepare_env(env_path, origin, options.credentials_stdin)
    del values  # Never put credentials into the installation receipt or command arguments.
    logs = release / 'logs'
    logs.mkdir(exist_ok=True)
    for role, path in zip(('app', 'gateway'), unit_files):
        with (logs / (role + '.log')).open('ab'):
            pass
        os.chmod(str(logs / (role + '.log')), 0o600)
        path.write_text(unit_text(role, release, env_path))
        os.chmod(str(path), 0o644)
    created_links = []
    receipt = {'release': str(release), 'publicOrigin': origin, 'publicPort': 3048,
               'internalPort': 5317, 'credentialsConfigured': True,
               'environmentFileMode': '0600', 'createdExercises': 0,
               'services': UNIT_NAMES, 'bootPersistence': False, 'status': 'installing'}
    try:
        persistent, mode = register_units(unit_files, created_links)
        receipt.update(bootPersistence=persistent, registrationMode=mode)
        command(['systemctl', 'daemon-reload'])
        stop_detached(processes)
        receipt['terminatedDetachedPids'] = [pid for pid, _arguments in processes]
        for port, host in ((5317, '127.0.0.1'), (3048, '0.0.0.0')):
            with socket.socket() as probe:
                probe.bind((host, port))
        command(['systemctl', 'start'] + UNIT_NAMES)
        receipt['health'] = wait_health()
        plans = public_json('/api/plans', 10)
        ids = sorted(plan.get('id') for plan in plans.get('plans', []))
        require(ids == PLAN_IDS, 'EIGHT_PLAN_VERIFICATION_FAILED')
        receipt['planIds'] = ids
        receipt['planCount'] = len(ids)
        receipt['mainPids'] = {name: int(command(['systemctl', 'show', name, '--property=MainPID', '--value']))
                               for name in UNIT_NAMES}
        receipt['activeStates'] = {name: command(['systemctl', 'show', name, '--property=ActiveState', '--value'])
                                   for name in UNIT_NAMES}
        require(all(value == 'active' for value in receipt['activeStates'].values()), 'SERVICE_NOT_ACTIVE')
        receipt['status'] = 'verified'
    except Exception as error:
        receipt['status'] = 'verification-failed'
        receipt['errorCode'] = str(error) if isinstance(error, InstallError) else type(error).__name__
        raise
    finally:
        receipt['checkedAtUtc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
        private_write(release / 'service-install-receipt.json', json.dumps(receipt, indent=2) + '\n')
        print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        # Arbitrary exception messages may contain input; emit only deliberate codes.
        code = str(error) if isinstance(error, InstallError) else type(error).__name__
        print(json.dumps({'status': 'failed', 'errorCode': code}), file=sys.stderr, flush=True)
        sys.exit(1)
