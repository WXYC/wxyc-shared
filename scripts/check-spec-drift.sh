#!/usr/bin/env bash
#
# check-spec-drift.sh -- compare a pinned api.yaml version against
# wxyc-shared's current main, without failing the calling job.
#
# Used by the read-only reusable workflow
# .github/workflows/check-api-spec-drift.yml (WXYC/wxyc-shared#319, option
# B'). This script does no network I/O itself: the workflow step resolves
# wxyc-shared:main's current SHA (`git ls-remote`) and fetches api.yaml's
# `info.version` at both the caller's pinned ref and at main (`curl` against
# raw.githubusercontent.com) BEFORE calling this script, so the actual
# comparison-and-report logic here is pure string handling that bats can
# exercise with plain arguments -- no network access or GitHub Actions
# runner required. See scripts/__tests__/check-spec-drift.test.sh.
#
# Usage:
#   check-spec-drift.sh <pinned-ref> <pinned-version> <current-sha> <current-version>
#
# Outputs (to $GITHUB_OUTPUT if set; no-op locally):
#   drift=true|false      -- pinned-version != current-version
#   current-sha=<sha>
#   current-version=<version>
#   pinned-version=<version>
#
# Also writes a human-readable summary to $GITHUB_STEP_SUMMARY if set (again
# a no-op locally), and always echoes the same summary to stdout.
#
# Exit code is ALWAYS 0 (usage errors on argc/empty-arg aside, which exit 2)
# -- this is an informational check, not a gate. #319's option B' is
# deliberately read-only: the CALLER's own workflow decides what to do with
# a drift=true output (open an issue, open a regen PR, just log it) using
# its own token, not this script or this repo. Failing the job here would
# take that decision away from the caller.

set -euo pipefail

if [[ "$#" -ne 4 ]]; then
    cat >&2 <<'EOF'
Usage: check-spec-drift.sh <pinned-ref> <pinned-version> <current-sha> <current-version>

Compares <pinned-version> (api.yaml's info.version at the caller's pinned
wxyc-shared ref) against <current-version> (info.version at wxyc-shared's
main), and reports whether they differ. Does not fail the job on drift --
see the file header for why.
EOF
    exit 2
fi

PINNED_REF="$1"
PINNED_VERSION="$2"
CURRENT_SHA="$3"
CURRENT_VERSION="$4"

if [[ -z "$PINNED_VERSION" || -z "$CURRENT_SHA" || -z "$CURRENT_VERSION" ]]; then
    echo "check-spec-drift: pinned-version, current-sha, and current-version must all be non-empty" >&2
    echo "  (got pinned-ref='$PINNED_REF' pinned-version='$PINNED_VERSION' current-sha='$CURRENT_SHA' current-version='$CURRENT_VERSION')" >&2
    exit 2
fi

if [[ "$PINNED_VERSION" == "$CURRENT_VERSION" ]]; then
    DRIFT="false"
else
    DRIFT="true"
fi

# Write key=value to $GITHUB_OUTPUT when in GHA; no-op locally. Mirrors the
# emit_output convention in scripts/bs-lml-gate/push-prod.sh.
emit_output() {
    if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
        if ! printf '%s=%s\n' "$1" "$2" >>"$GITHUB_OUTPUT"; then
            echo "check-spec-drift: failed to write $1=$2 to \$GITHUB_OUTPUT ($GITHUB_OUTPUT)" >&2
            exit 1
        fi
    fi
}

emit_output drift "$DRIFT"
emit_output current-sha "$CURRENT_SHA"
emit_output current-version "$CURRENT_VERSION"
emit_output pinned-version "$PINNED_VERSION"

if [[ "$DRIFT" == "true" ]]; then
    SUMMARY="### wxyc-shared api.yaml drift detected

Your pinned ref (\`$PINNED_REF\`) is at api.yaml **$PINNED_VERSION**. wxyc-shared's \`main\` is at api.yaml **$CURRENT_VERSION** (\`$CURRENT_SHA\`).

Regenerate against the new commit, or bump this repo's pin to \`$CURRENT_SHA\`, when convenient -- this check is informational and does not fail this job on its own. See https://github.com/WXYC/wxyc-shared/issues/319 for why the check exists and https://github.com/WXYC/wxyc-shared/commits/main/api.yaml for what changed."
else
    SUMMARY="### wxyc-shared api.yaml is current

Your pinned ref (\`$PINNED_REF\`) matches wxyc-shared's \`main\` (\`$CURRENT_SHA\`) at api.yaml **$CURRENT_VERSION**."
fi

echo "$SUMMARY"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "$SUMMARY" >>"$GITHUB_STEP_SUMMARY"
fi

exit 0
