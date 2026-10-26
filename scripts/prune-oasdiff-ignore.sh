#!/usr/bin/env bash

# Prune stale entries from oasdiff-err-ignore.txt
#
# Entries are scoped to the origin/main..PR diff, so one stops matching the moment
# its change lands on main. This drops every entry that suppresses no current
# oasdiff finding (judged by oasdiff itself), then drops a comment block left with
# no entries. Blocks
# that still hold a live entry keep their comments, and so does all prose that sits
# in a block with no entries at all (the header). The file itself is never removed:
# CI passes its path unconditionally and oasdiff exits 121 when it is missing.
#
# Usage:
#   npm run prune:oasdiff-ignore
#   bash scripts/prune-oasdiff-ignore.sh [base-spec-path]
#
# Run it after rebasing a contract PR. Exit codes:
#   0 - pruned (or nothing to prune)
#   2 - error (missing oasdiff, api.yaml, base spec or ignore file)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
IGNORE_FILE="$PROJECT_ROOT/oasdiff-err-ignore.txt"
BASE_SPEC="${1:-}"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/prune-oasdiff-XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

command -v oasdiff > /dev/null || { echo "Error: oasdiff is not installed (brew install oasdiff)." >&2; exit 2; }
[[ -f "$PROJECT_ROOT/api.yaml" ]] || { echo "Error: api.yaml not found at $PROJECT_ROOT/api.yaml" >&2; exit 2; }
[[ -f "$IGNORE_FILE" && -r "$IGNORE_FILE" ]] || { echo "Error: oasdiff-err-ignore.txt is not a readable file at $IGNORE_FILE" >&2; exit 2; }

if [[ -z "$BASE_SPEC" ]]; then
    BASE_SPEC="$WORK_DIR/base.yaml"
    git -C "$PROJECT_ROOT" show origin/main:api.yaml > "$BASE_SPEC" 2>/dev/null \
        || { echo "Error: could not read api.yaml from origin/main." >&2; exit 2; }
fi
[[ -f "$BASE_SPEC" ]] || { echo "Error: base spec not found: $BASE_SPEC" >&2; exit 2; }

# Liveness is decided by oasdiff itself, so the prune and the matcher can never
# disagree (oasdiff ignores case and accepts extra text on the line, which a
# substring test does not). An entry is live when oasdiff run with only that
# entry as --err-ignore reports something different from the raw run, i.e. the
# entry suppresses a finding. Not --fail-on: any non-zero exit is then a tool or
# input problem.
oasdiff breaking "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" > "$WORK_DIR/raw.txt" \
    || { echo "Error: oasdiff could not complete the comparison." >&2; exit 2; }

: > "$WORK_DIR/live.txt"
while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    printf '%s\n' "$line" > "$WORK_DIR/one.txt"
    oasdiff breaking "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" --err-ignore "$WORK_DIR/one.txt" > "$WORK_DIR/one-out.txt" \
        || { echo "Error: oasdiff could not complete the comparison." >&2; exit 2; }
    if ! cmp -s "$WORK_DIR/raw.txt" "$WORK_DIR/one-out.txt"; then
        printf '%s\n' "$line" >> "$WORK_DIR/live.txt"
    fi
done < "$IGNORE_FILE"

# A block is a run of lines between blank lines. Stale entries are removed. A block
# left with no live entry loses its comments too, except the first block of the
# file: that is where the header lives, and a stale entry written without a blank
# line after the header shares its block, so the header must survive.
awk -v live="$WORK_DIR/live.txt" '
function flush() {
    if (n == 0) return
    blocks++
    if (entries > 0 && kept == 0 && blocks > 1) { }
    else if (buf != "") { if (emitted++) print ""; printf "%s", buf }
    buf = ""; n = 0; entries = 0; kept = 0
}
BEGIN { while ((getline l < live) > 0) L[l] = 1 }
/^[[:space:]]*$/ { flush(); next }
{
    n++
    if ($0 !~ /^[[:space:]]*#/) {
        entries++
        if ($0 in L) { kept++; buf = buf $0 "\n" }
        else print "pruned: " $0 > "/dev/stderr"
        next
    }
    buf = buf $0 "\n"
}
END { flush() }
' "$IGNORE_FILE" > "$WORK_DIR/pruned.txt"

if cmp -s "$IGNORE_FILE" "$WORK_DIR/pruned.txt"; then
    echo "No stale entries in oasdiff-err-ignore.txt."
else
    cat "$WORK_DIR/pruned.txt" > "$IGNORE_FILE"
    echo "Pruned oasdiff-err-ignore.txt."
fi
