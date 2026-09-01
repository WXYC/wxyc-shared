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
#   scripts/generate-python-models.sh [--input PATH] [--output PATH] [--ref REF]
#
#   --input PATH   Path to api.yaml. Default: PROJECT_DIR/api.yaml, falling
#                  back to downloading
#                  raw.githubusercontent.com/WXYC/wxyc-shared/<ref>/api.yaml
#                  when that file doesn't exist (see --ref).
#   --output PATH  Where to write the generated models. Downstream consumers
#                  should pass their own repo's path, e.g.
#                  --output generated/api_models.py. Default:
#                  generated/python/models.py (this repo's own reference
#                  tree -- gitignored, consumed by nobody; see CLAUDE.md).
#   --ref REF      Git ref (commit SHA, branch, or tag) of wxyc-shared to
#                  download api.yaml from, when the download fallback is
#                  actually taken (see --input above). Also settable via the
#                  WXYC_SHARED_REF environment variable; --ref wins if both
#                  are given. Ignored whenever --input is given or a local
#                  PROJECT_DIR/api.yaml is found -- see #319.
#
#                  PREFER A COMMIT SHA. Tags in this repo are not immutable
#                  by policy -- gha/v1 is a deliberately MOVING major tag
#                  (see CLAUDE.md's Tag Stability Policy) -- so a SHA is the
#                  only ref that actually pins. A branch name (including the
#                  default, unpinned "main") is exactly the moving target
#                  this flag exists to let a caller opt out of.
#
#                  Leaving this unset is still permitted -- erroring by
#                  default would break every existing unpinned caller with
#                  no migration path -- but the download then targets
#                  wxyc-shared's main branch and prints a loud warning
#                  instead of downloading silently, because an unpinned
#                  fetch is exactly the failure mode #319 describes: an
#                  api.yaml merge here can change a caller's CI input with
#                  no commit in the caller's repo and no signal to anyone.
#                  CI callers should always pass --ref.
#   -h, --help     Show this help and exit.

set -euo pipefail

DATAMODEL_CODEGEN_PIN="datamodel-code-generator[http]==0.56.1"

# #428: these five streaming URL fields carry pre-existing malformed/
# wrong-shaped stored values (WXYC/Backend-Service#1710). api.yaml annotates
# them with `format: uri` for documentation, but datamodel-code-generator's
# default mapping for `type: string, format: uri` is pydantic's `AnyUrl`
# (confirmed against 0.56.1, this script's pin), which validates AT
# CONSTRUCTION -- a naive Python regen would turn already-persisted
# malformed rows into hard decode failures the first time LML or
# request-o-matic loads one, exactly the outcome #428's acceptance criteria
# rules out. Every other consumer (TypeScript, Swift, Kotlin) treats
# `format: uri` as documentation-only; this list is what makes Python match
# them -- see pin_streaming_url_fields_to_str() below for how.
STREAMING_URL_FIELDS=(
    spotify_url
    apple_music_url
    youtube_music_url
    bandcamp_url
    soundcloud_url
)

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
REF=""
DEFAULT_OUTPUT="$PROJECT_DIR/generated/python/models.py"
OUTPUT="$DEFAULT_OUTPUT"

