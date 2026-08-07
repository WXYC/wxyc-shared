#!/usr/bin/env bash
#
# Generate Python Pydantic v2 models from api.yaml (this repo's OpenAPI spec).
#
# Canonical Python codegen script for the WXYC org (#107). It replaces the two
# near-identical copies of `scripts/generate_api_models.sh` that used to live
# in library-metadata-lookup and request-o-matic. Those scripts lived in the
# CONSUMER repo and had to locate api.yaml elsewhere -- a sibling wxyc-shared
# checkout (worktree-aware via `git rev-parse --git-common-dir`), or else a
# download from GitHub. This script lives IN wxyc-shared, next to api.yaml, so
# THAT HALF of the old resolution problem collapses: the spec is just
# "$PROJECT_DIR/api.yaml" once this script is running. The download fallback
# below is kept for the remaining case: a caller that invokes this script
# without api.yaml sitting next to it (a vendored copy, a sparse checkout, or
# simply no local wxyc-shared checkout at all).
#
# Locating THIS SCRIPT from a consumer repo is a separate problem this
# colocation does not solve, and worktrees make it the normal case, not an
# edge case: a caller's cwd is typically <consumer>/.worktrees/<branch>, from
# which a plain `../wxyc-shared` does not resolve to the sibling checkout.
# The worktree-safe invocation locates the consumer's own repo root first
# (which `git rev-parse --git-common-dir` reports correctly even from inside
# a linked worktree) and finds wxyc-shared relative to THAT, not to cwd:
#
#   WXYC_SHARED="$(dirname "$(git rev-parse --git-common-dir)")/../wxyc-shared"
#   bash "$WXYC_SHARED/scripts/generate-python-models.sh" --output generated/api_models.py
#
# See CLAUDE.md / README.md's Code Generation sections for the full migration
# instructions.
#
# The datamodel-code-generator version is pinned below in
# $DATAMODEL_CODEGEN_PIN -- this is "this repo's tooling" that #107 exists to
# centralize (previously LML pinned 0.56.1, request-o-matic pinned 0.57.0, and
# this repo pinned nothing). When `uv` is available this script runs that
# exact version, on a pinned interpreter (`uvx --python 3.12`), ignoring
# whatever else happens to be on PATH or in a local venv. That pin is NOT a
# full lockfile, though: black, isort, and pydantic are pulled in
# transitively and left to float, and 0.56.1 still formats via black+isort by
# default. A transitive release that changes formatting output can still
# produce a different diff on two machines that both honor this pin -- "the
# generator version and interpreter are pinned" is the accurate claim, not
# "output is guaranteed byte-identical everywhere." Without `uv` this script
# falls back to a local .venv or PATH-resolved `datamodel-codegen` (matching
# the old consumer scripts' resolution order) and warns loudly, but does not
# fail, if that binary's version doesn't match the pin.
#
# --strict-nullable (#302): a required + nullable property must generate as
# `X | None` while STAYING required (no default) -- without the flag the
# documented null (e.g. BulkResolveTrackIdentity.resolved_artist_name) is
# inexpressible through the generated model. The side effect is deliberate
# and measured (72 changed field declarations across both Python consumers:
# 36 widened, 36 narrowed): optional NON-nullable properties stop generating
# as Optional, so explicitly passing None to them raises ValidationError.
# Each consumer audits its call sites as part of its own regen PR before
# adopting the regenerated output -- see CLAUDE.md's "Python codegen and
# `nullable` on required fields" section.
#
# The .venv/PATH fallback (used when `uv` isn't available) finds a caller's
# venv by walking up from the invocation directory ($(pwd)), nearest match
# wins -- not by jumping straight to a git-derived "repo root", and not this
# script's own location ($PROJECT_DIR, always wxyc-shared). This script
# lives in wxyc-shared, but it is invoked from somewhere inside a consumer
# repo -- resolving against wxyc-shared's own checkout would never find a
# consumer's venv, and resolving against plain $(pwd) alone only works when
# the caller happens to invoke this script from the exact directory holding
# the venv: a cd-ing Makefile recipe, or a CI step with `working-directory:`
# set to a subdirectory, would silently miss a venv that is really there,
# one level up (#311). Jumping straight to a git-derived repo root has its
# own miss: the standard Python monorepo layout puts `.venv` beside a
# subdirectory's own `pyproject.toml` (e.g. `apps/backend/.venv`), not at
# the repo root, and jumping past $(pwd) straight to the root would skip
# exactly that (a regression an earlier version of this fix introduced --
# see the "regression pinned by code review" bats test). Walking up one
# directory at a time, nearest match wins, is a superset of both: it finds
# `.venv` beside the invocation directory, at any ancestor including a
# consumer's repo root, and at a linked worktree's own root -- without
# shelling out to git at all, so it works the same whether or not git is
# installed and is not confused by `GIT_DIR`/`GIT_WORK_TREE` set by an
# enclosing git hook or `git rebase -x`.
#
# Usage:
#   scripts/generate-python-models.sh [--input PATH] [--output PATH]
#
#   --input PATH   Path to api.yaml. Default: PROJECT_DIR/api.yaml, falling
#                  back to downloading
#                  raw.githubusercontent.com/WXYC/wxyc-shared/main/api.yaml
#                  when that file doesn't exist.
#   --output PATH  Where to write the generated models. Downstream consumers
#                  should pass their own repo's path, e.g.
#                  --output generated/api_models.py. Default:
#                  generated/python/models.py (this repo's own reference
#                  tree -- gitignored, consumed by nobody; see CLAUDE.md).
#   -h, --help     Show this help and exit.

