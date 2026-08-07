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
        [[ "$line" =~ ^(get|post|put|patch|delete)\ /.+ ]]
    done < <(live_entries)
}

# The original defect: `--err-ignore` args were held in an array and expanded as
# `"${IGNORE_ARGS[@]}"`, which under bash 3.2 — what macOS ships at /bin/bash —
# aborts with "unbound variable" when the array is empty and `set -u` is on. The
# script exits 1 there, and its own header defines exit 1 as "breaking changes
# detected". The array is gone, so this is a static guard against reintroducing
# the construct rather than a behavioural test: a runtime check only catches it
# on a bash 3.2 host, and CI runs bash 5.
@test "the script contains no bare array expansion (bash 3.2 + set -u trap)" {
    run grep -nE '"\$\{[A-Za-z_][A-Za-z0-9_]*\[@\]\}"' "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
}

@test "runs clean under whatever /bin/bash the platform ships" {
    [ -x /bin/bash ] || skip "no /bin/bash"
    run /bin/bash "$SCRIPT_PATH" "$REPO_ROOT/api.yaml"
    [[ "$output" != *"unbound variable"* ]]
    [ "$status" -eq 0 ]
}

@test "exits 2 with an explanation when the whitelist file is missing" {
    # Not a silent skip: a local run that passes where CI fails is the exact
    # divergence the unconditional --err-ignore wiring exists to prevent.
    cp -R "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"

    run bash "$TEST_TEMP_DIR/scripts/check-breaking-changes.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"oasdiff-err-ignore.txt"* ]]
    [[ "$output" == *"121"* ]]
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

# --- the whitelist actually suppressing something ---
#
# Every test above either exits at preflight or takes the identical-specs fast
# path at the top of the script, so none of them reaches oasdiff. The ones below
# are the only end-to-end coverage: they run a real diff (origin/main..HEAD)
# through the real flag.
#
# They express the invariant directly — "the whitelist only ever removes
# findings" — rather than via the whitelist's entry count. An earlier pair
# asserted "this diff is breaking without the whitelist", which read as a claim
# about the entries but was written as a claim about api.yaml: unconditional, it
# demanded that *every* api.yaml PR be breaking, so the first description-only
# change went red with no defect behind it. Guarding that with an entry count
# fixed the false red but bought a test that skips on main's steady state (an
# empty whitelist), in the one suite whose CI wiring exists precisely to stop
# tests skipping themselves — and bats reports a skip as `ok`, so the suite
# would have read green while asserting nothing. The subset formulation needs
# neither the skip nor a parser for the file's syntax.

setup_base() {
    command -v oasdiff > /dev/null || skip "oasdiff not installed"
    BASE_SPEC="$TEST_TEMP_DIR/base.yaml"
    git -C "$REPO_ROOT" show origin/main:api.yaml > "$BASE_SPEC" 2>/dev/null \
        || skip "no origin/main api.yaml to diff against"
    if diff -q "$BASE_SPEC" "$REPO_ROOT/api.yaml" > /dev/null 2>&1; then
        skip "api.yaml identical to origin/main; nothing to suppress"
    fi
}

# The whitelist's live entries — every line that is neither a comment nor blank.
# Single definition: the format check, the staleness check and any future reader
# all go through here, so the entry syntax is described in exactly one place.
#
# The `|| [[ -n "$line" ]]` is load-bearing, not defensive. A bare `read` returns
# non-zero on a final line with no trailing newline and the loop body never runs
# for it, so an entry pasted in as the last line — routine, since entries are
# pasted verbatim from oasdiff output — was invisible to every check here while
# oasdiff itself (Go, bufio.Scanner) still honoured it. That is the worst
# direction for the bug to run: a live, silently unguarded suppression.
live_entries() {
    local line
    while IFS= read -r line || [[ -n "$line" ]]; do
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line//[[:space:]]/}" ]] && continue
        printf '%s\n' "$line"
    done < "$IGNORE_FILE"
}

@test "live_entries sees a final entry that has no trailing newline" {
    # Regression guard. Entries are pasted verbatim from oasdiff output, which
    # is exactly how a file ends up without a terminating newline. A bare
    # `while read` drops that last line, so the entry would be honoured by
    # oasdiff and invisible to every check in this file at once.
    local saved="$IGNORE_FILE"
    IGNORE_FILE="$TEST_TEMP_DIR/no-trailing-newline.txt"
    printf '# a comment\n\npost /api/v1/x the response property `y` became nullable for the status `200`' \
        > "$IGNORE_FILE"

    run live_entries
    IGNORE_FILE="$saved"

    [ "${#lines[@]}" -eq 1 ]
    [[ "${lines[0]}" == post\ /api/v1/x* ]]
}

@test "the script exits 0 on the current diff, i.e. the whitelist entries match" {
    setup_base
    run "$SCRIPT_PATH" "$BASE_SPEC"
    [ "$status" -eq 0 ]
    [[ "$output" == *"No breaking changes detected"* ]]
}

@test "the whitelist only ever removes findings, never adds or rewrites them" {
    # Non-vacuous at every whitelist size, so it never skips. With entries, it
    # proves they suppress real findings rather than inventing suppression;
    # with none, both runs agree and it still exercises the full oasdiff path.
    # An over-broad or malformed entry that made oasdiff report something new
    # fails here.
    setup_base
    run oasdiff breaking "$BASE_SPEC" "$REPO_ROOT/api.yaml" -f json
    [ "$status" -eq 0 ]
    local unignored="$output"
    run oasdiff breaking "$BASE_SPEC" "$REPO_ROOT/api.yaml" -f json --err-ignore "$IGNORE_FILE"
    [ "$status" -eq 0 ]
    local ignored="$output"

    python3 - "$unignored" "$ignored" <<'PY'
import json, sys
key = lambda f: (f.get("id"), f.get("operation"), f.get("path"), f.get("text"))
before = {key(f) for f in json.loads(sys.argv[1] or "[]")}
after = {key(f) for f in json.loads(sys.argv[2] or "[]")}
added = after - before
if added:
    print("whitelist introduced findings that oasdiff does not report without it:")
    for f in sorted(map(str, added)):
        print("  " + f)
    sys.exit(1)
PY
}

@test "every whitelist entry corresponds to a finding in the current diff" {
    # The file's own rule is that entries are diff-scoped and dead ones get
    # pruned. This fails when an entry outlives the change it was written for.
    # Correctly vacuous at zero entries: it quantifies over entries, and there
    # are none. The test above is what stays non-vacuous in that state.
    setup_base
    run oasdiff breaking "$BASE_SPEC" "$REPO_ROOT/api.yaml" --fail-on ERR
    local findings="$output" line message
    while IFS= read -r line; do
        # Strip the leading "<method> <path> " to get the message text.
        message="${line#* }"
        message="${message#* }"
        [[ "$findings" == *"$message"* ]] || {
            echo "stale whitelist entry, matches nothing in the diff:"
            echo "  $line"
            return 1
        }
    done < <(live_entries)
}

@test "a non-breaking oasdiff failure is not reported as a breaking change" {
    # oasdiff exits 121 for a bad --err-ignore path, 2/3 for a malformed spec.
    # Reporting those as "Breaking changes detected!" with advice to deprecate
    # rather than remove is a confidently wrong diagnosis of what is really a
    # file-permission or syntax problem — the same misdiagnosis the preflight
    # was written to prevent, arriving through a door the preflight left open.
    command -v oasdiff > /dev/null || skip "oasdiff not installed"
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    cp "$IGNORE_FILE" "$TEST_TEMP_DIR/"
    # Revision is malformed; base is the real spec, so the two differ and the
    # identical-specs fast path does not swallow the run before oasdiff sees it.
    printf 'this is not: openapi: at all\n  - and: [unclosed\n' > "$TEST_TEMP_DIR/api.yaml"

    run bash "$TEST_TEMP_DIR/scripts/check-breaking-changes.sh" "$REPO_ROOT/api.yaml"
    [ "$status" -ne 0 ]
    [ "$status" -ne 1 ]
    [[ "$output" != *"Breaking changes detected"* ]]
    [[ "$output" != *"Deprecating rather than removing"* ]]
}

@test "an unreadable whitelist fails preflight rather than exiting 121 from oasdiff" {
    [ "$(id -u)" -ne 0 ] || skip "running as root; permission bits are advisory"
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"
    cp "$IGNORE_FILE" "$TEST_TEMP_DIR/"
    chmod 000 "$TEST_TEMP_DIR/oasdiff-err-ignore.txt"

    run bash "$TEST_TEMP_DIR/scripts/check-breaking-changes.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"oasdiff-err-ignore.txt"* ]]
}

@test "a directory named oasdiff-err-ignore.txt fails preflight, not oasdiff" {
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/api.yaml"
    mkdir -p "$TEST_TEMP_DIR/oasdiff-err-ignore.txt"

    run bash "$TEST_TEMP_DIR/scripts/check-breaking-changes.sh"
    [ "$status" -eq 2 ]
    [[ "$output" == *"oasdiff-err-ignore.txt"* ]]
}
