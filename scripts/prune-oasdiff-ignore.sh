#!/usr/bin/env bash

# Prune stale entries from oasdiff-err-ignore.txt
#
# Entries are scoped to the origin/main..PR diff, so one stops matching the moment
# its change lands on main. This drops every entry that suppresses no current
# oasdiff finding (judged by oasdiff itself), together with the justification
# comments that belong only to dropped entries.
#
# A justification belongs to the entries directly below it: a run of comment lines
# followed, with no blank line between, by a run of entry lines. It is dropped only
# when every entry in that run is dropped. Comments kept by this rule: any comment
# block with no entry below it (the header prose), and comments above a live entry.
# One exception for the header: in the first block of the file, only the comment
# line immediately above the entries is a justification; the comment lines above
# it are header and stay. Blank lines are never touched, except that the blank lines
# left around a block that became empty are removed with it. When no entry is stale
# the file is left byte-identical. The file itself is never removed: CI passes its
# path unconditionally and oasdiff exits 121 when it is missing.
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

# shellcheck source=oasdiff-entry-live.sh
source "$SCRIPT_DIR/oasdiff-entry-live.sh"

command -v oasdiff > /dev/null || { echo "Error: oasdiff is not installed (brew install oasdiff)." >&2; exit 2; }
[[ -f "$PROJECT_ROOT/api.yaml" ]] || { echo "Error: api.yaml not found at $PROJECT_ROOT/api.yaml" >&2; exit 2; }
[[ -f "$IGNORE_FILE" && -r "$IGNORE_FILE" ]] || { echo "Error: oasdiff-err-ignore.txt is not a readable file at $IGNORE_FILE" >&2; exit 2; }

if [[ -z "$BASE_SPEC" ]]; then
    BASE_SPEC="$WORK_DIR/base.yaml"
    git -C "$PROJECT_ROOT" show origin/main:api.yaml > "$BASE_SPEC" 2>/dev/null \
        || { echo "Error: could not read api.yaml from origin/main." >&2; exit 2; }
fi
[[ -f "$BASE_SPEC" ]] || { echo "Error: base spec not found: $BASE_SPEC" >&2; exit 2; }

# Liveness is decided by oasdiff itself (see oasdiff-entry-live.sh).
oasdiff breaking "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" > "$WORK_DIR/raw.txt" \
    || { echo "Error: oasdiff could not complete the comparison." >&2; exit 2; }

: > "$WORK_DIR/live.txt"
while IFS= read -r line || [[ -n "$line" ]]; do
    if [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]]; then
        continue
    fi
    rc=0
    oasdiff_entry_is_live "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" "$WORK_DIR/raw.txt" "$line" "$WORK_DIR" || rc=$?
    case "$rc" in
        0) printf '%s\n' "$line" >> "$WORK_DIR/live.txt" ;;
        1) ;;
        *) echo "Error: oasdiff could not complete the comparison." >&2; exit 2 ;;
    esac
done < "$IGNORE_FILE"

awk -v live="$WORK_DIR/live.txt" -v countfile="$WORK_DIR/count.txt" '
function iscomment(x) { return x ~ /^[[:space:]]*#/ }
# Decide which lines of the current block to drop, then emit the rest.
function flush(   i, cs, ce, es, ee, k, allstale, any) {
    if (n == 0) return
    blocks++
    i = 1
    while (i <= n) {
        cs = i; while (i <= n && iscomment(b[i])) i++
        ce = i - 1
        es = i; while (i <= n && !iscomment(b[i])) i++
        ee = i - 1
        if (es > ee) continue
        allstale = 1
        for (k = es; k <= ee; k++) {
            if (b[k] in L) allstale = 0
            else { drop[k] = 1; pruned++; print "pruned: " b[k] > "/dev/stderr" }
        }
        if (allstale && ce >= cs) {
            if (blocks == 1 && cs == 1) drop[ce] = 1
            else for (k = cs; k <= ce; k++) drop[k] = 1
        }
    }
    any = 0
    for (i = 1; i <= n; i++) if (!(i in drop)) any = 1
    if (any) {
        printf "%s", pending
        for (i = 1; i <= n; i++) if (!(i in drop)) print b[i]
        emitted = 1; pending = ""; lastRemoved = 0
    } else {
        if (!emitted) pending = ""   # leading blank lines go with a dropped first block
        lastRemoved = 1   # keep pending: the separator before the dropped block now separates its neighbours
    }
    skipBlanks = !any
    delete drop; n = 0
}
BEGIN { while ((getline l < live) > 0) L[l] = 1 }
/^[[:space:]]*$/ { flush(); if (!skipBlanks) pending = pending $0 "\n"; next }
{ skipBlanks = 0; b[++n] = $0 }
END { flush(); if (!lastRemoved) printf "%s", pending; print pruned + 0 > countfile }
' "$IGNORE_FILE" > "$WORK_DIR/pruned.txt"

if [[ "$(cat "$WORK_DIR/count.txt")" -eq 0 ]]; then
    echo "Nothing pruned: no stale entries in oasdiff-err-ignore.txt."
else
    cat "$WORK_DIR/pruned.txt" > "$IGNORE_FILE"
    echo "Pruned oasdiff-err-ignore.txt."
fi
