#!/usr/bin/env python3
"""Apply a verified frontend bundle, retaining a rollback copy of each file."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', required=True)
    parser.add_argument('--bundle', required=True)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--backup', required=True)
    parser.add_argument('--node', required=True)
    args = parser.parse_args()
    root, bundle, backup = map(lambda x: Path(x).resolve(), (args.root, args.bundle, args.backup))
    entries = json.loads(Path(args.manifest).read_text())
    assert root.is_dir() and bundle.is_dir(), 'DIRECTORY_MISSING'
    assert not backup.exists(), 'BACKUP_ALREADY_EXISTS'
    assert isinstance(entries, list) and entries, 'EMPTY_MANIFEST'
    names = [entry['name'] for entry in entries]
    assert len(set(names)) == len(names), 'DUPLICATE_FILE'
    assert all(Path(name).name == name and name.endswith(('.js', '.css', '.html')) for name in names), 'INVALID_FILE_NAME'
    payloads, originals = {}, {}
    for entry in entries:
        name = entry['name']
        payload = (bundle / name).read_bytes()
        assert digest(payload) == entry['afterSha256'], 'BUNDLE_CHANGED: ' + name
        existing = (root / name).read_bytes() if (root / name).exists() else None
        assert (digest(existing) if existing is not None else None) == entry['beforeSha256'], 'SOURCE_CHANGED: ' + name
        payloads[name], originals[name] = payload, existing
    backup.mkdir(parents=True)
    stage = backup / 'staged'
    stage.mkdir()
    for name in names:
        original = originals[name]
        if original is not None:
            (backup / name).write_bytes(original)
        candidate = stage / name
        candidate.write_bytes(payloads[name])
        candidate.chmod(0o644)
        if name.endswith('.js'):
            syntax_file = stage / (name + '.mjs')
            syntax_file.write_bytes(payloads[name])
            subprocess.run([args.node, '--check', str(syntax_file)], check=True)
            syntax_file.unlink()
    applied = []
    try:
        # Shared modules and data precede the entry module on both servers.
        for name in sorted(names, key=lambda n: (n == 'app.js', n == 'index.html', n)):
            os.replace(stage / name, root / name)
            applied.append(name)
        assert all(digest((root / e['name']).read_bytes()) == e['afterSha256'] for e in entries), 'FINAL_HASH_MISMATCH'
    except Exception:
        for name in reversed(applied):
            if originals[name] is None:
                (root / name).unlink()
            else:
                rollback = stage / (name + '.rollback')
                shutil.copyfile(backup / name, rollback)
                rollback.chmod(0o644)
                os.replace(rollback, root / name)
        raise
    receipt = {'root': str(root), 'backup': str(backup), 'serviceRestarted': False, 'files': entries}
    (backup / 'receipt.json').write_text(json.dumps(receipt, indent=2))
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
