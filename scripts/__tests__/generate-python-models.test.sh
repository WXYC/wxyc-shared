#!/usr/bin/env bats
#
# BATS tests for generate-python-models.sh.
#
# Run with: npm run test:python-codegen
# Or directly: npx bats scripts/__tests__/generate-python-models.test.sh
#
# Context (#107): this script consolidates two near-identical copies of
# `scripts/generate_api_models.sh` that used to live in library-metadata-lookup
# and request-o-matic. Those scripts lived in the CONSUMER repo and had to hunt
# for api.yaml elsewhere (sibling checkout, worktree-aware, download fallback).
# This script lives IN wxyc-shared next to api.yaml, so most of that resolution
# problem structurally disappears -- what's left to guard is: the CLI contract
# downstream repos will call this script with (--input/--output), that the
# datamodel-code-generator version is pinned in exactly one place here (the
# reason #107 was sequenced ahead of #302's --strict-nullable fix), and that
# --strict-nullable IS passed (#302, landed after the consolidation): a
# required + nullable property must generate as X | None while staying
# required, or the contract's documented nulls are inexpressible in every
# Python consumer. If test 15 or 31 goes red, the flag was dropped --
# restore it; do not resolve toward the pre-#302 state.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/generate-python-models.sh"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

# A minimal but valid OpenAPI 3.0 document -- enough for datamodel-codegen to
# produce a real Pydantic model without paying the cost of running against the
# full api.yaml in every test.
write_fixture_spec() {
    cat > "$TEST_TEMP_DIR/fixture.yaml" <<'EOF'
openapi: 3.0.3
info:
  title: Fixture
  version: 1.0.0
paths: {}
components:
  schemas:
    Artist:
      type: object
      required:
        - name
        - genre
      properties:
        name:
          type: string
        genre:
          type: string
          nullable: true
EOF
}

@test "script exists and is executable" {
    [ -x "$SCRIPT_PATH" ]
}

@test "script has valid bash syntax" {
    run bash -n "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "--help shows usage and exits 0" {
    run "$SCRIPT_PATH" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
    [[ "$output" == *"--input"* ]]
    [[ "$output" == *"--output"* ]]
}

