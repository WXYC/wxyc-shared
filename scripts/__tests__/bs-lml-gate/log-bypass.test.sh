#!/usr/bin/env bats
#
# BATS tests for scripts/bs-lml-gate/log-bypass.sh.
#
# log-bypass.sh appends a comment to a long-lived "gate-bypasses"
# tracker issue with who/when/justification/SHAs. Called by the
# workflow on the bypass path before any prod push. If the append
# fails, log-bypass exits non-zero so the workflow bails out before
# advancing prod — bypass-with-no-audit is forbidden.
#
# Env:
#   BYPASS_REPO            — required, e.g. WXYC/wxyc-shared
#   BYPASS_ISSUE_NUMBER    — required, integer
#   BYPASS_ACTOR           — required (github.actor)
#   BYPASS_JUSTIFICATION   — required, non-empty
#   BYPASS_BS_SHA          — required
#   BYPASS_LML_SHA         — required
#   BYPASS_RUN_URL         — required, link back to the GHA run
#   BYPASS_WHEN            — optional, ISO timestamp. Defaults to `date -u +%Y-%m-%dT%H:%M:%SZ`
#
# Exit:
#   0 — comment posted
#   1 — gh api failed
#   2 — usage error

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/../../bs-lml-gate" && pwd)"
SCRIPT_PATH="$SCRIPT_DIR/log-bypass.sh"

setup() {
    TEST_TEMP_DIR="$(mktemp -d)"
    export FAKE_BIN="$TEST_TEMP_DIR/bin"
    mkdir -p "$FAKE_BIN"
    export PATH="$FAKE_BIN:$PATH"
    export GH_CALL_LOG="$TEST_TEMP_DIR/gh-calls.log"
    export GH_BODY_LOG="$TEST_TEMP_DIR/gh-body.log"
    : >"$GH_CALL_LOG"
    : >"$GH_BODY_LOG"

    export BYPASS_REPO='WXYC/wxyc-shared'
    export BYPASS_ISSUE_NUMBER='42'
    export BYPASS_ACTOR='jakebromberg'
    export BYPASS_JUSTIFICATION='LML staging wedged on stale Discogs cache; promoting BS hotfix #BS-1318 manually'
    export BYPASS_BS_SHA='a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9'
    export BYPASS_LML_SHA='ffeeddccbbaa99887766554433221100ffeeddcc'
    export BYPASS_RUN_URL='https://github.com/WXYC/wxyc-shared/actions/runs/123456'
    export BYPASS_WHEN='2026-06-04T22:00:00Z'
}

teardown() {
    rm -rf "$TEST_TEMP_DIR"
}

install_fake_gh_success() {
    cat >"$FAKE_BIN/gh" <<GH_EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$GH_CALL_LOG"
# Capture the body sent via -F body=@... if present
for ((i=1; i<=\$#; i++)); do
    arg="\${!i}"
    if [[ "\$arg" == "body=@"* ]]; then
        path="\${arg#body=@}"
        cat "\$path" >>"$GH_BODY_LOG"
    fi
done
exit 0
GH_EOF
    chmod +x "$FAKE_BIN/gh"
}

install_fake_gh_failure() {
    cat >"$FAKE_BIN/gh" <<GH_EOF
#!/usr/bin/env bash
printf '%s\n' "\$*" >>"$GH_CALL_LOG"
echo "fake gh: simulated failure" >&2
exit 1
GH_EOF
    chmod +x "$FAKE_BIN/gh"
}

@test "posts a comment containing actor, justification, both SHAs, when, and run URL" {
    install_fake_gh_success
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]

    grep -q "POST" "$GH_CALL_LOG"
    grep -q "repos/WXYC/wxyc-shared/issues/42/comments" "$GH_CALL_LOG"

    grep -q 'jakebromberg' "$GH_BODY_LOG"
    grep -q 'LML staging wedged' "$GH_BODY_LOG"
    grep -q 'a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9' "$GH_BODY_LOG"
    grep -q 'ffeeddccbbaa99887766554433221100ffeeddcc' "$GH_BODY_LOG"
    grep -q '2026-06-04T22:00:00Z' "$GH_BODY_LOG"
    grep -q 'actions/runs/123456' "$GH_BODY_LOG"
}

@test "exits 1 when gh fails — workflow must abort before pushing prod" {
    install_fake_gh_failure
    run "$SCRIPT_PATH"
    [ "$status" -eq 1 ]
}

@test "exits 2 when justification is empty (defends invariant: no silent bypass)" {
    install_fake_gh_success
    export BYPASS_JUSTIFICATION=''
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
    [ ! -s "$GH_CALL_LOG" ]
}

@test "exits 2 when any required field is missing" {
    install_fake_gh_success
    unset BYPASS_ACTOR
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
}

@test "defaults BYPASS_WHEN to current UTC time when unset" {
    install_fake_gh_success
    unset BYPASS_WHEN
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' "$GH_BODY_LOG"
}
