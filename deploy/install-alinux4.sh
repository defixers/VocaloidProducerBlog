#!/usr/bin/env bash
# Fresh-server installer. Run from a reviewed, clean project checkout.
set -Eeuo pipefail
umask 027

APP=/opt/vocaloid-producer-blog
STORE=/var/lib/vocaloid-producer-blog
CONFIG=/etc/vocaloid-producer-blog
BACKUPS=/var/backups/vocaloid-producer-blog
SOURCE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
CLAMAV_VERSION=1.5.4
CLAMAV_DATABASE=/var/lib/vpb-clamav/database
WORK=''
CLAMSCAN_BIN=''
FRESHCLAM_BIN=''
RESUME=false
ADMIN_PASSWORD=''
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[install] %s\n' "$*"; }
cleanup() {
  if [[ "$WORK" == /tmp/vpb-install.* && -d "$WORK" ]]; then rm -rf -- "$WORK"; fi
}
trap cleanup EXIT
trap 'printf "Installation stopped at line %s. Correct the error before continuing; existing data has not been reset.\n" "$LINENO" >&2' ERR

prompt() {
  local key="$1" label="$2" fallback="${3:-}" value
  [[ -n "${!key:-}" ]] && return
  read -r -p "$label [$fallback]: " value
  printf -v "$key" '%s' "${value:-$fallback}"
}

