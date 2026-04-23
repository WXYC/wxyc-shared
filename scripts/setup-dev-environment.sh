#!/usr/bin/env bash
#
# WXYC Full-Stack Development Environment Setup
#
# This script sets up and starts the complete WXYC development environment:
# - Backend-Service (API + Auth)
# - dj-site (Frontend)
# - PostgreSQL database
#
# Ports are assigned dynamically. If the default port (8080, 8082, 3000) is
# occupied, the next available port is used. The .env and .env.local files are
# regenerated on each run to match the resolved ports (previous versions are
# backed up to .env.bak / .env.local.bak).
#
# Usage: ./setup-dev-environment.sh [OPTIONS]
#
# Options:
#   --skip-clone      Skip repository cloning (use existing directories)
#   --skip-deps       Skip npm install
#   --backend-only    Only start backend services (no frontend)
#   --frontend-only   Only start frontend (assumes backend is running)
#   --help            Show this help message
#
# Environment Variables:
#   WXYC_DEV_ROOT     Directory for WXYC repositories (default: parent of this script)
#   BACKEND_BRANCH    Backend-Service branch to checkout (default: main)
#   FRONTEND_BRANCH   dj-site branch to checkout (default: main)

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

# Generate .env content for Backend-Service with resolved ports
generate_backend_env() {
    local backend_port=$1
    local auth_port=$2
    local frontend_port=$3

    cat << EOF
PORT=${backend_port}
CI_PORT=8081
AUTH_PORT=${auth_port}
DB_HOST=localhost
DB_NAME=wxyc_db
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_PORT=5432
CI_DB_PORT=5433
BETTER_AUTH_URL=http://localhost:${auth_port}/auth
BETTER_AUTH_JWKS_URL=http://localhost:${auth_port}/auth/jwks
BETTER_AUTH_ISSUER=http://localhost:${auth_port}
BETTER_AUTH_AUDIENCE=http://localhost:${auth_port}
BETTER_AUTH_TRUSTED_ORIGINS=http://localhost:${frontend_port}
TEST_HOST=http://localhost
AUTH_BYPASS=true
AUTH_USERNAME=test_dj1
AUTH_PASSWORD=testpassword123
TUBAFRENZY_URL=http://localhost:${backend_port}
MIRROR_API_KEY=wxyc-local-dev-mirror-key
EOF
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Port utility functions

is_port_available() {
    ! lsof -iTCP:"$1" -sTCP:LISTEN -P -n >/dev/null 2>&1
}

RESOLVED_PORTS=()

find_available_port() {
    local port=$1
    for (( i=0; i<20; i++ )); do
        if is_port_available "$port" && [[ ! " ${RESOLVED_PORTS[*]:-} " =~ " $port " ]]; then
            RESOLVED_PORTS+=("$port")
            echo "$port"
            return 0
        fi
        log_warn "Port $port is in use, trying $((port + 1))..."
        port=$((port + 1))
    done
    log_error "Could not find an available port starting from $1"
    return 1
}

# Default configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Default to parent of wxyc-shared (so repos are siblings)
WXYC_DEV_ROOT="${WXYC_DEV_ROOT:-$(dirname "$(dirname "$SCRIPT_DIR")")}"
BACKEND_BRANCH="${BACKEND_BRANCH:-main}"
FRONTEND_BRANCH="${FRONTEND_BRANCH:-main}"

# Options
SKIP_CLONE=false
SKIP_DEPS=false
BACKEND_ONLY=false
FRONTEND_ONLY=false

# Repository URLs
BACKEND_REPO="git@github.com:WXYC/Backend-Service.git"
FRONTEND_REPO="git@github.com:WXYC/dj-site.git"

# Service URLs for health checks (updated by resolve_ports)
BACKEND_URL="http://localhost:8080"
AUTH_URL="http://localhost:8082"
FRONTEND_URL="http://localhost:3000"

# Default ports
DEFAULT_BACKEND_PORT=8080
DEFAULT_AUTH_PORT=8082
DEFAULT_FRONTEND_PORT=3000

# Health check timeout (seconds)
HEALTH_CHECK_TIMEOUT=60
HEALTH_CHECK_INTERVAL=2

show_help() {
    cat << EOF
WXYC Full-Stack Development Environment Setup

Usage: $(basename "$0") [OPTIONS]

Options:
  --skip-clone      Skip repository cloning (use existing directories)
  --skip-deps       Skip npm install
  --backend-only    Only start backend services (no frontend)
  --frontend-only   Only start frontend (assumes backend is running)
  --help            Show this help message

Environment Variables:
  WXYC_DEV_ROOT     Directory for WXYC repositories (default: $WXYC_DEV_ROOT)
  BACKEND_BRANCH    Backend-Service branch to checkout (default: $BACKEND_BRANCH)
  FRONTEND_BRANCH   dj-site branch to checkout (default: $FRONTEND_BRANCH)

Examples:
  # Full setup from scratch
  ./$(basename "$0")

  # Skip cloning if repos already exist
  ./$(basename "$0") --skip-clone

  # Quick restart (skip clone and deps)
  ./$(basename "$0") --skip-clone --skip-deps

  # Start only backend for API development
  ./$(basename "$0") --backend-only

EOF
}

parse_args() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --skip-clone)
                SKIP_CLONE=true
                shift
                ;;
            --skip-deps)
                SKIP_DEPS=true
                shift
                ;;
            --backend-only)
                BACKEND_ONLY=true
                shift
                ;;
            --frontend-only)
                FRONTEND_ONLY=true
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done

    # Validate mutually exclusive options
    if [[ "$BACKEND_ONLY" == true && "$FRONTEND_ONLY" == true ]]; then
        log_error "--backend-only and --frontend-only cannot be used together"
        exit 1
    fi
}

