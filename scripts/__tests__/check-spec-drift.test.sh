#!/usr/bin/env bats
#
# BATS tests for check-spec-drift.sh.
#
# Run with: npm run test:spec-drift-guard
# Or directly: npx bats scripts/__tests__/check-spec-drift.test.sh
#
# Context (#319, option B'): this script is the comparison-and-report half
# of the read-only reusable workflow
# .github/workflows/check-api-spec-drift.yml. The workflow step resolves
# wxyc-shared:main's current SHA (git ls-remote) and fetches api.yaml's
# CONTENT and info.version at both the caller's pinned ref and at main
# (curl against raw.githubusercontent.com) -- both of which need real
# network access and so are NOT exercised here -- then hands the resulting
# strings (including a SHA-256 of each fetched file) to this script, which
# is pure string comparison and formatting and so CAN be exercised here
# with no network and no GitHub Actions runner.
#
# THE DRIFT SIGNAL IS CONTENT, NOT info.version (PR #323 review finding).
# A survey of the last 15 commits touching api.yaml on wxyc-shared main
# found 9 of 15 did NOT bump info.version -- including a commit literally
# titled "make include_tracks omittable in the generated types" and commits
# that add fields. Per library-metadata-lookup#1117, the observed staleness
# symptom included a *docstring* divergence: datamodel-codegen renders
# `description:` into `Field(description=...)`, so even a "docs-only"
# api.yaml commit changes a consumer's generated api_models.py. A drift
# check keyed on info.version would report `drift: false` on all nine of
# those commits -- a check that says "current" while a consumer is
# genuinely stale is worse than no check, which is the exact failure mode
# #319 itself describes ("a check nobody believes"). Test 15 below
# ("same version, different content -> drift: true") is the regression net
# for this finding; don't let it go green for the wrong reason.
#
# This script is deliberately never supposed to fail the calling job: #319's
# B' is read-only by design, and the decision of what to do about drift
# (open an issue, open a regen PR, just log it) belongs to the CALLER's own
# workflow, using its own token -- see the file header on check-spec-drift.sh
# and CLAUDE.md's Code Generation section.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/check-spec-drift.sh"

# Two distinct, realistic SHA-256 hashes to use across tests. These are not
# computed from real content -- they're just two different-looking 64-hex-char
# strings, which is all the script's own logic (a string equality check) can
# tell apart. The "did we hash real content correctly" question belongs to
# the WORKFLOW step (network-bound, untestable here), not this script.
HASH_A="$(printf '1%.0s' {1..64})"
HASH_B="$(printf '2%.0s' {1..64})"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

@test "script exists and is executable" {
    [ -x "$SCRIPT_PATH" ]
}

@test "script has valid bash syntax" {
    run bash -n "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "exits 2 with usage when called with the wrong number of arguments" {
    run "$SCRIPT_PATH" "main" "1.34.0" "$HASH_A"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "exits 2 when pinned-version is empty" {
    run "$SCRIPT_PATH" "main" "" "$HASH_A" "abc123" "1.34.0" "$HASH_A"
    [ "$status" -eq 2 ]
}

@test "exits 2 when pinned-sha256 is empty" {
    run "$SCRIPT_PATH" "main" "1.29.0" "" "abc123" "1.34.0" "$HASH_A"
    [ "$status" -eq 2 ]
}

@test "exits 2 when current-sha is empty" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "" "1.34.0" "$HASH_A"
    [ "$status" -eq 2 ]
}

@test "exits 2 when current-version is empty" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "" "$HASH_A"
    [ "$status" -eq 2 ]
}

@test "exits 2 when current-sha256 is empty" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" ""
    [ "$status" -eq 2 ]
}

@test "exits 0 (informational, not a gate) when content hashes match" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" "$HASH_A"
    [ "$status" -eq 0 ]
}

@test "exits 0 (informational, not a gate) when content hashes differ -- this script never fails the job on drift" {
    run "$SCRIPT_PATH" "abc123" "1.29.0" "$HASH_A" "def456" "1.34.0" "$HASH_B"
    [ "$status" -eq 0 ]
}

