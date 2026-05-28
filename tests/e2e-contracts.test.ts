/**
 * Cross-service contract E2E tests.
 *
 * One test per entry in `CONTRACTS` (see `src/contracts.ts`). Each test
 * documents the named invariant in its description so a failure in CI
 * names the contract that broke.
 *
 * Two contracts (PLAY_ORDER_PER_SHOW_MONOTONIC, ROTATION_DEDUP_PER_ALBUM_BIN)
 * are NOT yet enforced on the server side. Those tests are `it.skip`-ed; the
 * assertion bodies still describe target state. To enable them, replace
 * `it.skip` with `it` once the BS-side fix lands (see comments inline).
 *
 * Prerequisites:
 *   - Backend service at $E2E_BASE_URL (default http://localhost:8080)
 *   - Auth service at $E2E_AUTH_URL (default http://localhost:8081/auth)
 *   - Test DJ account: $E2E_TEST_DJ_EMAIL / $E2E_TEST_DJ_PASSWORD
 *
 * Run with:
 *   npm run test:e2e:contracts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createE2EClient,
  createE2EAuthHelper,
  type E2EClient,
  type E2EAuthHelper,
  waitForService,
  getE2EConfig,
} from '../e2e/setup.js';
import { CONTRACTS } from '../src/contracts.js';
import type {
  FlowsheetEntryResponse,
  FlowsheetCreateSongFreeform,
} from '../src/generated/models/index.js';

/**
 * Set of role values recognized by the backend's `requirePermissions`
 * middleware after `normalizeRole()` runs. A JWT carrying any of these
 * is sufficient to authorize an authenticated request.
 */
const VALID_BACKEND_ROLES = new Set([
  'member',
  'dj',
  'musicDirector',
  'stationManager',
  'admin',
]);