check_command() {
    local cmd=$1
    local name=${2:-$cmd}
    if ! command -v "$cmd" &> /dev/null; then
        log_error "$name is not installed or not in PATH"
        return 1
    fi
    return 0
}

check_dependencies() {
    log_info "Checking dependencies..."
    local missing=0

    if ! check_command docker "Docker"; then
        log_error "  Install Docker: https://docs.docker.com/get-docker/"
        missing=1
    else
        log_success "Docker found"
        # Check if Docker daemon is running
        if ! docker info &> /dev/null; then
            log_error "Docker daemon is not running. Please start Docker Desktop or the Docker service."
            missing=1
        else
            log_success "Docker daemon is running"
        fi
    fi

    if ! check_command node "Node.js"; then
        log_error "  Install Node.js: https://nodejs.org/"
        missing=1
    else
        log_success "Node.js found ($(node --version))"
    fi

    if ! check_command npm "npm"; then
        log_error "  npm should be installed with Node.js"
        missing=1
    else
        log_success "npm found ($(npm --version))"
    fi

    if ! check_command git "git"; then
        log_error "  Install git: https://git-scm.com/"
        missing=1
    else
        log_success "git found ($(git --version | cut -d' ' -f3))"
    fi

    if [[ $missing -eq 1 ]]; then
        log_error "Missing required dependencies. Please install them and try again."
        exit 1
    fi

    log_success "All dependencies satisfied"
}

resolve_ports() {
    log_info "Resolving available ports..."

    if [[ "$FRONTEND_ONLY" == true ]]; then
        # Backend is already running -- read its ports from existing .env
        local backend_env="$WXYC_DEV_ROOT/Backend-Service/.env"
        if [[ -f "$backend_env" ]]; then
            BACKEND_PORT=$(grep '^PORT=' "$backend_env" | cut -d= -f2)
            AUTH_PORT=$(grep '^AUTH_PORT=' "$backend_env" | cut -d= -f2)
        fi
        BACKEND_PORT=${BACKEND_PORT:-$DEFAULT_BACKEND_PORT}
        AUTH_PORT=${AUTH_PORT:-$DEFAULT_AUTH_PORT}
        log_info "Using backend ports from .env: backend=$BACKEND_PORT, auth=$AUTH_PORT"
    else
        BACKEND_PORT=$(find_available_port $DEFAULT_BACKEND_PORT) || exit 1
        AUTH_PORT=$(find_available_port $DEFAULT_AUTH_PORT) || exit 1
        log_success "Backend port: $BACKEND_PORT"
        log_success "Auth port: $AUTH_PORT"
    fi

    if [[ "$BACKEND_ONLY" != true ]]; then
        FRONTEND_PORT=$(find_available_port $DEFAULT_FRONTEND_PORT) || exit 1
        log_success "Frontend port: $FRONTEND_PORT"
    fi

    # Update service URLs used for health checks and the banner
    BACKEND_URL="http://localhost:$BACKEND_PORT"
    AUTH_URL="http://localhost:$AUTH_PORT"
    FRONTEND_URL="http://localhost:${FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}"
}