@test "reports no drift in the summary when content hashes match" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" "$HASH_A"
    [[ "$output" == *"current"* ]]
    [[ "$output" != *"drift detected"* ]]
}

@test "reports drift in the summary when content hashes differ, naming both versions and the current sha" {
    run "$SCRIPT_PATH" "abc123" "1.29.0" "$HASH_A" "def456" "1.34.0" "$HASH_B"
    [[ "$output" == *"drift"* ]]
    [[ "$output" == *"1.29.0"* ]]
    [[ "$output" == *"1.34.0"* ]]
    [[ "$output" == *"def456"* ]]
}

@test "writes drift=false to GITHUB_OUTPUT when content hashes match" {
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" "$HASH_A"
    [ "$status" -eq 0 ]
    grep -q '^drift=false$' "$GITHUB_OUTPUT"
}

@test "writes drift=true to GITHUB_OUTPUT when content hashes differ" {
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "abc123" "1.29.0" "$HASH_A" "def456" "1.34.0" "$HASH_B"
    [ "$status" -eq 0 ]
    grep -q '^drift=true$' "$GITHUB_OUTPUT"
}

# --- The regression net for the PR #323 review finding. ---

@test "SAME version string, DIFFERENT content -> drift: true (#323 review finding, 9/15 evidence)" {
    # This is the case a naive info.version comparison gets wrong: 9 of the
    # last 15 commits touching api.yaml on wxyc-shared main did not bump
    # info.version, including a commit that changed the generated TypeScript
    # shape and commits that only touched `description:` prose (which still
    # changes a consumer's generated api_models.py, since datamodel-codegen
    # renders descriptions into Field(description=...)). A version-string
    # comparison would report drift: false here. A content-hash comparison
    # must not.
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" "$HASH_B"
    [ "$status" -eq 0 ]
    grep -q '^drift=true$' "$GITHUB_OUTPUT"
    [[ "$output" == *"drift"* ]]
}

@test "writes current-sha, current-version, and pinned-version to GITHUB_OUTPUT" {
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "my-pinned-ref" "1.29.0" "$HASH_A" "0123456789abcdef0123456789abcdef01234567" "1.34.0" "$HASH_B"
    [ "$status" -eq 0 ]
    grep -q '^current-sha=0123456789abcdef0123456789abcdef01234567$' "$GITHUB_OUTPUT"
    grep -q '^current-version=1.34.0$' "$GITHUB_OUTPUT"
    grep -q '^pinned-version=1.29.0$' "$GITHUB_OUTPUT"
}

@test "does not require GITHUB_OUTPUT to be set -- no-ops the write and still succeeds" {
    unset GITHUB_OUTPUT || true
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" "$HASH_A"
    [ "$status" -eq 0 ]
}

@test "writes the same summary to GITHUB_STEP_SUMMARY when set" {
    export GITHUB_STEP_SUMMARY="$TEST_TEMP_DIR/step_summary.md"
    : >"$GITHUB_STEP_SUMMARY"
    run "$SCRIPT_PATH" "abc123" "1.29.0" "$HASH_A" "def456" "1.34.0" "$HASH_B"
    [ "$status" -eq 0 ]
    run grep -F "1.29.0" "$GITHUB_STEP_SUMMARY"
    [ "$status" -eq 0 ]
    run grep -F "1.34.0" "$GITHUB_STEP_SUMMARY"
    [ "$status" -eq 0 ]
}

@test "does not require GITHUB_STEP_SUMMARY to be set -- no-ops the write and still succeeds" {
    unset GITHUB_STEP_SUMMARY || true
    run "$SCRIPT_PATH" "abc123" "1.34.0" "$HASH_A" "def456" "1.34.0" "$HASH_A"
    [ "$status" -eq 0 ]
}

@test "names the pinned ref in the drift summary, not just the versions" {
    run "$SCRIPT_PATH" "0123456789abcdef0123456789abcdef01234567" "1.29.0" "$HASH_A" "def456" "1.34.0" "$HASH_B"
    [[ "$output" == *"0123456789abcdef0123456789abcdef01234567"* ]]
}
