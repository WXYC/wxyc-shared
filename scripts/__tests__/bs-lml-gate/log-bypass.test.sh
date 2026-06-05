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
# Mirror real \`gh api\` flag semantics: only -F (--field) treats
# @<path> as a file reference; -f (--raw-field) sends it as a literal
# string. Capturing both behaviors lets the test distinguish them so
# a swap of -F → -f doesn't silently pass.
printf '%s\n' "\$*" >>"$GH_CALL_LOG"
prev=""
for arg in "\$@"; do
    if [[ "\$arg" == "body="* ]]; then
        value="\${arg#body=}"
        if [[ "\$value" == "@"* && ( "\$prev" == "-F" || "\$prev" == "--field" ) ]]; then
            cat "\${value#@}" >>"\$GH_BODY_LOG"
        else
            # -f or no flag context: body is the literal string value
            printf '%s\n' "\$value" >>"\$GH_BODY_LOG"
        fi
    fi
    prev="\$arg"
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

@test "exits 2 when justification is whitespace-only (no silent bypass via blank)" {
    install_fake_gh_success
    export BYPASS_JUSTIFICATION=$'   \n\t  \n'
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
    [ ! -s "$GH_CALL_LOG" ]
}

@test "handles justification line equal to 'EOF' (heredoc-injection defense)" {
    install_fake_gh_success
    # If the body were built with an unquoted heredoc <<EOF, this line
    # would terminate the heredoc early. The script must build the
    # body via a delimiter-free mechanism so this is just text.
    export BYPASS_JUSTIFICATION=$'before\nEOF\nafter'
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    # Body must contain all three lines verbatim plus the closing fence.
    grep -q '^before$' "$GH_BODY_LOG"
    grep -q '^EOF$' "$GH_BODY_LOG"
    grep -q '^after$' "$GH_BODY_LOG"
    # And the body must end with the closing fence (either ``` or ~~~);
    # if heredoc-EOF had terminated early, the closing fence would be missing.
    tail -1 "$GH_BODY_LOG" | grep -qE '^(```|~~~)$'
}

@test "exits 2 when any required field is missing" {
    install_fake_gh_success
    unset BYPASS_ACTOR
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
}

@test "error message names the exact env-var the operator must set" {
    install_fake_gh_success
    unset BYPASS_ISSUE_NUMBER
    run "$SCRIPT_PATH"
    [ "$status" -eq 2 ]
    # Must say BYPASS_ISSUE_NUMBER, not BYPASS_ISSUE (the earlier name
    # was confusing — operator would grep for the wrong var).
    [[ "$output" == *"BYPASS_ISSUE_NUMBER"* ]]
    [[ "$output" != *"BYPASS_ISSUE is"* ]]
}

@test "defaults BYPASS_WHEN to current UTC time when unset" {
    install_fake_gh_success
    unset BYPASS_WHEN
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    grep -qE '20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z' "$GH_BODY_LOG"
}

@test "wraps justification in a fenced code block so markdown is neutralized" {
    install_fake_gh_success
    export BYPASS_JUSTIFICATION='Approved by @wxyc/oncall — see https://evil.example/spoof'
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    # The body should contain a fence line, AND the justification text
    # should appear after the fence (not as inline markdown).
    grep -qE '^```$' "$GH_BODY_LOG" || grep -qE '^~~~$' "$GH_BODY_LOG"
    grep -q 'Approved by @wxyc/oncall' "$GH_BODY_LOG"
}

@test "falls back to ~~~ fence if justification contains backtick fence" {
    install_fake_gh_success
    export BYPASS_JUSTIFICATION=$'try this:\n```rm -rf /```'
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    # Outer fence must be ~~~ since the body contains ```
    grep -qE '^~~~$' "$GH_BODY_LOG"
}

@test "disarms input fence that matches the chosen outer fence" {
    install_fake_gh_success
    # Outer fence is chosen based on input: ``` is the default; if
    # input contains ```, outer flips to ~~~. The remaining defense:
    # if the chosen outer fence sequence appears in the input, it
    # must be broken up so it can't close the outer block early.
    #
    # Input contains BOTH ``` and ~~~. Outer fence becomes ~~~
    # (input has ```). The script must disarm the standalone ~~~
    # line in the input so it doesn't close the outer ~~~ block.
    export BYPASS_JUSTIFICATION=$'has ``` and\n~~~\nstandalone'
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    # Body must not contain a standalone ~~~ line in positions where
    # it would close the outer block. The opening and closing fences
    # are the only legitimate ~~~ lines; the middle of the body
    # (inside the fence) must not have ~~~ alone on a line.
    # Count standalone ~~~ lines: should be exactly 2 (open + close).
    count=$(grep -cE '^~~~$' "$GH_BODY_LOG")
    [ "$count" -eq 2 ]
}

@test "posts the rendered body via -F (not -f), so audit content reaches the issue" {
    # Regression test for the iter-2 swap of -F → -f that silently
    # broke the audit body: gh api -f body=@path sends the LITERAL
    # string '@path', not the file content. The fake gh distinguishes
    # the two flags, so this asserts the script uses -F.
    install_fake_gh_success
    run "$SCRIPT_PATH"
    [ "$status" -eq 0 ]
    grep -qE '(^| )-F( |$)' "$GH_CALL_LOG"
    # And the body that landed must be the rendered markdown, not
    # the literal '@/tmp/...' string the -f path would produce.
    [ -s "$GH_BODY_LOG" ]
    ! grep -qE '^@/' "$GH_BODY_LOG"
}