setup_repository() {
    local repo_url=$1
    local repo_dir=$2
    local branch=$3
    local repo_name=$(basename "$repo_dir")

    if [[ -d "$repo_dir" ]]; then
        if [[ "$SKIP_CLONE" == true ]]; then
            log_info "Using existing $repo_name directory"
        else
            log_info "Updating $repo_name..."
            cd "$repo_dir"
            git fetch origin
            git checkout "$branch"
            git pull origin "$branch"
            cd - > /dev/null
        fi
    else
        if [[ "$SKIP_CLONE" == true ]]; then
            log_error "$repo_name directory not found at $repo_dir"
            log_error "Run without --skip-clone to clone the repository"
            exit 1
        fi
        log_info "Cloning $repo_name..."
        git clone "$repo_url" "$repo_dir"
        cd "$repo_dir"
        git checkout "$branch"
        cd - > /dev/null
    fi
    log_success "$repo_name ready"
}

install_dependencies() {
    local dir=$1
    local name=$(basename "$dir")

    if [[ "$SKIP_DEPS" == true ]]; then
        log_info "Skipping npm install for $name"
        return
    fi

    log_info "Installing dependencies for $name..."
    cd "$dir"
    npm install
    cd - > /dev/null
    log_success "$name dependencies installed"
}

wait_for_health() {
    local url=$1
    local name=$2
    local timeout=${3:-$HEALTH_CHECK_TIMEOUT}
    local elapsed=0

    log_info "Waiting for $name to be healthy..."

    while [[ $elapsed -lt $timeout ]]; do
        if curl -sf "$url" > /dev/null 2>&1; then
            log_success "$name is healthy"
            return 0
        fi
        sleep $HEALTH_CHECK_INTERVAL
        elapsed=$((elapsed + HEALTH_CHECK_INTERVAL))
    done

    log_error "$name did not become healthy within ${timeout}s"
    return 1
}

start_backend_services() {
    local backend_dir="$WXYC_DEV_ROOT/Backend-Service"

    # Always (re)generate .env with resolved ports
    if [[ -f "$backend_dir/.env" ]]; then
        cp "$backend_dir/.env" "$backend_dir/.env.bak"
        log_info "Backed up existing .env to .env.bak"
    fi
    log_info "Writing .env with resolved ports (backend=$BACKEND_PORT, auth=$AUTH_PORT)..."
    generate_backend_env "$BACKEND_PORT" "$AUTH_PORT" "${FRONTEND_PORT:-$DEFAULT_FRONTEND_PORT}" > "$backend_dir/.env"
    log_success ".env written"

    log_info "Starting PostgreSQL database..."
    cd "$backend_dir"
    npm run db:start
    log_success "PostgreSQL started"

    log_info "Starting backend and auth services..."
    # Run in background and capture PID
    npm run dev &
    BACKEND_PID=$!
    cd - > /dev/null

    # Wait for services to be healthy
    wait_for_health "$BACKEND_URL/healthcheck" "Backend API" || {
        log_error "Backend failed to start. Check logs above."
        kill $BACKEND_PID 2>/dev/null || true
        exit 1
    }

    wait_for_health "$AUTH_URL/auth/ok" "Auth Service" || {
        log_error "Auth service failed to start. Check logs above."
        kill $BACKEND_PID 2>/dev/null || true
        exit 1
    }

    log_success "Backend services are running"
}

