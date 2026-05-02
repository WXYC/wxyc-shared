#!/usr/bin/env bash
#
# Charset Torture Corpus Drift Guard
#
# Compares the SHA-256 of a charset-torture.json file against a pinned hash.
# Used by the WX-1 reusable workflow at
# .github/workflows/check-charset-corpus-drift.yml so consuming repos detect
# upstream corpus changes before their per-repo round-trip tests start failing
# for unexplained reasons.
#
# Usage:
#   bash scripts/check-corpus-drift.sh <path-to-json> <expected-sha256>
#
# Exit codes:
#   0 - hash matches the pin
#   1 - hash does not match (drift)
#   2 - error (missing arg, missing file)

set -euo pipefail

usage() {
    cat >&2 <<'EOF'
Usage: check-corpus-drift.sh <path-to-charset-torture.json> <expected-sha256>

Verifies that the file at <path> has the given SHA-256 hash. Use this from CI
to detect upstream charset-torture corpus changes that would invalidate
pinned per-repo round-trip fixtures.
EOF
}

if [ "$#" -ne 2 ]; then
    usage
    exit 2
fi

JSON_PATH="$1"
EXPECTED_SHA="$2"

if [ ! -f "$JSON_PATH" ]; then
    echo "error: corpus JSON not found at $JSON_PATH" >&2
    exit 2
fi

if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL_SHA=$(sha256sum "$JSON_PATH" | awk '{print $1}')
else
    ACTUAL_SHA=$(shasum -a 256 "$JSON_PATH" | awk '{print $1}')
fi

if [ "$ACTUAL_SHA" = "$EXPECTED_SHA" ]; then
    echo "OK: charset-torture.json SHA-256 matches the pinned hash ($EXPECTED_SHA)"
    exit 0
fi

cat <<EOF
::error::charset-torture corpus drift detected

  Pinned SHA-256:    $EXPECTED_SHA
  Published SHA-256: $ACTUAL_SHA

Categories in the published corpus:
EOF

if command -v jq >/dev/null 2>&1; then
    jq -r '.categories | to_entries[] | "  \(.key): \(.value | length) entries"' "$JSON_PATH"
else
    echo "  (jq not available; install jq for a per-category breakdown)"
fi

cat <<EOF

Bump procedure:
  1. Inspect the change at https://github.com/WXYC/wxyc-shared/blob/main/src/test-utils/charset-torture.json
  2. Update tests/fixtures/charset-torture.json.sha256 in this repo to:
       $ACTUAL_SHA
  3. Re-run your repo's charset-torture round-trip suite against the new fixture
  4. Open a PR; reviewers verify expected vs. surprise category changes

To freeze the pin for one release with reviewer sign-off, add a comment in
tests/fixtures/charset-torture.json.sha256:
  # corpus-pin-frozen reason: <text>
EOF

exit 1
