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
} as const;

/** A reference to one of the named cross-service contracts. */
export type ContractId = keyof typeof CONTRACTS;

/** The invariant statement for a given contract id. */
export type ContractStatement = (typeof CONTRACTS)[ContractId];
