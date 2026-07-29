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
