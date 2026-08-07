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
# Do not add --strict-nullable here without reading CLAUDE.md's "Python
# codegen drops `nullable` on required fields" section and #302 first -- that
# flag has a measured, reviewed blast radius across both Python consumers (72
# changed field declarations, 36 widened / 36 narrowed) and is being added as
# its own deliberate change, not folded into this consolidation.
#
# The .venv/PATH fallback (used when `uv` isn't available) resolves against
# the CALLER's current directory, not this script's own location. This
# script lives in wxyc-shared, but it is invoked from a consumer repo's root
# (or a worktree of it) -- resolving against wxyc-shared's own checkout would
# never find a consumer's venv.
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
    # Resolved against the CALLER's cwd ("$(pwd)"), not $PROJECT_DIR (this
    # script's own wxyc-shared checkout) -- a consumer invokes this script
    # from their own repo root, so that's where their venv lives.
    CODEGEN="$(pwd)/.venv/bin/datamodel-codegen"
    if [[ ! -x "$CODEGEN" ]]; then
        CODEGEN="$(command -v datamodel-codegen 2>/dev/null || true)"
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
# Like the datamodel-codegen fallback above, this is resolved against the
# CALLER's cwd, not $PROJECT_DIR -- otherwise "a consumer's own .venv wins"
# would be false whenever this script runs (which is always, since it lives
# in wxyc-shared and callers invoke it from their own repo).
echo "Formatting generated code..."
RUFF="$(pwd)/.venv/bin/ruff"
if [[ ! -x "$RUFF" ]]; then
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
