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

# Fetch the `commit.sha` for a branch.
#
# Exit semantics — we distinguish 404 (branch missing → seed path) from
# every other gh failure (transient 5xx, expired PAT, rate-limit). The
# old behavior of collapsing all failures into "empty" would let a 503
# on a `prod` lookup mis-trigger the seed/POST path on an existing
# branch and corrupt the audit trail.
#
# Returns: prints SHA on stdout (empty if branch is genuinely missing).
# Exits the script on any non-404 failure (set -e propagates).
fetch_branch_sha() {
    local repo="$1" branch="$2"
    local body="" err_file rc=0
    err_file="$(mktemp)"

    # NB: `if body="$(cmd)"; then` would clobber $? to 0 in the else
    # branch (bash if-statement quirk). `|| rc=$?` keeps the real code.
    body="$(gh api "repos/${repo}/branches/${branch}" 2>"$err_file")" || rc=$?

    if (( rc == 0 )); then
        rm -f "$err_file"
        printf '%s' "$body" | jq -r '.commit.sha // ""'
        return 0
    fi

    # gh's 404 stderr always includes the literal `HTTP 404`. We anchor
    # on that exact substring (no `-i`, no 'Not Found' alternation) to
    # avoid false-matching on errors like `host not found` (DNS),
    # `token not found` (auth), or upstream proxy messages that happen
    # to contain the phrase. A false 404 match drives push-prod.sh into
    # the seed/POST path on an existing branch, which then 422s loudly
    # but mis-attributes the cause.
    if grep -q 'HTTP 404' "$err_file"; then
        rm -f "$err_file"
        echo ""
        return 0
    fi

    # Anything else: surface the error and propagate. set -e in main
    # will fail the script.
    echo "resolve-shas: gh api repos/${repo}/branches/${branch} failed (rc=$rc):" >&2
    cat "$err_file" >&2
    rm -f "$err_file"
    return "$rc"
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
