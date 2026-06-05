#!/usr/bin/env bash
#
# verify-version.sh — confirm a service's /version endpoint reports the
# SHA we are about to promote.
#
# Used by .github/workflows/bs-lml-gate.yml after staging /health is
# green but before we run E2E. If the staging build doesn't match
# main, a newer push is mid-flight and the gate should fail — the
# next dispatch (from that newer push) will re-run with the latest
# pair.
#
# Env:
#   VERIFY_URL    — required, http(s) URL of the /version endpoint
#   EXPECTED_SHA  — required, the 40-char hex SHA we want to see
#   VERIFY_JQ_PATH— optional, default '.sha'. Some services nest the SHA.
#
# Exit:
#   0 — match
#   1 — mismatch, non-200, or unparseable response
#   2 — usage error
#
# Requires: curl, jq.

set -uo pipefail

URL="${VERIFY_URL:-}"
EXPECTED="${EXPECTED_SHA:-}"
JQ_PATH="${VERIFY_JQ_PATH:-.sha}"

if [[ -z "$URL" || -z "$EXPECTED" ]]; then
    echo "verify-version: VERIFY_URL and EXPECTED_SHA are required" >&2
    exit 2
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

status="$(curl -s -o "$tmp" -w '%{http_code}' -m 10 "$URL" || echo "000")"
if [[ "$status" != "200" ]]; then
    echo "verify-version: $URL returned HTTP $status (expected 200)" >&2
    exit 1
fi

if [[ ! -s "$tmp" ]]; then
    echo "verify-version: $URL returned empty body" >&2
    exit 1
fi

actual="$(jq -r "$JQ_PATH // \"\"" <"$tmp" 2>/dev/null || true)"
if [[ -z "$actual" || "$actual" == "null" ]]; then
    echo "verify-version: could not extract sha at $JQ_PATH from response" >&2
    exit 1
fi

if [[ "$actual" != "$EXPECTED" ]]; then
    echo "verify-version: $URL reports sha '$actual' but expected '$EXPECTED'" >&2
    exit 1
fi

echo "verify-version: $URL matches expected sha $EXPECTED"
exit 0