start_frontend() {
    local frontend_dir="$WXYC_DEV_ROOT/dj-site"

    # Always (re)generate .env.local with resolved ports
    if [[ -f "$frontend_dir/.env.local" ]]; then
        cp "$frontend_dir/.env.local" "$frontend_dir/.env.local.bak"
        log_info "Backed up existing .env.local to .env.local.bak"
    fi
    log_info "Writing .env.local with resolved ports..."
    cat > "$frontend_dir/.env.local" << EOF
NEXT_PUBLIC_BACKEND_URL=http://localhost:${BACKEND_PORT}
NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:${AUTH_PORT}/auth
NEXT_PUBLIC_DASHBOARD_HOME_PAGE=/dashboard/flowsheet
NEXT_PUBLIC_DEFAULT_EXPERIENCE=modern
NEXT_PUBLIC_ENABLED_EXPERIENCES=modern,classic
NEXT_PUBLIC_ALLOW_EXPERIENCE_SWITCHING=true
EOF
    log_success ".env.local written"

    log_info "Starting frontend on port $FRONTEND_PORT..."
    cd "$frontend_dir"
    PORT=$FRONTEND_PORT npm run dev &
    FRONTEND_PID=$!
    cd - > /dev/null

    wait_for_health "$FRONTEND_URL" "Frontend" || {
        log_error "Frontend failed to start. Check logs above."
        kill $FRONTEND_PID 2>/dev/null || true
        exit 1
    }

    log_success "Frontend is running"
}

print_success_banner() {
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  WXYC Development Environment Ready!  ${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""

    if [[ "$FRONTEND_ONLY" != true ]]; then
        echo -e "  Backend API:  ${BLUE}$BACKEND_URL${NC}"
        echo -e "  Auth Service: ${BLUE}$AUTH_URL${NC}"
    fi

    if [[ "$BACKEND_ONLY" != true ]]; then
        echo -e "  Frontend:     ${BLUE}$FRONTEND_URL${NC}"
    fi

    if [[ "${BACKEND_PORT:-}" != "$DEFAULT_BACKEND_PORT" || "${AUTH_PORT:-}" != "$DEFAULT_AUTH_PORT" || "${FRONTEND_PORT:-}" != "$DEFAULT_FRONTEND_PORT" ]]; then
        echo ""
        echo -e "  ${YELLOW}NOTE: Some ports differ from defaults because the default ports were occupied.${NC}"
    fi

    echo ""
    echo "  Test Credentials (password: testpassword123):"
    echo "    test_member          - member role"
    echo "    test_dj1, test_dj2   - dj role"
    echo "    test_music_director  - musicDirector role"
    echo "    test_station_manager - stationManager role"
    echo ""
    echo -e "  Press ${YELLOW}Ctrl+C${NC} to stop all services"
    echo ""
}

cleanup() {
    log_info "Shutting down services..."

    # Kill background processes
    if [[ -n "${BACKEND_PID:-}" ]]; then
        kill $BACKEND_PID 2>/dev/null || true
    fi
    if [[ -n "${FRONTEND_PID:-}" ]]; then
        kill $FRONTEND_PID 2>/dev/null || true
    fi

    # Stop database
    if [[ "$FRONTEND_ONLY" != true ]]; then
        cd "$WXYC_DEV_ROOT/Backend-Service" 2>/dev/null && npm run db:stop 2>/dev/null || true
    fi

    log_info "Cleanup complete"
    exit 0
}

main() {
    parse_args "$@"

    echo ""
    echo -e "${BLUE}WXYC Development Environment Setup${NC}"
    echo ""

    # Check dependencies
    check_dependencies

    # Resolve available ports before any env file generation
    resolve_ports

    # Set up repositories
    if [[ "$FRONTEND_ONLY" != true ]]; then
        setup_repository "$BACKEND_REPO" "$WXYC_DEV_ROOT/Backend-Service" "$BACKEND_BRANCH"
        install_dependencies "$WXYC_DEV_ROOT/Backend-Service"
    fi

    if [[ "$BACKEND_ONLY" != true ]]; then
        setup_repository "$FRONTEND_REPO" "$WXYC_DEV_ROOT/dj-site" "$FRONTEND_BRANCH"
        install_dependencies "$WXYC_DEV_ROOT/dj-site"
    fi

    # Set up trap for cleanup
    trap cleanup SIGINT SIGTERM

    # Start services
    if [[ "$FRONTEND_ONLY" != true ]]; then
        start_backend_services
    fi

    if [[ "$BACKEND_ONLY" != true ]]; then
        # If frontend-only, verify backend is running
        if [[ "$FRONTEND_ONLY" == true ]]; then
            if ! curl -sf "$BACKEND_URL/healthcheck" > /dev/null 2>&1; then
                log_error "Backend is not running. Start it first or remove --frontend-only flag."
                exit 1
            fi
        fi
        start_frontend
    fi

    print_success_banner

    # Wait for interrupt
    wait
}

# Run main function
main "$@"
