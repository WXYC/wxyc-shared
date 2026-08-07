#!/usr/bin/env bash
#
# check-spec-drift.sh -- compare a pinned api.yaml's CONTENT against
# wxyc-shared's current main, without failing the calling job.
#
# Used by the read-only reusable workflow
# .github/workflows/check-api-spec-drift.yml (WXYC/wxyc-shared#319, option
# B'). This script does no network I/O itself: the workflow step resolves
# wxyc-shared:main's current SHA (`git ls-remote`), fetches api.yaml at both
# the caller's pinned ref and at that SHA (`curl` against
# raw.githubusercontent.com), and hashes each fetched file (`sha256sum`/
# `shasum -a 256`) BEFORE calling this script, so the actual
# comparison-and-report logic here is pure string handling that bats can
# exercise with plain arguments -- no network access or GitHub Actions
# runner required. See scripts/__tests__/check-spec-drift.test.sh.
#
# THE DRIFT DECISION IS CONTENT, NOT info.version (PR #323 review finding).
# An earlier version of this script compared api.yaml's `info.version`
# string between the two refs. A survey of the last 15 commits touching
# api.yaml on wxyc-shared main found 9 of 15 did NOT bump info.version --
# including a commit literally titled "make include_tracks omittable in the
# generated types" and commits that add fields. Per
# library-metadata-lookup#1117, the observed staleness symptom included a
# *docstring* divergence: datamodel-codegen renders `description:` into
# `Field(description=...)`, so even a "docs-only" api.yaml commit changes a
# consumer's generated api_models.py. A version-string comparison would
# have reported `drift: false` on all nine of those commits -- a check that
# says "current" while a consumer is genuinely stale is worse than no check
# at all, which is exactly the failure mode #319 itself describes ("a check
# nobody believes"). The SHA-256 comparison below is a proxy for the whole
# file's content, not a proxy for a proxy.
#
# Usage:
#   check-spec-drift.sh <pinned-ref> <pinned-version> <pinned-sha256> <current-sha> <current-version> <current-sha256>
#
# Outputs (to $GITHUB_OUTPUT if set; no-op locally):
#   drift=true|false      -- pinned-sha256 != current-sha256 (content, not version)
#   current-sha=<sha>
#   current-version=<version>
#   pinned-version=<version>
#
# current-version and pinned-version are still reported -- they're genuinely
# useful for a human reading the summary -- but they are NOT what decides
# drift.
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

if [[ "$#" -ne 6 ]]; then
    cat >&2 <<'EOF'
Usage: check-spec-drift.sh <pinned-ref> <pinned-version> <pinned-sha256> <current-sha> <current-version> <current-sha256>

Compares <pinned-sha256> (the SHA-256 of api.yaml's CONTENT at the caller's
pinned wxyc-shared ref) against <current-sha256> (the SHA-256 of api.yaml's
content at wxyc-shared's current main), and reports whether they differ.
<pinned-version>/<current-version> are info.version at each ref -- reported
for a human reader, but NOT what decides drift (an api.yaml commit can
change generated output without bumping info.version; see the file header).
Does not fail the job on drift -- see the file header for why.
EOF
    exit 2
fi

PINNED_REF="$1"
PINNED_VERSION="$2"
PINNED_SHA256="$3"
CURRENT_SHA="$4"
CURRENT_VERSION="$5"
CURRENT_SHA256="$6"

if [[ -z "$PINNED_VERSION" || -z "$PINNED_SHA256" || -z "$CURRENT_SHA" || -z "$CURRENT_VERSION" || -z "$CURRENT_SHA256" ]]; then
    echo "check-spec-drift: pinned-version, pinned-sha256, current-sha, current-version, and current-sha256 must all be non-empty" >&2
    echo "  (got pinned-ref='$PINNED_REF' pinned-version='$PINNED_VERSION' pinned-sha256='$PINNED_SHA256' current-sha='$CURRENT_SHA' current-version='$CURRENT_VERSION' current-sha256='$CURRENT_SHA256')" >&2
    exit 2
fi

if [[ "$PINNED_SHA256" == "$CURRENT_SHA256" ]]; then
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

Your pinned ref (\`$PINNED_REF\`) is at api.yaml **$PINNED_VERSION** (content SHA-256 \`$PINNED_SHA256\`). wxyc-shared's \`main\` is at api.yaml **$CURRENT_VERSION** (\`$CURRENT_SHA\`, content SHA-256 \`$CURRENT_SHA256\`).

This is a CONTENT comparison, not a version comparison -- the two can differ even when \`info.version\` matches (most api.yaml commits on wxyc-shared don't bump it; see WXYC/wxyc-shared#319 and PR #323 for why version alone is not a safe signal).

Regenerate against the new commit, or bump this repo's pin to \`$CURRENT_SHA\`, when convenient -- this check is informational and does not fail this job on its own. See https://github.com/WXYC/wxyc-shared/issues/319 for why the check exists and https://github.com/WXYC/wxyc-shared/commits/main/api.yaml for what changed."
else
    SUMMARY="### wxyc-shared api.yaml is current

Your pinned ref (\`$PINNED_REF\`) matches wxyc-shared's \`main\` (\`$CURRENT_SHA\`) byte-for-byte at api.yaml **$CURRENT_VERSION** (content SHA-256 \`$CURRENT_SHA256\`)."
fi

echo "$SUMMARY"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
    echo "$SUMMARY" >>"$GITHUB_STEP_SUMMARY"
fi

exit 0
