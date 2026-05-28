# Plan: Un-skip 3 `LIVE_FS_*` cross-repo contract tests

## Issue

[WXYC/wxyc-shared#145](https://github.com/WXYC/wxyc-shared/issues/145) — three skipped contract tests in `tests/e2e-contracts.test.ts` were blocked on Backend-Service PRs (BS-1 #1168, BS-2 #1170) that have since merged and auto-deployed. Flip the skips and update `INVARIANTS.md` accordingly.

## Goal

Close the cross-repo contract loop documented in `INVARIANTS.md` for live-updates SSE, so a regression on the BS side (revoking public anonymous access, dropping a payload field, breaking the envelope) is caught by `npm run test:e2e:contracts` in CI.

## Three contracts, three different gating decisions

The issue body says "the three `it.skip(...)` calls become `it.skipIf(!hasCredentials)(...)`". That phrasing works for **one** of the three; for the other two it would needlessly skip CI runs that should pass against any healthy stack. The test bodies clarify which is which:

| Contract | Current state | Right new state | Reason |
|---|---|---|---|
| `LIVE_FS_PUBLIC_TOPIC_NO_AUTH` | `it.skip(...)` | **`it(...)`** (plain) | The whole point of the test is to assert anonymous access works. Gating on `hasCredentials` would mask the regression we're trying to catch — a test that needs no creds should run regardless of whether creds are configured. |
| `LIVE_FS_UPDATE_INCLUDES_FULL_ROW` | `it.skip(...)` with `if (!hasCredentials) skip()` body | **`it.skipIf(!hasCredentials)(...)`** | Test inserts a flowsheet row via authed `client.post`. Needs creds. Already had the inner `skip()` guard, which becomes redundant once `it.skipIf` does the same job at the test-definition level. |
| `LIVE_FS_EVENT_ENVELOPE_SHAPE` | `it.skip(...)` | **`it(...)`** (plain) | Anonymous fetch + read first frame. No creds needed. Same anonymous shape as `LIVE_FS_PUBLIC_TOPIC_NO_AUTH`. |

The two anonymous tests rely on at least one SSE frame arriving within a 5–30s budget. On a quiet stack with no enrichment activity, there are no frames — see "Risk: flakiness" below.

## Changes

### `tests/e2e-contracts.test.ts`

Three precise edits:

1. **`LIVE_FS_PUBLIC_TOPIC_NO_AUTH`** (currently line 231) — replace `it.skip(` with `it(`. Delete the preceding "SKIPPED: Backend-Service BS-1 (#1168) has not landed..." comment block.

2. **`LIVE_FS_UPDATE_INCLUDES_FULL_ROW`** (currently line 263) — replace `it.skip(` with `it.skipIf(!hasCredentials)(`. Drop the inner `if (!hasCredentials) skip()` line since the gate now lives at the test-definition level. Delete the "SKIPPED: Backend-Service BS-2 (#1170) has not landed..." comment block.

3. **`LIVE_FS_EVENT_ENVELOPE_SHAPE`** (currently line 332) — replace `it.skip(` with `it(`. Drop the inner "Skipped until BS-1 (#1168) lands..." comment, keeping the rest of the test body intact.

### `INVARIANTS.md`

Two precise edits:

1. The per-contract **Status** lines (currently lines 52 and 61) change from:
   > **Status (2026-05-26):** **PENDING.** Test is `it.skip`-ed until BS-2/BS-1 ([WXYC/Backend-Service#NNNN](...)) merges and deploys to the E2E target stack.

   to:
   > **Status (2026-05-28):** **ENFORCED.** BS-2 / BS-1 ([WXYC/Backend-Service#NNNN](...)) merged and deployed; test runs against the E2E target.

   The `LIVE_FS_EVENT_ENVELOPE_SHAPE` status (currently line 70) is already **ENFORCED** in copy ("today's `serverEventsMgr.broadcast` already sends the envelope; pinning catches a regression"). The accompanying comment in the test file was the only "PENDING" surface, so no INVARIANTS edit is needed there — but I'll update the date stamp to 2026-05-28 for consistency.

2. The **Toggling skipped contracts** list (currently lines 99–101) drops the three `LIVE_FS_*` entries, leaving only the two remaining skipped contracts (`PLAY_ORDER_PER_SHOW_MONOTONIC`, `ROTATION_DEDUP_PER_ALBUM_BIN`).

## Risk: flakiness in the two anonymous tests

Both `LIVE_FS_PUBLIC_TOPIC_NO_AUTH` and `LIVE_FS_EVENT_ENVELOPE_SHAPE` depend on SSE frames arriving within their respective deadlines (2s / 5s). Looking at each:

- **`LIVE_FS_PUBLIC_TOPIC_NO_AUTH`** doesn't read any frames — it asserts the *connection* succeeds (status 200, `text/event-stream` content-type), then cancels the body. Robust regardless of stack activity. No flakiness risk.

- **`LIVE_FS_EVENT_ENVELOPE_SHAPE`** *does* read frames — it loops `await reader.read()` until a `data:` frame arrives or 5s elapses. On a quiet stack with no enrichment activity, no frames arrive and the test fails with "expected at least one SSE frame". This is genuinely flaky against `api.wxyc.org` outside DJ-active hours.

**Trade-off.** The cleanest fix is to make the envelope test self-trigger: POST a flowsheet row (like `LIVE_FS_UPDATE_INCLUDES_FULL_ROW` does), wait for the matching frame, assert envelope shape. That converts the envelope test into an authed test, gated on `hasCredentials`. Net change to the spec is small.

**Decision.** Make the envelope test self-trigger and gate it on `hasCredentials`. The contract is "every emitted frame has `{type, payload, timestamp}`", and the only way to reliably observe a frame is to cause one to be emitted. The bonus: the existing 5s deadline becomes the timeout for "enrichment fires" and the test no longer depends on ambient stack activity.

Updated final table:

| Contract | Right new state | Reason |
|---|---|---|
| `LIVE_FS_PUBLIC_TOPIC_NO_AUTH` | `it(...)` | Pure connection check, no frames consumed. |
| `LIVE_FS_UPDATE_INCLUDES_FULL_ROW` | `it.skipIf(!hasCredentials)(...)` | Inserts row, reads frames. |
| `LIVE_FS_EVENT_ENVELOPE_SHAPE` | `it.skipIf(!hasCredentials)(...)` | Inserts row to guarantee a frame arrives, then asserts envelope shape. |

This reverses the "two of three should not gate on creds" table earlier — the envelope test gets self-triggering for reliability.

## Constraints honored

| Issue constraint | How it's met |
|---|---|
| "Tests must remain runnable both with and without `E2E_TEST_DJ_EMAIL` configured" | `LIVE_FS_PUBLIC_TOPIC_NO_AUTH` runs unconditionally (no creds needed). The other two use `it.skipIf(!hasCredentials)` so a credential-less run still passes. |
| "No package version bump — test-only change" | No edits to `package.json` / `api.yaml` / `src/contracts.ts`. |
| "Sentry / PostHog spans should NOT be emitted from the SSE-anonymous test" | `tests/e2e-contracts.test.ts` doesn't import Sentry or PostHog at all — the test runner is plain Vitest against `node:fetch`. No change needed. |

## Acceptance

- `npm run test:e2e:contracts` passes locally against `E2E_BASE_URL=http://localhost:8080` (when credentials are configured) and against `https://api.wxyc.org` (in CI's release-validation flow).
- The 3 newly-active tests pass against prod.
- `INVARIANTS.md` no longer lists the three contracts under **Toggling skipped contracts**.
- Status lines for `LIVE_FS_UPDATE_INCLUDES_FULL_ROW` and `LIVE_FS_PUBLIC_TOPIC_NO_AUTH` change from **PENDING** to **ENFORCED**.
- No new dependencies, no `src/` changes — test-only diff.

## File summary

| File | Action | Notes |
|---|---|---|
| `tests/e2e-contracts.test.ts` | modify | Flip 3 `it.skip` → `it` / `it.skipIf(!hasCredentials)`; rewrite envelope test to self-trigger; drop 3 "SKIPPED:" comment blocks |
| `INVARIANTS.md` | modify | 2 status lines PENDING → ENFORCED; drop 3 entries from the "Toggling skipped contracts" list |
| `docs/plans/unskip-live-fs-contracts.md` | new | This file |