set -euo pipefail

DATAMODEL_CODEGEN_PIN="datamodel-code-generator[http]==0.56.1"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Find a caller's venv binary by walking up from the invocation directory.
# Handles every layout that matters: .venv beside a subdirectory's own
# pyproject.toml, .venv at the consumer's repo root, and .venv at a linked
# worktree's root -- without depending on git being installed or on
# GIT_DIR/GIT_WORK_TREE being unset (#311).
find_caller_venv_bin() {
    local name="$1" dir
    dir="$PWD"
    while [[ -n "$dir" && "$dir" != "/" ]]; do
        if [[ -x "$dir/.venv/bin/$name" ]]; then
            printf '%s\n' "$dir/.venv/bin/$name"
            return 0
        fi
        dir="$(dirname "$dir")"
    done
    [[ -x "/.venv/bin/$name" ]] && { printf '%s\n' "/.venv/bin/$name"; return 0; }
    return 1
}

INPUT=""
DEFAULT_OUTPUT="$PROJECT_DIR/generated/python/models.py"
OUTPUT="$DEFAULT_OUTPUT"

usage() {
    cat <<EOF
Usage: generate-python-models.sh [--input PATH] [--output PATH]

Generate Python Pydantic v2 models from api.yaml, using
datamodel-code-generator pinned to $DATAMODEL_CODEGEN_PIN.

  --input PATH   Path to api.yaml (default: $PROJECT_DIR/api.yaml; downloads
                 from GitHub if that file doesn't exist)
  --output PATH  Where to write the generated models. Downstream consumers
                 should pass their own repo's path, e.g.
                 --output generated/api_models.py.
                 Default: $DEFAULT_OUTPUT
                 (this repo's own reference tree -- a caller almost always
                 wants to pass --output explicitly)
  -h, --help     Show this help and exit
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input)
            # A missing value (`--input` as the last arg) would make `shift 2`
            # fail under `set -euo pipefail` before printing anything; an
            # empty value (`--input ""`) is indistinguishable from "not
            # passed" once assigned, and would silently fall back to this
            # repo's own api.yaml instead of the caller's intended spec. Both
            # are caller bugs -- fail loudly instead of guessing.
            if [[ $# -lt 2 || -z "${2:-}" ]]; then
                echo "Error: --input requires a non-empty value." >&2
                usage >&2
                exit 2
            fi
            INPUT="$2"
            shift 2
            ;;
        --output)
            if [[ $# -lt 2 || -z "${2:-}" ]]; then
                echo "Error: --output requires a non-empty value." >&2
                usage >&2
                exit 2
            fi
            OUTPUT="$2"
            shift 2
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            echo "Unknown argument: $1" >&2
            usage >&2
            exit 2
            ;;
    esac
done

# Resolve api.yaml.
if [[ -n "$INPUT" ]]; then
    API_YAML="$INPUT"
    if [[ ! -f "$API_YAML" ]]; then
        echo "Error: --input path does not exist: $API_YAML" >&2
        exit 2
    fi
elif [[ -f "$PROJECT_DIR/api.yaml" ]]; then
    API_YAML="$PROJECT_DIR/api.yaml"
else
    API_YAML="$(mktemp)"
    trap 'rm -f "$API_YAML"' EXIT
    echo "api.yaml not found at $PROJECT_DIR/api.yaml -- downloading from GitHub..." >&2
    curl -sSfL --max-time 30 --retry 3 "https://raw.githubusercontent.com/WXYC/wxyc-shared/main/api.yaml" -o "$API_YAML"
fi
echo "Using api.yaml: $API_YAML"

mkdir -p "$(dirname "$OUTPUT")"

HEADER="# Generated from wxyc-shared/api.yaml -- do not edit manually.
# Regenerate with the shared codegen script: https://github.com/WXYC/wxyc-shared/blob/main/scripts/generate-python-models.sh"

run_codegen() {
    "$@" \
        --input "$API_YAML" \
        --input-file-type openapi \
        --output "$OUTPUT" \
        --output-model-type pydantic_v2.BaseModel \
        --target-python-version 3.12 \
        --use-standard-collections \
        --use-union-operator \
        --strict-nullable \
        --disable-timestamp \
        --custom-file-header "$HEADER"
}

echo "Generating Python models..."
if command -v uv &> /dev/null; then
    # Authoritative path: the datamodel-code-generator version and the
    # interpreter that runs it are pinned, regardless of what else is
    # installed on PATH or in a local venv. This is NOT a full lockfile --
    # black, isort, and pydantic (all pulled in transitively) are left to
    # float, and 0.56.1 still formats via black+isort by default (it emits a
    # FutureWarning saying so). A dependency release that changes formatting
    # output can still produce a different diff on two machines that both
    # honor this pin. Pinning those transitively is out of scope here; this
    # is what "authoritative" actually covers today.
    run_codegen uvx --python 3.12 --from "$DATAMODEL_CODEGEN_PIN" datamodel-codegen
else
    # Fallback for environments without uv, matching the old consumer
    # scripts' resolution order (prefer a local venv, then PATH). Not
    # guaranteed to be the pinned version -- warn instead of silently
    # generating a diff nobody asked for.
    #
    # find_caller_venv_bin walks up from $(pwd), not $PROJECT_DIR (this
    # script's own wxyc-shared checkout) -- a consumer invokes this script
    # from somewhere inside their own repo, and their venv could be right
    # there, at an ancestor, or at a linked worktree's root.
    CODEGEN="$(find_caller_venv_bin datamodel-codegen || true)"
    if [[ -z "$CODEGEN" ]]; then
        CODEGEN="$(command -v datamodel-codegen 2>/dev/null || true)"
        if [[ -n "$CODEGEN" ]]; then
            # Distinguish "no venv above $(pwd)" from "wrong generator
            # version, silently" -- both used to look identical to the
            # caller once this PATH lookup ran. Only fires once a PATH
            # fallback actually turned something up; the "neither uv nor
            # datamodel-codegen was found" error below already covers the
            # case where nothing did.
            echo "No .venv found above $(pwd) -- falling back to PATH-resolved datamodel-codegen ($CODEGEN)." >&2
        fi
    fi
    if [[ -z "$CODEGEN" ]]; then
        echo "Error: neither uv nor datamodel-codegen was found." >&2
        echo "Install uv (https://docs.astral.sh/uv/), or install the pinned generator directly:" >&2
        echo "  pip install '$DATAMODEL_CODEGEN_PIN'" >&2
        exit 1
    fi
    RAW_VERSION_OUTPUT="$("$CODEGEN" --version 2>/dev/null || echo "unknown")"
    # `datamodel-codegen --version` prints "datamodel-codegen X.Y.Z" -- pull
    # out just the version token so the comparison below is exact, not a
    # substring test (0.56.1 is a substring of 0.56.10, which is not a match).
    RESOLVED_VERSION="$(grep -oE '[0-9]+\.[0-9]+\.[0-9]+' <<< "$RAW_VERSION_OUTPUT" | head -1)"
    PINNED_VERSION="${DATAMODEL_CODEGEN_PIN##*==}"
    if [[ "$RESOLVED_VERSION" != "$PINNED_VERSION" ]]; then
        echo "Warning: $CODEGEN reports '$RAW_VERSION_OUTPUT', not the pinned $PINNED_VERSION." >&2
        echo "Output may not match other callers of this script. Install uv to always use the pin." >&2
    fi
    run_codegen "$CODEGEN"
fi

# Unlike datamodel-codegen, ruff version is deliberately NOT pinned here: a
# consumer's own .venv/PATH ruff wins when present (request-o-matic and LML
# intentionally run different ruff versions -- see request-o-matic's
# pyproject.toml). `uvx ruff` is a last resort, only to keep this step from
# silently no-op'ing on a bare runner that has uv but no ruff at all.
#
# Like the datamodel-codegen fallback above, this uses find_caller_venv_bin
# (walking up from $(pwd)), not $PROJECT_DIR -- otherwise "a consumer's own
# .venv wins" would be false whenever this script runs from a subdirectory
# (which is always possible, since it lives in wxyc-shared and callers
# invoke it from somewhere inside their own repo).
echo "Formatting generated code..."
RUFF="$(find_caller_venv_bin ruff || true)"
if [[ -z "$RUFF" ]]; then
    RUFF="$(command -v ruff 2>/dev/null || true)"
fi
if [[ -n "$RUFF" ]]; then
    "$RUFF" format "$OUTPUT" 2>/dev/null || true
    "$RUFF" check --fix "$OUTPUT" 2>/dev/null || true
elif command -v uv &> /dev/null; then
    uvx ruff format "$OUTPUT" 2>/dev/null || true
    uvx ruff check --fix "$OUTPUT" 2>/dev/null || true
else
    echo "ruff not found (no venv, no PATH, no uv) -- skipping formatting." >&2
fi

echo "Generated: $OUTPUT"
