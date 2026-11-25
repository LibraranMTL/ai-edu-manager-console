#!/usr/bin/env bash
set -euo pipefail
stage=/tmp/edu-activation-20261125-r1
root=/opt/edu-activation
backup=/opt/edu-activation-backups/deploy-20261125-r4
vhost=/www/server/panel/vhost/apache/123.56.83.50.conf
node=/opt/edu-cloud-documents/runtime/node-v24.21.0-linux-x64/bin/node
test "$(hostname)" = iZm5e6r68cl11nbh2y0o6zZ
test "$(readlink -f "$stage")" = "$stage"
test ! -L "$root"
cd "$stage"
sha256sum -c activation-service.sha256
tar -tzf activation-service.tar.gz | python3 -c 'import sys; names=sys.stdin.read().splitlines(); assert names and all(not n.startswith("/") and ".." not in n.split("/") for n in names)'
mkdir -p "$backup" "$root/releases"
if ! test -e "$backup/vhost.conf"; then cp -a "$vhost" "$backup/vhost.conf"; fi
if test -e /etc/systemd/system/edu-activation.service && ! test -e "$backup/service"; then cp -a /etc/systemd/system/edu-activation.service "$backup/service"; fi
if test -e "$root/current" && ! test -e "$backup/previous-release"; then readlink "$root/current" > "$backup/previous-release"; fi
id edu-activation >/dev/null 2>&1 || useradd --system --home /var/lib/edu-activation --shell /usr/sbin/nologin edu-activation
install -d -o edu-activation -g edu-activation -m 0700 /var/lib/edu-activation /var/backups/edu-activation /etc/edu-activation
release="$root/releases/1.0.0-20261125-r4"
test ! -e "$release"
mkdir "$release"
tar -xzf activation-service.tar.gz -C "$release"
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
for source in "$release"/activation-service/*.cjs; do "$node" --check "$source"; done
python3 - "$stage" <<'PY'
import os,sys,json,subprocess,pwd
from pathlib import Path
stage=Path(sys.argv[1]); base=Path('/etc/edu-activation'); config=base/'config.json'
if not config.exists():
    subprocess.run(['openssl','genpkey','-algorithm','RSA','-pkeyopt','rsa_keygen_bits:3072','-out',str(base/'signing.private.pem')],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    (base/'backup.key').write_bytes(os.urandom(32))
    config.write_text(json.dumps(dict(dataDir='/var/lib/edu-activation',port=8758,keyId='activation-online-20261125',privateKeyPath=str(base/'signing.private.pem'),backupKeyPath=str(base/'backup.key'),backupDir='/var/backups/edu-activation',adminPassword=(stage/'bootstrap-password').read_text().strip())))
owner=pwd.getpwnam('edu-activation')
for f in base.iterdir(): os.chmod(f,0o600);os.chown(f,owner.pw_uid,owner.pw_gid)
PY
cat > /etc/systemd/system/edu-activation.service <<'UNIT'
[Unit]
Description=AI Education Manager activation service
After=network.target
[Service]
User=edu-activation
Group=edu-activation
Environment=EDU_ACTIVATION_CONFIG=/etc/edu-activation/config.json
ExecStart=/opt/edu-cloud-documents/runtime/node-v24.21.0-linux-x64/bin/node /opt/edu-activation/current/activation-service/http.cjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/edu-activation
UMask=0077
MemoryMax=256M
TasksMax=64
[Install]
WantedBy=multi-user.target
UNIT
ln -s "$release" "$root/current.new"
mv -Tf "$root/current.new" "$root/current"
systemctl daemon-reload
systemctl enable edu-activation
systemctl restart edu-activation
ready=0
for attempt in {1..15}; do if curl -fsS http://127.0.0.1:8758/health; then ready=1; break; fi; sleep 1; done
test "$ready" = 1
# Do not retain the bootstrap plaintext password after the hashed administrator is established.
python3 - <<'PY'
from pathlib import Path
import json,os
p=Path('/etc/edu-activation/config.json');j=json.loads(p.read_text());j.pop('adminPassword',None)
with p.open('w') as f: json.dump(j,f)
PY
python3 - "$vhost" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text();assert s.count('<VirtualHost *:443>')==1
if '/edu-activation/' in s:
    previous='''
    # Independent product activation service
    ProxyPass /edu-activation/ http://127.0.0.1:8758/ connectiontimeout=5 timeout=30
    ProxyPassReverse /edu-activation/ http://127.0.0.1:8758/
    ProxyAddHeaders On
'''
    assert s.count(previous)==1
    s=s.replace(previous,'')
start=s.index('<VirtualHost *:443>');end=s.index('</VirtualHost>',start)
block='''
    # Independent product activation service
    ProxyPass /edu-activation/ http://127.0.0.1:8758/ connectiontimeout=5 timeout=30
    ProxyPassReverse /edu-activation/ http://127.0.0.1:8758/
    ProxyAddHeaders On
'''
p.write_text(s[:end]+block+s[end:])
PY
if ! /www/server/apache/bin/apachectl -t; then cp -a "$backup/vhost.conf" "$vhost"; exit 1; fi
/www/server/apache/bin/apachectl graceful
"$node" - <<'JS'
const fs=require('fs'),crypto=require('crypto');const c=JSON.parse(fs.readFileSync('/etc/edu-activation/config.json'));
const publicKey=crypto.createPublicKey(fs.readFileSync(c.privateKeyPath)).export({type:'spki',format:'pem'}).toString();
fs.writeFileSync('/tmp/edu-activation-20261125-r1/online-public.json',JSON.stringify({keyId:c.keyId,publicKey,maxEdition:'ORG',purpose:'license_signing'}));
JS
cat > /etc/systemd/system/edu-activation-backup.service <<'UNIT'
[Unit]
Description=Encrypted activation database and signing key backup
[Service]
Type=oneshot
User=edu-activation
ExecStart=/opt/edu-cloud-documents/runtime/node-v24.21.0-linux-x64/bin/node /opt/edu-activation/current/activation-service/maintenance.cjs backup /etc/edu-activation/config.json
UMask=0077
UNIT
cat > /etc/systemd/system/edu-activation-backup.timer <<'UNIT'
[Unit]
Description=Daily encrypted activation backup
[Timer]
OnCalendar=*-*-* 03:20:00 Asia/Shanghai
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now edu-activation-backup.timer
systemctl start edu-activation-backup.service
cat > /etc/systemd/system/edu-activation-monitor.service <<'UNIT'
[Unit]
Description=Activation availability and backup monitor
[Service]
Type=oneshot
User=edu-activation
ExecStart=/opt/edu-cloud-documents/runtime/node-v24.21.0-linux-x64/bin/node /opt/edu-activation/current/scripts/monitor-activation-service.cjs /etc/edu-activation/config.json
UNIT
cat > /etc/systemd/system/edu-activation-monitor.timer <<'UNIT'
[Unit]
Description=Activation monitor every five minutes
[Timer]
OnBootSec=5min
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now edu-activation-monitor.timer
rm -f "$stage/bootstrap-password"
curl -fsS https://www.greatbg.com/edu-activation/health
printf '\nDEPLOYED=1 BACKUP=%s\n' "$backup"
