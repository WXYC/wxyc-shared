# E2E Tests

End-to-end tests for WXYC services that verify full-stack integration.

## Prerequisites

Before running E2E tests, ensure:

1. Backend service is running (or use the Docker Compose setup)
2. Auth service is running (separate from backend)
3. Database is seeded with test data
4. Environment variables are configured

## Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npm run test:e2e -- e2e/flowsheet.test.ts
```

## Shared session fixtures (`global-setup.ts`)

`vitest.e2e.config.ts` registers `e2e/global-setup.ts` as a vitest
`globalSetup` module. It runs once, in the main process, before any test
file below is forked, and mints the anonymous session, the credentialed
(DJ) session, and a `POST /auth/wxyc/lookup-email` "no match" probe that
every other file in this directory would otherwise re-mint on its own —
against the SAME shared, cross-service rate-limit bucket
(`apps/auth/app.ts`'s `authMutationRateLimit`: 10 requests / 15 min per
`X-Real-IP`, one reused Express middleware instance mounted across nine
path prefixes). It exposes the results via `process.env`, which every
worker process inherits at fork time; `e2e/setup.ts`'s `getSharedAnonymousSession`
/ `getSharedDjSession` / `getSharedLookupEmailNullProbe` /
`exchangeSessionForJwt` are the one place every consumer reads them from.

Before this existed, seven files independently signed in a combined 15
times against that one 10-request bucket in a single `npm run test:e2e`
run — over the ceiling, so a full run could rate-limit itself.
`catalog`, `concerts`, `proxy`, and `recent-entries` now read the shared
fixtures instead of minting their own; `auth.test.ts` and
`tests/e2e-contracts.test.ts` still sign in for themselves and move over
in the two PRs that follow this one, which is where the full per-file
accounting lands.

When `E2E_TEST_DJ_USERNAME` is provisioned, the shared credentialed mint
reroutes from `/sign-in/email` to `/sign-in/username` with no code change
required. If `/sign-in/username` itself then fails (a misconfigured or
mismatched secret), `global-setup.ts` retries the shared mint once via
`/sign-in/email` rather than leaving the fixture unset — that fallback
costs one more request.

Note this accounting only holds because e2e test FILES run sequentially
(`fileParallelism: false`); concurrent files spend the same one bucket in
bursts.

`e2e/global-setup.ts` polls BOTH origins before minting anything (the
backend's `/healthcheck` and the auth service's own built-in `GET /ok` —
an earlier version only polled the backend, so a slow-starting auth
service could make the very first mint fail before anything had a chance
to come up), and every one of its live fetches carries an explicit
timeout. Set `E2E_SKIP_SHARED_AUTH_MINTS=true` to skip every mint
entirely for a targeted single-file run of a file that needs no auth at
all (e.g. `flowsheet.test.ts`), so that run doesn't spend covered
requests against the shared budget for fixtures nothing in it reads.

## Test Categories

### Auth E2E (`auth.test.ts`)
- Verifies unauthenticated requests to protected endpoints return 401
- Tests sign-in flow and JWT token acquisition
- Validates JWT contains a role recognized by the backend (`WXYCRoles`)
- Tests authenticated catalog and DJ bin access
- Tests rejection of invalid/tampered tokens

### Flowsheet E2E (`flowsheet.test.ts`)
- Public read endpoints (no auth required)
- Pagination and filtering
- On-air status

### Recent Entries E2E (`recent-entries.test.ts`)
- Verifies Backend-Service is the flowsheet source-of-truth after the tubafrenzy turndown (WXYC/wiki#88): a write made through Backend surfaces on Backend's **own** `GET /playlists/recentEntries` (served from Postgres, BS#1860), not tubafrenzy
- Guards the v=1 flat array wire format + `X-Last-Modified` header (the Android contract, BS#1866) — this case runs without DJ credentials
- Tests POST (freeform track entry surfaces on recentEntries) and PATCH (updated entry reflects)
- Doubles as the automated guardrail for wiki#88's acceptance criterion: "mirror off; dj-site writes still land in Postgres and surface within the polling window"
- Requires Backend-Service and Auth running; the write-path cases need a test DJ account
- Replaces the former `mirror.test.ts` (which asserted the now-retired Backend→tubafrenzy mirror direction)

### Catalog E2E (`catalog.test.ts`)
- Album and artist search (requires `catalog:read` auth)
- Format and genre listing
- Rotation queries
- Verifies 401 for unauthenticated requests

### Concerts E2E (`concerts.test.ts`)
- The cross-repo wire-contract gate for `GET /concerts` (On Tour)
- Anonymous-session auth exchanged for a JWT (the mobile-app mechanism); verifies 401 unauthenticated
- Decodes the live payload through the **generated** `Concert` / `ConcertsResponse` types and asserts every field matches the codegen shape (nullable keys present, no internal ingestion columns leaked, `status` within `ConcertStatus`) — the contract iOS/Android/dj-site consume
- Self-seeds a deterministic row set (timed+curated, date-only, past, removed) directly into the stack DB, then asserts windowing, ordering, the `event_url` fallback field, and `curated=true`
- The seeded assertions require `E2E_DB_URL` (a Postgres connection string for the stack DB); they self-skip when it is unset. The auth gate and the envelope/shape contract run regardless.

### Contract Tests (`contract/openapi-compliance.test.ts`)
- Validates API responses match OpenAPI schema definitions

### Type Tests (`types/generated-types.test.ts`)
- Validates generated TypeScript types can parse real API responses

## Configuration

E2E tests use environment variables:

```env
E2E_BASE_URL=http://localhost:8080       # Backend API
E2E_AUTH_URL=http://localhost:8081/auth   # Better-auth service
E2E_TEST_DJ_EMAIL=test@wxyc.org          # Test DJ account email
E2E_TEST_DJ_PASSWORD=testpassword        # Test DJ account password
E2E_DB_URL=postgres://user:pw@host:5432/db  # Stack DB, for suites that seed rows (concerts)
E2E_SCHEMA_NAME=wxyc_schema              # Postgres schema the backend reads (default wxyc_schema)
```

Tests that require authentication use `it.skipIf(!hasCredentials)` and will
be skipped when `E2E_TEST_DJ_EMAIL` / `E2E_TEST_DJ_PASSWORD` are not set.

## Auth Requirements by Endpoint

| Endpoint | Auth Required | Permission |
|----------|:---:|---|
| `GET /flowsheet` | No | Public |
| `GET /flowsheet/latest` | No | Public |
| `GET /flowsheet/djs-on-air` | No | Public |
| `GET /flowsheet/on-air` | No | Public |
| `POST /flowsheet` | Yes | `flowsheet:write` |
| `PATCH /flowsheet` | Yes | `flowsheet:write` |
| `DELETE /flowsheet` | Yes | `flowsheet:write` |
| `GET /library` | Yes | `catalog:read` |
| `GET /library/formats` | Yes | `catalog:read` |
| `GET /library/genres` | Yes | `catalog:read` |
| `GET /library/rotation` | Yes | `catalog:read` |
| `GET /library/info` | Yes | `catalog:read` |
| `GET /djs/bin` | Yes | `bin:read` |
| `POST /djs/bin` | Yes | `bin:write` |
| `GET /schedule` | No | Public |
| `GET /concerts` | Yes | Anonymous session → JWT |
