#!/usr/bin/env bats
#
# BATS tests for scripts/bs-lml-gate/resolve-shas.sh
#
# resolve-shas.sh fetches current main + prod SHAs for BS and LML via
# `gh api`, writes them to $GITHUB_OUTPUT, and exits non-zero if any
# fetch fails (so a transient API blip blocks promotion rather than
# silently using a stale SHA).

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../bs-lml-gate" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/resolve-shas.sh"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
    export GITHUB_OUTPUT="$TEST_TEMP_DIR/github_output"
    : >"$GITHUB_OUTPUT"
    export FAKE_BIN="$TEST_TEMP_DIR/bin"
    mkdir -p "$FAKE_BIN"
    export PATH="$FAKE_BIN:$PATH"
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

# Install a fake `gh` that emits canned JSON keyed by the path it was
# called with. Missing fixture defaults to a 404-style stderr so the
# script's 404→empty path is exercised (the production gh emits e.g.
# `gh: Not Found (HTTP 404)`). Tests that want a non-404 failure write
# a fixture-suffixed file `<path>.500` or `<path>.401`.
install_fake_gh() {
    local fixture_dir="$TEST_TEMP_DIR/gh-fixtures"
    mkdir -p "$fixture_dir"
    export GH_FIXTURE_DIR="$fixture_dir"
    cat >"$FAKE_BIN/gh" <<'GH_EOF'
#!/usr/bin/env bash
if [[ "$1" != "api" ]]; then
    echo "fake gh: unexpected first arg '$1'" >&2
    exit 99
fi
path="$2"
sanitized="${path//\//_}"
fixture="$GH_FIXTURE_DIR/${sanitized}.json"
# Non-404 failure fixture support: presence of <sanitized>.HTTP_xxx
# means simulate that status code with a matching stderr.
for code in 401 403 429 500 503; do
    if [[ -f "$GH_FIXTURE_DIR/${sanitized}.HTTP_${code}" ]]; then
        echo "gh: HTTP ${code}: simulated (https://api.github.com/${path})" >&2
        exit 1
    fi
done
if [[ ! -f "$fixture" ]]; then
    echo "gh: Not Found (HTTP 404)" >&2
    exit 1
fi
cat "$fixture"
GH_EOF
    chmod +x "$FAKE_BIN/gh"
}

simulate_http() {
    # simulate_http <path> <status>
    local sanitized="${1//\//_}"
    : >"$GH_FIXTURE_DIR/${sanitized}.HTTP_${2}"
}

set_fixture() {
    local path="$1" body="$2"
    local sanitized="${path//\//_}"
    echo "$body" >"$GH_FIXTURE_DIR/${sanitized}.json"
}

# Test SHAs: hex-only, exactly 40 chars. Leading letter + 38 zeros + tag.
BS_MAIN='b000000000000000000000000000000000000001'
BS_PROD='b000000000000000000000000000000000000002'
LML_MAIN='c000000000000000000000000000000000000001'
LML_PROD='c000000000000000000000000000000000000002'

@test "writes bs_main_sha, lml_main_sha, bs_prod_sha, lml_prod_sha to GITHUB_OUTPUT" {
    install_fake_gh
    set_fixture "repos/WXYC/Backend-Service/branches/main"           "{\"commit\":{\"sha\":\"$BS_MAIN\"}}"
    set_fixture "repos/WXYC/Backend-Service/branches/prod"           "{\"commit\":{\"sha\":\"$BS_PROD\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/main"   "{\"commit\":{\"sha\":\"$LML_MAIN\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/prod"   "{\"commit\":{\"sha\":\"$LML_PROD\"}}"

    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]

    grep -qE "^bs_main_sha=${BS_MAIN}\$"   "$GITHUB_OUTPUT"
    grep -qE "^bs_prod_sha=${BS_PROD}\$"   "$GITHUB_OUTPUT"
    grep -qE "^lml_main_sha=${LML_MAIN}\$" "$GITHUB_OUTPUT"
    grep -qE "^lml_prod_sha=${LML_PROD}\$" "$GITHUB_OUTPUT"
}

@test "treats missing prod branch (404) as empty SHA so the seed flow works" {
    install_fake_gh
    set_fixture "repos/WXYC/Backend-Service/branches/main"           "{\"commit\":{\"sha\":\"$BS_MAIN\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/main"   "{\"commit\":{\"sha\":\"$LML_MAIN\"}}"
    # prod fixtures intentionally absent -> fake gh exits 22 (Not Found-ish)

    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    grep -q '^bs_prod_sha=$'  "$GITHUB_OUTPUT"
    grep -q '^lml_prod_sha=$' "$GITHUB_OUTPUT"
}

@test "fails if main resolve fails (do NOT proceed with empty main)" {
    install_fake_gh
    # No main fixtures -> fake gh exits 22 for main lookups
    set_fixture "repos/WXYC/Backend-Service/branches/prod"           "{\"commit\":{\"sha\":\"$BS_PROD\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/prod"   "{\"commit\":{\"sha\":\"$LML_PROD\"}}"

    run "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
}

@test "fails if GITHUB_OUTPUT is unset" {
    install_fake_gh
    unset GITHUB_OUTPUT
    run "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
    [[ "$output" == *"GITHUB_OUTPUT"* ]]
}

@test "rejects SHAs that are not 40-char hex (defense against fixture/API drift)" {
    install_fake_gh
    set_fixture "repos/WXYC/Backend-Service/branches/main"           '{"commit":{"sha":"not-a-sha"}}'
    set_fixture "repos/WXYC/Backend-Service/branches/prod"           "{\"commit\":{\"sha\":\"$BS_PROD\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/main"   "{\"commit\":{\"sha\":\"$LML_MAIN\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/prod"   "{\"commit\":{\"sha\":\"$LML_PROD\"}}"

    run "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
    [[ "$output" == *"sha"* || "$output" == *"SHA"* ]]
}

@test "fails fast on transient 5xx for prod lookup (does NOT collapse to seed path)" {
    install_fake_gh
    set_fixture "repos/WXYC/Backend-Service/branches/main"           "{\"commit\":{\"sha\":\"$BS_MAIN\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/main"   "{\"commit\":{\"sha\":\"$LML_MAIN\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/prod"   "{\"commit\":{\"sha\":\"$LML_PROD\"}}"
    # BS prod returns 503 — must surface as a failure, not as 'seed needed'
    simulate_http "repos/WXYC/Backend-Service/branches/prod" 503

    run "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
    [[ "$output" == *"503"* ]]
}

@test "fails fast on 401 for any lookup (expired PAT, do NOT silently bypass)" {
    install_fake_gh
    set_fixture "repos/WXYC/Backend-Service/branches/main"           "{\"commit\":{\"sha\":\"$BS_MAIN\"}}"
    set_fixture "repos/WXYC/library-metadata-lookup/branches/main"   "{\"commit\":{\"sha\":\"$LML_MAIN\"}}"
    set_fixture "repos/WXYC/Backend-Service/branches/prod"           "{\"commit\":{\"sha\":\"$BS_PROD\"}}"
    simulate_http "repos/WXYC/library-metadata-lookup/branches/prod" 401

    run "$SCRIPT_PATH"
    [ "$status" -ne 0 ]
    [[ "$output" == *"401"* ]]
}