@test "-h shows usage and exits 0" {
    run "$SCRIPT_PATH" -h
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "--help's stated --output default matches what the script actually uses (Finding 9)" {
    # OUTPUT defaults to $PROJECT_DIR/generated/python/models.py -- an
    # absolute path under wxyc-shared's own checkout. The usage text must
    # say so, not print a bare relative path that reads as "relative to
    # wherever you run this", which is true for a *passed* --output value but
    # false for the default.
    run "$SCRIPT_PATH" --help
    [ "$status" -eq 0 ]
    [[ "$output" == *"Default: $REPO_ROOT/generated/python/models.py"* ]]
}

@test "an unknown flag exits non-zero with usage" {
    run "$SCRIPT_PATH" --bogus
    [ "$status" -ne 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "--input pointing at a nonexistent file fails fast with a clear message" {
    run "$SCRIPT_PATH" --input "$TEST_TEMP_DIR/does-not-exist.yaml" --output "$TEST_TEMP_DIR/out.py"
    [ "$status" -ne 0 ]
    [[ "$output" == *"does-not-exist.yaml"* ]]
}

# --- Findings 7 + 8: a missing or empty --input/--output value must fail ---
# --- loudly, not silently abort or silently fall back to the default. ---

@test "--output with no value fails with a clear message, not a silent set -e abort (Finding 7)" {
    run "$SCRIPT_PATH" --output
    [ "$status" -ne 0 ]
    [ -n "$output" ]
    [[ "$output" == *"--output"* ]]
}

@test "--input with no value fails with a clear message, not a silent set -e abort (Finding 7)" {
    run "$SCRIPT_PATH" --input
    [ "$status" -ne 0 ]
    [ -n "$output" ]
    [[ "$output" == *"--input"* ]]
}

@test "--input '' (empty string) fails loudly instead of silently falling back to this repo's own api.yaml (Finding 8)" {
    run "$SCRIPT_PATH" --input "" --output "$TEST_TEMP_DIR/out.py"
    [ "$status" -ne 0 ]
    [[ "$output" == *"--input"* ]]
    [ ! -f "$TEST_TEMP_DIR/out.py" ]
}

@test "--output '' (empty string) fails loudly instead of silently falling back to the default output path (Finding 8)" {
    run "$SCRIPT_PATH" --output ""
    [ "$status" -ne 0 ]
    [[ "$output" == *"--output"* ]]
}

@test "the datamodel-code-generator version is pinned with ==, not a floating spec" {
    run grep -E 'DATAMODEL_CODEGEN_PIN=.*datamodel-code-generator\[http\]==[0-9]+\.[0-9]+\.[0-9]+' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "the uvx invocation also pins the interpreter, not just the generator package (Finding 3)" {
    # DATAMODEL_CODEGEN_PIN alone leaves black/isort/pydantic and the
    # interpreter floating -- a full lockfile is out of scope, but the
    # interpreter minor version is cheap to pin and closes the biggest gap.
    run grep -E 'uvx --python [0-9]+\.[0-9]+(\.[0-9]+)? --from' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "the GitHub download fallback bounds curl with a timeout and retry limit (Finding 4)" {
    # No --max-time/--retry means a half-open connection blocks indefinitely.
    # scripts/__tests__/generate-python-models.test.sh's own reachability
    # probe uses --max-time 5; the script it guards must not be laxer.
    run grep -E 'curl .*--max-time' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -E 'curl .*--retry' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# #302: --strict-nullable is now a deliberate part of this script. Without it
# a required + nullable property generates as a plain non-Optional field, so
# the null the contract documents (BulkResolveTrackIdentity.resolved_artist_name,
# BulkResolveProvenanceEntry.confidence, ...) is inexpressible in every Python
# consumer. The blast radius was measured and consumer-audited before flipping
# (72 changed field declarations, 36 widened / 36 narrowed); see #302 and
# CLAUDE.md's Python-codegen nullability section. (Excludes comment lines so
# prose mentioning the flag doesn't satisfy the grep.)
@test "passes --strict-nullable (#302)" {
    run bash -c "grep -v '^[[:space:]]*#' '$SCRIPT_PATH' | grep -- '--strict-nullable'"
    [ "$status" -eq 0 ]
}

@test "preserves the flags the consumer scripts relied on (parity, not a lossy merge)" {
    for flag in --target-python-version --use-standard-collections --use-union-operator --disable-timestamp --custom-file-header; do
        run grep -F -- "$flag" "$SCRIPT_PATH"
        [ "$status" -eq 0 ]
    done
}

@test "still runs ruff format + ruff check --fix over the generated file" {
    # Pin the actual invocations against $OUTPUT (Finding 10), not just
    # co-occurrence of the words "ruff"/"format"/"check --fix" anywhere in the
    # file -- the "Formatting generated code..." echo alone used to satisfy
    # the old, weaker version of this test.
    run grep -F 'ruff' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -F -- 'format "$OUTPUT"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -F -- 'check --fix "$OUTPUT"' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# ruff, like datamodel-codegen, gets a uv fallback so a bare CI runner (uv
# installed, nothing else) still exercises real formatting instead of the
# `2>/dev/null || true` swallowing a "command not found" into silence. Unlike
# datamodel-codegen this fallback is last-resort, not authoritative: a
# consumer's own .venv/PATH ruff wins when present, because ruff version is
# deliberately unpinned across consumers (LML and request-o-matic run
# different ruff versions on purpose -- see request-o-matic's pyproject.toml).
# Not exercised live: on a dev machine ruff and uv are commonly installed
# side by side (e.g. both under the same Homebrew prefix), so faking "uv
# present, ruff absent" by trimming PATH is environment-fragile. The static
# guard plus the broad live-generation tests above (which do run ruff, via
# whichever branch this machine's PATH resolves to) are the coverage here.
@test "falls back to uvx for ruff too, not just datamodel-codegen" {
    run grep -F 'uvx ruff' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "defaults --output to generated/python/models.py, matching this repo's existing generate:python path" {
    run grep -F 'generated/python/models.py' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "defaults --input to this repo's own api.yaml, not a sibling/download search" {
    # The whole sibling + git-common-dir resolution the old consumer scripts
    # needed only existed because the script and the spec lived in different
    # repos. Once the script lives in wxyc-shared, PROJECT_DIR/api.yaml is
    # always correct for any caller with this repo checked out.
    run grep -F 'PROJECT_DIR/api.yaml' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "falls back to downloading api.yaml from GitHub main when it's missing locally" {
    run grep -F 'raw.githubusercontent.com/WXYC/wxyc-shared/main/api.yaml' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# --- Finding 2: the DOCUMENTED consumer invocation must work from inside a ---
# --- worktree, since the org's global CLAUDE.md requires one for all new ---
# --- development. There's no script-side fix here -- SCRIPT_DIR already ---
# --- resolves correctly from any path bash was told to run it at; what was ---
# --- broken is the recommended COMMAND consumers were told to type. These ---
# --- tests pin the corrected command (see this script's own header comment ---
# --- and CLAUDE.md/README.md's migration instructions). ---

@test "the old sibling-relative invocation (bash ../wxyc-shared/...) breaks from inside a consumer's linked worktree" {
    local root="$TEST_TEMP_DIR/org-naive"
    mkdir -p "$root/wxyc-shared/scripts"
    cp "$SCRIPT_PATH" "$root/wxyc-shared/scripts/generate-python-models.sh"
    git init -q "$root/consumer"
    git -C "$root/consumer" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
    git -C "$root/consumer" worktree add -q .worktrees/my-branch -b my-branch

    # Assert on path resolution directly (`test -f`) rather than invoking
    # bash on a path that doesn't exist -- the latter is still a true
    # end-to-end repro, but its "command not found" exit (127) is a
    # special-cased bats status best asserted with a version-gated `run -N`,
    # which the rest of this suite doesn't use.
    run bash -c "cd '$root/consumer/.worktrees/my-branch' && test -f ../wxyc-shared/scripts/generate-python-models.sh"
    [ "$status" -ne 0 ]
}

@test "the git-common-dir-based invocation finds the sibling wxyc-shared checkout from inside a consumer's linked worktree" {
    local root="$TEST_TEMP_DIR/org-fixed"
    mkdir -p "$root/wxyc-shared/scripts"
    cp "$SCRIPT_PATH" "$root/wxyc-shared/scripts/generate-python-models.sh"
    git init -q "$root/consumer"
    git -C "$root/consumer" -c user.email=t@t -c user.name=t commit -q --allow-empty -m init
    git -C "$root/consumer" worktree add -q .worktrees/my-branch -b my-branch

    run bash -c '
        cd "'"$root"'/consumer/.worktrees/my-branch" &&
        WXYC_SHARED="$(dirname "$(git rev-parse --git-common-dir)")/../wxyc-shared" &&
        bash "$WXYC_SHARED/scripts/generate-python-models.sh" --help
    '
    [ "$status" -eq 0 ]
    [[ "$output" == *"Usage:"* ]]
}

@test "warns rather than fails when a non-pinned datamodel-codegen is used without uv" {
    run grep -F 'Warning' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

@test "the version-mismatch warning fires on 0.56.10, not just any string containing 0.56.1 (Finding 6, substring bug)" {
    # [[ "$RESOLVED" != *"$PINNED"* ]] treats 0.56.1 as a substring of 0.56.10
    # and silently accepts the mismatch. Compare the parsed version token for
    # exact equality instead.
    mkdir -p "$TEST_TEMP_DIR/consumer/.venv/bin"
    cat > "$TEST_TEMP_DIR/consumer/.venv/bin/datamodel-codegen" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then echo "datamodel-codegen 0.56.10"; exit 0; fi
out=""
prev=""
for a in "$@"; do
    if [[ "$prev" == "--output" ]]; then out="$a"; fi
    prev="$a"
done
mkdir -p "$(dirname "$out")"
echo "# stub" > "$out"
STUB
    chmod +x "$TEST_TEMP_DIR/consumer/.venv/bin/datamodel-codegen"
    write_fixture_spec

    run bash -c "cd '$TEST_TEMP_DIR/consumer' && PATH=/usr/bin:/bin bash '$SCRIPT_PATH' --input '$TEST_TEMP_DIR/fixture.yaml' --output out/models.py"
    [ "$status" -eq 0 ]
    [[ "$output" == *"Warning"* ]]
}

@test "prefers uv (the pin) over an ambient PATH/venv install when both are available" {
    # Ordering guard: the uv branch must be checked before falling back to
    # .venv/PATH resolution, or the pin stops being authoritative.
    local uv_line venv_line
    uv_line="$(grep -n 'command -v uv' "$SCRIPT_PATH" | head -1 | cut -d: -f1)"
    venv_line="$(grep -n '\.venv/bin/datamodel-codegen' "$SCRIPT_PATH" | head -1 | cut -d: -f1)"
    [ -n "$uv_line" ]
    [ -n "$venv_line" ]
    [ "$uv_line" -lt "$venv_line" ]
}

@test "generated header points at the shared script, not a repo-relative path that only makes sense for one caller" {
    # Pin the literal HEADER content, not just co-occurrence with this
    # script's own Usage:/comment prose (which would keep this test green even
    # if HEADER pointed nowhere near generate-python-models.sh).
    run grep -F 'do not edit manually' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -F 'Regenerate with the shared codegen script: https://github.com/WXYC/wxyc-shared/blob/main/scripts/generate-python-models.sh' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# --- .venv fallback must resolve against the CALLER's checkout, not this ---
# --- script's own (wxyc-shared) repo. Finding 1. ---
#
# The predecessor scripts lived in the consumer repo, so their PROJECT_DIR was
# the consumer's own repo root and `$PROJECT_DIR/.venv` found the consumer's
# venv. This script now lives in wxyc-shared, so PROJECT_DIR is always
# wxyc-shared's checkout -- if the .venv fallback still keys off PROJECT_DIR,
# a caller's own .venv sitting right next to their invocation is never found.

@test "neither the datamodel-codegen nor the ruff venv fallback resolves against this script's own repo" {
    run grep -n '\$PROJECT_DIR/\.venv\|\${PROJECT_DIR}/\.venv' "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
}

@test "the datamodel-codegen venv fallback finds the CALLER's own .venv, not this repo's" {
    # No uv on PATH, so the script must fall back to .venv/PATH resolution.
    # The consumer's .venv/bin/datamodel-codegen sits in their own cwd -- the
    # documented invocation always runs from the consumer's repo root (or a
    # worktree of it), never from inside wxyc-shared's checkout.
    mkdir -p "$TEST_TEMP_DIR/consumer/.venv/bin"
    cat > "$TEST_TEMP_DIR/consumer/.venv/bin/datamodel-codegen" <<'STUB'
#!/usr/bin/env bash
if [[ "$1" == "--version" ]]; then echo "datamodel-codegen 0.56.1"; exit 0; fi
out=""
prev=""
for a in "$@"; do
    if [[ "$prev" == "--output" ]]; then out="$a"; fi
    prev="$a"
done
mkdir -p "$(dirname "$out")"
echo "# consumer venv stub ran" > "$out"
STUB
    chmod +x "$TEST_TEMP_DIR/consumer/.venv/bin/datamodel-codegen"
    write_fixture_spec

    run bash -c "cd '$TEST_TEMP_DIR/consumer' && PATH=/usr/bin:/bin bash '$SCRIPT_PATH' --input '$TEST_TEMP_DIR/fixture.yaml' --output out/models.py"
    [ "$status" -eq 0 ]
    grep -q "consumer venv stub ran" "$TEST_TEMP_DIR/consumer/out/models.py"
}

# --- Live generation tests: skipped when the pinned generator can't be run. ---

@test "generates a real Pydantic model from a minimal spec via --input/--output" {
    command -v uv > /dev/null || command -v datamodel-codegen > /dev/null || skip "neither uv nor datamodel-codegen installed"
    write_fixture_spec
    run "$SCRIPT_PATH" --input "$TEST_TEMP_DIR/fixture.yaml" --output "$TEST_TEMP_DIR/out/models.py"
    [ "$status" -eq 0 ]
    [ -f "$TEST_TEMP_DIR/out/models.py" ]
    grep -q "class Artist" "$TEST_TEMP_DIR/out/models.py"
    grep -q "do not edit manually" "$TEST_TEMP_DIR/out/models.py"
}

@test "required + nullable fields generate as X | None and stay required (#302)" {
    command -v uv > /dev/null || command -v datamodel-codegen > /dev/null || skip "neither uv nor datamodel-codegen installed"
    write_fixture_spec
    run "$SCRIPT_PATH" --input "$TEST_TEMP_DIR/fixture.yaml" --output "$TEST_TEMP_DIR/out/models.py"
    [ "$status" -eq 0 ]
    # `name` is required + non-nullable: still a plain str -- --strict-nullable
    # must not widen fields whose contract has no null.
    grep -qE '^ *name: str$' "$TEST_TEMP_DIR/out/models.py"
    # `genre` is required + nullable=true: WITH --strict-nullable the VALUE is
    # nullable but the KEY stays required -- assert the exact emitted shape,
    # `str | None = Field(...)` (the ellipsis is the required marker).
    grep -qF 'genre: str | None = Field(...)' "$TEST_TEMP_DIR/out/models.py"
    # Required-but-nullable emits `= Field(...)` -- the ellipsis is pydantic's
    # REQUIRED marker, not a default. What must never appear is an actual None
    # default making the key optional (an implementer who expects `= None`
    # defaults has misread the flag).
    run grep -E 'genre: str \| None = (None|Field\(None)' "$TEST_TEMP_DIR/out/models.py"
    [ "$status" -ne 0 ]
}

@test "regenerating from the same spec is idempotent" {
    command -v uv > /dev/null || command -v datamodel-codegen > /dev/null || skip "neither uv nor datamodel-codegen installed"
    write_fixture_spec
    "$SCRIPT_PATH" --input "$TEST_TEMP_DIR/fixture.yaml" --output "$TEST_TEMP_DIR/out/models.py"
    cp "$TEST_TEMP_DIR/out/models.py" "$TEST_TEMP_DIR/first.py"
    "$SCRIPT_PATH" --input "$TEST_TEMP_DIR/fixture.yaml" --output "$TEST_TEMP_DIR/out/models.py"
    diff -u "$TEST_TEMP_DIR/first.py" "$TEST_TEMP_DIR/out/models.py"
}

@test "runs against this repo's own api.yaml with no flags, writing the documented default path" {
    command -v uv > /dev/null || command -v datamodel-codegen > /dev/null || skip "neither uv nor datamodel-codegen installed"
    # Confined to TEST_TEMP_DIR like every other test here (Finding 5): a copy
    # of the script + this repo's real api.yaml, laid out the same way as the
    # real checkout (scripts/ next to api.yaml), so PROJECT_DIR resolves
    # inside the temp copy and the default --output path never touches the
    # developer's own generated/python/models.py.
    mkdir -p "$TEST_TEMP_DIR/proj/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/proj/scripts/generate-python-models.sh"
    cp "$REPO_ROOT/api.yaml" "$TEST_TEMP_DIR/proj/api.yaml"

    run bash "$TEST_TEMP_DIR/proj/scripts/generate-python-models.sh"
    [ "$status" -eq 0 ]
    [ -f "$TEST_TEMP_DIR/proj/generated/python/models.py" ]
    grep -q "BaseModel" "$TEST_TEMP_DIR/proj/generated/python/models.py"
}

@test "downloads api.yaml from GitHub when invoked outside this repo and no --input is given" {
    command -v uv > /dev/null || command -v datamodel-codegen > /dev/null || skip "neither uv nor datamodel-codegen installed"
    curl -sSf -o /dev/null --max-time 5 "https://raw.githubusercontent.com/WXYC/wxyc-shared/main/api.yaml" || skip "no network access to raw.githubusercontent.com"
    mkdir -p "$TEST_TEMP_DIR/scripts"
    cp "$SCRIPT_PATH" "$TEST_TEMP_DIR/scripts/"
    run bash "$TEST_TEMP_DIR/scripts/generate-python-models.sh" --output "$TEST_TEMP_DIR/out/models.py"
    [ "$status" -eq 0 ]
    [[ "$output" == *"downloading"* ]]
    [ -f "$TEST_TEMP_DIR/out/models.py" ]
}
