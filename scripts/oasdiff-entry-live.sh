#!/usr/bin/env bash

# Sourced by prune-oasdiff-ignore.sh and check-added-oasdiff-ignores.sh.
#
# Liveness is decided by oasdiff itself, so the matcher and its callers can never
# disagree (oasdiff ignores case and accepts extra text on the line, which a
# substring test does not). An entry is live when oasdiff run with only that
# entry as --err-ignore reports something different from the raw run, i.e. the
# entry suppresses a finding. Not --fail-on: any non-zero exit is then a tool or
# input problem.
#
# oasdiff_entry_is_live <base-spec> <revision-spec> <raw-output-file> <entry> <scratch-dir>
#   0 - live, 1 - suppresses nothing, 2 - oasdiff could not complete
oasdiff_entry_is_live() {
    local base="$1" revision="$2" raw="$3" entry="$4" scratch="$5"
    printf '%s\n' "$entry" > "$scratch/one.txt"
    oasdiff breaking "$base" "$revision" --err-ignore "$scratch/one.txt" > "$scratch/one-out.txt" || return 2
    ! cmp -s "$raw" "$scratch/one-out.txt"
}
