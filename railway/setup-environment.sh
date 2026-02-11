#!/usr/bin/env bash
#
# Set up a Railway project for WXYC services.
#
# Prerequisites:
#   - Railway CLI installed: https://docs.railway.app/guides/cli
#   - Logged in: railway login
#   - GitHub repos exist: WXYC/request-parser, WXYC/library-metadata-lookup
#
# Usage:
#   ./railway/setup-environment.sh
#
# This script creates Railway services and links them to GitHub repos.
# You still need to set environment variables manually via the Railway dashboard
# or `railway variables set`.

set -euo pipefail

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ---------------------------------------------------------------------------
# Preflight
# ---------------------------------------------------------------------------
if ! command -v railway &>/dev/null; then
    error "Railway CLI not found. Install it: https://docs.railway.app/guides/cli"
    exit 1
fi

if ! railway whoami &>/dev/null; then
    error "Not logged in to Railway. Run: railway login"
    exit 1
fi

info "Railway CLI detected. Logged in as: $(railway whoami 2>/dev/null || echo 'unknown')"

# ---------------------------------------------------------------------------
# Project selection
# ---------------------------------------------------------------------------
echo ""
info "Select or create the Railway project to set up."
info "If you already have a project, link it first: railway link"
echo ""
read -rp "Continue with the currently linked project? [y/N] " confirm
if [[ "$confirm" != [yY] ]]; then
    info "Exiting. Link a project first with: railway link"
    exit 0
fi

# ---------------------------------------------------------------------------
# Instructions
# ---------------------------------------------------------------------------
cat <<'INSTRUCTIONS'

=== WXYC Railway Environment Setup ===

Railway does not have a declarative config format for creating services
programmatically. Use the Railway dashboard to complete the following:

1. DATABASE: PostgreSQL
   - Add a PostgreSQL plugin (or use an existing one)
   - Note the internal connection URL for other services

2. SERVICE: request-o-matic
   - Create a new service from GitHub repo: WXYC/request-parser
   - Staging environment: deploy from `main` branch
   - Production environment: deploy from `prod` branch
   - Set environment variables:
     Required:
       GROQ_API_KEY=<your-groq-api-key>
     Recommended:
       DISCOGS_TOKEN=<your-discogs-token>
       DATABASE_URL_DISCOGS=<postgres-internal-url>
       SENTRY_DSN=<your-sentry-dsn>
       POSTHOG_API_KEY=<your-posthog-key>

3. SERVICE: library-metadata-lookup
   - Create a new service from GitHub repo: WXYC/library-metadata-lookup
   - Staging environment: deploy from `main` branch
   - Production environment: deploy from `prod` branch
   - Set environment variables:
     Recommended:
       DISCOGS_TOKEN=<your-discogs-token>
       DATABASE_URL_DISCOGS=<postgres-internal-url>
       SENTRY_DSN=<your-sentry-dsn>
       POSTHOG_API_KEY=<your-posthog-key>

4. NETWORKING
   - Both services share the same PostgreSQL instance via internal URL
   - Future: request-o-matic will call library-metadata-lookup via:
       LOOKUP_SERVICE_URL=http://library-metadata-lookup.railway.internal:8000

5. VERIFY
   - Check health endpoints:
       curl https://<request-o-matic-staging>.up.railway.app/health
       curl https://<library-metadata-lookup-staging>.up.railway.app/health

INSTRUCTIONS

info "See railway/services.yaml for the full service topology."
info "See railway/README.md for detailed documentation."
