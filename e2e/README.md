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

### Mirror E2E (`mirror.test.ts`)
- Verifies the full mirror round-trip: entry added via Backend-Service appears on tubafrenzy's public JSON API
- Tests POST mirroring (freeform track entry appears on tubafrenzy `/playlists/recentEntries`)
- Tests PATCH mirroring (updated entry reflects on tubafrenzy)
- Requires Backend-Service, Auth, and tubafrenzy all running
- Additional env var: `E2E_TUBAFRENZY_URL` (default: `http://localhost:8080`)

### Catalog E2E (`catalog.test.ts`)
- Album and artist search (requires `catalog:read` auth)
- Format and genre listing
- Rotation queries
- Verifies 401 for unauthenticated requests

### Contract Tests (`contract/openapi-compliance.test.ts`)
- Validates API responses match OpenAPI schema definitions

### Type Tests (`types/generated-types.test.ts`)
- Validates generated TypeScript types can parse real API responses

## Configuration

E2E tests use environment variables:

```env
E2E_BASE_URL=http://localhost:8080       # Backend API
E2E_AUTH_URL=http://localhost:8081/auth   # Better-auth service
E2E_TUBAFRENZY_URL=http://localhost:8080  # Tubafrenzy (mirror target)
E2E_TEST_DJ_EMAIL=test@wxyc.org          # Test DJ account email
E2E_TEST_DJ_PASSWORD=testpassword        # Test DJ account password
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
