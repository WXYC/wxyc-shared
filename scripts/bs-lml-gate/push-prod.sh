#!/usr/bin/env bash
#
# push-prod.sh — advance a repo's `prod` branch to a target SHA.
#
# Uses the GitHub API (refs PATCH / POST) rather than a local clone so
# the self-hosted runner stays clean. Authentication is via a
# fine-grained PAT scoped to `Contents: write` on the `prod` ref of
# the target repo only.
#
# Env:
#   PUSH_REPO        — required, e.g. WXYC/Backend-Service
#   PUSH_TARGET_SHA  — required, 40-char hex
#   PUSH_CURRENT_SHA — required, "" means seed (no prod branch yet)
#   PUSH_PAT         — required, fine-grained PAT
#   PUSH_DRY_RUN     — optional, "1" prints the planned API call
#
# Exit:
#   0 — push succeeded OR no-op (target == current)
#   1 — push failed
#   2 — usage error
#
# Requires: gh.

set -uo pipefail

REPO="${PUSH_REPO:-}"
TARGET="${PUSH_TARGET_SHA:-}"
CURRENT="${PUSH_CURRENT_SHA-__UNSET__}"
PAT="${PUSH_PAT:-}"
DRY_RUN="${PUSH_DRY_RUN:-0}"

if [[ -z "$REPO" || -z "$TARGET" || "$CURRENT" == "__UNSET__" || -z "$PAT" ]]; then
    echo "push-prod: PUSH_REPO, PUSH_TARGET_SHA, PUSH_CURRENT_SHA, PUSH_PAT are required" >&2
    exit 2
fi

if ! [[ "$TARGET" =~ ^[0-9a-f]{40}$ ]]; then
    echo "push-prod: PUSH_TARGET_SHA is not a 40-char hex sha: '$TARGET'" >&2
    exit 2
fi

if [[ -n "$CURRENT" ]] && ! [[ "$CURRENT" =~ ^[0-9a-f]{40}$ ]]; then
    echo "push-prod: PUSH_CURRENT_SHA is not a 40-char hex sha: '$CURRENT'" >&2
    exit 2
fi

if [[ "$TARGET" == "$CURRENT" ]]; then
    echo "push-prod: $REPO prod already at $TARGET (no-op)"
    exit 0
fi

# Decide PATCH vs POST. Seed (no prod yet) = POST /git/refs with ref=refs/heads/prod.
# Fast-forward = PATCH /git/refs/heads/prod with sha=TARGET.
if [[ -z "$CURRENT" ]]; then
    method="POST"
    path="repos/${REPO}/git/refs"
    fields=( -f "ref=refs/heads/prod" -f "sha=${TARGET}" )
else
    method="PATCH"
    path="repos/${REPO}/git/refs/heads/prod"
    fields=( -f "sha=${TARGET}" )
fi

if [[ "$DRY_RUN" == "1" ]]; then
    echo "push-prod: DRY_RUN $method $path sha=$TARGET (repo=$REPO from=${CURRENT:-<seed>})"
    exit 0
fi

# Pass the PAT via env to gh so it never appears on argv (would otherwise
# show in `ps`). `gh` reads $GH_TOKEN before $GITHUB_TOKEN.
if ! GH_TOKEN="$PAT" gh api -X "$method" "$path" "${fields[@]}" --silent; then
    echo "push-prod: $method $path failed" >&2
    exit 1
fi

echo "push-prod: $REPO prod -> $TARGET (${method})"
exit 0
