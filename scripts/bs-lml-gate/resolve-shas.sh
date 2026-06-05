#!/usr/bin/env bash
#
# resolve-shas.sh — fetch current main + prod SHAs for both repos.
#
# Used by .github/workflows/bs-lml-gate.yml. Always re-queries the GitHub
# API so a stale repository_dispatch payload cannot regress prod: whatever
# commit is at HEAD of main at *this* moment is the one that gets promoted.
#
# Outputs (to $GITHUB_OUTPUT):
#   bs_main_sha   — Backend-Service:main HEAD
#   bs_prod_sha   — Backend-Service:prod HEAD ("" if branch doesn't exist yet)
#   lml_main_sha  — library-metadata-lookup:main HEAD
#   lml_prod_sha  — library-metadata-lookup:prod HEAD ("")
#
# Exits non-zero if a main SHA cannot be resolved (we never proceed with
# a guessed/empty main). A missing prod branch is treated as "needs seed"
# and resolves to empty string.
#
# Requires: gh, jq.

set -euo pipefail

if [[ -z "${GITHUB_OUTPUT:-}" ]]; then
    echo "resolve-shas: GITHUB_OUTPUT is not set; refusing to run outside GHA" >&2
    exit 2
fi

# Fetch the `commit.sha` for a branch; on any gh failure, echo empty.
fetch_branch_sha() {
    local repo="$1" branch="$2"
    local body sha
    if ! body="$(gh api "repos/${repo}/branches/${branch}" 2>/dev/null)"; then
        echo ""
        return 0
    fi
    sha="$(printf '%s' "$body" | jq -r '.commit.sha // ""')"
    echo "$sha"
}

validate_sha() {
    local label="$1" sha="$2"
    if [[ -z "$sha" ]]; then
        return 0
    fi
    if ! [[ "$sha" =~ ^[0-9a-f]{40}$ ]]; then
        echo "resolve-shas: ${label} is not a 40-char hex sha: '${sha}'" >&2
        return 1
    fi
}

BS_MAIN_SHA="$(fetch_branch_sha WXYC/Backend-Service main)"
LML_MAIN_SHA="$(fetch_branch_sha WXYC/library-metadata-lookup main)"
BS_PROD_SHA="$(fetch_branch_sha WXYC/Backend-Service prod)"
LML_PROD_SHA="$(fetch_branch_sha WXYC/library-metadata-lookup prod)"

if [[ -z "$BS_MAIN_SHA" ]]; then
    echo "resolve-shas: failed to resolve Backend-Service:main" >&2
    exit 1
fi
if [[ -z "$LML_MAIN_SHA" ]]; then
    echo "resolve-shas: failed to resolve library-metadata-lookup:main" >&2
    exit 1
fi

validate_sha "Backend-Service:main"       "$BS_MAIN_SHA"
validate_sha "library-metadata-lookup:main" "$LML_MAIN_SHA"
validate_sha "Backend-Service:prod"       "$BS_PROD_SHA"
validate_sha "library-metadata-lookup:prod" "$LML_PROD_SHA"

{
    echo "bs_main_sha=${BS_MAIN_SHA}"
    echo "bs_prod_sha=${BS_PROD_SHA}"
    echo "lml_main_sha=${LML_MAIN_SHA}"
    echo "lml_prod_sha=${LML_PROD_SHA}"
} >>"$GITHUB_OUTPUT"
