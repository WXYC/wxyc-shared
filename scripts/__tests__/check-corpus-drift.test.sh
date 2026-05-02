#!/usr/bin/env bats
#
# BATS tests for check-corpus-drift.sh.
#
# Run with: npm run test:drift-guard
# Or directly: npx bats scripts/__tests__/check-corpus-drift.test.sh

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/check-corpus-drift.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CORPUS_PATH="$REPO_ROOT/src/test-utils/charset-torture.json"

# Pinned hash of the in-tree corpus. Bumped in lockstep with the test in
# tests/charset-torture.test.ts.
PINNED_SHA256='75a3395bb10894480dba95bf5b7f379f5056645098d6a1bf9e94416709e5214a'

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

@test "exits 2 when called with no arguments" {
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "exits 2 when called with one argument" {
    run "$SCRIPT_PATH" /tmp/whatever
    [ "$status" -eq 2 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "exits 2 when the JSON path does not exist" {
    run "$SCRIPT_PATH" "$TEST_TEMP_DIR/missing.json" "$PINNED_SHA256"
    [ "$status" -eq 2 ]
    [[ "$output" == *"not found"* ]]
}

@test "exits 0 and prints OK when SHA matches" {
    run "$SCRIPT_PATH" "$CORPUS_PATH" "$PINNED_SHA256"
    [ "$status" -eq 0 ]
    [[ "$output" == *"OK"* ]]
    [[ "$output" == *"$PINNED_SHA256"* ]]
}

@test "exits 1 and prints both SHAs when SHA does not match" {
    local wrong='0000000000000000000000000000000000000000000000000000000000000000'
    run "$SCRIPT_PATH" "$CORPUS_PATH" "$wrong"
    [ "$status" -eq 1 ]
    [[ "$output" == *"drift"* ]]
    [[ "$output" == *"$wrong"* ]]
    [[ "$output" == *"$PINNED_SHA256"* ]]
}

@test "drift output enumerates current categories with entry counts" {
    local wrong='0000000000000000000000000000000000000000000000000000000000000000'
    run "$SCRIPT_PATH" "$CORPUS_PATH" "$wrong"
    [ "$status" -eq 1 ]
    [[ "$output" == *"greek"* ]]
    [[ "$output" == *"cyrillic"* ]]
    [[ "$output" == *"mojibake_known"* ]]
    [[ "$output" == *"entries"* ]]
}

@test "drift output names the bump procedure" {
    local wrong='0000000000000000000000000000000000000000000000000000000000000000'
    run "$SCRIPT_PATH" "$CORPUS_PATH" "$wrong"
    [ "$status" -eq 1 ]
    [[ "$output" == *"charset-torture.json.sha256"* ]]
}
