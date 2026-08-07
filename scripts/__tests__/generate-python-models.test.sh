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
# --strict-nullable itself does NOT sneak in as part of this consolidation --
# that flag is #302's deliberate, separately-reviewed change.

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

@test "the datamodel-code-generator version is pinned with ==, not a floating spec" {
    run grep -E 'DATAMODEL_CODEGEN_PIN=.*datamodel-code-generator\[http\]==[0-9]+\.[0-9]+\.[0-9]+' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
}

# #302 is a deliberate, separately-reviewed change with a measured blast
# radius across both Python consumers (72 changed field declarations). It must
# not ride in silently as part of consolidating the three scripts into one.
# (The script's own header comment names --strict-nullable to explain why it's
# absent, so this excludes comment lines rather than grepping the whole file.)
@test "does not pass --strict-nullable (that is #302's job, not #107's)" {
    run bash -c "grep -v '^[[:space:]]*#' '$SCRIPT_PATH' | grep -- '--strict-nullable'"
    [ "$status" -ne 0 ]
}

@test "preserves the flags the consumer scripts relied on (parity, not a lossy merge)" {
    for flag in --target-python-version --use-standard-collections --use-union-operator --disable-timestamp --custom-file-header; do
        run grep -F -- "$flag" "$SCRIPT_PATH"
        [ "$status" -eq 0 ]
    done
}

@test "still runs ruff format + ruff check --fix over the generated file" {
    run grep -F 'ruff' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -F -- 'format' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -F -- 'check --fix' "$SCRIPT_PATH"
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

@test "warns rather than fails when a non-pinned datamodel-codegen is used without uv" {
    run grep -F 'Warning' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
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
    run grep -F 'do not edit manually' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    run grep -F 'generate-python-models.sh' "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
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

@test "required + nullable fields stay non-Optional without --strict-nullable (documents today's known defect, #302)" {
    command -v uv > /dev/null || command -v datamodel-codegen > /dev/null || skip "neither uv nor datamodel-codegen installed"
    write_fixture_spec
    run "$SCRIPT_PATH" --input "$TEST_TEMP_DIR/fixture.yaml" --output "$TEST_TEMP_DIR/out/models.py"
    [ "$status" -eq 0 ]
    # `name` is required + non-nullable: always a plain str.
    grep -q "name: str" "$TEST_TEMP_DIR/out/models.py"
    # `genre` is required + nullable=true: WITHOUT --strict-nullable this comes
    # out as a plain (non-Optional) str too -- the exact defect CLAUDE.md and
    # #302 describe. If this test starts failing because genre came out
    # `str | None`, --strict-nullable leaked into this script; that's #302's
    # change to make, deliberately, elsewhere.
    grep -q "genre: str" "$TEST_TEMP_DIR/out/models.py"
    run grep -F "genre: str | None" "$TEST_TEMP_DIR/out/models.py"
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
    rm -f "$REPO_ROOT/generated/python/models.py"
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    [ -f "$REPO_ROOT/generated/python/models.py" ]
    grep -q "BaseModel" "$REPO_ROOT/generated/python/models.py"
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
