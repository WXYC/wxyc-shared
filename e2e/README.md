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
run. See `e2e/auth.test.ts`'s budget-arithmetic comment (in its
`better-auth core surface (issue #379)` describe block) for the full,
current per-file accounting, parameterized on which credentials are
configured — 4 covered requests with none, 6 with `E2E_TEST_DJ_EMAIL` /
`_PASSWORD` (today's actual state), 7 once `E2E_TEST_DJ_USERNAME` is also
provisioned. `bs-lml-gate.yml` already wires that third secret through, so
the run activates two more assertions (and reroutes the shared
credentialed mint from `/sign-in/email` to `/sign-in/username`) the moment
it's set, with no code change required — the downstream `wxyc-canary`
smoke step's own sign-in adds one more on top, for a worst-case 8 of 10
requests against the ceiling (2 requests of headroom) once all three
secrets exist. If `/sign-in/username` itself ever fails (a misconfigured
or mismatched secret), `global-setup.ts` retries the shared mint once via
`/sign-in/email` rather than leaving the fixture unset — that fallback
costs one more request, 9 of 10 worst case, still under the ceiling. The
table also carries explicit zero-cost rows for the two files that touch
no auth surface at all (`flowsheet.test.ts`, `types/generated-types.test.ts`),
so the row list stays exhaustive against the full nine-file glob.

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
- Every credentialed and anonymous assertion in this file reads the shared
  sessions `e2e/global-setup.ts` mints (see "Shared session fixtures"
  above) rather than signing in itself — see the budget-arithmetic comment
  near the file's end for the full accounting. The "Authenticated catalog
  access" and "Authenticated DJ bin access" describes each re-apply the
  shared JWT in their own `beforeAll`, since the two describes before them
  (`Unauthenticated requests...`, `Public endpoints...`) clear the shared
  client's token in every one of their tests and nothing else would
  restore it.
- **`better-auth core surface (issue #379)`**: behavioral assertions for the
  eight `/auth/*` paths added to `api.yaml` in issue #379 — `set-auth-token`
  on email *and* username sign-in (the username case self-skips absent
  `E2E_TEST_DJ_USERNAME`, see below), the anonymous sign-in shape (no
  credentials needed), `/auth/token` mint shape for both a credentialed and
  an anonymous session, the 401-vs-404 split on `/auth/token` (missing/bad
  bearer vs. the wrong HTTP method), `/auth/wxyc/lookup-email` resolution
  (gated on `canResolveUsernameToEmail`, not `hasUsernameCredentials` — see
  below) + no-match, `send-verification-otp`'s success shape, and sign-out
  invalidation (a signed-out session subsequently 401s on `/auth/token`).
  **There is no live 429 test in this file.** An earlier version ended with
  one that deliberately exhausted the shared `authMutationRateLimit` budget
  (10 requests / 15 min per `X-Real-IP`, shared across every
  `/auth/sign-in/*` + `/auth/email-otp/send-verification-otp` +
  `/auth/wxyc/lookup-email` path, plus five more mount prefixes) — cascading
  429s into every test file that runs after this one in the same `npm run
  test:e2e` invocation, and into the canary smoke step downstream in
  `bs-lml-gate.yml`. It was removed (issue #379 review finding #7); the two
  429 response shapes (`AuthRateLimitedResponse` for better-auth's own
  tighter internal per-path limiter, met first in practice, and
  `AuthPlainErrorResponse` for the shared express-layer fallback) are
  documented directly in `api.yaml` and verified against source instead of
  a live probe — see the budget-arithmetic comment at the end of this file
  for the full accounting of why no live 429 assertion fits anywhere in
  this repo's e2e suite today.

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
- **`Auth Endpoints (#379)`**: validates the `/auth/*` responses against
  their `api.yaml` schemas (`AuthTokenAndUserResult`, `AuthTokenResponse`,
  `LookupEmailResponse`) using an auth-origin client — see "Auth-origin
  client" below. Runs unconditionally; anonymous sign-in needs no
  credentials. Asserts each response's status directly rather than
  silently skipping on a non-2xx — the old skip-on-`!ok` pattern couldn't
  tell "auth service genuinely unreachable" (which a thrown `fetch` error
  already fails this suite on, before reaching that check) apart from
  "auth service reachable but answering with an error" (a 429 from the
  shared rate-limit budget, say), so it always passed regardless of which
  happened (issue #379 review finding #9). Of this block's three live
  requests, two now read `e2e/global-setup.ts`'s shared fixtures instead
  (the `GET /auth/token` schema check reads the shared anonymous session;
  the lookup-email schema check reads the shared no-match probe) — the ONE
  exception is the `AuthTokenAndUserResult` schema-shape test itself,
  which keeps its own dedicated `POST /auth/sign-in/anonymous` call
  because it needs the FULL raw response to validate, not just the token
  the shared fixture carries. See `e2e/auth.test.ts`'s budget-arithmetic
  comment for the exact count this block contributes to the shared
  rate-limit budget. The origin-verification test calls better-auth's own built-in
  `GET /ok` liveness route rather than probing a made-up path, since only
  the real auth origin serves it.

### Type Tests (`types/generated-types.test.ts`)
- Validates generated TypeScript types can parse real API responses

## Auth-origin client

`createE2EClient` binds `config.baseUrl` (the backend API origin, default
port 8080) — that's what every suite above except auth uses. The `/auth/*`
paths live on the separate auth origin (`config.authUrl`, default port
8081), so anything talking to them directly needs `createE2EAuthClient()`
instead (both factories accept the same `Partial<E2EConfig>` override).
`e2e/global-setup.ts` and every test file's own `authClient` use this
factory; there is no separate auth-helper class anymore (a `E2EAuthHelper`
that predated the shared-session design was retired once it had zero
remaining callers — see "Shared session fixtures" above).

## Configuration

E2E tests use environment variables:

```env
E2E_BASE_URL=http://localhost:8080       # Backend API
E2E_AUTH_URL=http://localhost:8081/auth   # Better-auth service
E2E_TEST_DJ_EMAIL=test@wxyc.org          # Test DJ account email
E2E_TEST_DJ_PASSWORD=testpassword        # Test DJ account password
E2E_TEST_DJ_USERNAME=testdj              # Username half of the same account — optional, see below
E2E_REQUIRE_CREDENTIALS=true             # Fail loud (not skip) if the DJ email/password are unset — see below
E2E_SKIP_SHARED_AUTH_MINTS=true          # Skip every e2e/global-setup.ts mint — see "Shared session fixtures" above
E2E_DB_URL=postgres://user:pw@host:5432/db  # Stack DB, for suites that seed rows (concerts)
E2E_SCHEMA_NAME=wxyc_schema              # Postgres schema the backend reads (default wxyc_schema)
```

Tests that require authentication use `it.skipIf(!hasCredentials)` and will
be skipped when `E2E_TEST_DJ_EMAIL` / `E2E_TEST_DJ_PASSWORD` are not set —
this is now conditional, not universal: the anonymous-sign-in and
`/auth/token` 401/404 assertions added in issue #379 need no credentials at
all and run unconditionally.

`E2E_REQUIRE_CREDENTIALS` (issue #379 review finding #10) flips that
self-skip into a fail-loud check: when set to `true`, `e2e/auth.test.ts`'s
`beforeAll` throws if `E2E_TEST_DJ_EMAIL` / `E2E_TEST_DJ_PASSWORD` are not
both set, instead of letting every credentialed assertion in that file
silently pass having run zero of them. `bs-lml-gate.yml` sets this now
that both secrets are provisioned there — a repository secret going
missing (renamed, revoked, a typo'd key) should fail the prod-promotion
gate loudly, not stay green having tested nothing. Leave it unset for
local/partial-stack runs where signing in as a DJ isn't the point.

`E2E_TEST_DJ_USERNAME` is optional and independent of the above: it gates
only `POST /auth/sign-in/username` via its own `hasUsernameCredentials`
check (username + password), and self-skips exactly like the
email/password ones when unset. `POST /auth/wxyc/lookup-email`'s
resolution case is gated on a separate `canResolveUsernameToEmail` check
(username + email, no password — issue #379 review finding #12; an
earlier version conflated the two, which made a username+password-but-no-
email env shape eligible to run that assertion and then fail on
`E2E_TEST_DJ_EMAIL` being `undefined` for a reason unrelated to the
contract under test). `E2E_TEST_DJ_USERNAME` is deliberately **not**
wired to a fail-loud gate — see `bs-lml-gate.yml`'s comment on this
variable and `E2EConfig.testDjUsername`'s doc comment in `setup.ts` for
the landing order that has to complete first (staging account +
repository secret, then the gate's env block, then a fail-loud
assertion).

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
| `POST /auth/sign-in/email` | No | Public — establishes a session |
| `POST /auth/sign-in/username` | No | Public — establishes a session |
| `POST /auth/sign-in/email-otp` | No | Public — establishes a session |
| `POST /auth/sign-in/anonymous` | No | Public — establishes a session |
| `POST /auth/email-otp/send-verification-otp` | No | Public |
| `POST /auth/wxyc/lookup-email` | No | Public (WXYC-custom, not better-auth) |
| `GET /auth/token` | Yes | Session bearer → JWT |
| `POST /auth/sign-out` | Yes | Session bearer |
