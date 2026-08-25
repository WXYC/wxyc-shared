/**
 * Cross-service contracts (a.k.a. invariants) shared across WXYC services.
 *
 * Each entry in {@link CONTRACTS} names a load-bearing assumption that one
 * service makes about another. The accompanying string is a single-sentence
 * statement of the invariant, suitable for use in test descriptions, code
 * comments, and incident write-ups.
 *
 * The full prose — provider file, consumer file, what breaks if violated,
 * related tickets — lives in `INVARIANTS.md` at the repo root. The E2E
 * suite at `tests/e2e-contracts.test.ts` asserts each invariant against
 * a running stack.
 *
 * Identifiers are stable: a contract's key is part of the public contract
 * vocabulary across repos. Do not rename without coordinating consumers.
 *
 * @example
 * ```ts
 * it(`upholds ${CONTRACTS.PLAY_ORDER_PER_SHOW_MONOTONIC}`, async () => {
 *   // ...
 * });
 * ```
 */
export const CONTRACTS = {
  /**
   * `play_order` is strictly increasing within a single `show_id`.
   *
   * Provider: `Backend-Service/apps/backend/services/flowsheet.service.ts:nextPlayOrder()`
   * Consumer: `dj-site/lib/features/flowsheet/infinite-cache.ts:swapPlayOrdersForSwitch`
   *
   * Status as of 2026-05-01: NOT YET ENFORCED. `nextPlayOrder()` does a global
   * `MAX(play_order)` with no `WHERE show_id` clause; tubafrenzy webhook-set
   * play_orders mix with dj-site's globally-maxed play_orders. Tracked in
   * Backend-Service#693 (build) and Backend-Service#694.
   */
  PLAY_ORDER_PER_SHOW_MONOTONIC:
    'play_order is strictly increasing within a single show_id',

  /**
   * The rotation API returns at most one row per `(album_id, rotation_bin)`.
   *
   * Provider: `Backend-Service/apps/backend/services/library.service.ts:getRotationFromDB`
   * Consumer: `dj-site` rotation dropdown
   *
   * Status as of 2026-05-01: NOT YET ENFORCED. The current INNER JOIN drops
   * 147 NULL-album_id rows and surfaces ~35 albums as duplicates because of
   * tubafrenzy upstream data. Read-side fix tracked in Backend-Service#694.
   */
  ROTATION_DEDUP_PER_ALBUM_BIN:
    'rotation API returns at most one row per (album_id, rotation_bin)',

  /**
   * Backend routes accept a JWT bearer token (verified via JWKS), not a
   * better-auth session token.
   *
   * Provider: `Backend-Service/apps/backend/middleware/requirePermissions` (JWKS verification)
   * Consumer: any HTTP client; canary's `signInDj` does the two-step exchange
   *           (sign-in -> /auth/token -> bearer)
   *
   * Status: ENFORCED. The 2026-04-30 canary deploy ate hours diagnosing this
   * because the contract was implicit. This test pins it.
   */
  BEARER_IS_JWT_NOT_SESSION:
    'backend routes accept JWT bearer (via JWKS), not session token',

  /**
   * `flowsheet.dj_name` is non-NULL on every entry inserted after migration
   * 0053.
   *
   * Provider: `Backend-Service/apps/backend/db/migrations/0053_*.sql` +
   *           `flowsheet.service.ts` insert paths
   * Consumer: dj-site flowsheet UI, tubafrenzy mirror, archive search
   *
   * Status: ENFORCED. Migration 0053 backfilled historical NULLs and the
   * insert paths now require `dj_name`. This test catches a regression
   * where new inserts could re-introduce NULL.
   */
  FLOWSHEET_DJ_NAME_NON_NULL:
    'flowsheet.dj_name is non-NULL on entries inserted after migration 0053',

  /**
   * The `liveFs:update` SSE event payload carries the client-facing flowsheet
   * row (the `FlowsheetEntryResponse` fields), not just `{id, metadata_status}`.
   *
   * Provider: `Backend-Service/apps/backend/services/metadata-broadcast/metadata-broadcast.ts:filterMetadataUpdate`
   * Consumer: `dj-site/lib/features/flowsheet/live-updates-listener.ts`
   *
   * Status: ENFORCED once Backend-Service BS-2 lands. Before BS-2 the payload
   * was `{id, metadata_status}` and a freshly-mounted /live viewer wouldn't see
   * the post-enrichment fields until the next full GET fired. The rich payload
   * is what makes cross-tab cache patching actually work. Since BS#1534 the row
   * is projected through Backend's client-facing allow-list before it hits this
   * anonymous stream — the payload stays sufficient to cache-patch, but internal
   * columns (`search_doc`, `composer`, `legacy_*`, ...) are stripped. The key
   * name is retained for continuity; "full row" now means the full client-facing
   * row, i.e. every `FlowsheetEntryResponse` field.
   */
  LIVE_FS_UPDATE_INCLUDES_FULL_ROW:
    'liveFs:update payload includes the client-facing flowsheet row (FlowsheetEntryResponse fields), not just {id, metadata_status}',

  /**
   * `GET /events/stream?topics=live-fs-topic` accepts anonymous subscription.
   *
   * Provider: `Backend-Service/apps/backend/routes/events.route.ts` (no
   *           `requirePermissions` guard) + `events.controller.ts:streamEventClient`
   *           with `TopicAuthz[Topics.liveFs] = []`.
   * Consumer: dj-site's listener middleware opens `EventSource(...)` from the
   *           browser, which can't attach an Authorization header.
   *
   * Status: ENFORCED once Backend-Service BS-1 lands. Authenticated topics
   * (`showDj`, `primaryDj`, `mirror`) remain role-gated via
   * `filterAuthorizedTopics`; this contract is specifically about the
   * `live-fs-topic` public path.
   */
  LIVE_FS_PUBLIC_TOPIC_NO_AUTH:
    'GET /events/stream?topics=live-fs-topic accepts anonymous subscription',

  /**
   * Every event on the SSE stream carries the shape `{ type, payload, timestamp }`.
   *
   * Provider: `Backend-Service/apps/backend/utils/serverEvents.ts` (`EventData<T>`)
   *           and `metadata-broadcast.ts` (sets `type: FsEvents.update`).
   * Consumer: `dj-site/lib/features/flowsheet/live-updates-listener.ts` parses
   *           by destructuring `{ type, payload }` and routing on `type`.
   *
   * Status: ENFORCED today. The envelope is also part of `LiveFsUpdateEvent` /
   * `LiveFsRefetchEvent` in `api.yaml` so it's machine-checkable across repos.
   * Pinning it here catches a regression where Backend-Service sends a bare
   * payload (`{id: 42}`) instead of `{type, payload, timestamp}`.
   */
  LIVE_FS_EVENT_ENVELOPE_SHAPE:
    'every liveFs event carries the shape { type, payload, timestamp }',

  /**
   * `POST /auth/sign-in/anonymous` returns `{token, user}`, where `user.id`
   * is the newly-created anonymous user's id and a session token arrives on
   * EITHER the `set-auth-token` response header or the body's `token` field
   * (whichever a caller reads).
   *
   * Provider: better-auth's anonymous plugin
   *           (`dist/plugins/anonymous/index.mjs` signInAnonymous) plus the
   *           bearer plugin's response-header mirror
   *           (`dist/plugins/bearer/index.mjs`).
   * Consumer: wxyc-ios-64 / WXYC-Android's `AuthNetworkClient.signInAnonymously`
   *           (the only credential-free auth mechanism those apps have);
   *           `e2e/global-setup.ts` (mints the shared anonymous session
   *           this contract's assertions in `tests/e2e-contracts.test.ts`
   *           and every other e2e file read via `getSharedAnonymousSession`
   *           in `e2e/setup.ts`).
   *
   * Status: ENFORCED. Verified 2026-08-24 against a live POST to
   * api.wxyc.org: the header and body values authenticate interchangeably
   * as a bearer on GET /auth/token (the bearer plugin re-signs a bare
   * token using the server secret when it arrives with no signature
   * segment), so a client reading either succeeds. The full response body
   * also carries the admin() plugin's `role`/`banned`/`banReason`/`banExpires`
   * fields and WXYC's `user.additionalFields` — see `AuthUser` in
   * `api.yaml` for the complete, verified shape.
   */
  ANONYMOUS_SIGN_IN_SHAPE:
    'POST /auth/sign-in/anonymous returns {token, user.id}, with the session token on set-auth-token or the body',

  /**
   * The session token VALUE embedded in `set-auth-token` never changes for
   * the life of a session. `GET /auth/token`'s rolling renewal re-issues
   * the session cookie (and the bearer plugin mirrors it onto
   * `set-auth-token`) only once per `session.updateAge` (Backend-Service:
   * 1 day), but the re-issued value is a DETERMINISTIC RE-ENCODING of the
   * same token — `<token>.<HMAC-base64url>` — never a new token; liveness
   * comes from `expiresAt` being extended server-side under that same
   * token, not from the client persisting a rotated credential. Whenever
   * `set-auth-token` is present, its value starts with the caller's
   * current session token followed by `.`; on an ordinary call inside the
   * renewal window the header is simply absent and the client keeps using
   * the token it already has.
   *
   * This corrects an earlier, false version of this contract
   * (SET_AUTH_TOKEN_ROTATES_ON_RENEWAL) that assumed the re-emitted header
   * carried a NEW token. It does not: see wxyc-ios-64#970's premise
   * correction, verified directly against the better-auth 1.6.30 dist
   * Backend-Service's apps/auth actually loads.
   *
   * Provider: better-auth's session refresh (`GET /auth/token`'s
   *           roll-forward calls `internalAdapter.updateSession(token,
   *           {expiresAt, updatedAt})` — dist/api/routes/session.mjs —
   *           which keys on the token and rewrites only the two timestamp
   *           columns; `token: generateId(32)` runs once at session
   *           creation and no code path rewrites it) plus the bearer
   *           plugin's `after` hook, which mirrors the session cookie's
   *           value (already `<token>.<hmac>` — better-call's signed-cookie
   *           format) onto `set-auth-token` whenever a fresh `set-cookie`
   *           appears (`dist/plugins/bearer/index.mjs`).
   * Consumer: wxyc-dj-ios `AuthService.captureRotatedSessionToken` — its
   *           name predates this correction; the value it captures is a
   *           same-token re-encoding, not a new token. Its guard is a raw
   *           string compare, so the first renewal does overwrite the
   *           stored bare `<token>` with the signed `<token>.<HMAC>`
   *           form — a real write, not a no-op, but a harmless one:
   *           ANONYMOUS_SIGN_IN_SHAPE records that the two
   *           forms authenticate interchangeably as a bearer.
   *
   *           The surviving rationale for keeping that capture surface at
   *           all is wire-compatibility with a future encoding change —
   *           NOT "the token actually rotates." wxyc-ios-64 already
   *           implements it that way: it pins that a `set-auth-token`
   *           header on the JWT exchange leaves the stored token
   *           untouched, and deliberately does not persist the value.
   *           Comments in several client repos still describe rotation as
   *           real; where they disagree with this contract, this contract
   *           is right. `INVARIANTS.md` in the wxyc-shared repo (not
   *           shipped in this package — see it on GitHub) tracks which of
   *           those corrections are still outstanding. Deliberately there
   *           and not here: this file ships on a version tag, so a "still
   *           open" list in it goes stale the moment one of them closes.
   *
   * Status: ENFORCED. Both assertable halves hold unconditionally against
   * a live stack: (1) a brand-new session's first GET /auth/token omits
   * set-auth-token entirely (nowhere near session.updateAge); (2) whenever
   * a sign-in response carries BOTH the header and the body's raw `token`
   * (every sign-in route in this section does), the header value starts
   * with `<body.token>.`. Asserting the renewal case itself — that the
   * header, when it DOES appear on a later call, still carries the SAME
   * token — would need a session aged past session.updateAge (1 day) or a
   * shortened local override, neither available to this harness; that
   * positive-renewal case is left unasserted rather than pinned with an
   * `it.skip` whose target (a NEW token appearing) was never true to begin
   * with.
   */
  SET_AUTH_TOKEN_NEVER_ROTATES:
    'the session token value in set-auth-token never changes for a session; renewal re-encodes the same token as <token>.<hmac> and extends expiresAt, it does not issue a new token',
} as const;

/** A reference to one of the named cross-service contracts. */
export type ContractId = keyof typeof CONTRACTS;

/** The invariant statement for a given contract id. */
export type ContractStatement = (typeof CONTRACTS)[ContractId];
