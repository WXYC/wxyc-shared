#!/usr/bin/env bats
#
# BATS tests for check-added-oasdiff-ignores.sh.
#
# Run with: npm run test:added-ignores-guard
#
# Each test builds a throwaway git repo: api.yaml is committed with a required
# property `b`, the working tree drops it (one oasdiff error), and the ignore file
# is edited in the working tree so the script sees the entry as added.

SCRIPT_DIR="$(cd "$(dirname "$BATS_TEST_FILENAME")/.." && pwd)"
LIVE_ENTRY='get /x removed the required property `b` from the response with the `200` status'
DEAD_ENTRY='get /x removed the required property `zzz` from the response with the `200` status'

setup() {
    command -v oasdiff > /dev/null || skip "oasdiff not installed"
    REPO="$(mktemp -d)"
    mkdir -p "$REPO/scripts"
    cp "$SCRIPT_DIR"/check-added-oasdiff-ignores.sh "$SCRIPT_DIR"/oasdiff-entry-live.sh "$REPO/scripts/"
    cat > "$REPO/api.yaml" <<'YAML'
openapi: 3.0.0
info: {title: t, version: 1.0.0}
paths:
  /x:
    get:
      responses:
        '200':
          description: ok
          content:
            application/json:
              schema:
                type: object
                required: [a, b]
                properties:
                  a: {type: string}
                  b: {type: string}
YAML
    printf '# header\n' > "$REPO/oasdiff-err-ignore.txt"
    git -C "$REPO" init -q
    git -C "$REPO" add -A
    git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm base
    sed -i.bak 's/required: \[a, b\]/required: [a]/; /b: {type/d' "$REPO/api.yaml" && rm "$REPO/api.yaml.bak"
    export BASE_REF=HEAD
}

teardown() {
    rm -rf "$REPO"
}

check() { bash "$REPO/scripts/check-added-oasdiff-ignores.sh"; }

@test "an added entry that suppresses nothing fails, naming the entry and the prune command" {
    printf '# why\n%s\n' "$DEAD_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    run check
    [ "$status" -eq 1 ]
    [[ "$output" == *"$DEAD_ENTRY"* ]]
    [[ "$output" == *"npm run prune:oasdiff-ignore"* ]]
}

@test "an added entry that suppresses a finding passes" {
    printf '# why\n%s\n' "$LIVE_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    run check
    [ "$status" -eq 0 ]
}

@test "an older stale entry is not reported when the branch adds nothing" {
    printf '%s\n' "$DEAD_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    git -C "$REPO" add -A
    git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm "older stale entry"
    run check
    [ "$status" -eq 0 ]
}

@test "only added lines are judged: a dead entry committed earlier is ignored beside a live added one" {
    printf '%s\n' "$DEAD_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    git -C "$REPO" add oasdiff-err-ignore.txt
    git -C "$REPO" -c user.name=t -c user.email=t@t commit -qm older
    printf '%s\n' "$LIVE_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    run check
    [ "$status" -eq 0 ]
}

@test "the check edits nothing" {
    printf '%s\n' "$DEAD_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    before=$(cat "$REPO/oasdiff-err-ignore.txt")
    run check
    [ "$(cat "$REPO/oasdiff-err-ignore.txt")" = "$before" ]
}

@test "a dead added entry fails even when api.yaml is identical to the base" {
    # The PR-that-only-adds-a-dead-entry case: no spec change, so every added entry is dead.
    git -C "$REPO" checkout -q -- api.yaml
    printf '# why\n%s\n' "$DEAD_ENTRY" >> "$REPO/oasdiff-err-ignore.txt"
    run check
    [ "$status" -eq 1 ]
    [[ "$output" == *"$DEAD_ENTRY"* ]]
}

@test "nothing added and api.yaml identical to the base passes" {
    git -C "$REPO" checkout -q -- api.yaml
    run check
    [ "$status" -eq 0 ]
}

@test "CI runs the check as its own step, not only through a bats case that skips on an unchanged api.yaml" {
    # check-breaking-changes.test.sh's case calls setup_base, which skips when api.yaml
    # matches origin/main, so it never covers the PR that changes only the whitelist.
    ci="$SCRIPT_DIR/../.github/workflows/ci.yml"
    run grep -E '^[[:space:]]*run:[[:space:]]*npm run check:added-oasdiff-ignores[[:space:]]*$' "$ci"
    [ "$status" -eq 0 ]
    run grep -F '"check:added-oasdiff-ignores": "bash scripts/check-added-oasdiff-ignores.sh"' "$SCRIPT_DIR/../package.json"
    [ "$status" -eq 0 ]
}
