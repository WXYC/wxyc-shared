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
# info.version at both the caller's pinned ref and at main (curl against
# raw.githubusercontent.com) -- both of which need real network access and
# so are NOT exercised here -- then hands the four resulting strings to this
# script, which is pure string comparison and formatting and so CAN be
# exercised here with no network and no GitHub Actions runner.
#
# This script is deliberately never supposed to fail the calling job: #319's
# B' is read-only by design, and the decision of what to do about drift
# (open an issue, open a regen PR, just log it) belongs to the CALLER's own
# workflow, using its own token -- see the file header on check-spec-drift.sh
# and CLAUDE.md's Code Generation section.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/check-spec-drift.sh"

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
    run "$SCRIPT_PATH" "main" "1.34.0"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "exits 2 when pinned-version is empty" {
    run "$SCRIPT_PATH" "main" "" "abc123" "1.34.0"
    [ "$status" -eq 2 ]
}

@test "exits 2 when current-sha is empty" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "" "1.34.0"
    [ "$status" -eq 2 ]
}

@test "exits 2 when current-version is empty" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "def456" ""
    [ "$status" -eq 2 ]
}

@test "exits 0 (informational, not a gate) when versions match" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
}

@test "exits 0 (informational, not a gate) when versions differ -- this script never fails the job on drift" {
    run "$SCRIPT_PATH" "abc123" "1.29.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
}

@test "reports no drift in the summary when versions match" {
    run "$SCRIPT_PATH" "abc123" "1.34.0" "def456" "1.34.0"
    [[ "$output" == *"current"* ]]
    [[ "$output" != *"drift detected"* ]]
}

@test "reports drift in the summary when versions differ, naming both versions and the current sha" {
    run "$SCRIPT_PATH" "abc123" "1.29.0" "def456" "1.34.0"
    [[ "$output" == *"drift"* ]]
    [[ "$output" == *"1.29.0"* ]]
    [[ "$output" == *"1.34.0"* ]]
    [[ "$output" == *"def456"* ]]
}

@test "writes drift=false to GITHUB_OUTPUT when versions match" {
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "abc123" "1.34.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
    grep -q '^drift=false$' "$GITHUB_OUTPUT"
}

@test "writes drift=true to GITHUB_OUTPUT when versions differ" {
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "abc123" "1.29.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
    grep -q '^drift=true$' "$GITHUB_OUTPUT"
}

@test "writes current-sha, current-version, and pinned-version to GITHUB_OUTPUT" {
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    run "$SCRIPT_PATH" "my-pinned-ref" "1.29.0" "0123456789abcdef0123456789abcdef01234567" "1.34.0"
    [ "$status" -eq 0 ]
    grep -q '^current-sha=0123456789abcdef0123456789abcdef01234567$' "$GITHUB_OUTPUT"
    grep -q '^current-version=1.34.0$' "$GITHUB_OUTPUT"
    grep -q '^pinned-version=1.29.0$' "$GITHUB_OUTPUT"
}

@test "does not require GITHUB_OUTPUT to be set -- no-ops the write and still succeeds" {
    unset GITHUB_OUTPUT || true
    run "$SCRIPT_PATH" "abc123" "1.34.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
}

@test "writes the same summary to GITHUB_STEP_SUMMARY when set" {
    export GITHUB_STEP_SUMMARY="$TEST_TEMP_DIR/step_summary.md"
    : >"$GITHUB_STEP_SUMMARY"
    run "$SCRIPT_PATH" "abc123" "1.29.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
    run grep -F "1.29.0" "$GITHUB_STEP_SUMMARY"
    [ "$status" -eq 0 ]
    run grep -F "1.34.0" "$GITHUB_STEP_SUMMARY"
    [ "$status" -eq 0 ]
}

@test "does not require GITHUB_STEP_SUMMARY to be set -- no-ops the write and still succeeds" {
    unset GITHUB_STEP_SUMMARY || true
    run "$SCRIPT_PATH" "abc123" "1.34.0" "def456" "1.34.0"
    [ "$status" -eq 0 ]
}

@test "names the pinned ref in the drift summary, not just the versions" {
    run "$SCRIPT_PATH" "0123456789abcdef0123456789abcdef01234567" "1.29.0" "def456" "1.34.0"
    [[ "$output" == *"0123456789abcdef0123456789abcdef01234567"* ]]
}
