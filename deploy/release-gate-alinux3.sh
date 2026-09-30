#!/usr/bin/env bash
set -Eeuo pipefail

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

require_sha() {
  [[ "$1" =~ ^[0-9a-fA-F]{40}$ ]] || fail "$2 must be a full 40-character Git SHA"
}

run_predeploy_gate() {
  [[ -n "${CURRENT_DEPLOY_COMMIT:-}" ]] || fail "Set CURRENT_DEPLOY_COMMIT to the commit currently serving production"
  require_sha "${CURRENT_DEPLOY_COMMIT}" "CURRENT_DEPLOY_COMMIT"
  [[ -z "$(git status --porcelain=v1)" ]] || fail "The release checkout contains uncommitted or untracked files"
  local candidate
  candidate="$(git rev-parse HEAD)"
  require_sha "${candidate}" "candidate commit"

  echo "[release-gate] Verifying the current production boundary"
  DEPLOY_COMMIT="${CURRENT_DEPLOY_COMMIT,,}" npm run smoke:production

  echo "[release-gate] Verifying candidate ${candidate}"
  npm ci
  npm run security:supply-chain
  npm audit --audit-level=high --registry=https://registry.npmjs.org
  npm run security:secrets
  npm run test:auth
  npm run test:uploads
  npm run test:public
  npm run test:content
  npm run test:monitoring
  npm run test:backup
  npm run test:deploy
  npm run test:smoke
  BUILD_COMMIT="${candidate}" npm run verify:reproducible
  DEPLOY_COMMIT="${candidate}" npm run verify:build
  echo "[release-gate] Pre-deployment gate passed for ${candidate}"
}

run_postdeploy_gate() {
  local candidate="${DEPLOY_COMMIT:-$(git rev-parse HEAD)}"
  require_sha "${candidate}" "DEPLOY_COMMIT"
  DEPLOY_COMMIT="${candidate,,}" npm run smoke:production
  echo "[release-gate] Post-deployment gate passed for ${candidate,,}"
}

case "${1:-}" in
  pre) run_predeploy_gate ;;
  post) run_postdeploy_gate ;;
  *) fail "Usage: bash deploy/release-gate-alinux3.sh <pre|post>" ;;
esac
