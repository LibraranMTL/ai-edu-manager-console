"""Promote only the verified Android 1.3.9 release unit on Qingdao."""
import pathlib,hashlib,json,socket,shutil,os,sys,subprocess
ROOT=pathlib.Path('/www/wwwroot/123.56.83.50')
STAGE=pathlib.Path('/tmp/edu-android-139-20261125-r1')
BACKUP=pathlib.Path('/var/backups/edu-android-139-20261125-r1')
APK='download/AI-Education-Manager-Android-Standalone-1.3.9.apk'
OLD='download/AI-Education-Manager-Android-Standalone-1.3.8.apk'
SMALL=['education/download.html','education/android-standalone-manual.html','education/edu-manager-version.json','download/edu-manager-version.json']
def sha(p):
    h=hashlib.sha256()
    with open(p,'rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
    return h.hexdigest().upper()
assert socket.gethostname()=='iZm5e6r68cl11nbh2y0o6zZ'
assert ROOT.resolve()==ROOT
if len(sys.argv)>1 and sys.argv[1]=='prepare':
    assert not BACKUP.exists() and not STAGE.exists(),'Refuse reusing release directories'
    assert not (ROOT/APK).exists(),'Formal APK name already exists'
    assert shutil.disk_usage(ROOT).free>300*1024*1024
    assert sha(ROOT/OLD)=='AF6398AE4A2D33D7709F5E4EDBCC9838D87B2CCC7813FCA39BBAE0C3AC11730C'
    BACKUP.mkdir(mode=0o700,parents=True)
    for rel in SMALL:
        source=ROOT/rel;assert source.is_file() and not source.is_symlink() and source.parent.resolve()==source.parent
        target=BACKUP/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    (BACKUP/'old-package.sha256').write_text(sha(ROOT/OLD).lower()+'  '+str(ROOT/OLD)+'\n')
    STAGE.mkdir(mode=0o700)
    print(json.dumps({'prepared':True,'stage':str(STAGE),'backup':str(BACKUP)}))
    sys.exit(0)
assert STAGE.resolve()==STAGE and BACKUP.is_dir()
inventory=json.loads((STAGE/'inventory.json').read_text())
assert len(inventory)==5 and {r['target'] for r in inventory}==set(SMALL+[APK])
for r in inventory:
    src,dst=STAGE/r['name'],ROOT/r['target']
    assert src.parent==STAGE and not src.is_symlink() and not dst.is_symlink() and dst.parent.resolve()==dst.parent
    assert src.stat().st_size==r['bytes'] and sha(src)==r['sha256']
subprocess.run(['sha256sum','-c','SHA256SUMS'],cwd=STAGE,check=True)
before=json.loads((STAGE/'expected-before.json').read_text())
assert set(before)==set(SMALL)
for rel,digest in before.items():assert sha(ROOT/rel)==digest and sha(BACKUP/rel)==digest,'Live or backup changed: '+rel
old=json.loads((ROOT/'download/edu-manager-version.json').read_text())
new=json.loads((STAGE/'edu-manager-version.json').read_text())
assert old['standaloneVersionName']=='1.3.8' and old['standaloneVersionCode']==42
assert new['standaloneVersionName']=='1.3.9' and new['standaloneVersionCode']==43
assert new['standaloneReleaseStatus']=='stable' and new['standalonePerformanceStatus']=='pending_verification'
assert new['standaloneSha256']=='9DE2EEFDA00B37C6CBB4446A581DECB927E15493BA801ABC9EADD58A6EEDAED7'
for key in old:
    if not key.startswith('standalone'):assert new[key]==old[key],key
assert new['windowsVersionName']=='0.24.4' and new['windowsVersionCode']==283
assert 'AI-edu-license-admin-Windows-0.5.0' not in (STAGE/'download.html').read_text()
assert '恢复上次联网激活' in (STAGE/'android-standalone-manual.html').read_text()
assert not (ROOT/APK).exists(),'Refuse overwriting a published version'
subprocess.run(['sha256sum','-c',str(BACKUP/'old-package.sha256')],check=True)
def atomic(src,dst):
    tmp=dst.with_name('.'+dst.name+'.new-android139')
    assert not tmp.is_symlink()
    meta=dst.stat() if dst.exists() else None
    shutil.copyfile(src,tmp);os.chmod(tmp,meta.st_mode&0o777 if meta else 0o644);os.chown(tmp,meta.st_uid if meta else 0,meta.st_gid if meta else 0)
    with open(tmp,'rb') as f:os.fsync(f.fileno())
    os.replace(tmp,dst)
rollback='''import pathlib,shutil,os
root=pathlib.Path('/www/wwwroot/123.56.83.50');backup=pathlib.Path('/var/backups/edu-android-139-20261125-r1')
assert root.resolve()==root and backup.resolve()==backup
for rel in %r:
    src,dst=backup/rel,root/rel
    assert not dst.is_symlink() and dst.parent.resolve()==dst.parent
    tmp=dst.with_name('.'+dst.name+'.rollback-android139')
    shutil.copy2(src,tmp);os.chown(tmp,src.stat().st_uid,src.stat().st_gid);os.replace(tmp,dst)
print('Old release pointers and manual restored; immutable APKs retained')
''' % SMALL
(BACKUP/'rollback.py').write_text(rollback)
try:
    for r in sorted(inventory,key=lambda r:2 if r['name']=='edu-manager-version.json' else (0 if r['target']==APK else 1)):
        atomic(STAGE/r['name'],ROOT/r['target'])
    for r in inventory:assert sha(ROOT/r['target'])==r['sha256'] and (ROOT/r['target']).stat().st_size==r['bytes']
except BaseException:
    subprocess.run(['python3',str(BACKUP/'rollback.py')],check=True);raise
subprocess.run(['sha256sum','-c',str(BACKUP/'old-package.sha256')],check=True)
shutil.copy2(STAGE/'inventory.json',BACKUP/'published-inventory.json')
print(json.dumps({'published':True,'backup':str(BACKUP),'files':inventory},indent=2))