usage() {
    cat <<EOF
Usage: generate-python-models.sh [--input PATH] [--output PATH] [--ref REF]

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
  --ref REF      Git ref (SHA, branch, or tag) of wxyc-shared to download
                 api.yaml from, when the download fallback is taken.
                 Also settable via the WXYC_SHARED_REF env var (--ref wins
                 if both are given). Prefer a commit SHA -- tags here are
                 not immutable (gha/v1 moves) so only a SHA truly pins.
                 Ignored when --input is given or a local api.yaml is found.
                 Default: unpinned (downloads from wxyc-shared's main branch
                 and prints a loud warning -- CI callers should always pass
                 this; see #319).
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
        --ref)
            # Same fail-loud-not-silently-fallback reasoning as --input and
            # --output above: an empty --ref would otherwise be
            # indistinguishable from "not passed" and silently resolve to
            # the unpinned default, which is the one thing this flag exists
            # to let a caller opt out of.
            if [[ $# -lt 2 || -z "${2:-}" ]]; then
                echo "Error: --ref requires a non-empty value." >&2
                usage >&2
                exit 2
            fi
            REF="$2"
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

# Resolve the ref used ONLY by the GitHub download fallback below (#319).
# --ref wins over WXYC_SHARED_REF; neither given falls back to wxyc-shared's
# main branch, which is unpinned -- see the warning printed when the
# download path is actually taken. This has no effect at all when --input
# is given or a local PROJECT_DIR/api.yaml is found, since neither of those
# paths downloads anything.
REF_WAS_PINNED=0
if [[ -n "$REF" ]]; then
    RESOLVED_REF="$REF"
    REF_WAS_PINNED=1
elif [[ -n "${WXYC_SHARED_REF:-}" ]]; then
    RESOLVED_REF="$WXYC_SHARED_REF"
    REF_WAS_PINNED=1
else
    RESOLVED_REF="main"
fi

# Resolve api.yaml.
if [[ -n "$INPUT" ]]; then
    API_YAML="$INPUT"
    if [[ ! -f "$API_YAML" ]]; then
        echo "Error: --input path does not exist: $API_YAML" >&2
        exit 2
    fi
    if [[ "$REF_WAS_PINNED" -eq 1 ]]; then
        echo "Note: --ref/WXYC_SHARED_REF ($RESOLVED_REF) is ignored -- --input was given, so nothing is downloaded." >&2
    fi
elif [[ -f "$PROJECT_DIR/api.yaml" ]]; then
    API_YAML="$PROJECT_DIR/api.yaml"
    if [[ "$REF_WAS_PINNED" -eq 1 ]]; then
        echo "Note: --ref/WXYC_SHARED_REF ($RESOLVED_REF) is ignored -- a local api.yaml was found at $PROJECT_DIR/api.yaml, so nothing is downloaded." >&2
    fi
else
    API_YAML="$(mktemp)"
    trap 'rm -f "$API_YAML"' EXIT
    if [[ "$REF_WAS_PINNED" -eq 0 ]]; then
        # #319: this is the silent-drift failure mode. An api.yaml merge to
        # wxyc-shared's main can change what THIS run downloads relative to
        # the last run, with no commit in the caller's repo and no signal to
        # anyone -- exactly the bug this flag exists to let a caller opt out
        # of. Loud by design; CI use should always pass --ref.
        cat >&2 <<EOF
Warning: api.yaml not found at $PROJECT_DIR/api.yaml -- downloading from wxyc-shared's main branch, an unpinned, moving target.
This means the spec used by this run can differ from the last run with no code change on your side. CI callers should pass --ref <commit-sha> (or set WXYC_SHARED_REF) to pin a specific wxyc-shared commit -- not a branch, and in this repo not even a tag: gha/v1-style tags are explicitly allowed to move (see CLAUDE.md's Tag Stability Policy). Find a SHA at https://github.com/WXYC/wxyc-shared/commits/main/api.yaml. See WXYC/wxyc-shared#319.
EOF
    fi
    echo "api.yaml not found at $PROJECT_DIR/api.yaml -- downloading from GitHub ($RESOLVED_REF)..." >&2
    curl -sSfL --max-time 30 --retry 3 "https://raw.githubusercontent.com/WXYC/wxyc-shared/${RESOLVED_REF}/api.yaml" -o "$API_YAML"
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

# #428: force STREAMING_URL_FIELDS to stay `str`, undoing datamodel-codegen's
# default `format: uri` -> `AnyUrl` mapping for exactly those five fields.
#
# This is a post-generation substitution, not a codegen flag, because
# 0.56.1 has no per-field override for format-derived types. Two flags look
# like they should do this and don't:
#
#   --type-mappings 'string+uri=string'   -- documented as format-scoped,
#       but format is document-wide: it retargets EVERY `format: uri`
#       field in the spec, not just the ones this pin cares about.
#   --type-overrides '{"Model.field": "builtins.str"}' -- documented as
#       "Scoped: ... replaces specific field only", but verified empirically
#       (2026-08-31, against 0.56.1) that this is false for format-derived
#       types: overriding StreamingLinks.spotify_url alone also flipped the
#       unrelated DeviceCodeResponse.verification_uri to `str`. The "scoped"
#       claim in --help does not hold for this case.
#
# Both flags are file-wide once ANY override targets `format: uri`, which
# would also repoint the archive presigned-GET `url` and the OAuth
# device-flow `verification_uri`/`verification_uri_complete` fields --
# none of which are in scope for #428's decision, and none of which share
# the malformed-stored-data problem that motivates this pin. A regex
# substitution scoped to the five known field names is the only mechanism
# available that matches the decision's actual scope.
#
# Safe against the generated file's several shapes (required vs. optional,
# with vs. without a Field(...) default, nullable or not) because all of
# them put the type token immediately after "fieldname: " on one line --
# matching up to "AnyUrl" and rewriting only that token leaves the rest
# (| None, Field(...), descriptions) untouched. Any of the fields ending up
# as the ONLY use of AnyUrl in the file leaves an unused `from pydantic
# import AnyUrl` behind; the ruff check --fix step that already runs after
# this (below) removes it, so no import bookkeeping is needed here.
#
# This is NAME-keyed, not schema-scoped: the sed matches "fieldname: AnyUrl"
# wherever that field name appears in the generated file, with no notion of
# which class (schema) it belongs to. If a future api.yaml schema unrelated
# to #428 ever declares its own field literally named e.g. `spotify_url`
# with `format: uri` and genuinely wants pydantic's AnyUrl validation, this
# pin silently downgrades that field to `str` too -- there is no per-schema
# guard to stop it. Accepted rather than fixed: the five names #428 pins
# are specific enough (`spotify_url`, `apple_music_url`,
# `youtube_music_url`, `bandcamp_url`, `soundcloud_url`) that a genuine
# collision is unlikely, and closing this would mean parsing the generated
# file's class structure instead of a flat text substitution -- real cost
# for a hypothetical this specific. verify_streaming_url_fields_pinned()
# below catches the pin failing to apply where it SHOULD; it cannot catch
# the pin over-applying to a field where it SHOULDN'T, because from the
# field name alone the two cases look identical.
pin_streaming_url_fields_to_str() {
    local field
    for field in "${STREAMING_URL_FIELDS[@]}"; do
        sed -E "s/^([[:space:]]*${field}: )AnyUrl/\1str/" "$OUTPUT" > "$OUTPUT.pin-tmp"
        mv "$OUTPUT.pin-tmp" "$OUTPUT"
    done
}

# #428 (bounced-PR escalation): pin_streaming_url_fields_to_str's sed is
# line-anchored on "fieldname: AnyUrl" appearing on one line, which is only
# ONE of the shapes datamodel-codegen can emit for a `format: uri` field. Add
# --use-annotated to run_codegen (not done today, but verified empirically
# against both the pinned 0.56.1 and 0.76.0) and a field with a description
# -- which is exactly what #428 gives all five of these -- generates instead
# as:
#
#   fieldname: Annotated[
#       AnyUrl | None,
#       Field(description="..."),
#   ]
#
# The sed above never matches that shape: "fieldname: " is followed by
# "Annotated[", not "AnyUrl", so all five substitutions silently no-op and
# pin_streaming_url_fields_to_str returns 0 regardless. That is the pin
# failing OPEN -- the exact regression this function exists to catch, and
# the reason it can't itself be another line-anchored regex (a second
# sed pattern only widens the set of shapes covered today; it does not
# close the class of "some future shape neither pattern anticipated").
#
# The check is therefore AST-level, not textual: parse $OUTPUT as Python,
# walk every class body's AnnAssign nodes, and for each of
# STREAMING_URL_FIELDS confirm "AnyUrl" does not appear anywhere in the
# unparsed annotation source. That catches `AnyUrl`, `AnyUrl | None`, and
# `Annotated[AnyUrl | None, Field(...)]` alike -- and any future shape,
# because it asks "is AnyUrl present in this field's annotation at all"
# rather than "does the annotation look like shape X". The three unrelated
# `format: uri` fields (the archive presigned-GET `url`, the OAuth
# device-flow `verification_uri`/`verification_uri_complete`) are not in
# STREAMING_URL_FIELDS, so they are untouched by this check and free to keep
# AnyUrl -- exactly the pin's intended scope.
#
# Needs a Python interpreter to run the AST walk. If codegen ran at all,
# one exists somewhere -- via `uv` (the authoritative path above) or via
# whatever installed datamodel-codegen on PATH in the fallback path -- so
# this tries python3/python first and falls back to `uv run` only if
# neither is on PATH.
verify_streaming_url_fields_pinned() {
    local python_cmd=()
    if command -v python3 &> /dev/null; then
        python_cmd=(python3)
    elif command -v python &> /dev/null; then
        python_cmd=(python)
    elif command -v uv &> /dev/null; then
        python_cmd=(uv run --no-project --python 3.12 python3)
    else
        echo "Error: no Python interpreter found to verify the #428 pin (need python3, python, or uv)." >&2
        exit 1
    fi

    STREAMING_URL_FIELDS_CSV="$(IFS=,; echo "${STREAMING_URL_FIELDS[*]}")" OUTPUT="$OUTPUT" \
        "${python_cmd[@]}" -c '
import ast
import os
import sys

output_path = os.environ["OUTPUT"]
fields = set(os.environ["STREAMING_URL_FIELDS_CSV"].split(","))

with open(output_path, "r", encoding="utf-8") as f:
    source = f.read()

tree = ast.parse(source, filename=output_path)
offenders = []
for node in ast.walk(tree):
    if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
        if node.target.id in fields:
            annotation_src = ast.unparse(node.annotation)
            if "AnyUrl" in annotation_src:
                offenders.append(f"{node.target.id} (line {node.lineno}): {annotation_src}")

if offenders:
    sys.stderr.write(
        "#428 pin did not apply -- the following streaming URL fields still "
        "carry AnyUrl in their generated annotation (pin_streaming_url_fields_to_str "
        "silently no-op'\''d, most likely because the generator emitted a shape its "
        "sed pattern does not match):\n"
    )
    for offender in offenders:
        sys.stderr.write(f"  - {offender}\n")
    sys.exit(1)
'
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

echo "Pinning streaming URL fields to str (#428)..."
pin_streaming_url_fields_to_str
verify_streaming_url_fields_pinned

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
