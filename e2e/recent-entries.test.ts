/**
 * Recent Entries E2E — Backend as flowsheet source-of-truth
 *
 * Post-Phase-3 of the tubafrenzy turndown (WXYC/wiki#88), Backend-Service is
 * the source of truth for the flowsheet read path: it serves
 * `GET /playlists/recentEntries` from its own Postgres `flowsheet` table
 * (BS#1860) rather than proxying tubafrenzy's SSE. This suite verifies the
 * post-flip invariant that the retired mirror round-trip no longer can — that
 * a write made through Backend (POST/PATCH /flowsheet) surfaces on Backend's
 * own `/playlists/recentEntries` within the polling window. It doubles as the
 * automated guardrail for wiki#88's headline acceptance criterion: "mirror
 * off; dj-site writes still land in Postgres and surface within the polling
 * window."
 *
 * This replaces the former `mirror.test.ts`, which asserted the opposite
 * direction (a Backend write mirrored to tubafrenzy's `/playlists/recentEntries`)
 * — the exact propagation the mirror-off deliberately removes. Once the mirror
 * is off, that test would only ever silently skip, which reads as "still
 * covered" when it is not.
 *
 * Prerequisites:
 * - Backend-Service running at E2E_BASE_URL
 * - Auth service running at E2E_AUTH_URL
 * - Test DJ account (E2E_TEST_DJ_EMAIL / E2E_TEST_DJ_PASSWORD) for the
 *   write-path cases; the public wire-contract case runs without credentials.
 *
 * Run with: npm run test:e2e -- e2e/recent-entries.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createE2EClient,
  exchangeSessionForJwt,
  getSharedDjSession,
  type E2EClient,
  waitForService,
  getE2EConfig,
  pollUntil,
} from './setup.js';
import type { FlowsheetEntryResponse } from '../src/dtos/index.js';

/**
 * Shape of an entry in the v=1 flat wire format served by
 * `GET /playlists/recentEntries` — the legacy tubafrenzy Android contract,
 * now served byte-identically by Backend (BS#1866).
 */
interface RecentEntry {
  id: number;
  entryType: string;
  playcut?: {
    artistName: string;
    songTitle: string;
    releaseTitle: string;
    labelName: string;
  };
}

const uniqueSuffix = Date.now().toString(36);

describe('Recent Entries E2E (Backend flowsheet source-of-truth)', () => {
  let client: E2EClient;
  const config = getE2EConfig();

  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);

    client = createE2EClient();

    // Authenticate using the DJ session e2e/global-setup.ts already minted
    // for this run, rather than signing in again -- issue #379 review
    // fix-pass #2, finding #2. See e2e/auth.test.ts's budget-arithmetic
    // comment for why sharing this across files is load-bearing.
    if (hasCredentials) {
      const shared = getSharedDjSession();
      if (shared) {
        const exchanged = await exchangeSessionForJwt(shared.sessionToken, config.authUrl);
        if (exchanged) {
          client.setAuthToken(exchanged.token);

          // Start or join a show so POST /flowsheet can add entries
          const djId = exchanged.payload.sub || exchanged.payload.id;
          await client.post('/flowsheet/join', { dj_id: djId });
        }
      }
    }
  });

  afterAll(async () => {
    // Best-effort: end the show to clean up
    if (hasCredentials) {
      try {
        await client.post('/flowsheet/end', {});
      } catch {
        // ignore
      }
    }
  });

  /**
   * Fetch the v=1 flat array from Backend's own `/playlists/recentEntries`
   * and find the playcut matching the given artist and song title.
   */
  async function findOnBackend(
    artistName: string,
    songTitle: string
  ): Promise<RecentEntry | null> {
    const resp = await fetch(
      `${config.baseUrl}/playlists/recentEntries?v=1&n=100`
    );
    if (!resp.ok) return null;

    const entries: RecentEntry[] = await resp.json();
    return (
      entries.find(
        (e) =>
          e.entryType === 'playcut' &&
          e.playcut?.artistName === artistName &&
          e.playcut?.songTitle === songTitle
      ) ?? null
    );
  }

  it('serves the v=1 flat array wire format with X-Last-Modified', async () => {
    // Public, unauthenticated read — the Android contract (BS#1866). Runs
    // regardless of DJ credentials so the wire shape is guarded even in
    // environments without a test DJ account.
    const resp = await fetch(
      `${config.baseUrl}/playlists/recentEntries?v=1&n=100`
    );

    expect(resp.ok).toBe(true);
    const entries = await resp.json();
    expect(Array.isArray(entries)).toBe(true);

    // X-Last-Modified is the freshness signal Android polls on, and must be
    // exposed cross-origin.
    expect(resp.headers.get('x-last-modified')).toMatch(/^\d+$/);
    expect(
      resp.headers.get('access-control-expose-headers')
    ).toContain('X-Last-Modified');
  });

  it.skipIf(!hasCredentials)(
    'surfaces a freeform track POSTed via Backend on /playlists/recentEntries',
    async () => {
      const testArtist = `E2E SoT ${uniqueSuffix}`;
      const testSong = `Test Track ${uniqueSuffix}`;
      const testAlbum = `Test Album ${uniqueSuffix}`;
      const testLabel = `Test Label ${uniqueSuffix}`;

      // 1. POST a freeform entry via Backend-Service
      const postResp = await client.post<FlowsheetEntryResponse>('/flowsheet', {
        artist_name: testArtist,
        album_title: testAlbum,
        track_title: testSong,
        record_label: testLabel,
        request_flag: false,
      });

      expect(postResp.ok).toBe(true);
      expect(postResp.body.artist_name).toBe(testArtist);

      // 2. Poll Backend's own recentEntries until the entry surfaces
      const surfaced = await pollUntil(
        () => findOnBackend(testArtist, testSong),
        15000,
        500
      );

      expect(surfaced.playcut!.artistName).toBe(testArtist);
      expect(surfaced.playcut!.songTitle).toBe(testSong);
      expect(surfaced.playcut!.releaseTitle).toBe(testAlbum);
      expect(surfaced.playcut!.labelName).toBe(testLabel);
    }
  );

  it.skipIf(!hasCredentials)(
    'surfaces an updated (PATCHed) track on /playlists/recentEntries',
    async () => {
      const testArtist = `E2E SoT Update ${uniqueSuffix}`;
      const testSong = `Original Song ${uniqueSuffix}`;
      const updatedSong = `Updated Song ${uniqueSuffix}`;

      // 1. Create the entry
      const postResp = await client.post<FlowsheetEntryResponse>('/flowsheet', {
        artist_name: testArtist,
        album_title: 'Update Test Album',
        track_title: testSong,
        request_flag: false,
      });

      expect(postResp.ok).toBe(true);
      const entryId = postResp.body.id;

      // 2. Wait for it to surface on Backend
      await pollUntil(() => findOnBackend(testArtist, testSong), 15000, 500);

      // 3. PATCH the entry via Backend-Service
      const patchResp = await client.patch<FlowsheetEntryResponse>(
        '/flowsheet',
        {
          entry_id: entryId,
          data: { track_title: updatedSong },
        }
      );

      expect(patchResp.ok).toBe(true);

      // 4. Poll until the updated song title surfaces
      const updated = await pollUntil(
        () => findOnBackend(testArtist, updatedSong),
        15000,
        500
      );

      expect(updated.playcut!.artistName).toBe(testArtist);
      expect(updated.playcut!.songTitle).toBe(updatedSong);
    }
  );
});
