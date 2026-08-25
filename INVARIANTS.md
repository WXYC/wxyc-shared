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
- **Consumer:** any HTTP client. The two-step exchange is: better-auth `/auth/sign-in/email` to get a session token, then `/auth/token` with that token to mint a short-lived JWT, then `Authorization: Bearer <jwt>` against backend routes. See `wxyc-canary/signInDj` and `e2e/setup.ts:exchangeSessionForJwt` (used from the shared session `e2e/global-setup.ts` mints) for reference implementations.
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
- **Status (2026-05-28):** **ENFORCED.** BS-2 ([WXYC/Backend-Service#1170](https://github.com/WXYC/Backend-Service/pull/1170)) merged and deployed; the contract test runs against the E2E target.

### `CONTRACTS.LIVE_FS_PUBLIC_TOPIC_NO_AUTH`

> `GET /events/stream?topics=live-fs-topic` accepts anonymous subscription.

- **Provider:** `Backend-Service/apps/backend/routes/events.route.ts` (no `requirePermissions` guard on the `GET /stream` route) + `events.controller.ts:streamEventClient` with `TopicAuthz[Topics.liveFs] = []` after [WXYC/Backend-Service#1168](https://github.com/WXYC/Backend-Service/pull/1168) (BS-1 of the live-updates SSE plan).
- **Consumer:** dj-site's listener middleware opens `EventSource(${BACKEND_URL}/events/stream?topics=live-fs-topic)` from the browser. Native EventSource is GET-only and can't attach an `Authorization` header — anonymous subscription is the whole point of the route.
- **What breaks if violated:** every browser EventSource fires `onerror` with no useful diagnostic. The live-updates feature stops working in dashboards and on `/live` — clients fall back to the 60s safety poll. Authenticated topics (`showDj`, `primaryDj`, `mirror`) remain role-gated via `filterAuthorizedTopics`; this contract is specifically about `live-fs-topic`.
- **Status (2026-05-28):** **ENFORCED.** BS-1 ([WXYC/Backend-Service#1168](https://github.com/WXYC/Backend-Service/pull/1168)) merged and deployed; the contract test runs against the E2E target.

### `CONTRACTS.LIVE_FS_EVENT_ENVELOPE_SHAPE`

> Every event on the SSE stream carries the shape `{ type, payload, timestamp }`.

- **Provider:** `Backend-Service/apps/backend/utils/serverEvents.ts` (`EventData<T> = { type, payload, timestamp? }`); `metadata-broadcast.ts` sets `type: FsEvents.update`.
- **Consumer:** `dj-site/lib/features/flowsheet/live-updates-listener.ts` parses each frame by destructuring `{ type, payload }` and routing on `type`.
- **What breaks if violated:** the listener middleware can't tell `update` from `refetch`. Either the surgical-patch path runs against a refetch payload (typeError) or the debounced invalidate runs against an update payload (extra refetch latency). The envelope is also pinned in `api.yaml` via the `LiveFsUpdateEvent` / `LiveFsRefetchEvent` schemas so a future BS change that ships a bare payload (`{id: 42}`) breaks two checks at once.
- **Status:** **ENFORCED.** Today's `serverEventsMgr.broadcast` already sends the envelope; pinning catches a regression where someone bypasses it.

### `CONTRACTS.ANONYMOUS_SIGN_IN_SHAPE`

> `POST /auth/sign-in/anonymous` returns `{token, user}`, where `user.id` is the newly-created anonymous user's id and a session token arrives on either the `set-auth-token` response header or the body's `token` field.

- **Provider:** better-auth's anonymous plugin (`dist/plugins/anonymous/index.mjs` `signInAnonymous`) plus the bearer plugin's response-header mirror (`dist/plugins/bearer/index.mjs`).
- **Consumer:** wxyc-ios-64 / WXYC-Android's `AuthNetworkClient.signInAnonymously` — the only credential-free auth mechanism those apps have; `e2e/global-setup.ts` (mints the shared anonymous session this contract's assertions in `tests/e2e-contracts.test.ts`, and every other e2e file, read via `getSharedAnonymousSession` in `e2e/setup.ts`).
- **What breaks if violated:** a client reading only the header (or only the body) stops obtaining a session token, and every anonymous-gated route (`/proxy/*`, `/concerts` after a `/auth/token` exchange) 401s from launch.
- **Status (2026-08-24):** **ENFORCED.** Verified directly against a live `POST` to `api.wxyc.org`: the header and body token values authenticate interchangeably as a bearer on `GET /auth/token` — the bearer plugin re-signs a bare (unsigned) token using the server secret when it arrives with no signature segment, so a client reading either succeeds. The response body also carries the `admin()` plugin's `role`/`banned`/`banReason`/`banExpires` fields and WXYC's `user.additionalFields`; see `AuthUser` in `api.yaml` for the complete, verified shape (issue #379).

### `CONTRACTS.SET_AUTH_TOKEN_NEVER_ROTATES`

> The session token value carried in `set-auth-token` never changes for the life of a session. `GET /auth/token`'s rolling renewal (once per `session.updateAge`, Backend-Service: 1 day) re-issues the header, but the value is a deterministic re-encoding of the SAME token — `<token>.<HMAC-base64url>` — never a new token; liveness comes from `expiresAt` being extended server-side, not from the client persisting a rotated credential. An ordinary call inside the renewal window omits the header entirely.

This corrects an earlier, false version of this contract, `SET_AUTH_TOKEN_ROTATES_ON_RENEWAL`, which assumed the re-emitted header carried a new token — it does not. See [wxyc-ios-64#970's premise correction](https://github.com/WXYC/wxyc-ios-64/issues/970), verified directly against `apps/auth/node_modules/better-auth` (1.6.30, the version Backend-Service's auth app actually loads): `GET /auth/token`'s roll-forward calls `internalAdapter.updateSession(session.session.token, { expiresAt, updatedAt })` (`dist/api/routes/session.mjs`), which keys on the token and writes only the two timestamp columns; `token: generateId(32)` runs once at session creation and no code path in the package rewrites it. The `set-auth-token` header re-emitted on renewal is `HMAC(token, secret)` appended to that same token (`dist/cookies/index.mjs`, mirrored via `dist/plugins/bearer/index.mjs`'s `after` hook reading the session cookie's already-signed value) — a deterministic re-encoding of the credential the client already holds, interchangeable with the raw form as a bearer.

- **Provider:** better-auth's session refresh (`GET /auth/token`'s roll-forward, `dist/api/routes/session.mjs`) plus the bearer plugin's `after` hook, which mirrors the session cookie's signed value onto `set-auth-token` whenever a fresh `set-cookie` appears (`dist/plugins/bearer/index.mjs`).
- **Consumer:** wxyc-dj-ios `AuthService.captureRotatedSessionToken` — the method name predates this correction; the value it captures is a same-token re-encoding, not a new token. Persisting it is a no-op wherever the guard already compares decoded-token equality. The wxyc-swift-auth plan has **not** yet been corrected: its Phase B/D1 text still reads "D1 — rotation capture" and still declares `rotatedSessionToken // set-auth-token when the server rotated`, and [wxyc-ios-64#970](https://github.com/WXYC/wxyc-ios-64/issues/970) is still open under the title "capture set-auth-token rotation in mintJWT". [WXYC/wiki#121](https://github.com/WXYC/wiki/pull/121) is the open PR that rewrites that rationale to the one that survives this correction — wire-compatibility with a future encoding change, not "the token actually rotates." Once it merges, restate this bullet in the past tense and drop the pointer.
- **What breaks if violated:** if the token value ever DID change silently (contradicting this contract), a client that ignores `set-auth-token` and keeps using its original token would eventually be rejected once the server-side record no longer matches — the failure this contract exists to name if the underlying mechanism ever changes. Under the current (correct) mechanism, a client that ignores the header entirely is fine as long as it doesn't let its local token go stale relative to `expiresAt`.
- **Status (2026-08-24):** **ENFORCED**, on the two halves that are honestly assertable against a live stack without an aged session: (1) a brand-new session's first `GET /auth/token` call omits `set-auth-token` entirely — nowhere near `session.updateAge`; (2) whenever a sign-in response carries both the header and the body's raw `token` field (every sign-in route in this section does), the header value starts with `<body.token>.` — the deterministic-prefix property. Asserting the renewal case itself (that a header appearing on a LATER call still carries the same token) needs a session aged past `session.updateAge` or a shortened local override, neither available to this harness; that case is left unasserted rather than pinned with an `it.skip` whose target was never true to begin with. See [wxyc-ios-64#970](https://github.com/WXYC/wxyc-ios-64/issues/970) for the aged-session tracking issue if that capability is ever added.

## Future invariants to add

The set above is deliberately small: it covers invariants whose violation has already cost us something, not everything that could in principle be asserted. (It said "4 items" from the day it was written until this edit, by which point there were nine — a hardcoded count in prose next to a list that grows is a claim nothing checks, so it is stated as a property here instead of a number.) Candidates for follow-ups, ordered roughly by cost-of-violation:

- **Sentry filters statusCode<500** -- ops contract; clients reading Sentry to diagnose 4xx-class symptoms get burned (see #691). Belongs in INVARIANTS but is asserted by Sentry config, not E2E.
- **dj-site auths via same-origin proxy, not directly to api.wxyc.org** -- the canary debugging on 2026-04-30 surfaced this. Add a test that POSTs to `/api/...` from a same-origin context and verifies the cookie round-trip.
- **Backend-Service serves `/playlists/recentEntries` from its own store, not by proxying tubafrenzy** -- the flowsheet source-of-truth flip ([WXYC/wiki#88](https://github.com/WXYC/wiki/issues/88)); covered today as a plain E2E test in `e2e/recent-entries.test.ts`, worth lifting to a CONTRACT so the source-of-truth is grep-discoverable. Supersedes the former Backend-Service -> tubafrenzy mirror candidates, retired with the mirror-off.
- **Tubafrenzy -> Backend-Service webhook push is at-least-once delivery** -- the still-live inbound real-time flowsheet mirror from tubafrenzy into Backend-Service (distinct from the retired Backend-Service -> tubafrenzy direction above); an idempotency + "every webhook eventually lands" invariant is worth asserting while the webhook remains live, i.e. until the tubafrenzy turndown.
- **`/auth/token` returns a JWT with `role` set to a value in `WXYCRoles`** -- partially covered by `e2e/auth.test.ts`; lift it to a CONTRACT so it's grep-discoverable.
- **`/healthcheck` is the canonical health path on Backend-Service (not `/health`)** -- already documented in MEMORY.md; this is the kind of cheap, easy-to-violate invariant that bit a deploy.
- **LML calls use `Authorization: Bearer <LML_API_KEY>`** -- as of 2026-05-01 LML prod enforces auth; all 3 consumers (rom, BS, tubafrenzy) wire the bearer. Asserting via E2E requires LML reachable from CI.
- **Rotation `add_date` is set to today (UTC) on POST when omitted** -- mentioned in API spec; not asserted.
- **`flowsheet.show_id` is set on every row produced by `/flowsheet/join`** -- 2026-05-01 incident showed this can drift via tubafrenzy.

When adding a new contract:

1. Add a key + statement + JSDoc block to `src/contracts.ts`. The JSDoc must include provider path, consumer path, and "what breaks if violated".
2. Add a section to this file with the same five fields plus current enforcement status.
3. Add an `it(\`upholds ${CONTRACTS.X}...\`, ...)` test in `tests/e2e-contracts.test.ts`. If the invariant is not yet enforced, use `it.skip` and explain in a comment what's blocking enforcement.
4. Wire the test into CI via `npm run test:e2e:contracts`.

## Toggling skipped contracts

Skipped contracts as of 2026-08-24, each guarded by a comment naming the blocking BS PR/issue (grep `it.skip` in `tests/e2e-contracts.test.ts`):

- `PLAY_ORDER_PER_SHOW_MONOTONIC` — blocked on [BS#693](https://github.com/WXYC/Backend-Service/issues/693).
- `ROTATION_DEDUP_PER_ALBUM_BIN` — blocked on [BS#694](https://github.com/WXYC/Backend-Service/issues/694).

`SET_AUTH_TOKEN_NEVER_ROTATES` is **not** in this skip list — both of its honestly-assertable halves (header-absent-on-a-fresh-session, and the deterministic-prefix property) run unconditionally with no blocker. There is no positive-renewal assertion left to unskip: the one an earlier version of this contract carried (`SET_AUTH_TOKEN_ROTATES_ON_RENEWAL`'s `it.skip`) asserted a NEW token appearing on renewal, which the corrected contract says never happens — see this contract's entry above and [wxyc-ios-64#970](https://github.com/WXYC/wxyc-ios-64/issues/970).

When the blocking change ships, flip `it.skip(...)` to `it(...)` for the corresponding test.
