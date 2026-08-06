#!/usr/bin/env bash

# Breaking Change Detection Script
#
# Compares the current api.yaml against the main branch version
# to detect breaking API changes using oasdiff.
#
# Usage:
#   npm run check:breaking
#   bash scripts/check-breaking-changes.sh [base-spec-path]
#
# Prerequisites:
#   brew install oasdiff
#
# Exit codes:
#   0 - No breaking changes (or no base spec available)
#   1 - Breaking changes detected
#   2 - Error (missing oasdiff, missing api.yaml, etc.)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
BASE_SPEC="${1:-}"
TEMP_BASE=$(mktemp "${TMPDIR:-/tmp}/api-base-XXXXXX.yaml")

cleanup() { rm -f "$TEMP_BASE"; }
trap cleanup EXIT

bold='\033[1m'
green='\033[32m'
yellow='\033[33m'
red='\033[31m'
reset='\033[0m'

# Check oasdiff is installed
if ! command -v oasdiff &> /dev/null; then
    echo -e "${red}Error: oasdiff is not installed.${reset}"
    echo "Install with: brew install oasdiff"
    exit 2
fi

# Check api.yaml exists
if [[ ! -f "$PROJECT_ROOT/api.yaml" ]]; then
    echo -e "${red}Error: api.yaml not found at $PROJECT_ROOT/api.yaml${reset}"
    exit 2
fi

# Check the whitelist exists. It is a hard dependency, not an optional extra:
# oasdiff exits 121 on a missing --err-ignore path and .github/workflows/
# breaking-changes.yml passes it unconditionally, so skipping it locally would
# pass here and fail the PR job — the divergence this wiring exists to prevent.
# Preflight (not just before the oasdiff call) so the failure is reported even
# on the paths that exit early.
IGNORE_FILE="$PROJECT_ROOT/oasdiff-err-ignore.txt"
if [[ ! -f "$IGNORE_FILE" ]]; then
    echo -e "${red}Error: oasdiff-err-ignore.txt is missing at $IGNORE_FILE${reset}"
    echo "CI passes this path unconditionally and oasdiff exits 121 without it."
    echo "Restore the file (an entry-free file of comments is fine)."
    exit 2
fi

echo -e "\n${bold}Checking for Breaking API Changes${reset}"

# Get base spec
if [[ -n "$BASE_SPEC" && -f "$BASE_SPEC" ]]; then
    cp "$BASE_SPEC" "$TEMP_BASE"
    echo "Comparing current api.yaml against $BASE_SPEC..."
else
    echo "Comparing current api.yaml against main branch..."
    if ! git -C "$PROJECT_ROOT" show origin/main:api.yaml > "$TEMP_BASE" 2>/dev/null; then
        if ! git -C "$PROJECT_ROOT" show main:api.yaml > "$TEMP_BASE" 2>/dev/null; then
            echo -e "${yellow}Warning: Could not get base spec from git. Skipping.${reset}"
            exit 0
        fi
    fi
fi

# Fast path: specs are identical
if diff -q "$TEMP_BASE" "$PROJECT_ROOT/api.yaml" > /dev/null 2>&1; then
    echo -e "\n${green}No API changes detected.${reset}"
    exit 0
fi

echo ""

# Run oasdiff breaking check
# --fail-on ERR: exit 1 if breaking changes found
# --err-ignore: findings whitelisted (with justification) in oasdiff-err-ignore.txt,
#   mirroring the `err-ignore` input on .github/workflows/breaking-changes.yml.
#   Passed unconditionally, exactly as CI passes it; existence is checked in the
#   preflight above. Prune entries, keep the file.
if oasdiff breaking "$TEMP_BASE" "$PROJECT_ROOT/api.yaml" --fail-on ERR --err-ignore "$IGNORE_FILE"; then
    echo -e "\n${green}No breaking changes detected.${reset}"
else
    exit_code=$?
    echo -e "\n${red}Breaking changes detected!${reset}"
    echo -e "${yellow}Consider:"
    echo "  - Adding new fields/endpoints instead of modifying existing ones"
    echo "  - Deprecating rather than removing"
    echo -e "  - Versioning the API if breaking changes are necessary${reset}"
    exit $exit_code
fi
