/**
 * Mirror E2E Tests
 *
 * Verifies the full mirror round-trip: an entry added via Backend-Service
 * (POST /flowsheet) appears on tubafrenzy's public JSON API
 * (GET /playlists/recentEntries).
 *
 * Prerequisites:
 * - Backend-Service running at E2E_BASE_URL
 * - Auth service running at E2E_AUTH_URL
 * - Tubafrenzy running at E2E_TUBAFRENZY_URL (default: http://localhost:8080)
 * - Test DJ account (E2E_TEST_DJ_EMAIL / E2E_TEST_DJ_PASSWORD)
 *
 * Run with: npm run test:e2e -- e2e/mirror.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  createE2EClient,
  createE2EAuthHelper,
  type E2EClient,
  type E2EAuthHelper,
  waitForService,
  getE2EConfig,
  pollUntil,
} from './setup.js';
import type { FlowsheetEntryResponse } from '../src/dtos/flowsheet.dto.js';

/** Shape of a playcut entry from tubafrenzy's /playlists/recentEntries */
interface TubafrenzyEntry {
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

describe('Mirror E2E', () => {
  let client: E2EClient;
  let authHelper: E2EAuthHelper;
  const config = getE2EConfig();

  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);

  let tubafrenzyReachable = false;

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);

    // Check tubafrenzy reachability with GET (it may not support HEAD)
    try {
      const resp = await fetch(
        `${config.tubafrenzyUrl}/playlists/recentEntries?n=1`
      );
      tubafrenzyReachable = resp.ok;
    } catch {
      tubafrenzyReachable = false;
    }

    client = createE2EClient();
    authHelper = createE2EAuthHelper();

    if (hasCredentials) {
      const { payload } = await authHelper.authenticateClient(
        client,
        config.testDjEmail!,
        config.testDjPassword!
      );

      // Start or join a show so POST /flowsheet can add entries
      const djId = payload.sub || payload.id;
      await client.post('/flowsheet/join', { dj_id: djId });
    }
  });

  afterAll(async () => {
    // Best-effort: end the show to clean up
    if (hasCredentials && tubafrenzyReachable) {
      try {
        await client.post('/flowsheet/end', {});
      } catch {
        // ignore
      }
    }
  });

  /**
   * Fetch recent entries from tubafrenzy and find one matching
   * the given artist and song title.
   */
  async function findOnTubafrenzy(
    artistName: string,
    songTitle: string
  ): Promise<TubafrenzyEntry | null> {
    const resp = await fetch(
      `${config.tubafrenzyUrl}/playlists/recentEntries?n=30`
    );
    if (!resp.ok) return null;

    const entries: TubafrenzyEntry[] = await resp.json();
    return (
      entries.find(
        (e) =>
          e.entryType === 'playcut' &&
          e.playcut?.artistName === artistName &&
          e.playcut?.songTitle === songTitle
      ) ?? null
    );
  }

  it.skipIf(!hasCredentials)(
    'mirrors a freeform track entry to tubafrenzy',
    async ({ skip }) => {
      if (!tubafrenzyReachable) skip();

      const testArtist = `E2E Mirror ${uniqueSuffix}`;
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

      // 2. Poll tubafrenzy until the entry appears
      const mirrored = await pollUntil(
        () => findOnTubafrenzy(testArtist, testSong),
        15000,
        500
      );

      expect(mirrored.playcut!.artistName).toBe(testArtist);
      expect(mirrored.playcut!.songTitle).toBe(testSong);
      expect(mirrored.playcut!.releaseTitle).toBe(testAlbum);
      expect(mirrored.playcut!.labelName).toBe(testLabel);
    }
  );

  it.skipIf(!hasCredentials)(
    'mirrors an updated entry to tubafrenzy',
    async ({ skip }) => {
      if (!tubafrenzyReachable) skip();

      const testArtist = `E2E Update ${uniqueSuffix}`;
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

      // 2. Wait for it to appear on tubafrenzy
      await pollUntil(
        () => findOnTubafrenzy(testArtist, testSong),
        15000,
        500
      );

      // 3. PATCH the entry via Backend-Service
      const patchResp = await client.patch<FlowsheetEntryResponse>(
        '/flowsheet',
        {
          entry_id: entryId,
          data: { track_title: updatedSong },
        }
      );

      expect(patchResp.ok).toBe(true);

      // 4. Poll tubafrenzy until the updated song title appears
      const updated = await pollUntil(
        () => findOnTubafrenzy(testArtist, updatedSong),
        15000,
        500
      );

      expect(updated.playcut!.artistName).toBe(testArtist);
      expect(updated.playcut!.songTitle).toBe(updatedSong);
    }
  );
});
