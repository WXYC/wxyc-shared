#!/usr/bin/env bash
#
# poll-staging-health.sh — poll a URL until 200 OK or timeout.
#
# Used by .github/workflows/bs-lml-gate.yml to wait for staging /health
# endpoints. Returns fast on success so the gate doesn't pay polling
# latency unnecessarily.
#
# Env:
#   POLL_URL          — required, must be http(s)://
#   POLL_TIMEOUT_SECS — optional, default 300 (5 minutes)
#   POLL_INTERVAL_SECS— optional, default 5
#
# Exit:
#   0 — got a 200
#   1 — timed out / connection failed throughout
#   2 — usage error (missing/invalid POLL_URL)
#
# Requires: curl, bash 4+.

set -uo pipefail

URL="${POLL_URL:-}"
TIMEOUT_SECS="${POLL_TIMEOUT_SECS:-300}"
INTERVAL_SECS="${POLL_INTERVAL_SECS:-5}"

if [[ -z "$URL" ]]; then
    echo "poll-staging-health: POLL_URL is required" >&2
    exit 2
fi
if [[ "$URL" != http://* && "$URL" != https://* ]]; then
    echo "poll-staging-health: POLL_URL must be http:// or https:// (got: '$URL')" >&2
    exit 2
fi

# SECONDS resets each subshell — safe in this single-script context.
SECONDS=0
last_status=""
while (( SECONDS < TIMEOUT_SECS )); do
    # -s silent, -o /dev/null discard body, -w "%{http_code}" emit status
    # -m caps per-request time so a hung connection doesn't eat the whole budget
    last_status="$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$URL" || echo "000")"
    if [[ "$last_status" == "200" ]]; then
        echo "poll-staging-health: $URL ready (elapsed ${SECONDS}s)"
        exit 0
    fi
    sleep "$INTERVAL_SECS"
done

echo "poll-staging-health: timed out after ${TIMEOUT_SECS}s polling $URL (last status: ${last_status})" >&2
exit 1
