#!/usr/bin/env bats
#
# BATS tests for check-version-bump.sh.
#
# Run with: npm run test:version-bump-guard
# Or directly: npx bats scripts/__tests__/check-version-bump.test.sh
#
# Context (#347): api.yaml's info.version does not reliably move with
# content -- all five of the most recent api.yaml-touching commits landed
# at an unchanged 1.35.0, including one that added a whole path and schema.
# This script is the enforcement half of the fix (see CLAUDE.md's "Version
# bump gate" section): fail when a base..current diff shows content changed
# but info.version did not. These tests exercise the script directly against
# synthetic base specs so they don't depend on what's currently true of
# origin/main -- the only tests that do (the ones below marked "end-to-end")
# skip cleanly when a real diff isn't available, matching
# check-breaking-changes.test.sh's setup_base pattern.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/check-version-bump.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

@test "script exists and is executable" {
    [ -x "$SCRIPT_PATH" ]
}

@test "exits 2 when api.yaml is absent from the project root" {
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"

    run bash "$TEST_TEMP_DIR/scripts/check-version-bump.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"api.yaml not found"* ]]
}

@test "exits 0 for an identical base spec (fast path), regardless of version" {
    run "$SCRIPT_PATH" "$REPO_ROOT/api.yaml"
    [ "$status" -eq 0 ]
    [[ "$output" == *"unchanged"* ]]
}

@test "exits 1 when content changed but info.version did not move" {
    BASE_SPEC="$TEST_TEMP_DIR/base.yaml"
    cp "$REPO_ROOT/api.yaml" "$BASE_SPEC"
    # Simulate a base spec lacking a description present in current api.yaml,
    # both pinned to the same version -- the exact shape of 363718c.
    sed -i.bak '/^  version:/a\
  x-test-marker: base
' "$BASE_SPEC"
    rm -f "$BASE_SPEC.bak"

    run "$SCRIPT_PATH" "$BASE_SPEC"
    [ "$status" -eq 1 ]
    [[ "$output" == *"content changed but info.version is still"* ]]
}

@test "exits 0 when content changed and info.version moved" {
    BASE_SPEC="$TEST_TEMP_DIR/base.yaml"
    cp "$REPO_ROOT/api.yaml" "$BASE_SPEC"
    sed -i.bak 's/^  version: .*/  version: 0.0.1/' "$BASE_SPEC"
    rm -f "$BASE_SPEC.bak"

    run "$SCRIPT_PATH" "$BASE_SPEC"
    [ "$status" -eq 0 ]
    [[ "$output" == *"info.version moved"* ]]
}

@test "exits 2 when a version line cannot be read from one of the specs" {
    BASE_SPEC="$TEST_TEMP_DIR/base.yaml"
    printf 'openapi: 3.0.3\ninfo:\n  title: no version here\n' > "$BASE_SPEC"

    run "$SCRIPT_PATH" "$BASE_SPEC"
    [ "$status" -eq 2 ]
    [[ "$output" == *"could not read info.version"* ]]
}

@test "exits 1 on a comment-only api.yaml edit without a bump (byte-level rule)" {
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"
    # CLAUDE.md's rule text says a #-comment edit inside api.yaml counts as
    # content. Pin that against a future swap of the whole-file diff for a
    # semantic/comment-stripping comparison, which would make the documented
    # rule silently false.
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/base.yaml"
    echo "# test-only trailing comment" >> "$TEST_TEMP_DIR/api.yaml"

    run bash "$TEST_TEMP_DIR/scripts/check-version-bump.sh" "$TEST_TEMP_DIR/base.yaml"
    [ "$status" -eq 1 ]
    [[ "$output" == *"content changed but info.version"* ]]
}

@test "exits 1 when content changed and info.version moved backwards" {
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"
    # The rebase ours/theirs-inversion scenario: base carries a higher
    # version than the current spec, and content differs. Mere inequality
    # must not pass -- the version has to sort forward.
    sed 's/^  version:.*/  version: 99.0.0/' "$REPO_ROOT/api.yaml" > "$TEST_TEMP_DIR/base.yaml"
    echo "x-test-marker: base" >> "$TEST_TEMP_DIR/base.yaml"

    run bash "$TEST_TEMP_DIR/scripts/check-version-bump.sh" "$TEST_TEMP_DIR/base.yaml"
    [ "$status" -eq 1 ]
    [[ "$output" == *"backwards"* ]]
}

@test "warns and exits 0 when no base spec is available and none is given" {
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"

    run bash "$TEST_TEMP_DIR/scripts/check-version-bump.sh"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Could not get base spec"* ]]
}

# --- end-to-end, against the real repo history ---

@test "the script reaches a decision on the current diff against origin/main" {
    command -v git > /dev/null || skip "git not available"
    git -C "$REPO_ROOT" show origin/main:api.yaml > /dev/null 2>&1 \
        || skip "no origin/main api.yaml to diff against"

    # Assert the script RAN (no exit-2 error), not that the branch is
    # compliant: on a mid-flight branch whose api.yaml legitimately hasn't
    # been bumped yet, exit 1 is the script working as designed, and a
    # unit-test failure here would misread branch state as a script bug.
    run "$SCRIPT_PATH"
    [ "$status" -ne 2 ]
}
