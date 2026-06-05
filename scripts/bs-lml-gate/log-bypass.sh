#!/usr/bin/env bash
#
# log-bypass.sh — append an audit comment to the gate-bypasses tracker
# issue.
#
# Invariant: the workflow MUST NOT advance prod via the bypass path if
# this script fails. The audit append is the only record of a manual
# promotion, so failing-open here would be a silent bypass.
#
# Env (all required unless noted):
#   BYPASS_REPO           — e.g. WXYC/wxyc-shared
#   BYPASS_ISSUE_NUMBER   — integer
#   BYPASS_ACTOR          — github.actor
#   BYPASS_JUSTIFICATION  — non-empty
#   BYPASS_BS_SHA         — Backend-Service main SHA being promoted
#   BYPASS_LML_SHA        — library-metadata-lookup main SHA being promoted
#   BYPASS_RUN_URL        — link to the GHA run
#   BYPASS_WHEN           — optional ISO timestamp; defaults to now (UTC)
#
# Exit:
#   0 — comment posted
#   1 — gh api failed
#   2 — usage error

set -uo pipefail

REPO="${BYPASS_REPO:-}"
ISSUE="${BYPASS_ISSUE_NUMBER:-}"
ACTOR="${BYPASS_ACTOR:-}"
JUSTIFICATION="${BYPASS_JUSTIFICATION:-}"
BS_SHA="${BYPASS_BS_SHA:-}"
LML_SHA="${BYPASS_LML_SHA:-}"
RUN_URL="${BYPASS_RUN_URL:-}"
WHEN="${BYPASS_WHEN:-$(date -u +%Y-%m-%dT%H:%M:%SZ)}"

for var in REPO ISSUE ACTOR JUSTIFICATION BS_SHA LML_SHA RUN_URL; do
    if [[ -z "${!var}" ]]; then
        echo "log-bypass: BYPASS_${var} is required (no silent bypasses)" >&2
        exit 2
    fi
done

body_file="$(mktemp)"
trap 'rm -f "$body_file"' EXIT

# Plain markdown — the tracker issue is a long-lived pinned issue so
# comments append naturally. Keep this format stable; runbook may grep it.
cat >"$body_file" <<EOF
## Gate bypass — ${WHEN}

- **Actor:** @${ACTOR}
- **Run:** ${RUN_URL}
- **Backend-Service SHA promoted:** \`${BS_SHA}\`
- **library-metadata-lookup SHA promoted:** \`${LML_SHA}\`

**Justification**

${JUSTIFICATION}
EOF

if ! gh api -X POST "repos/${REPO}/issues/${ISSUE}/comments" \
    -F "body=@${body_file}" --silent; then
    echo "log-bypass: failed to append comment to ${REPO}#${ISSUE}" >&2
    exit 1
fi

echo "log-bypass: appended bypass audit to ${REPO}#${ISSUE}"
exit 0