parse_args() {
  [[ $# -le 1 ]] || fail 'Usage: sudo bash deploy/install-alinux4.sh [--resume]'
  if [[ $# == 1 ]]; then
    [[ "$1" == --resume ]] || fail 'Usage: sudo bash deploy/install-alinux4.sh [--resume]'
    RESUME=true
  fi
}

prompt_admin_password() {
  local confirmation=''
  [[ -t 0 ]] || fail 'Admin password entry requires an interactive terminal.'
  while true; do
    read -r -s -p 'Admin password (at least 12 characters): ' ADMIN_PASSWORD
    printf '\n'
    if [[ ${#ADMIN_PASSWORD} -lt 12 ]]; then
      printf 'Password must contain at least 12 characters. Try again.\n' >&2
      continue
    fi
    read -r -s -p 'Confirm admin password: ' confirmation
    printf '\n'
    if [[ "$ADMIN_PASSWORD" == "$confirmation" ]]; then break; fi
    printf 'Passwords do not match. Try again.\n' >&2
  done
  confirmation=''
}

require_resume_state() {
  local target account
  [[ -d "$APP" && ! -L "$APP" && -d "$APP/.git" && ! -L "$APP/.git" ]] || fail "Cannot resume: missing or unsafe Git checkout at $APP."
  [[ -d "$STORE" && ! -L "$STORE" && -f "$STORE/data/content.json" && ! -L "$STORE/data/content.json" \
    && -d "$STORE/uploads" && ! -L "$STORE/uploads" ]] || fail 'Cannot resume: initial application data is incomplete or unsafe.'
  [[ -d "$CONFIG" && ! -L "$CONFIG" && -f "$CONFIG/fullchain.pem" && ! -L "$CONFIG/fullchain.pem" \
    && -f "$CONFIG/privkey.pem" && ! -L "$CONFIG/privkey.pem" ]] || fail 'Cannot resume: installed TLS files are incomplete or unsafe.'
  if [[ -e "$CLAMAV_DATABASE" || -L "$CLAMAV_DATABASE" ]]; then
    [[ -d "$CLAMAV_DATABASE" && ! -L "$CLAMAV_DATABASE" ]] || fail "Cannot resume: unsafe ClamAV database path: $CLAMAV_DATABASE"
  fi
  for target in "$APP/.env" "$BACKUPS" /opt/vocaloid-producer-blog-backup \
    "$STORE/drills" "$CONFIG/freshclam.conf" "$CONFIG/backup.key" "$CONFIG/backup.env" \
    /etc/nginx/conf.d/vocaloid-producer-blog.conf /etc/systemd/system/vocaloid-producer-blog.service \
    /etc/systemd/system/vpb-port-guard.service /etc/systemd/system/vpb-freshclam.service \
    /etc/systemd/system/vpb-freshclam.timer /etc/systemd/system/vocaloid-producer-blog-backup.service \
    /etc/systemd/system/vocaloid-producer-blog-backup.timer \
    /etc/systemd/system/vocaloid-producer-blog-restore-drill.service \
    /etc/systemd/system/vocaloid-producer-blog-restore-drill.timer /etc/vpb-port-guard.nft; do
    [[ ! -e "$target" && ! -L "$target" ]] || fail "Cannot resume: unexpected installation artifact: $target"
  done
  for account in vpb vpb-build vpb-backup vpb-clamav; do
    id "$account" >/dev/null 2>&1 || fail "Cannot resume: missing account: $account"
  done
  [[ -z "$(git -C "$APP" status --porcelain)" ]] || fail 'Cannot resume: the installed application checkout is not clean.'
  TLS_CERT="$CONFIG/fullchain.pem"
  TLS_KEY="$CONFIG/privkey.pem"
}

preflight() {
  [[ "$EUID" == 0 ]] || fail 'Run with sudo bash deploy/install-alinux4.sh [--resume]'
  source /etc/os-release
  [[ "${ID:-}" == alinux && "${VERSION_ID:-}" =~ ^4([.]|$) ]] || fail 'Requires Alibaba Cloud Linux 4.'
  [[ -d /run/systemd/system ]] || fail 'Requires a host running systemd.'
  if [[ "$RESUME" == true ]]; then
    require_resume_state
  else
    for target in "$APP" "$STORE" "$CONFIG" "$BACKUPS" /opt/vocaloid-producer-blog-backup \
      /etc/nginx/conf.d/vocaloid-producer-blog.conf /etc/systemd/system/vocaloid-producer-blog.service \
      /etc/systemd/system/vpb-port-guard.service /etc/systemd/system/vpb-freshclam.service \
      /etc/systemd/system/vpb-freshclam.timer /etc/vpb-port-guard.nft; do
      [[ ! -e "$target" && ! -L "$target" ]] || fail "Existing installation target: $target. Use the upgrade/migration procedure instead."
    done
    for account in vpb vpb-build vpb-backup vpb-clamav; do
      ! id "$account" >/dev/null 2>&1 || fail "Account already exists: $account"
    done
  fi
  prompt DOMAIN 'Primary domain' utopiap.top
  prompt WWW_DOMAIN 'Second domain (use the primary domain again for a single-domain site)' "www.$DOMAIN"
  for domain in "$DOMAIN" "$WWW_DOMAIN"; do
    [[ ${#domain} -le 253 && "$domain" == *.* && "$domain" != *..* ]] || fail 'Invalid domain.'
    local label
    IFS=. read -r -a labels <<< "$domain"
    for label in "${labels[@]}"; do
      [[ "$label" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] || fail "Invalid domain label: $label"
    done
  done
  if [[ "$RESUME" != true ]]; then
    prompt TLS_CERT 'Absolute path to PEM full certificate chain'
    prompt TLS_KEY 'Absolute path to PEM private key'
  fi
  [[ "$TLS_CERT" == /* && -f "$TLS_CERT" && "$TLS_KEY" == /* && -f "$TLS_KEY" ]] || fail 'Certificate and private key files are required.'
  command -v git >/dev/null || fail 'Install git and clone this repository first: sudo dnf install -y git'
  [[ -z "$(git -C "$SOURCE" status --porcelain)" ]] || fail 'The source checkout must be clean. Commit the installer before distribution.'
  COMMIT="$(git -C "$SOURCE" rev-parse HEAD)"
  [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || fail 'Invalid source commit.'
  if command -v ss >/dev/null; then
    [[ -z "$(ss -H -ltn '( sport = :80 or sport = :443 or sport = :8787 )')" ]] || fail 'Ports 80, 443 or 8787 are in use. This installer is for a fresh host.'
  fi
  prompt_admin_password
}

install_runtime() {
  # EPEL 9 ClamAV currently requires an OpenSSL ABI that Alibaba Cloud Linux 4
  # does not provide. Install only generic OS packages from configured repos;
  # the pinned upstream ClamAV RPM is installed below.
  dnf install -y nginx curl ca-certificates openssl tar xz acl util-linux nftables
  if command -v getenforce >/dev/null && [[ "$(getenforce)" != Disabled ]]; then
    dnf install -y policycoreutils-python-utils
    setsebool -P httpd_can_network_connect on
  fi
  openssl x509 -in "$TLS_CERT" -noout -checkend 86400 || fail 'Certificate expires within 24 hours.'
  for domain in "$DOMAIN" "$WWW_DOMAIN"; do
    openssl x509 -in "$TLS_CERT" -noout -checkhost "$domain" || fail 'Certificate does not cover the configured domain.'
  done
  [[ "$(openssl x509 -in "$TLS_CERT" -pubkey -noout | openssl pkey -pubin -outform DER | sha256sum)" == \
     "$(openssl pkey -in "$TLS_KEY" -pubout -outform DER | sha256sum)" ]] || fail 'Certificate/key mismatch.'
  local version arch archive clamav_arch clamav_rpm clamav_sha256
  version="$(tr -d '\r\n' < "$SOURCE/.nvmrc")"
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid .nvmrc'
  case "$(uname -m)" in
    x86_64)
      arch=x64
      clamav_arch=x86_64
      clamav_sha256=1f4d381226b3cb5f4b1897253a496cf774a975fa1934e8610d7899f614f144dc
      ;;
    aarch64)
      arch=arm64
      clamav_arch=aarch64
      clamav_sha256=72cb798eb6afa19cd79dc3a40bd54f36146197db00cfc7e5594389a713869c0c
      ;;
    *) fail 'Unsupported architecture';;
  esac
  NODE_ROOT="/opt/vpb-node-$version-$arch"
  archive="node-v$version-linux-$arch.tar.xz"
  WORK="$(mktemp -d /tmp/vpb-install.XXXXXXXX)"
  clamav_rpm="clamav-${CLAMAV_VERSION}.linux.${clamav_arch}.rpm"
  if [[ "$RESUME" == true ]]; then
    CLAMSCAN_BIN="$(command -v clamscan)" || fail 'Cannot resume: clamscan is not installed.'
    FRESHCLAM_BIN="$(command -v freshclam)" || fail 'Cannot resume: freshclam is not installed.'
  else
    curl -fSL --proto '=https' --proto-redir '=https' \
      "https://github.com/Cisco-Talos/clamav/releases/download/clamav-${CLAMAV_VERSION}/${clamav_rpm}" \
      -o "$WORK/$clamav_rpm"
    printf '%s  %s\n' "$clamav_sha256" "$clamav_rpm" > "$WORK/CLAMAV-CHECKSUM"
    (cd "$WORK"; sha256sum -c CLAMAV-CHECKSUM)
    dnf install -y --disablerepo='epel*' "$WORK/$clamav_rpm"
    CLAMSCAN_BIN="$(command -v clamscan)"
    FRESHCLAM_BIN="$(command -v freshclam)"
  fi
  [[ -x "$CLAMSCAN_BIN" && -x "$FRESHCLAM_BIN" ]] || fail 'The official ClamAV RPM did not install clamscan and freshclam.'
  [[ "$("$CLAMSCAN_BIN" --version)" == "ClamAV ${CLAMAV_VERSION}"* ]] || fail 'Unexpected ClamAV version.'
  if [[ -e "$NODE_ROOT" ]]; then
    [[ "$RESUME" == true && -d "$NODE_ROOT/bin" ]] || fail "Runtime directory already exists: $NODE_ROOT"
  else
    [[ "$RESUME" != true ]] || fail "Cannot resume: missing Node runtime directory: $NODE_ROOT"
    curl -fSL --proto '=https' --proto-redir '=https' "https://nodejs.org/dist/v$version/$archive" -o "$WORK/$archive"
    curl -fSL --proto '=https' --proto-redir '=https' "https://nodejs.org/dist/v$version/SHASUMS256.txt" -o "$WORK/SHA256SUMS"
    (cd "$WORK"; awk -v name="$archive" '$2 == name { print }' SHA256SUMS > CHECKSUM; test -s CHECKSUM; sha256sum -c CHECKSUM)
    install -d -o root -g root -m 0755 "$NODE_ROOT"
    tar -xJf "$WORK/$archive" -C "$NODE_ROOT" --strip-components=1
  fi
  export PATH="$NODE_ROOT/bin:/usr/sbin:/usr/bin:/sbin:/bin"
  [[ "$(node -p 'process.versions.node')" == "$version" ]] || fail 'Wrong Node version.'
  local npm_version
  npm_version="$(node -p "require('$SOURCE/package.json').packageManager.split('@')[1]")"
  [[ "$npm_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail 'Invalid npm version.'
  if [[ "$(npm --version)" != "$npm_version" ]]; then npm install -g "npm@$npm_version" --ignore-scripts --registry=https://registry.npmjs.org; fi
  chmod -R a+rX "$NODE_ROOT"
  chmod -R go-w "$NODE_ROOT"
  if [[ "$RESUME" != true ]]; then
    for account in vpb vpb-build vpb-backup vpb-clamav; do
      useradd --system --user-group --create-home --home-dir "/var/lib/$account" --shell /usr/sbin/nologin "$account"
    done
    install -d -o root -g root -m 0755 "$APP"
    git clone --no-local "$SOURCE" "$APP"
    git -C "$APP" checkout --detach "$COMMIT"
  else
    git -C "$APP" fetch --no-tags "$SOURCE" "$COMMIT"
    git -C "$APP" checkout --detach FETCH_HEAD
  fi
  chown -R vpb-build:vpb-build "$APP"
  log 'Installing locked dependencies and running the release checks as an unprivileged build account'
  (
    cd "$APP"
    runuser -u vpb-build -- env PATH="$PATH" npm ci
    for check in security:supply-chain security:secrets test:auth test:uploads test:public test:content test:monitoring test:backup test:deploy test:smoke verify:reproducible verify:build; do
      runuser -u vpb-build -- env PATH="$PATH" npm run "$check"
    done
    runuser -u vpb-build -- env PATH="$PATH" npm audit --audit-level=high --registry=https://registry.npmjs.org
  )
  chown -R root:root "$APP"
  # Build-time umask is restrictive; the separate runtime account needs read/traverse access.
  # The production .env is created only after this step, with its own 0640 permissions.
  chmod -R a+rX "$APP"
  chmod -R go-w "$APP"
}

configure_application() {
  if [[ "$RESUME" != true ]]; then
    install -d -o root -g vpb -m 0750 "$CONFIG"
    install -d -o vpb -g vpb -m 0750 "$STORE" "$STORE/data" "$STORE/uploads"
    install -o vpb -g vpb -m 0640 "$APP/server/data/content.json" "$STORE/data/content.json"
    install -o root -g root -m 0644 "$TLS_CERT" "$CONFIG/fullchain.pem"
    install -o root -g root -m 0600 "$TLS_KEY" "$CONFIG/privkey.pem"
  fi
  printf '%s' "$ADMIN_PASSWORD" | node --input-type=module -e '
    import { writeFileSync } from "node:fs";
    import { pathToFileURL } from "node:url";
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    const { hashAdminPassword } = await import(pathToFileURL(process.argv[1]).href);
    const hash = await hashAdminPassword(Buffer.concat(chunks).toString("utf8"));
    writeFileSync(process.argv[2], `ADMIN_PASSWORD_HASH=${hash}\n`, { mode: 0o600 });
  ' "$APP/server/security/password.js" "$WORK/password.env"
  ADMIN_PASSWORD=''
  install -o root -g vpb -m 0640 "$APP/.env.example" "$APP/.env"
  # Parse the helper output rather than sourcing an environment file as shell code.
  CLAMSCAN_BIN="$CLAMSCAN_BIN" node --input-type=module - "$APP/.env" "$WORK/password.env" "$DOMAIN" "$WWW_DOMAIN" <<'JS'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const [file, passwordFile, domain, www] = process.argv.slice(2);
const hash = readFileSync(passwordFile, 'utf8').match(/^ADMIN_PASSWORD_HASH=(.+)$/m)?.[1];
if (!hash) throw new Error('Password hash was not generated');
let source = readFileSync(file, 'utf8');
const changes = { ADMIN_PASSWORD_HASH: hash, APP_ORIGIN: [...new Set([domain,www])].map(x=>'https://'+x).join(','), APP_STORAGE_ROOT: '/var/lib/vocaloid-producer-blog', SECURITY_LOG_IP_KEY: randomBytes(32).toString('hex'), UPLOAD_VIRUS_SCAN_COMMAND: process.env.CLAMSCAN_BIN, UPLOAD_VIRUS_SCAN_ARGS: JSON.stringify(['--no-summary','--database=/var/lib/vpb-clamav/database']) };
for (const [key,value] of Object.entries(changes)) source=source.replace(new RegExp('^'+key+'=.*$', 'm'), ()=>key+'='+value);
writeFileSync(file, source);
JS
  # Use a separate table so other firewall rules, including SSH rules, remain intact.
  cat > /etc/vpb-port-guard.nft <<'EOF'
table inet vpb_guard {
  chain input {
    type filter hook input priority -10; policy accept;
    iifname != "lo" tcp dport 8787 drop
  }
}
EOF
  cat > /etc/systemd/system/vpb-port-guard.service <<'EOF'
[Unit]
Description=Block external access to the blog API port
After=firewalld.service nftables.service
Before=vocaloid-producer-blog.service
[Service]
Type=oneshot
RemainAfterExit=yes
ExecStart=/usr/sbin/nft -f /etc/vpb-port-guard.nft
[Install]
WantedBy=multi-user.target
EOF
  cat > /etc/systemd/system/vocaloid-producer-blog.service <<EOF
[Unit]
Description=Vocaloid Producer Blog
After=network-online.target vpb-port-guard.service
Requires=vpb-port-guard.service
Wants=network-online.target
[Service]
User=vpb
Group=vpb
WorkingDirectory=$APP
ExecStart=$NODE_ROOT/bin/node server/index.js
Environment=NODE_ENV=production
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STORE
UMask=0027
[Install]
WantedBy=multi-user.target
EOF
  # Use a dedicated writable database and updater account. The application can
  # read signatures through its vpb group but cannot replace them.
  install -d -o vpb-clamav -g vpb -m 0750 "$CLAMAV_DATABASE"
  cat > "$CONFIG/freshclam.conf" <<EOF
DatabaseDirectory $CLAMAV_DATABASE
DatabaseMirror database.clamav.net
EOF
  chown root:vpb "$CONFIG/freshclam.conf"
  chmod 0640 "$CONFIG/freshclam.conf"
  runuser -u vpb-clamav -- "$FRESHCLAM_BIN" --config-file="$CONFIG/freshclam.conf"
  cat > /etc/systemd/system/vpb-freshclam.service <<'EOF'
[Unit]
Description=Update ClamAV signatures
[Service]
Type=oneshot
User=vpb-clamav
Group=vpb
ExecStart=FRESHCLAM_COMMAND --config-file=/etc/vocaloid-producer-blog/freshclam.conf
TimeoutStartSec=30min
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/vpb-clamav/database
EOF
  sed -i "s|FRESHCLAM_COMMAND|$FRESHCLAM_BIN|" /etc/systemd/system/vpb-freshclam.service
  cat > /etc/systemd/system/vpb-freshclam.timer <<'EOF'
[Unit]
Description=Update ClamAV signatures every six hours
[Timer]
OnBootSec=10min
OnUnitActiveSec=6h
Persistent=true
[Install]
WantedBy=timers.target
EOF
}

configure_nginx() {
  # The packaged default host may remain: this named virtual host takes precedence.
  cat > /etc/nginx/conf.d/vocaloid-producer-blog.conf <<EOF
limit_req_zone \$binary_remote_addr zone=vpb_login:10m rate=5r/m;
limit_conn_zone \$binary_remote_addr zone=vpb_conn:10m;
server {
    listen 80;
    server_name $DOMAIN $WWW_DOMAIN;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl;
    server_name $DOMAIN $WWW_DOMAIN;
    ssl_certificate $CONFIG/fullchain.pem;
    ssl_certificate_key $CONFIG/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security "max-age=31536000" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy strict-origin-when-cross-origin always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests" always;
    # Empty values suppress this header for public pages; inherited by all locations.
    add_header Cache-Control \$vpb_admin_cache always;
    client_max_body_size 101m;
    client_header_timeout 15s;
    client_body_timeout 30s;
    send_timeout 120s;
    limit_conn vpb_conn 20;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$remote_addr;
    proxy_set_header X-Forwarded-Proto \$scheme;
    proxy_connect_timeout 5s;
    proxy_send_timeout 120s;
    proxy_read_timeout 120s;
    location = /api/admin/auth/login {
        client_max_body_size 16k;
        limit_req zone=vpb_login burst=3 nodelay;
        proxy_pass http://127.0.0.1:8787;
    }
    location /admin {
        proxy_hide_header Cache-Control;
        proxy_pass http://127.0.0.1:8787;
    }
    location /uploads { return 404; }
    location / { proxy_pass http://127.0.0.1:8787; }
}
map \$uri \$vpb_admin_cache {
    default "";
    ~^/admin "no-store";
}
EOF
  if command -v restorecon >/dev/null; then restorecon -RF "$CONFIG" /etc/nginx/conf.d; fi
  nginx -t
  if systemctl is-active --quiet firewalld; then
    firewall-cmd --permanent --add-service=http
    firewall-cmd --permanent --add-service=https
    firewall-cmd --add-service=http
    firewall-cmd --add-service=https
  fi
}

configure_backup() {
  local program=/opt/vocaloid-producer-blog-backup
  install -d -o root -g root -m 0755 "$program/scripts/lib"
  install -m 0644 "$APP/scripts/lib/backup.mjs" "$program/scripts/lib/"
  install -m 0644 "$APP/scripts/backup-data.mjs" "$APP/scripts/restore-backup.mjs" "$APP/scripts/restore-drill.mjs" "$program/scripts/"
  install -d -o vpb-backup -g vpb-backup -m 0700 "$BACKUPS" "$STORE/drills"
  setfacl -m u:vpb-backup:x "$CONFIG" "$APP"
  setfacl -m u:vpb-backup:r "$APP/.env"
  setfacl -m u:vpb-backup:rx "$STORE"
  setfacl -R -m u:vpb-backup:rX "$STORE/data" "$STORE/uploads"
  find "$STORE/data" "$STORE/uploads" -type d -exec setfacl -m d:u:vpb-backup:rX {} +
  openssl rand -hex 32 > "$CONFIG/backup.key"
  chown vpb-backup:vpb-backup "$CONFIG/backup.key"
  chmod 0600 "$CONFIG/backup.key"
  cat > "$CONFIG/backup.env" <<EOF
BACKUP_APP_ROOT=$APP
APP_STORAGE_ROOT=$STORE
BACKUP_LOCAL_DIR=$BACKUPS
BACKUP_ENCRYPTION_KEY_FILE=$CONFIG/backup.key
BACKUP_RETENTION_DAYS=14
BACKUP_REQUIRE_REPLICA=false
BACKUP_REPLICA_COMMAND=
BACKUP_REPLICA_ARGS=[]
BACKUP_DRILL_LOG_DIR=$STORE/drills
BACKUP_TAR_COMMAND=/usr/bin/tar
EOF
  chmod 0600 "$CONFIG/backup.env"
  for name in backup restore-drill; do
    install -m 0644 "$APP/deploy/systemd/vocaloid-producer-blog-$name.service" /etc/systemd/system/
    install -m 0644 "$APP/deploy/systemd/vocaloid-producer-blog-$name.timer" /etc/systemd/system/
    sed -i "s|/usr/bin/node|$NODE_ROOT/bin/node|g" "/etc/systemd/system/vocaloid-producer-blog-$name.service"
  done
}

start_and_verify() {
  systemd-analyze verify /etc/systemd/system/vocaloid-producer-blog*.service /etc/systemd/system/vpb-*.service
  systemctl daemon-reload
  systemctl enable --now vpb-port-guard.service vocaloid-producer-blog.service nginx.service vpb-freshclam.timer
  local ready=no
  for ((attempt=0; attempt<30; attempt++)); do
    if curl -fsS http://127.0.0.1:8787/api/health >/dev/null; then ready=yes; break; fi
    sleep 1
  done
  [[ "$ready" == yes ]] || fail 'Application did not start. Check journalctl -u vocaloid-producer-blog.'
  for domain in "$DOMAIN" "$WWW_DOMAIN"; do
    curl -fsS --resolve "$domain:443:127.0.0.1" "https://$domain/api/health"
  done
  systemctl start vocaloid-producer-blog-backup.service
  systemctl start vocaloid-producer-blog-restore-drill.service
  systemctl enable --now vocaloid-producer-blog-backup.timer vocaloid-producer-blog-restore-drill.timer
  log "Installed commit $COMMIT. Website: https://$DOMAIN ; Admin: https://$DOMAIN/admin"
  log "Store $CONFIG/backup.key in an offline password vault. Backups are currently local only."
  log 'Cloud security group: allow 80/443, keep your SSH access, never expose 8787.'
  log 'Certificate files are copied, not automatically renewed. Replace both files in the config directory before expiry and reload nginx.'
  log "After DNS points here, run an EXTERNAL production smoke check with DEPLOY_COMMIT=$COMMIT and your two domains."
}

main() {
  parse_args "$@"
  preflight
  install_runtime
  configure_application
  configure_nginx
  configure_backup
  start_and_verify
}
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then main "$@"; fi
