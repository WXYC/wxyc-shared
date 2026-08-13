#!/usr/bin/env bash
#
# check-version-bump.sh -- fail when api.yaml's CONTENT changed against a
# base spec but info.version did not move.
#
# Context (#347): info.version does not reliably move with content. A survey
# of five consecutive api.yaml-touching commits found all five landed at an
# unchanged 1.35.0 (the last bump before them was 8c35e97, 1.34.0 -> 1.35.0),
# including 363718c, which added a whole path
# (/config/secrets) and schema (AppSecrets). Downstream consumers (see
# WXYC/wxyc-ios-64#919) record info.version as a human-readable identity of
# "what shape did I generate against" -- a version that doesn't move makes
# that identity a lie. This script is the enforcement half of that fix; see
# CLAUDE.md's "Version bump gate" section for the rule itself.
#
# THE DECISION IS CONTENT, NOT A HUMAN GLANCING AT info.version -- deliberately
# mirroring scripts/check-spec-drift.sh's content-over-version stance (#319):
# a byte-identical api.yaml can never trip this check regardless of what
# info.version says, and any content change at all, however small
# (description-only included), requires info.version to differ from the base.
# This script does not attempt to classify additive-vs-patch-vs-major -- it
# only asks "did content change and did version not."
#
# Usage:
#   npm run check:version-bump
#   bash scripts/check-version-bump.sh [base-spec-path]
#
# Exit codes:
#   0 - no content change, or content changed and info.version moved
#   1 - content changed but info.version did not move
#   2 - error (missing api.yaml, base spec unavailable and none provided, etc.)

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

if [[ ! -f "$PROJECT_ROOT/api.yaml" ]]; then
    echo -e "${red}Error: api.yaml not found at $PROJECT_ROOT/api.yaml${reset}"
    exit 2
fi

echo -e "\n${bold}Checking api.yaml content changes bump info.version${reset}"

# Get base spec -- same resolution order as check-breaking-changes.sh, so a
# local run and the CI job agree on what "base" means.
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

# Fast path: specs are identical byte-for-byte -- no content change, nothing
# to enforce, regardless of what info.version says on either side.
if diff -q "$TEMP_BASE" "$PROJECT_ROOT/api.yaml" > /dev/null 2>&1; then
    echo -e "\n${green}api.yaml is unchanged -- no version bump required.${reset}"
    exit 0
fi

# `|| true` on each: under `pipefail`, grep finding no match makes the whole
# pipeline (and, under `set -e`, the script) exit before the empty-version
# check below ever runs -- exactly the case a missing version line needs to
# hit.
BASE_VERSION="$(grep -m1 '^  version:' "$TEMP_BASE" | awk '{print $2}' || true)"
CURRENT_VERSION="$(grep -m1 '^  version:' "$PROJECT_ROOT/api.yaml" | awk '{print $2}' || true)"

if [[ -z "$BASE_VERSION" || -z "$CURRENT_VERSION" ]]; then
    echo -e "${red}Error: could not read info.version from base ('$BASE_VERSION') or current ('$CURRENT_VERSION') api.yaml.${reset}"
    exit 2
fi

if [[ "$BASE_VERSION" == "$CURRENT_VERSION" ]]; then
    echo -e "\n${red}api.yaml content changed but info.version is still $CURRENT_VERSION.${reset}"
    echo -e "${yellow}Bump info.version (line ~9) before merging:"
    echo "  - additive path/schema/field -> minor"
    echo -e "  - description/docs-only change -> patch${reset}"
    exit 1
fi

# Inequality alone is not enough: a rebase's ours/theirs inversion (the
# intuitive "keep mine" during a version-line conflict), or a partial revert,
# can restore an OLDER number over changed content -- re-publishing a version
# string already used for a different shape, the exact falsehood this gate
# exists to remove. Require strictly forward motion.
if ! printf '%s\n%s\n' "$BASE_VERSION" "$CURRENT_VERSION" | sort -V -C; then
    echo -e "\n${red}api.yaml content changed but info.version moved backwards ($BASE_VERSION -> $CURRENT_VERSION).${reset}"
    echo -e "${yellow}The new version must sort after the base's ($BASE_VERSION) -- a lower or reused number republishes an already-used identity for a different shape. If this is a rebase conflict resolution, take the higher version and raise it.${reset}"
    exit 1
fi

echo -e "\n${green}api.yaml content changed and info.version moved ($BASE_VERSION -> $CURRENT_VERSION).${reset}"
exit 0
