#!/usr/bin/env bash
#
# WXYC Development Environment Teardown
#
# Kills all WXYC-related node processes and Docker containers left behind by
# setup-dev-environment.sh. Safe to run at any time — only targets processes in
# known WXYC directories and Docker containers from the dev_env compose file.
#
# Usage: ./teardown-dev-environment.sh [OPTIONS]
#
# Options:
#   --dry-run   Show what would be killed without actually killing anything
#   --help      Show this help message

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[OK]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

DRY_RUN=false

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WXYC_DEV_ROOT="${WXYC_DEV_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
STATE_FILE="$WXYC_DEV_ROOT/.wxyc-dev-pids"

show_help() {
    cat << 'EOF'
WXYC Development Environment Teardown

Kills all WXYC-related node processes and Docker containers from the dev
environment. Targets only processes whose working directory is inside the
WXYC dev root.

Usage: teardown-dev-environment.sh [OPTIONS]

Options:
  --dry-run   Show what would be killed without doing it
  --help      Show this help message

Environment Variables:
  WXYC_DEV_ROOT   WXYC repositories directory (default: auto-detected)

EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run) DRY_RUN=true; shift ;;
        --help|-h) show_help; exit 0 ;;
        *) log_error "Unknown option: $1"; show_help; exit 1 ;;
    esac
done

killed=0

# 1. Kill processes saved in the state file from setup-dev-environment.sh
if [[ -f "$STATE_FILE" ]]; then
    log_info "Reading state file: $STATE_FILE"
    source "$STATE_FILE"
    for var in prev_backend_pid prev_frontend_pid; do
        pid="${!var:-}"
        if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
            if [[ "$DRY_RUN" == true ]]; then
                log_warn "Would kill $var (PID $pid)"
            else
                log_info "Killing $var (PID $pid)..."
                pkill -P "$pid" 2>/dev/null || true
                kill "$pid" 2>/dev/null || true
                killed=$((killed + 1))
            fi
        fi
    done
    if [[ "$DRY_RUN" != true ]]; then
        rm -f "$STATE_FILE"
    fi
fi

# 2. Find and kill node processes whose cwd is inside WXYC_DEV_ROOT
log_info "Scanning for node processes in $WXYC_DEV_ROOT..."
while IFS= read -r line; do
    pid=$(echo "$line" | awk '{print $2}')
    # Resolve the process's working directory
    cwd=$(lsof -p "$pid" -Fn 2>/dev/null | grep '^n/' | grep '^n'"$WXYC_DEV_ROOT" | head -1 || true)
    if [[ -z "$cwd" ]]; then
        # Fallback: check the command line for WXYC paths
        cmdline=$(ps -p "$pid" -o command= 2>/dev/null || true)
        if [[ "$cmdline" != *"$WXYC_DEV_ROOT"* ]]; then
            continue
        fi
    fi
    cmd=$(ps -p "$pid" -o command= 2>/dev/null | head -c 80 || true)
    if [[ "$DRY_RUN" == true ]]; then
        log_warn "Would kill PID $pid: $cmd"
    else
        log_info "Killing PID $pid: $cmd"
        kill "$pid" 2>/dev/null || true
        killed=$((killed + 1))
    fi
done < <(lsof -iTCP -sTCP:LISTEN -P -n 2>/dev/null | grep '^node' | awk '!seen[$2]++ {print}' || true)

# 3. Stop Docker containers from the dev_env compose file
for backend_dir in "$WXYC_DEV_ROOT"/Backend-Service "$WXYC_DEV_ROOT"/Backend-Service/.claude/worktrees/*/; do
    local_compose="$backend_dir/dev_env/docker-compose.yml"
    if [[ -f "$local_compose" ]]; then
        # Check if any containers from this compose project are running
        if docker compose -f "$local_compose" ps -q 2>/dev/null | grep -q .; then
            if [[ "$DRY_RUN" == true ]]; then
                log_warn "Would stop Docker containers from: $local_compose"
            else
                log_info "Stopping Docker containers from: $(basename "$backend_dir")"
                docker compose -f "$local_compose" --profile dev down -v --remove-orphans 2>/dev/null || true
                killed=$((killed + 1))
            fi
        fi
    fi
done

# 4. Clean up stale Next.js lock files
for dj_dir in "$WXYC_DEV_ROOT"/dj-site "$WXYC_DEV_ROOT"/dj-site-*; do
    lock_file="$dj_dir/.next/dev/lock"
    if [[ -f "$lock_file" ]]; then
        holder=$(lsof -t "$lock_file" 2>/dev/null || true)
        if [[ -n "$holder" ]]; then
            if [[ "$DRY_RUN" == true ]]; then
                log_warn "Would remove active Next.js lock at $lock_file (PID $holder)"
            else
                log_info "Next.js lock at $(basename "$dj_dir") held by PID $holder — killing"
                kill "$holder" 2>/dev/null || true
                rm -f "$lock_file"
                killed=$((killed + 1))
            fi
        else
            if [[ "$DRY_RUN" == true ]]; then
                log_warn "Would remove stale lock file: $lock_file"
            else
                log_info "Removing stale lock file: $(basename "$dj_dir")/.next/dev/lock"
                rm -f "$lock_file"
            fi
        fi
    fi
done

echo ""
if [[ "$DRY_RUN" == true ]]; then
    log_info "Dry run complete. Re-run without --dry-run to execute."
elif [[ $killed -eq 0 ]]; then
    log_success "No WXYC services were running."
else
    log_success "Teardown complete ($killed processes/containers stopped)."
fi