describe('Cross-service contracts (E2E)', () => {
  let client: E2EClient;
  let authHelper: E2EAuthHelper;
  const config = getE2EConfig();

  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);
  const uniqueSuffix = Date.now().toString(36);

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
    authHelper = createE2EAuthHelper();

    if (hasCredentials) {
      const { payload } = await authHelper.authenticateClient(
        client,
        config.testDjEmail!,
        config.testDjPassword!
      );

      // Join a show so we can post flowsheet entries.
      const djId = payload.sub || payload.id;
      await client.post('/flowsheet/join', { dj_id: djId });
    }
  });

  afterAll(async () => {
    if (hasCredentials) {
      try {
        await client.post('/flowsheet/end', {});
      } catch {
        // best effort
      }
    }
  });

  // ── PLAY_ORDER_PER_SHOW_MONOTONIC ────────────────────────────────────
  //
  // SKIPPED: Backend-Service#693 has not landed. `nextPlayOrder()` does a
  // global MAX(play_order) with no WHERE show_id, so tubafrenzy webhook-set
  // play_orders mix with dj-site's globally-maxed ones. Flip `it.skip` to
  // `it` once #693 is merged and deployed.
  it.skip(
    `upholds CONTRACTS.PLAY_ORDER_PER_SHOW_MONOTONIC: ${CONTRACTS.PLAY_ORDER_PER_SHOW_MONOTONIC}`,
    async ({ skip }) => {
      if (!hasCredentials) skip();

      // Add 5 freeform entries in a row.
      const created: FlowsheetEntryResponse[] = [];
      for (let i = 0; i < 5; i++) {
        const body: FlowsheetCreateSongFreeform = {
          artist_name: `Contract Artist ${uniqueSuffix}`,
          album_title: `Contract Album ${uniqueSuffix}`,
          track_title: `Contract Track ${i} ${uniqueSuffix}`,
          request_flag: false,
        };
        const resp = await client.post<FlowsheetEntryResponse>('/flowsheet', body);
        expect(resp.ok, `POST /flowsheet failed at index ${i}`).toBe(true);
        created.push(resp.body);
      }

      // All 5 entries must share the same show_id (we just joined a show).
      const showIds = new Set(created.map((e) => e.show_id));
      expect(showIds.size, 'all 5 entries should be in the same show').toBe(1);

      // play_order must be strictly increasing within that show.
      // VIOLATION SYMPTOM: dj-site's swapPlayOrdersForSwitch reconciliation
      // breaks (PR/incident: WXYC/Backend-Service#693, dj-site#478).
      for (let i = 1; i < created.length; i++) {
        expect(
          created[i].play_order,
          `entry ${i} play_order ${created[i].play_order} must be > entry ${i - 1} play_order ${created[i - 1].play_order}`
        ).toBeGreaterThan(created[i - 1].play_order);
      }
    }
  );

  // ── ROTATION_DEDUP_PER_ALBUM_BIN ─────────────────────────────────────
  //
  // SKIPPED: Backend-Service#694's read-side dedup has not landed. The
  // current INNER JOIN drops 147 NULL-album_id rows and surfaces ~35
  // albums as duplicates because of tubafrenzy upstream data. Flip
  // `it.skip` to `it` once #694 is merged and deployed.
  it.skip(
    `upholds CONTRACTS.ROTATION_DEDUP_PER_ALBUM_BIN: ${CONTRACTS.ROTATION_DEDUP_PER_ALBUM_BIN}`,
    async ({ skip }) => {
      if (!hasCredentials) skip();

      const resp = await client.get<
        Array<{ id?: number | null; play_freq?: string | null }>
      >('/library/rotation');
      expect(resp.ok).toBe(true);
      expect(Array.isArray(resp.body)).toBe(true);

      // Group by (album_id, rotation_bin). The legacy /library/rotation
      // schema exposes album identity via `id` (the album id) and bin via
      // `play_freq`. Each (album_id, bin) pair must appear at most once.
      // VIOLATION SYMPTOM: dj-site rotation dropdown shows the same album
      // multiple times in the same bin (WXYC/Backend-Service#694, #689).
      const seen = new Map<string, number>();
      for (const row of resp.body) {
        if (row.id == null || row.play_freq == null) continue;
        const key = `${row.id}|${row.play_freq}`;
        seen.set(key, (seen.get(key) ?? 0) + 1);
      }

      const duplicates = [...seen.entries()].filter(([, count]) => count > 1);
      expect(
        duplicates,
        `rotation API returned duplicate (album_id, rotation_bin) pairs: ${JSON.stringify(duplicates)}`
      ).toEqual([]);
    }
  );

  // ── BEARER_IS_JWT_NOT_SESSION ────────────────────────────────────────
  //
  // ENFORCED. The 2026-04-30 canary deploy ate hours diagnosing this
  // because the contract was implicit; this test pins it.
  it.skipIf(!hasCredentials)(
    `upholds CONTRACTS.BEARER_IS_JWT_NOT_SESSION: ${CONTRACTS.BEARER_IS_JWT_NOT_SESSION}`,
    async () => {
      // Fresh sign-in to capture both the session cookies and the JWT.
      const helper = createE2EAuthHelper();
      const { cookies } = await helper.signIn(
        config.testDjEmail!,
        config.testDjPassword!
      );
      const jwt = await helper.getJWTToken();
      expect(jwt, 'sign-in must mint a JWT via /auth/token').not.toBeNull();

      // 1. JWT is shape-correct (header.payload.sig, RS256, has role + sub).
      const parts = jwt!.token.split('.');
      expect(parts.length, 'JWT must be a 3-segment compact serialization').toBe(3);
      const header = JSON.parse(
        Buffer.from(parts[0], 'base64url').toString('utf-8')
      );
      expect(header.alg, 'JWT must be RS256-signed (JWKS-verifiable)').toBe(
        'RS256'
      );
      expect(jwt!.payload.role, 'JWT must carry a role claim').toBeTruthy();
      expect(
        VALID_BACKEND_ROLES.has(jwt!.payload.role as string),
        `JWT role "${jwt!.payload.role}" must be one the backend recognizes`
      ).toBe(true);

      // 2. JWT bearer succeeds against a protected route.
      const jwtClient = createE2EClient();
      jwtClient.setAuthToken(jwt!.token);
      const okResp = await jwtClient.get('/library?artist_name=test');
      // 200 (results) or 404 (no match) are both fine; never 401.
      expect(
        okResp.status,
        `JWT bearer must NOT be rejected by /library (got ${okResp.status})`
      ).not.toBe(401);
      expect(okResp.status).not.toBe(403);

      // 3. Session cookie value (NOT a JWT) used as a bearer must be rejected.
      // VIOLATION SYMPTOM: clients send the session token directly, get 401,
      // burn hours diagnosing. This is exactly the canary deploy outage.
      const sessionTokenLike = cookies
        .map((c) => c.split('=')[1]?.split(';')[0])
        .find((v) => Boolean(v));
      if (sessionTokenLike) {
        const sessClient = createE2EClient();
        sessClient.setAuthToken(sessionTokenLike);
        const sessResp = await sessClient.get('/library?artist_name=test');
        expect(
          sessResp.status,
          'session token used as bearer must be rejected (not JWT)'
        ).toBe(401);
      }
    }
  );

  // ── LIVE_FS_PUBLIC_TOPIC_NO_AUTH ─────────────────────────────────────
  //
  // Pure anonymous connection check — no creds required, so the test runs
  // unconditionally on every CI invocation.
  it(
    `upholds CONTRACTS.LIVE_FS_PUBLIC_TOPIC_NO_AUTH: ${CONTRACTS.LIVE_FS_PUBLIC_TOPIC_NO_AUTH}`,
    async () => {
      // Anonymous fetch — no Authorization header. The 2s timeout is a
      // safety net so the test fails fast if the server hangs without
      // sending headers; on a healthy stack the response arrives well
      // before it fires.
      const resp = await fetch(`${config.baseUrl}/events/stream?topics=live-fs-topic`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      }).catch((err: Error) => {
        if (err.name === 'AbortError') return null;
        throw err;
      });

      if (resp === null) {
        throw new Error('GET /events/stream timed out before sending headers');
      }
      expect(resp.status, 'public GET /events/stream must accept anonymous callers').toBe(200);
      expect(resp.headers.get('content-type')).toMatch(/text\/event-stream/);
      // We don't need to consume the stream — accepting the connection is the
      // contract under test. Cancel the body so the connection closes cleanly.
      await resp.body?.cancel();
    }
  );

  // ── LIVE_FS_UPDATE_INCLUDES_FULL_ROW ─────────────────────────────────
  //
  // Posts a flowsheet row via the authed client, so this test needs creds.
  it.skipIf(!hasCredentials)(
    `upholds CONTRACTS.LIVE_FS_UPDATE_INCLUDES_FULL_ROW: ${CONTRACTS.LIVE_FS_UPDATE_INCLUDES_FULL_ROW}`,
    async () => {
      // Open the SSE stream first so we don't race against the post.
      const controller = new AbortController();
      const streamResp = await fetch(
        `${config.baseUrl}/events/stream?topics=live-fs-topic`,
        { method: 'GET', signal: controller.signal }
      );
      expect(streamResp.status).toBe(200);

      // Insert a row that the enrichment-worker will (eventually) terminally
      // mark with `metadata_status=enriched_no_match` (freeform entries that
      // don't match any catalog row land there).
      const post = await client.post<FlowsheetEntryResponse>('/flowsheet', {
        artist_name: `LiveFs Update ${uniqueSuffix}`,
        album_title: `Update Album ${uniqueSuffix}`,
        track_title: `Update Track ${uniqueSuffix}`,
        request_flag: false,
      } satisfies FlowsheetCreateSongFreeform);
      expect(post.ok).toBe(true);
      const newId = post.body.id;

      // Read SSE frames until we see an `update` event for the row we just
      // inserted, or hit the 30s ceiling for the enrichment chain.
      const reader = streamResp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const deadline = Date.now() + 30_000;
      let matched: {
        type: string;
        payload: { id: number; metadata_status?: string; artist_name?: string };
      } | null = null;

      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const raw of frames) {
          if (!raw.startsWith('data: ')) continue;
          const parsed = JSON.parse(raw.slice(6));
          if (parsed.type === 'update' && parsed.payload?.id === newId) {
            matched = parsed;
            break;
          }
        }
        if (matched) break;
      }
      controller.abort();
      expect(matched, 'expected an update frame for the just-inserted row').not.toBeNull();

      // VIOLATION SYMPTOM: payload is `{id, metadata_status}` only. After
      // BS-2 lands the payload IS the full row, so non-required fields like
      // `artist_name` round-trip.
      expect(matched!.payload.artist_name, 'payload should carry full row data, including artist_name').toBe(
        `LiveFs Update ${uniqueSuffix}`
      );
    }
  );

  // ── LIVE_FS_EVENT_ENVELOPE_SHAPE ─────────────────────────────────────
  //
  // The envelope (`{ type, payload, timestamp }`) is already enforced
  // server-side via `EventData<T>` and pinned at the schema layer in
  // `api.yaml`. This test exercises the wire format end-to-end against
  // a live stack.
  //
  // Self-triggers via an authed flowsheet insert so a quiet stack
  // doesn't leave the test waiting on an event that never arrives. The
  // anonymous code path (no creds, plain GET) is already exercised by
  // LIVE_FS_PUBLIC_TOPIC_NO_AUTH above.
  it.skipIf(!hasCredentials)(
    `upholds CONTRACTS.LIVE_FS_EVENT_ENVELOPE_SHAPE: ${CONTRACTS.LIVE_FS_EVENT_ENVELOPE_SHAPE}`,
    async () => {
      const controller = new AbortController();
      const streamResp = await fetch(
        `${config.baseUrl}/events/stream?topics=live-fs-topic`,
        { method: 'GET', signal: controller.signal }
      );
      expect(streamResp.status).toBe(200);

      // Trigger an enrichment event by inserting a freeform row. The
      // metadata pipeline reliably emits a terminal-status liveFs:update
      // within the 30s ceiling on any healthy stack.
      const post = await client.post<FlowsheetEntryResponse>('/flowsheet', {
        artist_name: `LiveFs Envelope ${uniqueSuffix}`,
        album_title: `Envelope Album ${uniqueSuffix}`,
        track_title: `Envelope Track ${uniqueSuffix}`,
        request_flag: false,
      } satisfies FlowsheetCreateSongFreeform);
      expect(post.ok).toBe(true);

      const reader = streamResp.body!.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const deadline = Date.now() + 30_000;
      let firstFrame: { type?: unknown; payload?: unknown; timestamp?: unknown } | null = null;
      while (Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const frames = buf.split('\n\n');
        buf = frames.pop() ?? '';
        for (const raw of frames) {
          if (!raw.startsWith('data: ')) continue;
          firstFrame = JSON.parse(raw.slice(6));
          break;
        }
        if (firstFrame) break;
      }
      controller.abort();
      expect(firstFrame, 'expected at least one SSE frame').not.toBeNull();
      expect(typeof firstFrame!.type, 'frame.type must be a string').toBe('string');
      expect(firstFrame!.payload, 'frame.payload must be present').toBeDefined();
      expect(firstFrame!.timestamp, 'frame.timestamp must be present').toBeDefined();
    }
  );

  // ── FLOWSHEET_DJ_NAME_NON_NULL ───────────────────────────────────────
  //
  // ENFORCED. Migration 0053 backfilled historical NULLs and the insert
  // paths require dj_name. This test catches a regression where new
  // inserts re-introduce NULL.
  it.skipIf(!hasCredentials)(
    `upholds CONTRACTS.FLOWSHEET_DJ_NAME_NON_NULL: ${CONTRACTS.FLOWSHEET_DJ_NAME_NON_NULL}`,
    async () => {
      // Add a freeform entry as the test DJ.
      const body: FlowsheetCreateSongFreeform = {
        artist_name: `DJName Contract ${uniqueSuffix}`,
        album_title: 'Contract Album',
        track_title: `DJName Track ${uniqueSuffix}`,
        request_flag: false,
      };
      const post = await client.post<FlowsheetEntryResponse>('/flowsheet', body);
      expect(post.ok, 'POST /flowsheet must succeed').toBe(true);
      const entryId = post.body.id;
      const showId = post.body.show_id;

      // Fetch the show's entries via the v2 endpoint, which carries dj_name
      // on show_start / dj_join markers (the show-block entries that scope
      // every track row to a DJ).
      // VIOLATION SYMPTOM: tubafrenzy mirror payload validation fails;
      // dj-site renders an empty DJ name; archive search drops the row.
      const v2 = await client.get<{
        entries?: Array<{
          entry_type: string;
          dj_name?: string | null;
          id?: number;
          show_id?: number | null;
        }>;
      }>('/v2/flowsheet?limit=100');
      expect(v2.ok).toBe(true);

      const entries = v2.body.entries ?? [];
      // At least one show-block entry for our show must carry a non-null,
      // non-empty dj_name.
      const showBlocks = entries.filter(
        (e) =>
          e.show_id === showId &&
          (e.entry_type === 'show_start' ||
            e.entry_type === 'dj_join' ||
            e.entry_type === 'show_end' ||
            e.entry_type === 'dj_leave')
      );
      expect(
        showBlocks.length,
        `expected at least one show-block entry for show_id=${showId}`
      ).toBeGreaterThan(0);

      for (const block of showBlocks) {
        expect(
          block.dj_name,
          `entry ${block.id} (${block.entry_type}) has null/empty dj_name`
        ).toBeTruthy();
      }

      // Sanity: the entry we just created should still be in the show.
      expect(post.body.show_id).toBeTruthy();
      expect(entryId).toBeGreaterThan(0);
    }
  );
});
