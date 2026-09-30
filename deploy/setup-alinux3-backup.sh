#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly BACKUP_USER="vpb-backup"
readonly INSTALL_ROOT="/opt/vocaloid-producer-blog-backup"
readonly CONFIG_ROOT="/etc/vocaloid-producer-blog"
readonly BACKUP_ROOT="/var/backups/vocaloid-producer-blog"
readonly RCLONE_HOME="/var/lib/vpb-backup"
readonly RCLONE_CONFIG="${RCLONE_HOME}/.config/rclone/rclone.conf"
readonly DEFAULT_STORAGE_ROOT="/var/lib/vocaloid-producer-blog"
readonly RCLONE_VERSION_DEFAULT="v1.70.3"

TEMP_DIR=""
cleanup() {
  if [[ -n "${TEMP_DIR}" && -d "${TEMP_DIR}" ]]; then
    rm -rf -- "${TEMP_DIR}"
  fi
}
trap cleanup EXIT

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

log() {
  echo "[vpb-backup] $*"
}

require_root() {
  [[ "${EUID}" -eq 0 ]] || fail "Run this script as root: sudo bash deploy/setup-alinux3-backup.sh"
}

verify_operating_system() {
  [[ -r /etc/os-release ]] || fail "/etc/os-release is missing"
  # shellcheck disable=SC1091
  source /etc/os-release
  [[ "${ID:-}" == "alinux" && "${VERSION_ID:-}" == 3* ]] \
    || fail "This installer supports Alibaba Cloud Linux 3 only"
}

prompt_value() {
  local variable_name="$1"
  local prompt="$2"
  local default_value="${3:-}"
  local current_value="${!variable_name:-}"
  if [[ -n "${current_value}" ]]; then return
  fi
  if [[ -n "${default_value}" ]]; then
    read -r -p "${prompt} [${default_value}]: " current_value
    printf -v "${variable_name}" '%s' "${current_value:-${default_value}}"
  else
    read -r -p "${prompt}: " current_value
    [[ -n "${current_value}" ]] || fail "${variable_name} is required"
    printf -v "${variable_name}" '%s' "${current_value}"
  fi
}

prompt_secret() {
  local variable_name="$1"
  local prompt="$2"
  local current_value="${!variable_name:-}"
  if [[ -n "${current_value}" ]]; then return
  fi
  read -r -s -p "${prompt}: " current_value
  echo
  [[ -n "${current_value}" ]] || fail "${variable_name} is required"
  printf -v "${variable_name}" '%s' "${current_value}"
}

