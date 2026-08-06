#!/usr/bin/env bats
#
# BATS tests for check-breaking-changes.sh.
#
# Run with: npm run test:breaking-guard
# Or directly: npx bats scripts/__tests__/check-breaking-changes.test.sh
#
# Focus is the oasdiff-err-ignore.txt wiring (#297) and the script's contract
# with its callers: which exit codes mean what, and whether a local run agrees
# with the breaking-changes.yml job. The two defects these tests were written
# against — an empty-array expansion that aborts under bash 3.2's `set -u`, and
# a `[[ -f ]]` guard that let a missing ignore file pass locally while oasdiff
# exits 121 in CI — are both invisible to a spec-level test.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/check-breaking-changes.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
IGNORE_FILE="$REPO_ROOT/oasdiff-err-ignore.txt"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

# The ignore file is a hard dependency of both callers, not an optional extra:
# oasdiff exits 121 on a missing --err-ignore path, and the CI job passes it
# unconditionally. If this file ever goes away, the next api.yaml PR gets a red
# "Breaking API Changes Detected" comment describing a file-not-found error.
@test "the whitelist file the CI job references exists" {
    [ -f "$IGNORE_FILE" ]
}

@test "every non-comment line in the whitelist is a real oasdiff finding line" {
    # Guards against a stray blank-ish or prose line that silently matches
    # nothing. Entries must name a method + path.
    while IFS= read -r line; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line//[[:space:]]/}" ]] && continue
        [[ "$line" =~ ^(get|post|put|patch|delete)\ /.+ ]]
    done < "$IGNORE_FILE"
}

@test "runs clean under bash 3.2 semantics (set -u + empty array expansion)" {
    # macOS ships bash 3.2 at /bin/bash, where `"${arr[@]}"` on an empty array
    # is an unbound-variable abort under `set -u`. The script must not depend
    # on the bash 5 behaviour the author's homebrew shell happens to have.
    if [ -x /bin/bash ]; then
        run /bin/bash "$SCRIPT_PATH"
        [[ "$output" != *"unbound variable"* ]]
    fi
}

@test "exits 2 with an explanation when the whitelist file is missing" {
    # Not a silent skip: a local run that passes where CI fails is the exact
    # divergence the unconditional --err-ignore wiring exists to prevent.
    cp -R "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"

    run bash "$TEST_TEMP_DIR/scripts/check-breaking-changes.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"oasdiff-err-ignore.txt is missing"* ]]
}

@test "exits 2 when api.yaml is absent from the project root" {
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"

    run bash "$TEST_TEMP_DIR/scripts/check-breaking-changes.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"api.yaml not found"* ]]
}

@test "reports no breaking changes for an identical base spec (fast path)" {
    run "$SCRIPT_PATH" "$REPO_ROOT/api.yaml"
    [ "$status" -eq 0 ]
    [[ "$output" == *"No API changes detected"* ]]
}
