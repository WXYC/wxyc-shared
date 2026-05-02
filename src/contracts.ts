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
} as const;

/** A reference to one of the named cross-service contracts. */
export type ContractId = keyof typeof CONTRACTS;

/** The invariant statement for a given contract id. */
export type ContractStatement = (typeof CONTRACTS)[ContractId];
