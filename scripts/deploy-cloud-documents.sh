#!/usr/bin/env bash
# Reviewed one-instance deployment. No credentials are written to stdout.
set -euo pipefail
stage=/tmp/edu-cloud-20261001
root=/opt/edu-cloud-documents
backup=/opt/edu-cloud-documents-backups/deploy-20261001
vhost=/www/server/panel/vhost/apache/123.56.83.50.conf
test "$(hostname)" = iZm5e6r68cl11nbh2y0o6zZ
test "$(readlink -f "$stage")" = "$stage"
test ! -L "$root"
mkdir -p "$backup" "$root/releases" "$root/runtime"
if ! test -e "$backup/vhost.conf"; then cp -a "$vhost" "$backup/vhost.conf"; fi
if test -e /etc/systemd/system/edu-cloud-documents.service; then cp -a /etc/systemd/system/edu-cloud-documents.service "$backup/service"; fi
if test -e "$root/current"; then readlink "$root/current" > "$backup/previous-release"; fi
cd "$stage"
tr -d '\r' < cloud-bundle.sha256 | sha256sum -c -
tar -tzf cloud-bundle.tar.gz | python3 -c 'import sys; names=sys.stdin.read().splitlines(); assert names and all(not n.startswith("/") and ".." not in n.split("/") for n in names)'
curl --retry 2 -fsSLO https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
curl --retry 2 -fsSLo node-shasums https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
grep ' node-v24.21.0-linux-x64.tar.xz$' node-shasums | sha256sum -c -
tar -xJf node-v24.21.0-linux-x64.tar.xz -C "$root/runtime"
release="$root/releases/20261001"
if ! test -e "$release"; then mkdir "$release"; tar -xzf cloud-bundle.tar.gz -C "$release"; fi
find "$release" -type d -exec chmod 755 {} +
find "$release" -type f -exec chmod 644 {} +
node="$root/runtime/node-v24.21.0-linux-x64/bin/node"
for source in "$release"/*.cjs; do "$node" --check "$source"; done
mkdir -p "$stage/test-suite"
tar -xzf "$stage/cloud-test-dependencies.tar.gz" -C "$stage/test-suite"
test -e "$stage/test-suite/cloud-report-service" || ln -s "$release" "$stage/test-suite/cloud-report-service"
# Copy tests rather than resolving their symlink to the production directory.
mkdir -p "$stage/test-suite/tests"
cp "$release"/security-contract.test.cjs "$stage/test-suite/tests/security-contract.test.cjs"
cp "$release"/{http,service,document-stream,backup,backup-scheduler,maintenance}.cjs "$stage/test-suite/tests/"
"$node" --test "$release"/backup*.test.cjs "$release"/maintenance.test.cjs "$release"/service.test.cjs "$stage/test-suite/tests/security-contract.test.cjs" > "$backup/server-tests.log" 2>&1
id edu-cloud >/dev/null 2>&1 || useradd --system --home-dir /var/lib/edu-cloud-documents --shell /sbin/nologin edu-cloud
install -d -o edu-cloud -g edu-cloud -m 700 /var/lib/edu-cloud-documents /var/backups/edu-cloud-documents /var/log/edu-cloud-documents
if ! test -e "$root/service.env"; then
  umask 077
  admin=$(openssl rand -hex 32)
  audit=$(openssl rand -hex 32)
  printf 'CLOUD_REPORT_DATA_DIR=/var/lib/edu-cloud-documents\nCLOUD_REPORT_ADMIN_TOKEN=%s\nCLOUD_REPORT_HOST=127.0.0.1\nCLOUD_REPORT_PORT=8755\nCLOUD_REPORT_BACKUP_ROOT=/var/backups/edu-cloud-documents\nCLOUD_REPORT_AUDIT_ROOT=/var/log/edu-cloud-documents\nCLOUD_REPORT_AUDIT_KEY=%s\n' "$admin" "$audit" > "$root/service.env"
  printf '%s\n' "$admin" > "$root/admin-bootstrap.secret"
  unset admin audit
fi
install -m 644 "$stage/edu-cloud-documents.service" /etc/systemd/system/edu-cloud-documents.service.new
systemd-analyze verify /etc/systemd/system/edu-cloud-documents.service.new 2>/dev/null || systemd-analyze verify "$stage/edu-cloud-documents.service"
mv /etc/systemd/system/edu-cloud-documents.service.new /etc/systemd/system/edu-cloud-documents.service
ln -s "$release" "$root/current.new"
mv -Tf "$root/current.new" "$root/current"
systemctl daemon-reload
systemctl enable --now edu-cloud-documents
ready=0
for attempt in {1..15}; do if curl -fsS http://127.0.0.1:8755/health; then ready=1; break; fi; sleep 1; done
test "$ready" = 1
python3 - "$vhost" <<'PY'
from pathlib import Path
import sys
file=Path(sys.argv[1]); content=file.read_text()
assert content.count('<VirtualHost *:443>') == 1
assert '/edu-cloud/' not in content
proxy='''
    # AI Education Manager cloud documents (isolated service)
    RedirectMatch 308 ^/edu-cloud$ /edu-cloud/
    ProxyPass /edu-cloud/ http://127.0.0.1:8755/ connectiontimeout=5 timeout=60
    ProxyPassReverse /edu-cloud/ http://127.0.0.1:8755/
    <Location /edu-cloud/>
        LimitRequestBody 22020096
    </Location>
'''
content=content.replace('    # Mandarin evaluation bridge reverse proxy',proxy+'\n    # Mandarin evaluation bridge reverse proxy',1)
temp=file.with_name(file.name+'.edu-cloud.new'); temp.write_text(content); temp.chmod(file.stat().st_mode); temp.replace(file)
PY
if ! /www/server/apache/bin/apachectl -t; then cp -a "$backup/vhost.conf" "$vhost"; exit 1; fi
/www/server/apache/bin/apachectl -k graceful
curl -fsS https://www.greatbg.com/edu-cloud/health
curl -fsS http://127.0.0.1:8787/healthz
curl -fsS https://www.greatbg.com/edu-cloud/ > "$backup/public-index.html"
cmp "$release/web-dist/index.html" "$backup/public-index.html"
systemctl is-active edu-cloud-documents
sha256sum "$release/http.cjs" "$release/web-dist/index.html"
printf '\nDeployment verified; rollback backup: %s\n' "$backup"
