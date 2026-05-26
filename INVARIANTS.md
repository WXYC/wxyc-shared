# Cross-service invariants

This document names the load-bearing cross-service contracts in WXYC. Each entry has a typed identifier in `src/contracts.ts` (importable as `CONTRACTS.<ID>` from `@wxyc/shared`) and an E2E test in `tests/e2e-contracts.test.ts` that asserts the invariant against a running stack.

If an entry here is wrong, two things break: someone wastes a half-day diagnosing a "should obviously work" symptom (see Backend-Service#693, the 2026-04-30 canary auth incident), and the contract drifts further from reality with every new feature. Keep this file aligned with reality. When you change a provider's behavior, update the contract; when you add a consumer, scan this file for assumptions you're inheriting.

## Backend-Service -> dj-site / iOS / Android

### `CONTRACTS.PLAY_ORDER_PER_SHOW_MONOTONIC`

> `play_order` is strictly increasing within a single `show_id`.

- **Provider:** `Backend-Service/apps/backend/services/flowsheet.service.ts:nextPlayOrder()` after [WXYC/Backend-Service#693](https://github.com/WXYC/Backend-Service/issues/693).
- **Consumer:** `dj-site/lib/features/flowsheet/infinite-cache.ts:swapPlayOrdersForSwitch` and any client that does optimistic-update reconciliation against play_order.
- **What breaks if violated:** dj-site's optimistic-update + cache reconciliation falls apart even though server mutations succeed. The on-air DJ sees the UI fail to reflect successful PATCH/DELETE calls; talkset/insert can hit the 5s nextPlayOrder() timeout. This is exactly the 2026-05-01 flowsheet incident (BS#693, BS#694, dj-site#478).
- **Status (2026-05-01):** **NOT YET ENFORCED.** `nextPlayOrder()` does a global `MAX(play_order)` with no `WHERE show_id`. Tubafrenzy's webhook-set play_orders mix with dj-site's globally-maxed play_orders. Test is `it.skip`-ed until BS#693 lands.

### `CONTRACTS.ROTATION_DEDUP_PER_ALBUM_BIN`

> The rotation API returns at most one row per `(album_id, rotation_bin)`.

- **Provider:** `Backend-Service/apps/backend/services/library.service.ts:getRotationFromDB` after [WXYC/Backend-Service#694](https://github.com/WXYC/Backend-Service/issues/694)'s read-side fix.
- **Consumer:** `dj-site` rotation dropdown.
- **What breaks if violated:** the rotation dropdown shows the same album multiple times in the same bin (Heavy/Medium/Light), making selection ambiguous and burying valid rows. The current INNER JOIN drops 147 NULL-album_id rows and surfaces about 35 albums as duplicates because of tubafrenzy upstream data (filed as #689).
- **Status (2026-05-01):** **NOT YET ENFORCED.** Read-side dedup not yet shipped. Test is `it.skip`-ed until BS#694 lands.

### `CONTRACTS.BEARER_IS_JWT_NOT_SESSION`

> Backend routes accept a JWT bearer token (verified via JWKS), not a better-auth session token.

- **Provider:** `Backend-Service/apps/backend/middleware/requirePermissions` -- verifies via JWKS endpoint exposed by the auth service.
- **Consumer:** any HTTP client. The two-step exchange is: better-auth `/auth/sign-in/email` to get session cookies, then `/auth/token` with those cookies to mint a short-lived JWT, then `Authorization: Bearer <jwt>` against backend routes. See `wxyc-canary/signInDj` and `e2e/setup.ts:E2EAuthHelper` for reference implementations.
- **What breaks if violated:** every authenticated backend request 401s. The canary deploy on 2026-04-30 ate hours because clients were sending the session token directly and the symptom was a generic 401.
- **Status:** **ENFORCED.** Asserting it nails the contract so a regression in either direction (backend stops accepting JWT, or starts accepting session tokens) gets caught.

### `CONTRACTS.FLOWSHEET_DJ_NAME_NON_NULL`

> `flowsheet.dj_name` is non-NULL on every entry inserted after migration 0053.

- **Provider:** `Backend-Service/apps/backend/db/migrations/0053_*.sql` (backfill) + the flowsheet insert paths in `flowsheet.service.ts`.
- **Consumer:** dj-site flowsheet UI (renders DJ name on each row), tubafrenzy mirror (requires it on POST), archive search (groups by DJ).
- **What breaks if violated:** the UI shows "undefined" or empty rows in show headers; the tubafrenzy webhook payload validation fails; archive search drops the entry from DJ-grouped views. Migration 0053 fixed the historical backfill -- the test guards against a regression on the insert side.
- **Status:** **ENFORCED.** Asserted by adding an entry as the test DJ and reading it back via `/v2/flowsheet`.

### `CONTRACTS.LIVE_FS_UPDATE_INCLUDES_FULL_ROW`

> The `liveFs:update` SSE event payload carries the full flowsheet row, not just `{id, metadata_status}`.

- **Provider:** `Backend-Service/apps/backend/services/metadata-broadcast/metadata-broadcast.ts:filterMetadataUpdate` after [WXYC/Backend-Service#1170](https://github.com/WXYC/Backend-Service/pull/1170) (BS-2 of the live-updates SSE plan).
- **Consumer:** `dj-site/lib/features/flowsheet/live-updates-listener.ts` patches the RTK Query cache row with whatever payload arrives.
- **What breaks if violated:** a /live viewer that just mounted the page has no cached copy to merge into and the post-enrichment fields (`artwork_url`, `release_year`, ...) won't show until the next full GET fires. The dashboards survive because they already have the row cached, but cross-tab visibility for a freshly-mounted viewer breaks.
- **Status (2026-05-26):** **PENDING.** Test is `it.skip`-ed until BS-2 ([WXYC/Backend-Service#1170](https://github.com/WXYC/Backend-Service/pull/1170)) merges and deploys to the E2E target stack.

### `CONTRACTS.LIVE_FS_PUBLIC_TOPIC_NO_AUTH`

> `GET /events/stream?topics=live-fs-topic` accepts anonymous subscription.

- **Provider:** `Backend-Service/apps/backend/routes/events.route.ts` (no `requirePermissions` guard on the `GET /stream` route) + `events.controller.ts:streamEventClient` with `TopicAuthz[Topics.liveFs] = []` after [WXYC/Backend-Service#1168](https://github.com/WXYC/Backend-Service/pull/1168) (BS-1 of the live-updates SSE plan).
- **Consumer:** dj-site's listener middleware opens `EventSource(${BACKEND_URL}/events/stream?topics=live-fs-topic)` from the browser. Native EventSource is GET-only and can't attach an `Authorization` header — anonymous subscription is the whole point of the route.
- **What breaks if violated:** every browser EventSource fires `onerror` with no useful diagnostic. The live-updates feature stops working in dashboards and on `/live` — clients fall back to the 60s safety poll. Authenticated topics (`showDj`, `primaryDj`, `mirror`) remain role-gated via `filterAuthorizedTopics`; this contract is specifically about `live-fs-topic`.
- **Status (2026-05-26):** **PENDING.** Test is `it.skip`-ed until BS-1 ([WXYC/Backend-Service#1168](https://github.com/WXYC/Backend-Service/pull/1168)) merges and deploys to the E2E target stack.

### `CONTRACTS.LIVE_FS_EVENT_ENVELOPE_SHAPE`

> Every event on the SSE stream carries the shape `{ type, payload, timestamp }`.

- **Provider:** `Backend-Service/apps/backend/utils/serverEvents.ts` (`EventData<T> = { type, payload, timestamp? }`); `metadata-broadcast.ts` sets `type: FsEvents.update`.
- **Consumer:** `dj-site/lib/features/flowsheet/live-updates-listener.ts` parses each frame by destructuring `{ type, payload }` and routing on `type`.
- **What breaks if violated:** the listener middleware can't tell `update` from `refetch`. Either the surgical-patch path runs against a refetch payload (typeError) or the debounced invalidate runs against an update payload (extra refetch latency). The envelope is also pinned in `api.yaml` via the `LiveFsUpdateEvent` / `LiveFsRefetchEvent` schemas so a future BS change that ships a bare payload (`{id: 42}`) breaks two checks at once.
- **Status:** **ENFORCED.** Today's `serverEventsMgr.broadcast` already sends the envelope; pinning catches a regression where someone bypasses it.

## Future invariants to add

The starter set above is deliberately small (4 items). Candidates for follow-ups, ordered roughly by cost-of-violation:

- **Sentry filters statusCode<500** -- ops contract; clients reading Sentry to diagnose 4xx-class symptoms get burned (see #691). Belongs in INVARIANTS but is asserted by Sentry config, not E2E.
- **dj-site auths via same-origin proxy, not directly to api.wxyc.org** -- the canary debugging on 2026-04-30 surfaced this. Add a test that POSTs to `/api/...` from a same-origin context and verifies the cookie round-trip.
- **Tubafrenzy webhook -> Backend-Service mirror is at-least-once delivery** -- the existing `e2e/mirror.test.ts` covers happy-path round-trip; an explicit invariant for "POST eventually appears on tubafrenzy" with idempotency should be lifted out.
- **`/auth/token` returns a JWT with `role` set to a value in `WXYCRoles`** -- partially covered by `e2e/auth.test.ts`; lift it to a CONTRACT so it's grep-discoverable.
- **`/healthcheck` is the canonical health path on Backend-Service (not `/health`)** -- already documented in MEMORY.md; this is the kind of cheap, easy-to-violate invariant that bit a deploy.
- **LML calls use `Authorization: Bearer <LML_API_KEY>`** -- as of 2026-05-01 LML prod enforces auth; all 3 consumers (rom, BS, tubafrenzy) wire the bearer. Asserting via E2E requires LML reachable from CI.
- **Rotation `add_date` is set to today (UTC) on POST when omitted** -- mentioned in API spec; not asserted.
- **`flowsheet.show_id` is set on every row produced by `/flowsheet/join`** -- 2026-05-01 incident showed this can drift via tubafrenzy.
- **Backend-Service mirrors PATCH and DELETE to tubafrenzy within 15s** -- existing `mirror.test.ts` covers POST and PATCH; DELETE missing.

When adding a new contract:

1. Add a key + statement + JSDoc block to `src/contracts.ts`. The JSDoc must include provider path, consumer path, and "what breaks if violated".
2. Add a section to this file with the same five fields plus current enforcement status.
3. Add an `it(\`upholds ${CONTRACTS.X}...\`, ...)` test in `tests/e2e-contracts.test.ts`. If the invariant is not yet enforced, use `it.skip` and explain in a comment what's blocking enforcement.
4. Wire the test into CI via `npm run test:e2e:contracts`.

## Toggling skipped contracts

Skipped contracts as of 2026-05-26, each guarded by a comment naming the blocking BS PR/issue (grep `it.skip` in `tests/e2e-contracts.test.ts`):

- `PLAY_ORDER_PER_SHOW_MONOTONIC` — blocked on [BS#693](https://github.com/WXYC/Backend-Service/issues/693).
- `ROTATION_DEDUP_PER_ALBUM_BIN` — blocked on [BS#694](https://github.com/WXYC/Backend-Service/issues/694).
- `LIVE_FS_PUBLIC_TOPIC_NO_AUTH` — blocked on [BS#1168](https://github.com/WXYC/Backend-Service/pull/1168) (BS-1).
- `LIVE_FS_UPDATE_INCLUDES_FULL_ROW` — blocked on [BS#1170](https://github.com/WXYC/Backend-Service/pull/1170) (BS-2).
- `LIVE_FS_EVENT_ENVELOPE_SHAPE` — blocked on BS#1168 (needs the public GET endpoint reachable to exercise the assertion). The shape is already enforced server-side; this is just the E2E.

When the blocking change ships, flip `it.skip(...)` to `it(...)` for the corresponding test.
