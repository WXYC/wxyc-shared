#!/usr/bin/env bash

# Prune stale entries from oasdiff-err-ignore.txt
#
# Entries are scoped to the origin/main..PR diff, so one stops matching the moment
# its change lands on main. This drops every live entry whose message matches no
# current oasdiff finding, then drops a comment block left with no entries. Blocks
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

# Findings without --err-ignore, so an entry is judged against what oasdiff reports
# raw. Not --fail-on: any non-zero exit here is then a tool or input problem.
oasdiff breaking "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" > "$WORK_DIR/findings.txt" \
    || { echo "Error: oasdiff could not complete the comparison." >&2; exit 2; }

# A block is a run of lines between blank lines. Matching mirrors the staleness test:
# the entry's message (everything after "<method> <path> ") must appear in the findings.
awk -v findings="$WORK_DIR/findings.txt" '
function flush() {
    if (n == 0) return
    if (entries > 0 && kept == 0) { dropped_blocks++ }
    else { if (emitted++) print ""; printf "%s", buf }
    buf = ""; n = 0; entries = 0; kept = 0
}
BEGIN { while ((getline l < findings) > 0) F = F l "\n" }
/^[[:space:]]*$/ { flush(); next }
{
    n++
    if ($0 !~ /^[[:space:]]*#/) {
        entries++
        msg = $0; sub(/^[^ ]+ [^ ]+ /, "", msg)
        if (index(F, msg)) { kept++; buf = buf $0 "\n" }
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
