"""Bounded, hash-checked promotion; run only on the authorized Qingdao host."""
import hashlib, json, os, pathlib, shutil, socket, subprocess

ROOT = pathlib.Path('/www/wwwroot/123.56.83.50')
STAGE = pathlib.Path('/tmp/edu-windows-0244-20261125-r2')
BACKUP = pathlib.Path('/var/backups/edu-windows-0244-20261125-r2')
assert socket.gethostname() == 'iZm5e6r68cl11nbh2y0o6zZ'
assert ROOT.resolve() == ROOT and STAGE.resolve() == STAGE
assert BACKUP.is_dir()
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''): h.update(b)
    return h.hexdigest().upper()
inventory = json.loads((STAGE / 'inventory.json').read_text())
allowed = {'download/AI-edu-manager-console-Windows-0.24.4' + ext for ext in ('.exe', '.zip', '-Setup.exe')}
allowed |= {'download/edu-manager-version.json', 'education/edu-manager-version.json', 'education/download.html', 'education/windows-host-manual.html', 'education/windows-manual.html'}
assert len(inventory) == 8 and {r['target'] for r in inventory} == allowed
for r in inventory:
    src, dst = STAGE / r['name'], ROOT / r['target']
    assert src.parent == STAGE and not src.is_symlink() and dst.parent.resolve() == dst.parent and not dst.is_symlink()
    assert src.stat().st_size == r['bytes'] and sha(src) == r['sha256']
subprocess.run(['sha256sum', '-c', 'SHA256SUMS'], cwd=STAGE, check=True)
before = json.loads((STAGE / 'expected-before.json').read_text())
for rel, digest in before.items(): assert sha(ROOT / rel) == digest, 'Concurrent change: ' + rel
old = json.loads((ROOT / 'download/edu-manager-version.json').read_text())
new = json.loads((STAGE / 'edu-manager-version.json').read_text())
assert old['windowsVersionName'] == '0.24.3' and old['windowsVersionCode'] == 282
assert new['windowsVersionName'] == '0.24.4' and new['windowsVersionCode'] == 283 and new['windowsReleaseStatus'] == 'stable'
assert new['standaloneVersionName'] == '1.3.8'
for k in old:
    if not k.startswith('windows') and k != 'notes': assert old[k] == new[k], k
assert 'AI-edu-license-admin-Windows-0.5.0' not in (STAGE / 'download.html').read_text()
assert 'Android-Standalone-1.3.9' not in (STAGE / 'download.html').read_text()
for r in inventory:
    dst = ROOT / r['target']
    if r['target'].startswith('download/AI-') and dst.exists(): assert sha(dst) == r['sha256'], 'Existing new package differs'
subprocess.run(['sha256sum', '-c', str(BACKUP / 'old-packages.sha256')], check=True)
def atomic(src, dst):
    tmp = dst.with_name('.' + dst.name + '.new-windows-0244')
    assert not tmp.is_symlink()
    meta = dst.stat() if dst.exists() else None
    shutil.copyfile(src, tmp)
    os.chmod(tmp, meta.st_mode & 0o777 if meta else 0o644)
    os.chown(tmp, meta.st_uid if meta else 0, meta.st_gid if meta else 0)
    with open(tmp, 'rb') as f: os.fsync(f.fileno())
    os.replace(tmp, dst)
small = [r for r in inventory if not r['target'].startswith('download/AI-')]
for r in small:
    dst, bak = ROOT / r['target'], BACKUP / r['target']
    assert not dst.exists() or (bak.is_file() and sha(bak) == sha(dst)), 'Backup mismatch: ' + r['target']
rollback = '''import pathlib,shutil,os
root=pathlib.Path('/www/wwwroot/123.56.83.50')
backup=pathlib.Path('/var/backups/edu-windows-0244-20261125-r2')
assert root.resolve()==root and backup.resolve()==backup
for rel in %r:
    src,dst=backup/rel,root/rel
    assert not dst.is_symlink() and dst.parent.resolve()==dst.parent
    if src.exists():
        tmp=dst.with_name('.'+dst.name+'.rollback-0244')
        shutil.copy2(src,tmp);os.chown(tmp,src.stat().st_uid,src.stat().st_gid);os.replace(tmp,dst)
    elif dst.exists(): dst.unlink()
print('Small release files restored; immutable packages retained')
''' % [r['target'] for r in small]
(BACKUP / 'rollback.py').write_text(rollback)
# Binaries first; manifests last so discovery cannot precede available payloads.
ordered = sorted(inventory, key=lambda r: 2 if r['name'] == 'edu-manager-version.json' else (0 if r['target'].startswith('download/AI-') else 1))
try:
    for r in ordered: atomic(STAGE / r['name'], ROOT / r['target'])
    for r in inventory: assert sha(ROOT / r['target']) == r['sha256']
except BaseException:
    subprocess.run(['python3', str(BACKUP / 'rollback.py')], check=True)
    raise
subprocess.run(['sha256sum', '-c', str(BACKUP / 'old-packages.sha256')], check=True)
shutil.copy2(STAGE / 'inventory.json', BACKUP / 'published-inventory.json')
print(json.dumps({'published': True, 'backup': str(BACKUP), 'files': inventory}, indent=2))
