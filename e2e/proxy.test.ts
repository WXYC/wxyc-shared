/**
 * Proxy Endpoint E2E Tests
 *
 * Tests for the Backend-Service proxy endpoints that route through
 * library-metadata-lookup. These endpoints use anonymous session auth
 * (not DJ auth) and are consumed by the iOS and Android apps.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createE2EClient, type E2EClient, waitForService, getE2EConfig, getAnonymousToken } from './setup.js';
import type {
  AlbumMetadataResponse,
  ArtistMetadataResponse,
  EntityResolveResponse,
  SpotifyTrackResponse,
} from '../src/dtos/index.js';

describe('Proxy E2E', () => {
  let client: E2EClient;
  const config = getE2EConfig();

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`, 10000);
    client = createE2EClient();

    // Authenticate with anonymous session (required for all proxy endpoints)
    const token = await getAnonymousToken(config.authUrl);
    client.setAuthToken(token);
  });

  // -- Authentication --------------------------------------------------------

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const unauthClient = createE2EClient();
      const response = await unauthClient.get('/proxy/metadata/album?artistName=Test');
      expect(response.status).toBe(401);
    });
  });

  // -- GET /proxy/metadata/album --------------------------------------------

  describe('GET /proxy/metadata/album', () => {
    it('should return metadata for a known artist and release', async () => {
      const response = await client.get<AlbumMetadataResponse>(
        '/proxy/metadata/album?artistName=Autechre&releaseTitle=Confield'
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(typeof response.body).toBe('object');

      // Core Discogs fields
      if (response.body.discogsReleaseId) {
        expect(typeof response.body.discogsReleaseId).toBe('number');
      }
      if (response.body.discogsUrl) {
        expect(response.body.discogsUrl).toContain('discogs.com');
      }
      if (response.body.releaseYear) {
        expect(response.body.releaseYear).toBeGreaterThan(1900);
      }

      // Streaming links (at least some should be present)
      const hasAnyStreamingLink =
        response.body.spotifyUrl ||
        response.body.appleMusicUrl ||
        response.body.youtubeMusicUrl ||
        response.body.bandcampUrl ||
        response.body.soundcloudUrl;
      expect(hasAnyStreamingLink).toBeTruthy();
    });

    it('should return enriched fields (genres, styles, label)', async () => {
      const response = await client.get<AlbumMetadataResponse>(
        '/proxy/metadata/album?artistName=Autechre&releaseTitle=Confield'
      );

      expect(response.ok).toBe(true);

      // Enriched fields from LML
      if (response.body.genres) {
        expect(Array.isArray(response.body.genres)).toBe(true);
        expect(response.body.genres.length).toBeGreaterThan(0);
      }
      if (response.body.styles) {
        expect(Array.isArray(response.body.styles)).toBe(true);
      }
      if (response.body.label) {
        expect(typeof response.body.label).toBe('string');
      }
      if (response.body.discogsArtistId) {
        expect(typeof response.body.discogsArtistId).toBe('number');
      }
    });

    it('should accept trackTitle as fallback when releaseTitle is absent', async () => {
      const response = await client.get<AlbumMetadataResponse>(
        '/proxy/metadata/album?artistName=Autechre&trackTitle=Pen Expers'
      );

      expect(response.ok).toBe(true);
      expect(typeof response.body).toBe('object');
    });

    it('should return 400 when artistName is missing', async () => {
      const response = await client.get('/proxy/metadata/album?releaseTitle=Confield');
      expect(response.status).toBe(400);
    });

    it('should include cache-control header', async () => {
      const response = await client.get<AlbumMetadataResponse>(
        '/proxy/metadata/album?artistName=Autechre&releaseTitle=Confield'
      );

      expect(response.ok).toBe(true);
      const cacheControl = response.headers.get('cache-control');
      expect(cacheControl).toBeTruthy();
    });

    // wxyc-shared#318 / WXYC/Backend-Service#1827. The "local-first base
    // fields" are durable BS state read off the linked flowsheet row, so an
    // LML timeout can blank `artworkUrl` but can never blank the catalog
    // label or the enrichment status. They were emitted for months without
    // being in api.yaml, which meant no generated client decoded them and the
    // guarantee was consumed nowhere. This is the parity guard: drive the
    // request off a row the flowsheet says IS linked, then assert the served
    // response carries the three fields, decoded through the generated type.
    describe('local-first base fields for a linked flowsheet row (#318 / BS#1827)', () => {
      /** A recent flowsheet track row that resolved to a catalog album. */
      type LinkedRow = {
        album_id?: number | null;
        artist_name?: string | null;
        album_title?: string | null;
        record_label?: string | null;
        label_id?: number | null;
        metadata_status?: string | null;
      };

      const TERMINAL_STATUSES = ['enriched_match', 'enriched_no_match', 'failed_no_retry'];

      let linkedRow: LinkedRow | undefined;
      let served: AlbumMetadataResponse | undefined;

      // One fetch for the whole block. Two reasons beyond economy: a second
      // proxy call would hit the memo the first one populated (so it would not
      // be an independent observation anyway), and re-deriving the row per test
      // would let the two cases disagree about which row they are asserting on.
      beforeAll(async () => {
        const feed = await client.get<LinkedRow[]>('/flowsheet?limit=100');
        if (!feed.ok || !Array.isArray(feed.body)) return;
        // `album_id` is the discriminator BS itself keys the local read off
        // (selectLinkedFlowsheetRow); `record_label` narrows to rows that
        // actually have the base field to echo, since BS assigns it only when
        // the linked row's column is non-empty.
        linkedRow = feed.body.find(
          (row) => row.album_id != null && !!row.artist_name && !!row.album_title && !!row.record_label
        );
        if (!linkedRow) return;

        const query = new URLSearchParams({
          artistName: linkedRow.artist_name!,
          releaseTitle: linkedRow.album_title!,
        });
        const response = await client.get<AlbumMetadataResponse>(
          `/proxy/metadata/album?${query.toString()}`
        );
        if (response.ok) served = response.body;
      });

      /**
       * Skip — visibly, as a `↓` in the reporter — when the stack has no linked
       * row to assert against. `ctx.skip()` is deliberate: the surrounding
       * `console.log(...) + return` idiom used elsewhere in `e2e/` records the
       * case as PASSING, and this block is issue #318's acceptance criterion.
       * A green that certifies nothing was checked is worse than no test. The
       * other uses of that idiom skip on "backend not available", where the
       * whole suite is failing loudly anyway; this one skips on a *data*
       * condition against a healthy stack, which is exactly when a false green
       * goes unnoticed.
       */
      function requireServedLinkedRow(ctx: { skip: () => void }): void {
        if (!linkedRow || !served) ctx.skip();
      }

      it('serves the three base fields for a row the feed says is linked', (ctx) => {
        requireServedLinkedRow(ctx);

        // The acceptance criterion: present, not merely well-typed. If this
        // ever goes red on a stack that is otherwise healthy, the first
        // hypothesis is the 1h memo documented on the AlbumMetadataResponse
        // schema — a cache entry written while this key had no linked row will
        // keep omitting all three until it expires.
        expect(
          served!.recordLabel,
          'recordLabel absent for a linked row; if the stack is healthy, suspect a pre-link entry still inside the 1h memo window'
        ).toBeTruthy();
        expect(typeof served!.recordLabel).toBe('string');
        expect(served!.metadataStatus, 'metadataStatus absent for a linked row').toBeTruthy();
        // NOT NULL DEFAULT 'pending' on the column, so a linked row always has one.
        expect([
          'pending',
          'enriching',
          ...TERMINAL_STATUSES,
        ]).toContain(served!.metadataStatus);
        if (served!.labelId !== undefined) {
          expect(Number.isInteger(served!.labelId)).toBe(true);
        }
      });

      it('echoes the same row the feed reports, when the response is not a stale memo', (ctx) => {
        requireServedLinkedRow(ctx);

        // Equality against a live feed read is only owed when the response was
        // assembled from the row's CURRENT state. `metadataStatus` is the
        // freshness witness: BS#1827 reads all three base fields from a single
        // `selectLinkedFlowsheetRow` call, so a response whose status matches
        // the feed row's was read from that same state and must agree on the
        // rest. A response served from an older memo can legitimately disagree
        // — asserting equality unconditionally would be a scheduled flake
        // against a correctly-behaving server.
        if (served!.metadataStatus !== linkedRow!.metadata_status) {
          expect(TERMINAL_STATUSES, 'a memoized status is always terminal (BS#1893)').toContain(
            served!.metadataStatus
          );
          return;
        }

        expect(served!.recordLabel).toBe(linkedRow!.record_label);
        if (linkedRow!.label_id != null) {
          expect(served!.labelId).toBe(linkedRow!.label_id);
        }
      });

      it('keeps recordLabel distinct from the Discogs release label', (ctx) => {
        requireServedLinkedRow(ctx);

        // `label` may be absent entirely — pre-BS#1336 album_metadata rows
        // still carry a NULL label (BS#1442). That is exactly why the two are
        // separate keys: `recordLabel` survives regardless.
        expect(served!.recordLabel).toBeTruthy();
        if (served!.label !== undefined) {
          expect(typeof served!.label).toBe('string');
        }
      });
    });
  });

  // -- GET /proxy/metadata/artist -------------------------------------------

  describe('GET /proxy/metadata/artist', () => {
    // Use a known Discogs artist ID (Autechre = 19202)
    const autechreArtistId = 19202;

    it('should return artist bio and Wikipedia URL', async () => {
      const response = await client.get<ArtistMetadataResponse>(
        `/proxy/metadata/artist?artistId=${autechreArtistId}`
      );

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);

      if (response.body.bio) {
        expect(typeof response.body.bio).toBe('string');
        expect(response.body.bio.length).toBeGreaterThan(0);
      }
      if (response.body.wikipediaUrl) {
        expect(response.body.wikipediaUrl).toContain('wikipedia.org');
      }
      expect(response.body.discogsArtistId).toBe(autechreArtistId);
    });

    it('should return raw Discogs markup in bio', async () => {
      const response = await client.get<ArtistMetadataResponse>(
        `/proxy/metadata/artist?artistId=${autechreArtistId}`
      );

      expect(response.ok).toBe(true);
      // Raw Discogs markup may contain [a=...], [l=...], [url=...] tags.
      // We verify the bio is present; markup parsing is the client's responsibility.
      if (response.body.bio) {
        expect(typeof response.body.bio).toBe('string');
      }
    });

    it('should return 400 when artistId is missing', async () => {
      const response = await client.get('/proxy/metadata/artist');
      expect(response.status).toBe(400);
    });

    it('should return 400 when artistId is not a number', async () => {
      const response = await client.get('/proxy/metadata/artist?artistId=abc');
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent artist', async () => {
      const response = await client.get('/proxy/metadata/artist?artistId=999999999');
      expect(response.status).toBe(404);
    });
  });

  // -- GET /proxy/entity/resolve --------------------------------------------

  describe('GET /proxy/entity/resolve', () => {
    it('should resolve an artist by ID', async () => {
      const response = await client.get<EntityResolveResponse>(
        '/proxy/entity/resolve?type=artist&id=19202'
      );

      expect(response.ok).toBe(true);
      expect(response.body.type).toBe('artist');
      expect(response.body.id).toBe(19202);
      expect(typeof response.body.name).toBe('string');
      expect(response.body.name.length).toBeGreaterThan(0);
    });

    it('should resolve a release by ID', async () => {
      // Autechre - Confield (Discogs release 27246)
      const response = await client.get<EntityResolveResponse>(
        '/proxy/entity/resolve?type=release&id=27246'
      );

      expect(response.ok).toBe(true);
      expect(response.body.type).toBe('release');
      expect(response.body.id).toBe(27246);
      expect(typeof response.body.name).toBe('string');
    });

    it('should resolve a master release by ID', async () => {
      // Autechre - Confield (Discogs master 3065)
      const response = await client.get<EntityResolveResponse>(
        '/proxy/entity/resolve?type=master&id=3065'
      );

      expect(response.ok).toBe(true);
      expect(response.body.type).toBe('master');
      expect(response.body.id).toBe(3065);
      expect(typeof response.body.name).toBe('string');
    });

    it('should return 400 for invalid type', async () => {
      const response = await client.get('/proxy/entity/resolve?type=label&id=123');
      expect(response.status).toBe(400);
    });

    it('should return 400 when params are missing', async () => {
      const response = await client.get('/proxy/entity/resolve');
      expect(response.status).toBe(400);
    });

    it('should return 404 for non-existent entity', async () => {
      const response = await client.get('/proxy/entity/resolve?type=artist&id=999999999');
      expect(response.status).toBe(404);
    });
  });

  // -- GET /proxy/artwork/search --------------------------------------------

  describe('GET /proxy/artwork/search', () => {
    it('should return image bytes for a known release', async () => {
      // Make a raw fetch since E2EClient only parses JSON
      const url = `${config.baseUrl}/proxy/artwork/search?artistName=Autechre&releaseTitle=Confield`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${client['authToken']}` },
      });

      // May be 200 (image found) or 404 (not found / NSFW)
      if (response.status === 200) {
        const contentType = response.headers.get('content-type') ?? '';
        expect(contentType).toMatch(/image\/(jpeg|png|webp)/);
        const bytes = await response.arrayBuffer();
        expect(bytes.byteLength).toBeGreaterThan(0);
      } else {
        expect(response.status).toBe(404);
      }
    });

    it('should return 400 when artistName is missing', async () => {
      const response = await client.get('/proxy/artwork/search?releaseTitle=Confield');
      expect(response.status).toBe(400);
    });

    it('should include cache-control header', async () => {
      const url = `${config.baseUrl}/proxy/artwork/search?artistName=Autechre&releaseTitle=Confield`;
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${client['authToken']}` },
      });

      if (response.ok) {
        const cacheControl = response.headers.get('cache-control');
        expect(cacheControl).toBeTruthy();
      }
    });
  });

  // -- GET /proxy/spotify/track/:id -----------------------------------------

  describe('GET /proxy/spotify/track/:id', () => {
    it('should return 400 for missing track ID', async () => {
      const response = await client.get('/proxy/spotify/track/');
      // Depending on routing, this may be 400 or 404
      expect([400, 404]).toContain(response.status);
    });

    it('should return error for non-existent track ID', async () => {
      const response = await client.get<SpotifyTrackResponse>(
        '/proxy/spotify/track/0000000000000000000000'
      );
      // 404 (not found), 502 (Spotify API error), or 503 (Spotify not configured)
      expect([404, 502, 503]).toContain(response.status);
    });

    // Note: Testing with a real Spotify track ID is fragile (tracks can be removed).
    // We test the error paths; success paths are covered by unit tests.
  });
});