collect_configuration() {
  APP_ROOT="${APP_ROOT:-}"
  STORAGE_ROOT="${STORAGE_ROOT:-}"
  ENABLE_OFFSITE_BACKUP="${ENABLE_OFFSITE_BACKUP:-}"
  OSS_ENDPOINT="${OSS_ENDPOINT:-}"
  OSS_BUCKET="${OSS_BUCKET:-}"
  OSS_PREFIX="${OSS_PREFIX:-}"
  ALIYUN_OSS_ACCESS_KEY_ID="${ALIYUN_OSS_ACCESS_KEY_ID:-}"
  ALIYUN_OSS_ACCESS_KEY_SECRET="${ALIYUN_OSS_ACCESS_KEY_SECRET:-}"
  RCLONE_VERSION="${RCLONE_VERSION:-${RCLONE_VERSION_DEFAULT}}"

  prompt_value APP_ROOT "Application repository path" "/home/admin/VocaloidProducerBlog"
  prompt_value STORAGE_ROOT "Application storage root" "${DEFAULT_STORAGE_ROOT}"
  prompt_value ENABLE_OFFSITE_BACKUP "Enable Alibaba Cloud OSS off-site replication now? (yes/no)" "no"
  ENABLE_OFFSITE_BACKUP="${ENABLE_OFFSITE_BACKUP,,}"
  [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" || "${ENABLE_OFFSITE_BACKUP}" == "no" ]] \
    || fail "ENABLE_OFFSITE_BACKUP must be yes or no"

  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    prompt_value OSS_ENDPOINT "OSS endpoint, for example oss-cn-hangzhou.aliyuncs.com"
    prompt_value OSS_BUCKET "OSS bucket name"
    prompt_value OSS_PREFIX "OSS object prefix" "vocaloid-producer-blog"
    prompt_value ALIYUN_OSS_ACCESS_KEY_ID "OSS RAM AccessKey ID"
    prompt_secret ALIYUN_OSS_ACCESS_KEY_SECRET "OSS RAM AccessKey Secret"
  fi

  APP_ROOT="$(readlink -f -- "${APP_ROOT}")"
  STORAGE_ROOT="$(readlink -f -- "${STORAGE_ROOT}")"
  [[ "${APP_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ && "${STORAGE_ROOT}" =~ ^/[A-Za-z0-9._/-]+$ ]] || fail "Application paths may only contain safe absolute-path characters"
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    [[ "${OSS_ENDPOINT}" =~ ^oss-[a-z0-9-]+\.aliyuncs\.com$ ]] || fail "Invalid Alibaba Cloud OSS endpoint"
    [[ "${OSS_BUCKET}" =~ ^[a-z0-9][a-z0-9-]{1,62}$ ]] || fail "Invalid OSS bucket name"
    [[ "${OSS_PREFIX}" =~ ^[A-Za-z0-9._/-]+$ && "${OSS_PREFIX}" != *".."* ]] || fail "Invalid OSS prefix"
    OSS_PREFIX="${OSS_PREFIX#/}"
    OSS_PREFIX="${OSS_PREFIX%/}"
    [[ "${ALIYUN_OSS_ACCESS_KEY_ID}" != *$'\n'* && "${ALIYUN_OSS_ACCESS_KEY_SECRET}" != *$'\n'* ]] || fail "AccessKey contains an invalid newline"
  fi
  [[ "${RCLONE_VERSION}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "Invalid RCLONE_VERSION"
  [[ -f "${APP_ROOT}/package.json" && -f "${APP_ROOT}/scripts/lib/backup.mjs" ]] || fail "APP_ROOT is not a compatible project checkout"
  [[ -f "${APP_ROOT}/.env" ]] || fail "Application .env is missing: ${APP_ROOT}/.env"
  [[ -f "${STORAGE_ROOT}/data/content.json" && -d "${STORAGE_ROOT}/uploads" ]] || fail "Storage root is incomplete"
}

install_packages() {
  log "Installing operating system dependencies"
  dnf install -y acl ca-certificates openssl tar util-linux
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    dnf install -y curl unzip
  fi
  command -v node >/dev/null 2>&1 || fail "Node.js 24.21.x must be installed before running this script"
  [[ "$(node -p 'process.versions.node')" == 24.21.* ]] || fail "Node.js 24.21.x is required"
}

install_rclone() {
  local architecture
  case "$(uname -m)" in
    x86_64) architecture="amd64" ;;
    aarch64) architecture="arm64" ;;
    *) fail "Unsupported CPU architecture: $(uname -m)" ;;
  esac

  local archive="rclone-${RCLONE_VERSION}-linux-${architecture}.zip"
  local base_url="https://downloads.rclone.org/${RCLONE_VERSION}"
  log "Downloading pinned rclone ${RCLONE_VERSION}"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "${TEMP_DIR}/${archive}" "${base_url}/${archive}"
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
    --output "${TEMP_DIR}/SHA256SUMS" "${base_url}/SHA256SUMS"
  grep -E "  ${archive}$" "${TEMP_DIR}/SHA256SUMS" > "${TEMP_DIR}/CHECKSUM" \
    || fail "The rclone checksum entry is missing"
  (cd "${TEMP_DIR}" && sha256sum --check CHECKSUM)
  unzip -q "${TEMP_DIR}/${archive}" -d "${TEMP_DIR}/unpacked"
  install -o root -g root -m 0755 \
    "${TEMP_DIR}/unpacked/rclone-${RCLONE_VERSION}-linux-${architecture}/rclone" \
    /usr/local/bin/rclone
  RCLONE_BIN="/usr/local/bin/rclone"
}

create_backup_account() {
  if ! id "${BACKUP_USER}" >/dev/null 2>&1; then
    useradd --system --home-dir "${RCLONE_HOME}" --create-home --shell /usr/sbin/nologin "${BACKUP_USER}"
  fi
  install -d -o "${BACKUP_USER}" -g "${BACKUP_USER}" -m 0700 "${BACKUP_ROOT}"
  install -d -o "${BACKUP_USER}" -g "${BACKUP_USER}" -m 0700 "${STORAGE_ROOT}/drills"
  install -d -o "${BACKUP_USER}" -g "${BACKUP_USER}" -m 0700 "$(dirname "${RCLONE_CONFIG}")"
}

grant_read_access() {
  log "Granting the backup account read-only access to application data"
  local current_path
  current_path="$(dirname "${APP_ROOT}")"
  while [[ "${current_path}" != "/" ]]; do
    setfacl -m "u:${BACKUP_USER}:x" "${current_path}"
    current_path="$(dirname "${current_path}")"
  done
  setfacl -m "u:${BACKUP_USER}:x" "${APP_ROOT}"
  setfacl -m "u:${BACKUP_USER}:r" "${APP_ROOT}/.env"
  setfacl -m "u:${BACKUP_USER}:rx" "${STORAGE_ROOT}"
  setfacl -R -m "u:${BACKUP_USER}:rX" "${STORAGE_ROOT}/data" "${STORAGE_ROOT}/uploads"
  find "${STORAGE_ROOT}/data" "${STORAGE_ROOT}/uploads" -type d \
    -exec setfacl -m "d:u:${BACKUP_USER}:rX" {} +
}

create_encryption_key() {
  install -d -o root -g "${BACKUP_USER}" -m 0750 "${CONFIG_ROOT}"
  if [[ ! -f "${CONFIG_ROOT}/backup.key" ]]; then
    openssl rand -hex 32 > "${CONFIG_ROOT}/backup.key"
    chown "${BACKUP_USER}:${BACKUP_USER}" "${CONFIG_ROOT}/backup.key"
    chmod 0600 "${CONFIG_ROOT}/backup.key"
    KEY_CREATED="true"
  else
    KEY_CREATED="false"
    [[ "$(stat -c '%U:%G:%a' "${CONFIG_ROOT}/backup.key")" == "${BACKUP_USER}:${BACKUP_USER}:600" ]] \
      || fail "Existing backup.key must be owned by ${BACKUP_USER}:${BACKUP_USER} with mode 600"
  fi
}

configure_rclone() {
  log "Configuring the Alibaba Cloud OSS remote"
  local temporary_config="${TEMP_DIR}/rclone.conf"
  cat > "${temporary_config}" <<EOF
[utopia-backups]
type = s3
provider = Alibaba
access_key_id = ${ALIYUN_OSS_ACCESS_KEY_ID}
secret_access_key = ${ALIYUN_OSS_ACCESS_KEY_SECRET}
endpoint = ${OSS_ENDPOINT}
acl = private
storage_class = STANDARD
EOF
  install -o "${BACKUP_USER}" -g "${BACKUP_USER}" -m 0600 "${temporary_config}" "${RCLONE_CONFIG}"
  rm -f -- "${temporary_config}"
  unset ALIYUN_OSS_ACCESS_KEY_SECRET

  local probe_directory="${TEMP_DIR}/probe"
  local probe="${probe_directory}/source"
  local downloaded_probe="${probe_directory}/downloaded"
  install -d -o "${BACKUP_USER}" -g "${BACKUP_USER}" -m 0700 "${probe_directory}"
  echo "VocaloidProducerBlog backup probe $(date -u +%FT%TZ)" > "${probe}"
  chown "${BACKUP_USER}:${BACKUP_USER}" "${probe}"
  runuser -u "${BACKUP_USER}" -- "${RCLONE_BIN}" --config "${RCLONE_CONFIG}" \
    copyto "${probe}" "utopia-backups:${OSS_BUCKET}/${OSS_PREFIX}/.setup-probe"
  runuser -u "${BACKUP_USER}" -- "${RCLONE_BIN}" --config "${RCLONE_CONFIG}" \
    copyto "utopia-backups:${OSS_BUCKET}/${OSS_PREFIX}/.setup-probe" "${downloaded_probe}"
  cmp --silent "${probe}" "${downloaded_probe}" || fail "The OSS download probe did not match the uploaded object"
  runuser -u "${BACKUP_USER}" -- "${RCLONE_BIN}" --config "${RCLONE_CONFIG}" \
    deletefile "utopia-backups:${OSS_BUCKET}/${OSS_PREFIX}/.setup-probe"
}

install_immutable_programs() {
  log "Installing root-owned backup programs"
  install -d -o root -g root -m 0755 "${INSTALL_ROOT}/scripts/lib"
  install -o root -g root -m 0644 "${APP_ROOT}/scripts/lib/backup.mjs" "${INSTALL_ROOT}/scripts/lib/backup.mjs"
  install -o root -g root -m 0644 \
    "${APP_ROOT}/scripts/backup-data.mjs" \
    "${APP_ROOT}/scripts/restore-backup.mjs" \
    "${APP_ROOT}/scripts/restore-drill.mjs" \
    "${INSTALL_ROOT}/scripts/"

  local backup_environment="${TEMP_DIR}/backup.env"
  cat > "${backup_environment}" <<EOF
BACKUP_APP_ROOT=${APP_ROOT}
APP_STORAGE_ROOT=${STORAGE_ROOT}
BACKUP_LOCAL_DIR=${BACKUP_ROOT}
BACKUP_ENCRYPTION_KEY_FILE=${CONFIG_ROOT}/backup.key
BACKUP_RETENTION_DAYS=14
BACKUP_DRILL_LOG_DIR=${STORAGE_ROOT}/drills
BACKUP_TAR_COMMAND=/usr/bin/tar
EOF
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    cat >> "${backup_environment}" <<EOF
BACKUP_REQUIRE_REPLICA=true
BACKUP_REPLICA_COMMAND=${RCLONE_BIN}
BACKUP_REPLICA_ARGS='["copyto","{file}","utopia-backups:${OSS_BUCKET}/${OSS_PREFIX}/{name}"]'
RCLONE_CONFIG=${RCLONE_CONFIG}
EOF
  else
    cat >> "${backup_environment}" <<EOF
BACKUP_REQUIRE_REPLICA=false
EOF
  fi
  install -o root -g root -m 0600 "${backup_environment}" "${CONFIG_ROOT}/backup.env"
  rm -f -- "${backup_environment}"
}

install_systemd_units() {
  log "Installing and validating systemd units"
  install -o root -g root -m 0644 "${APP_ROOT}"/deploy/systemd/vocaloid-producer-blog-{backup,restore-drill}.{service,timer} /etc/systemd/system/
  local node_bin
  node_bin="$(readlink -f -- "$(command -v node)")"
  [[ -x "${node_bin}" ]] || fail "Node.js is not installed"
  sed -i "s#/usr/bin/node#${node_bin}#g" \
    /etc/systemd/system/vocaloid-producer-blog-backup.service \
    /etc/systemd/system/vocaloid-producer-blog-restore-drill.service
  systemd-analyze verify \
    /etc/systemd/system/vocaloid-producer-blog-backup.service \
    /etc/systemd/system/vocaloid-producer-blog-backup.timer \
    /etc/systemd/system/vocaloid-producer-blog-restore-drill.service \
    /etc/systemd/system/vocaloid-producer-blog-restore-drill.timer
  systemctl daemon-reload
}

run_acceptance_checks() {
  log "Creating and replicating the first encrypted backup"
  systemctl start vocaloid-producer-blog-backup.service
  systemctl --quiet is-failed vocaloid-producer-blog-backup.service \
    && fail "The first backup failed; inspect journalctl -u vocaloid-producer-blog-backup.service"
  runuser -u "${BACKUP_USER}" -- bash -c \
    "cd '${BACKUP_ROOT}' && sha256sum -c -- *.vpb.sha256"
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    local remote_listing
    remote_listing="$(runuser -u "${BACKUP_USER}" -- "${RCLONE_BIN}" --config "${RCLONE_CONFIG}" \
      lsf "utopia-backups:${OSS_BUCKET}/${OSS_PREFIX}/")"
    grep -q '\.vpb$' <<< "${remote_listing}" || fail "No encrypted backup was found in OSS"
  fi

  log "Running the first full restore drill"
  systemctl start vocaloid-producer-blog-restore-drill.service
  systemctl --quiet is-failed vocaloid-producer-blog-restore-drill.service \
    && fail "The restore drill failed; inspect journalctl -u vocaloid-producer-blog-restore-drill.service"
  grep -q '"outcome": "succeeded"' "${STORAGE_ROOT}"/drills/restore-drill-*.json \
    || fail "A successful restore drill record was not created"

  systemctl enable --now vocaloid-producer-blog-backup.timer
  systemctl enable --now vocaloid-producer-blog-restore-drill.timer
}

print_summary() {
  echo
  echo "Backup deployment completed."
  echo "Local backups: ${BACKUP_ROOT}"
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    echo "OSS target: utopia-backups:${OSS_BUCKET}/${OSS_PREFIX}/"
  else
    echo "Off-site copy: disabled"
    echo "WARNING: Local backups cannot survive total server loss or server compromise."
  fi
  echo "Drill records: ${STORAGE_ROOT}/drills"
  echo "Timers:"
  systemctl list-timers 'vocaloid-producer-blog-*' --no-pager
  echo
  if [[ "${KEY_CREATED}" == "true" ]]; then
    echo "IMPORTANT: Store ${CONFIG_ROOT}/backup.key in an offline password vault now."
    echo "Backups cannot be recovered after total server loss without this key."
  fi
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    echo "Configure OSS versioning and a retention lifecycle of at least 35 days in the Alibaba Cloud console."
  else
    echo "Run this installer again and select yes after external storage becomes available."
  fi
}

main() {
  require_root
  verify_operating_system
  TEMP_DIR="$(mktemp -d)"
  collect_configuration
  install_packages
  create_backup_account
  grant_read_access
  create_encryption_key
  if [[ "${ENABLE_OFFSITE_BACKUP}" == "yes" ]]; then
    install_rclone
    configure_rclone
  fi
  install_immutable_programs
  install_systemd_units
  run_acceptance_checks
  print_summary
}

main "$@"
