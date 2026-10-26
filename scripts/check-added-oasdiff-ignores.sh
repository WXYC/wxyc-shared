#!/usr/bin/env bash

# Fail when a PR adds an oasdiff-err-ignore.txt entry that suppresses no finding.
#
# Only the lines this branch adds to the file (diff against the merge base) are
# judged, so older entries keep the existing staleness behavior. Liveness is
# decided by oasdiff itself (oasdiff-entry-live.sh), the same rule as the prune.
# Edits nothing.
#
# Usage:
#   bash scripts/check-added-oasdiff-ignores.sh [base-spec-path]
#   BASE_REF=<ref> overrides origin/main as the merge-base ref. The base spec is
#   api.yaml at the merge base, not at the ref tip, so a branch behind main is
#   judged against what it forked from.
#
# Exit codes:
#   0 - every added entry is live (or none was added)
#   1 - an added entry suppresses nothing
#   2 - error (missing oasdiff, api.yaml, base ref or spec)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BASE_REF="${BASE_REF:-origin/main}"
BASE_SPEC="${1:-}"
WORK_DIR=$(mktemp -d "${TMPDIR:-/tmp}/check-added-oasdiff-XXXXXX")
trap 'rm -rf "$WORK_DIR"' EXIT

# shellcheck source=oasdiff-entry-live.sh
source "$SCRIPT_DIR/oasdiff-entry-live.sh"

command -v oasdiff > /dev/null || { echo "Error: oasdiff is not installed (brew install oasdiff)." >&2; exit 2; }
MERGE_BASE=$(git -C "$PROJECT_ROOT" merge-base HEAD "$BASE_REF" 2>/dev/null) \
    || { echo "Error: no merge base with $BASE_REF." >&2; exit 2; }
if [[ -z "$BASE_SPEC" ]]; then
    BASE_SPEC="$WORK_DIR/base.yaml"
    git -C "$PROJECT_ROOT" show "$MERGE_BASE:api.yaml" > "$BASE_SPEC" 2>/dev/null \
        || { echo "Error: could not read api.yaml from the merge base with $BASE_REF." >&2; exit 2; }
fi

# Added lines only; comments and blanks are not entries.
git -C "$PROJECT_ROOT" diff --unified=0 "$MERGE_BASE" -- oasdiff-err-ignore.txt \
    | grep '^+[^+]' | cut -c2- | grep -v '^[[:space:]]*#' | grep -v '^[[:space:]]*$' > "$WORK_DIR/added.txt" || true

oasdiff breaking "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" > "$WORK_DIR/raw.txt" \
    || { echo "Error: oasdiff could not complete the comparison." >&2; exit 2; }

dead=0
while IFS= read -r line; do
    rc=0
    oasdiff_entry_is_live "$BASE_SPEC" "$PROJECT_ROOT/api.yaml" "$WORK_DIR/raw.txt" "$line" "$WORK_DIR" || rc=$?
    case "$rc" in
        0) ;;
        1) echo "added oasdiff-err-ignore.txt entry suppresses no finding:"; echo "  $line"; dead=1 ;;
        *) echo "Error: oasdiff could not complete the comparison." >&2; exit 2 ;;
    esac
done < "$WORK_DIR/added.txt"

if [[ "$dead" -eq 1 ]]; then
    echo "fix: npm run prune:oasdiff-ignore"
    exit 1
fi
