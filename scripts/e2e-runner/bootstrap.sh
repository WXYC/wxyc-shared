#!/usr/bin/env bash
#
# Bootstrap script for wxyc-e2e-runner EC2 instance.
#
# Target OS: Ubuntu 24.04 LTS (noble) on t3.small (or larger) in
# AWS account 503977661500, us-east-1. The runner is shared by
# Backend-Service, library-metadata-lookup, and dj-site for their
# E2E gate jobs (target via `runs-on: [self-hosted, e2e-runner]`).
#
# Idempotent: safe to re-run. Each install step short-circuits if
# the target is already in the requested state.
#
# Usage (as root or via sudo):
#   sudo GHA_RUNNER_TOKEN=<org-runner-registration-token> \
#        GHA_RUNNER_URL=https://github.com/WXYC \
#        bash bootstrap.sh
#
# The runner registration token is org-scoped and short-lived (~1h).
# Obtain via: gh api -X POST /orgs/WXYC/actions/runners/registration-token
#
# All steps log to stderr with a [step] prefix; stdout is reserved
# for command output. Failures exit non-zero with the failing step's
# name in the trap message.

set -euo pipefail

NODE_MAJOR="${NODE_MAJOR:-24}"
PYTHON_VERSION="${PYTHON_VERSION:-3.12}"
RUNNER_USER="${RUNNER_USER:-runner}"
RUNNER_HOME="/home/${RUNNER_USER}"
RUNNER_DIR="${RUNNER_HOME}/actions-runner"
RUNNER_LABELS="${RUNNER_LABELS:-e2e-runner}"
RUNNER_NAME="${RUNNER_NAME:-wxyc-e2e-runner}"
RUNNER_VERSION="${RUNNER_VERSION:-2.319.1}"
RUNNER_ARCH="${RUNNER_ARCH:-x64}"
RUNNER_TARBALL="actions-runner-linux-${RUNNER_ARCH}-${RUNNER_VERSION}.tar.gz"
RUNNER_URL_BASE="https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}"

CURRENT_STEP="<init>"
log() { printf '[%s] [%s] %s\n' "$(date -u +%FT%TZ)" "${CURRENT_STEP}" "$*" >&2; }
step() { CURRENT_STEP="$1"; log "===== ${CURRENT_STEP} ====="; }
on_error() {
  local exit_code=$?
  printf '[%s] [%s] FAILED with exit code %d\n' \
    "$(date -u +%FT%TZ)" "${CURRENT_STEP}" "${exit_code}" >&2
  exit "${exit_code}"
}
trap on_error ERR

require_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    echo "bootstrap.sh must run as root (use sudo)" >&2
    exit 64
  fi
}

require_env() {
  local var=$1
  if [[ -z "${!var:-}" ]]; then
    echo "Required env var ${var} is unset" >&2
    exit 64
  fi
}

step "preflight"
require_root
require_env GHA_RUNNER_TOKEN
require_env GHA_RUNNER_URL
log "ubuntu codename: $(. /etc/os-release && echo "${VERSION_CODENAME}")"

step "apt-base"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  ca-certificates curl gnupg lsb-release jq git build-essential \
  software-properties-common unzip

step "docker"
if ! command -v docker >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] \
https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  systemctl enable --now docker
else
  log "docker already installed: $(docker --version)"
fi

step "node-${NODE_MAJOR}"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')" != "${NODE_MAJOR}" ]]; then
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
  apt-get install -y -qq nodejs
else
  log "node already at v${NODE_MAJOR}: $(node -v)"
fi
log "npm: $(npm -v)"

step "python-${PYTHON_VERSION}"
# Ubuntu 24.04 ships python3.12 by default; verify and install venv tooling.
if ! command -v "python${PYTHON_VERSION}" >/dev/null 2>&1; then
  add-apt-repository -y ppa:deadsnakes/ppa
  apt-get update -qq
  apt-get install -y -qq "python${PYTHON_VERSION}" "python${PYTHON_VERSION}-venv"
fi
apt-get install -y -qq "python${PYTHON_VERSION}-venv" python3-pip
log "python: $(python"${PYTHON_VERSION}" --version)"

step "playwright-deps"
# Install Playwright OS dependencies for the chromium/firefox/webkit
# browsers. Browsers themselves are installed per-job via
# `npx playwright install` in the workflow.
apt-get install -y -qq \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 \
  libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 \
  libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
  libatspi2.0-0 libwayland-client0

step "runner-user"
if ! id -u "${RUNNER_USER}" >/dev/null 2>&1; then
  useradd -m -s /bin/bash "${RUNNER_USER}"
fi
usermod -aG docker "${RUNNER_USER}"

step "runner-download"
if [[ ! -x "${RUNNER_DIR}/config.sh" ]]; then
  install -d -o "${RUNNER_USER}" -g "${RUNNER_USER}" "${RUNNER_DIR}"
  cd "${RUNNER_DIR}"
  sudo -u "${RUNNER_USER}" curl -fsSL -o "${RUNNER_TARBALL}" "${RUNNER_URL_BASE}/${RUNNER_TARBALL}"
  sudo -u "${RUNNER_USER}" tar xzf "${RUNNER_TARBALL}"
  rm -f "${RUNNER_TARBALL}"
else
  log "runner already extracted at ${RUNNER_DIR}"
fi

step "runner-config"
cd "${RUNNER_DIR}"
if [[ ! -f .runner ]]; then
  sudo -u "${RUNNER_USER}" ./config.sh \
    --url "${GHA_RUNNER_URL}" \
    --token "${GHA_RUNNER_TOKEN}" \
    --name "${RUNNER_NAME}" \
    --labels "${RUNNER_LABELS}" \
    --runnergroup default \
    --work _work \
    --unattended \
    --replace
else
  log "runner already configured: $(jq -r .agentName .runner 2>/dev/null || echo unknown)"
fi

step "runner-service"
# `svc.sh install` writes /etc/systemd/system/actions.runner.*.service
# and `svc.sh start` enables + starts it.
if ! systemctl list-units --type=service --all | grep -q '^actions\.runner\.'; then
  ./svc.sh install "${RUNNER_USER}"
  ./svc.sh start
else
  log "runner service already installed"
  systemctl restart 'actions.runner.*.service' || true
fi

step "done"
log "wxyc-e2e-runner bootstrap complete"
log "verify runner status: systemctl status 'actions.runner.*.service'"
log "verify org-side: https://github.com/organizations/WXYC/settings/actions/runners"
