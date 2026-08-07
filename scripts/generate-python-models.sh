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
# that resolution problem structurally collapses: the spec is just
# "$PROJECT_DIR/api.yaml" for any caller that has this repo checked out --
# standalone, as a worktree, or as a sibling of a consumer repo. The download
# fallback below is kept for the remaining case: a caller that invokes this
# script without api.yaml sitting next to it (a vendored copy, a sparse
# checkout, or simply no local wxyc-shared checkout at all).
#
# The datamodel-code-generator version is pinned below in
# $DATAMODEL_CODEGEN_PIN -- this is "this repo's tooling" that #107 exists to
# centralize (previously LML pinned 0.56.1, request-o-matic pinned 0.57.0, and
# this repo pinned nothing). When `uv` is available this script runs the
# pinned version via `uvx`, ignoring whatever else happens to be on PATH or in
# a local venv, so the pin is authoritative rather than aspirational. Without
# `uv` it falls back to a local .venv or PATH-resolved `datamodel-codegen`
# (matching the old consumer scripts' resolution order) and warns loudly, but
# does not fail, if that binary's version doesn't match the pin.
#
# Do not add --strict-nullable here without reading CLAUDE.md's "Python
# codegen drops `nullable` on required fields" section and #302 first -- that
# flag has a measured, reviewed blast radius across both Python consumers (72
# changed field declarations, 36 widened / 36 narrowed) and is being added as
# its own deliberate change, not folded into this consolidation.
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
OUTPUT="$PROJECT_DIR/generated/python/models.py"

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
                 Default: generated/python/models.py
  -h, --help     Show this help and exit
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        --input)
            INPUT="${2:-}"
            shift 2
            ;;
        --output)
            OUTPUT="${2:-}"
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
    curl -sSfL "https://raw.githubusercontent.com/WXYC/wxyc-shared/main/api.yaml" -o "$API_YAML"
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
    # Authoritative path: the pin above is what runs, regardless of what else
    # is installed on PATH or in a local venv.
    run_codegen uvx --from "$DATAMODEL_CODEGEN_PIN" datamodel-codegen
else
    # Fallback for environments without uv, matching the old consumer
    # scripts' resolution order (prefer a local venv, then PATH). Not
    # guaranteed to be the pinned version -- warn instead of silently
    # generating a diff nobody asked for.
    CODEGEN="$PROJECT_DIR/.venv/bin/datamodel-codegen"
    if [[ ! -x "$CODEGEN" ]]; then
        CODEGEN="$(command -v datamodel-codegen 2>/dev/null || true)"
    fi
    if [[ -z "$CODEGEN" ]]; then
        echo "Error: neither uv nor datamodel-codegen was found." >&2
        echo "Install uv (https://docs.astral.sh/uv/), or install the pinned generator directly:" >&2
        echo "  pip install '$DATAMODEL_CODEGEN_PIN'" >&2
        exit 1
    fi
    RESOLVED_VERSION="$("$CODEGEN" --version 2>/dev/null || echo "unknown")"
    PINNED_VERSION="${DATAMODEL_CODEGEN_PIN##*==}"
    if [[ "$RESOLVED_VERSION" != *"$PINNED_VERSION"* ]]; then
        echo "Warning: $CODEGEN reports '$RESOLVED_VERSION', not the pinned $PINNED_VERSION." >&2
        echo "Output may not match other callers of this script. Install uv to always use the pin." >&2
    fi
    run_codegen "$CODEGEN"
fi

# Unlike datamodel-codegen, ruff version is deliberately NOT pinned here: a
# consumer's own .venv/PATH ruff wins when present (request-o-matic and LML
# intentionally run different ruff versions -- see request-o-matic's
# pyproject.toml). `uvx ruff` is a last resort, only to keep this step from
# silently no-op'ing on a bare runner that has uv but no ruff at all.
echo "Formatting generated code..."
RUFF="${PROJECT_DIR}/.venv/bin/ruff"
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
