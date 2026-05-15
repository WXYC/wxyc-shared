/**
 * Tests for generated TypeScript types
 *
 * Validates that the codegen script produces correct TypeScript types with
 * enum const objects that match the OpenAPI spec values.
 */

import { describe, it, expect } from 'vitest';
import {
  type FlowsheetEntryResponse,
  type FlowsheetSongEntry,
  type FlowsheetCreateSongFromCatalog,
  type FlowsheetUpdateRequest,
  type FlowsheetV2TrackEntry,
  type Album,
  type AlbumSearchResult,
  type Label,
  type DJ,
  type ScheduleShift,
  type SongRequest,
  type AlbumMetadataResponse,
  type ArtistMetadataResponse,
  type TrackListItem,
  type ReconciledIdentity,
  type HealthCheckResponse,
  type ReadinessResponse,
  type LibrarySearchItem,
  type LookupResultItem,
  type LookupRequest,
  type DiscogsMatchResult,
  type TrackMatchHint,
  RotationBin,
  DayOfWeek,
  Genre,
  Format,
  RequestStatus,
  MetadataSource,
  TrackMatchSource,
} from '../src/generated/models/index.js';

describe('Generated TypeScript Types', () => {
  describe('FlowsheetEntryResponse', () => {
    it('should accept a valid object literal', () => {
      const entry: FlowsheetEntryResponse = {
        id: 12345,
        play_order: 100,
        show_id: 42,
        request_flag: false,
        segue: false,
        track_title: 'Test Song',
        album_title: 'Test Album',
        artist_name: 'Test Artist',
        record_label: 'Test Label',
        rotation_bin: 'H',
      };

      expect(entry.id).toBe(12345);
      expect(entry.track_title).toBe('Test Song');
      expect(entry.rotation_bin).toBe(RotationBin.H);
    });

    it('should allow nullable metadata fields', () => {
      const entry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 1,
        show_id: 1,
        request_flag: false,
        segue: false,
        artwork_url: null,
        spotify_url: null,
        release_year: null,
      };

      expect(entry.artwork_url).toBeNull();
      expect(entry.spotify_url).toBeNull();
    });

    it('should allow message entries without song fields', () => {
      const entry: FlowsheetEntryResponse = {
        id: 1,
        play_order: 50,
        show_id: 42,
        request_flag: false,
        segue: false,
        message: 'Talkset - station ID',
      };

      expect(entry.message).toBe('Talkset - station ID');
      expect(entry.track_title).toBeUndefined();
    });
  });

  describe('Album', () => {
    it('should accept a valid object literal', () => {
      const album: Album = {
        id: 1001,
        artist_id: 500,
        album_title: 'Kind of Blue',
        code_number: 42,
        genre_id: 5,
        format_id: 2,
        label: 'Columbia Records',
        add_date: '2024-01-15T00:00:00Z',
      };

      expect(album.album_title).toBe('Kind of Blue');
      expect(typeof album.add_date).toBe('string');
    });

    it('should allow omitting optional fields', () => {
      const album: Album = {
        id: 1,
        artist_id: 1,
        album_title: 'Minimal',
        code_number: 1,
        genre_id: 1,
        format_id: 1,
      };

      expect(album.label).toBeUndefined();
      expect(album.add_date).toBeUndefined();
    });
  });

  describe('Label', () => {
    it('should accept a valid object literal', () => {
      const label: Label = {
        id: 1,
        label_name: 'Merge Records',
      };

      expect(label.id).toBe(1);
      expect(label.label_name).toBe('Merge Records');
    });

    it('should handle optional parent_label_id', () => {
      const label: Label = {
        id: 2,
        label_name: 'Domino USA',
        parent_label_id: 42,
      };

      expect(label.parent_label_id).toBe(42);
    });

    it('should allow omitting optional fields', () => {
      const label: Label = {
        id: 1,
        label_name: 'Sub Pop',
      };

      expect(label.parent_label_id).toBeUndefined();
    });
  });

  describe('DJ', () => {
    it('should accept a DJ with all fields', () => {
      const dj: DJ = {
        id: 1,
        dj_name: 'DJ Test',
        real_name: 'John Doe',
        email: 'test@wxyc.org',
      };

      expect(dj.dj_name).toBe('DJ Test');
    });

    it('should allow omitting optional fields', () => {
      const dj: DJ = {
        id: 2,
        dj_name: 'Minimal DJ',
      };

      expect(dj.real_name).toBeUndefined();
    });
  });

  describe('ScheduleShift', () => {
    it('should accept DayOfWeek enum values', () => {
      const shift: ScheduleShift = {
        id: 1,
        dj_id: 100,
        dj_name: 'Test DJ',
        day: DayOfWeek.Monday,
        start_time: '14:00',
        end_time: '16:00',
      };

      expect(shift.day).toBe('Monday');
    });
  });

  describe('SongRequest', () => {
    it('should accept RequestStatus enum values', () => {
      const request: SongRequest = {
        id: 1,
        device_id: 'device-123',
        message: 'Play some jazz please!',
        created_at: '2024-01-15T12:00:00Z',
        status: RequestStatus.pending,
      };

      expect(request.status).toBe('pending');
    });
  });

  describe('AlbumMetadataResponse', () => {
    it('should accept enriched metadata fields', () => {
      const response: AlbumMetadataResponse = {
        discogsReleaseId: 12345,
        releaseYear: 2024,
        artworkUrl: 'https://example.com/art.jpg',
        genres: ['Electronic', 'Experimental'],
        styles: ['IDM', 'Ambient'],
        label: 'Warp',
        discogsArtistId: 67890,
        fullReleaseDate: '2024-03-15',
        tracklist: [
          { position: '1', title: 'VI Scose Poise', duration: '5:23' },
          { position: '2', title: 'Cfern' },
        ],
      };

      expect(response.genres).toEqual(['Electronic', 'Experimental']);
      expect(response.styles).toEqual(['IDM', 'Ambient']);
      expect(response.label).toBe('Warp');
      expect(response.discogsArtistId).toBe(67890);
      expect(response.fullReleaseDate).toBe('2024-03-15');
      expect(response.tracklist).toHaveLength(2);
      expect(response.tracklist![0].duration).toBe('5:23');
      expect(response.tracklist![1].duration).toBeUndefined();
    });

    it('should allow omitting all new optional fields', () => {
      const response: AlbumMetadataResponse = {
        discogsReleaseId: 12345,
        artworkUrl: 'https://example.com/art.jpg',
      };

      expect(response.genres).toBeUndefined();
      expect(response.styles).toBeUndefined();
      expect(response.label).toBeUndefined();
      expect(response.discogsArtistId).toBeUndefined();
      expect(response.fullReleaseDate).toBeUndefined();
      expect(response.tracklist).toBeUndefined();
    });
  });

  describe('ArtistMetadataResponse', () => {
    it('should accept imageUrl field', () => {
      const response: ArtistMetadataResponse = {
        discogsArtistId: 67890,
        bio: 'Autechre are an English electronic music duo...',
        wikipediaUrl: 'https://en.wikipedia.org/wiki/Autechre',
        imageUrl: 'https://example.com/artist.jpg',
      };

      expect(response.imageUrl).toBe('https://example.com/artist.jpg');
    });

    it('should allow omitting imageUrl', () => {
      const response: ArtistMetadataResponse = {
        discogsArtistId: 67890,
        bio: 'Autechre are an English electronic music duo...',
      };

      expect(response.imageUrl).toBeUndefined();
    });
  });

  describe('TrackListItem', () => {
    it('should require position and title', () => {
      const track: TrackListItem = {
        position: 'A1',
        title: 'VI Scose Poise',
      };

      expect(track.position).toBe('A1');
      expect(track.title).toBe('VI Scose Poise');
      expect(track.duration).toBeUndefined();
    });

    it('should accept optional duration', () => {
      const track: TrackListItem = {
        position: '1',
        title: 'VI Scose Poise',
        duration: '5:23',
      };

      expect(track.duration).toBe('5:23');
    });
  });

  describe('ReconciledIdentity', () => {
    it('should accept all six external identifiers', () => {
      const identity: ReconciledIdentity = {
        discogs_artist_id: 7894,
        musicbrainz_artist_id: 'd7b8a3a5-9080-487c-8c3c-2f6a3a3d44b2',
        wikidata_qid: 'Q470892',
        spotify_artist_id: '4uSftVc3FPWe6RJuMZNEe9',
        apple_music_artist_id: '88495919',
        bandcamp_id: 'stereolab',
      };

      expect(identity.discogs_artist_id).toBe(7894);
      expect(identity.bandcamp_id).toBe('stereolab');
    });

    it('should allow all fields to be omitted (fully unresolved identity)', () => {
      const identity: ReconciledIdentity = {};

      expect(identity.discogs_artist_id).toBeUndefined();
      expect(identity.spotify_artist_id).toBeUndefined();
    });

    it('should allow null for any identifier (resolved-but-absent)', () => {
      const identity: ReconciledIdentity = {
        discogs_artist_id: 7894,
        musicbrainz_artist_id: null,
        wikidata_qid: null,
        spotify_artist_id: null,
        apple_music_artist_id: null,
        bandcamp_id: null,
      };

      expect(identity.discogs_artist_id).toBe(7894);
      expect(identity.musicbrainz_artist_id).toBeNull();
    });
  });

  describe('HealthCheckResponse', () => {
    it('should accept the three documented status values', () => {
      const healthy: HealthCheckResponse = { status: 'healthy' };
      const degraded: HealthCheckResponse = { status: 'degraded' };
      const unhealthy: HealthCheckResponse = { status: 'unhealthy' };

      expect(healthy.status).toBe('healthy');
      expect(degraded.status).toBe('degraded');
      expect(unhealthy.status).toBe('unhealthy');
    });

    it('should accept arbitrary extension properties (additionalProperties: true)', () => {
      // semantic-index extends the base shape with `artist_count`; the type
      // must accept that without type errors.
      const extended: HealthCheckResponse = {
        status: 'healthy',
        artist_count: 12345,
        version: 'abc123',
      };

      expect(extended.status).toBe('healthy');
      expect(extended.artist_count).toBe(12345);
    });
  });

  describe('ReadinessResponse', () => {
    it('should require status and a services map', () => {
      const ready: ReadinessResponse = {
        status: 'healthy',
        services: {
          postgres: 'ok',
          discogs: 'unavailable',
          spotify: 'timeout',
        },
      };

      expect(ready.status).toBe('healthy');
      expect(ready.services.postgres).toBe('ok');
      expect(ready.services.discogs).toBe('unavailable');
      expect(ready.services.spotify).toBe('timeout');
    });

    it('should allow an empty services map', () => {
      const ready: ReadinessResponse = {
        status: 'degraded',
        services: {},
      };

      expect(ready.services).toEqual({});
    });
  });

  describe('Enums', () => {
    it('should define RotationBin values', () => {
      expect(RotationBin.H).toBe('H');
      expect(RotationBin.M).toBe('M');
      expect(RotationBin.L).toBe('L');
      expect(RotationBin.S).toBe('S');
    });

    it('should define DayOfWeek values', () => {
      expect(DayOfWeek.Sunday).toBe('Sunday');
      expect(DayOfWeek.Monday).toBe('Monday');
      expect(DayOfWeek.Saturday).toBe('Saturday');
    });

    it('should define Genre values', () => {
      expect(Genre.Rock).toBe('Rock');
      expect(Genre.Jazz).toBe('Jazz');
      expect(Genre.Electronic).toBe('Electronic');
    });

    it('should define Format values', () => {
      expect(Format.Vinyl).toBe('Vinyl');
      expect(Format.CD).toBe('CD');
    });

    it('should define RequestStatus values', () => {
      expect(RequestStatus.pending).toBe('pending');
      expect(RequestStatus.played).toBe('played');
      expect(RequestStatus.rejected).toBe('rejected');
    });

    it('should define MetadataSource values', () => {
      expect(MetadataSource.discogs).toBe('discogs');
      expect(MetadataSource.spotify).toBe('spotify');
      expect(MetadataSource.cache).toBe('cache');
      expect(MetadataSource.none).toBe('none');
    });

    it('should define TrackMatchSource values', () => {
      expect(TrackMatchSource.cta).toBe('cta');
      expect(TrackMatchSource.discogs_release).toBe('discogs_release');
      expect(TrackMatchSource.discogs_master).toBe('discogs_master');
      expect(TrackMatchSource.library_identity).toBe('library_identity');
    });
  });

  describe('TrackMatchHint (catalog-track-search §5.2)', () => {
    it('should accept a minimal object with only required fields', () => {
      const hint: TrackMatchHint = {
        title: 'VI Scose Poise',
        source: TrackMatchSource.discogs_master,
      };

      expect(hint.title).toBe('VI Scose Poise');
      expect(hint.source).toBe('discogs_master');
    });

    it('should accept all optional fields', () => {
      const hint: TrackMatchHint = {
        title: 'In a Sentimental Mood',
        artist_credit: 'Duke Ellington & John Coltrane',
        position: 'A1',
        confidence: 0.95,
        source: TrackMatchSource.cta,
      };

      expect(hint.position).toBe('A1');
      expect(hint.confidence).toBe(0.95);
      expect(hint.artist_credit).toBe('Duke Ellington & John Coltrane');
    });

    it('should accept null for nullable optional fields', () => {
      const hint: TrackMatchHint = {
        title: 'la paradoja',
        artist_credit: null,
        position: null,
        confidence: null,
        source: TrackMatchSource.discogs_release,
      };

      expect(hint.artist_credit).toBeNull();
      expect(hint.position).toBeNull();
      expect(hint.confidence).toBeNull();
    });
  });

  describe('matched_via on result schemas (catalog-track-search §5.1)', () => {
    it('AlbumSearchResult.matched_via is optional and typed as TrackMatchHint[]', () => {
      const withoutHint: AlbumSearchResult = {
        id: 60359,
        add_date: '2026-05-12T00:00:00Z',
        album_title: 'Confield',
        artist_name: 'Autechre',
        code_letters: 'AU',
        code_number: 8,
        code_artist_number: 3,
        format_name: 'CD',
        genre_name: 'Electronic',
        label: 'Warp Records',
      };

      const withHint: AlbumSearchResult = {
        ...withoutHint,
        matched_via: [
          { title: 'VI Scose Poise', source: TrackMatchSource.discogs_master },
        ],
      };

      expect(withoutHint.matched_via).toBeUndefined();
      expect(withHint.matched_via?.[0].title).toBe('VI Scose Poise');
    });

    it('LibrarySearchItem.matched_via is optional and typed as TrackMatchHint[]', () => {
      const item: LibrarySearchItem = {
        id: 65880,
        title: 'Confield',
        artist: 'Autechre',
        matched_via: [
          { title: 'VI Scose Poise', source: TrackMatchSource.discogs_master, confidence: 0.85 },
        ],
      };

      expect(item.matched_via?.[0].source).toBe('discogs_master');
    });

    it('LookupResultItem.matched_via is optional and typed as TrackMatchHint[]', () => {
      const result: LookupResultItem = {
        library_item: {
          id: 60359,
          title: 'Confield',
          artist: 'Autechre',
        },
        matched_via: [
          { title: 'VI Scose Poise', source: TrackMatchSource.library_identity, confidence: 0.92 },
        ],
      };

      expect(result.matched_via?.[0].source).toBe('library_identity');
    });

    it('matched_via supports multiple hints per release (e.g., comps with two matching tracks)', () => {
      const item: LibrarySearchItem = {
        id: 6468,
        title: "Jazz: The 50's, Volume I",
        artist: 'Various Artists',
        matched_via: [
          { title: 'In a Sentimental Mood', artist_credit: 'Duke Ellington', source: TrackMatchSource.cta, confidence: 1.0 },
          { title: 'Whistling Away The Dark', artist_credit: 'Abbey Lincoln', source: TrackMatchSource.cta, confidence: 1.0 },
        ],
      };

      expect(item.matched_via?.length).toBe(2);
    });
  });

  describe('track_position on flowsheet schemas (catalog-track-search §5.3)', () => {
    it('FlowsheetSongEntry accepts optional track_position', () => {
      const withoutPosition: FlowsheetSongEntry = {
        id: 12345,
        play_order: 100,
        show_id: 42,
        track_title: 'VI Scose Poise',
        artist_name: 'Autechre',
        album_title: 'Confield',
        record_label: 'Warp Records',
        request_flag: false,
      };

      const withPosition: FlowsheetSongEntry = {
        ...withoutPosition,
        track_position: '2',
      };

      expect(withoutPosition.track_position).toBeUndefined();
      expect(withPosition.track_position).toBe('2');
    });

    it('FlowsheetSongEntry accepts null track_position', () => {
      const entry: FlowsheetSongEntry = {
        id: 12345,
        play_order: 100,
        show_id: 42,
        track_title: 'VI Scose Poise',
        artist_name: 'Autechre',
        album_title: 'Confield',
        record_label: 'Warp Records',
        request_flag: false,
        track_position: null,
      };

      expect(entry.track_position).toBeNull();
    });

    it('FlowsheetEntryResponse accepts vinyl-style track_position strings', () => {
      const entry: FlowsheetEntryResponse = {
        id: 12345,
        play_order: 100,
        show_id: 42,
        request_flag: false,
        track_title: 'In a Sentimental Mood',
        track_position: 'A1',
      };

      expect(entry.track_position).toBe('A1');
    });

    // Write-side schemas (PR #134 / E6-1). These pin the *generated TypeScript*
    // contract that BS/dj-site/iOS callers actually import. If a future
    // api.yaml edit accidentally promotes `track_position` to required (e.g.,
    // adds it to the schema's `required:` list), openapi-typescript will emit
    // `track_position: string` instead of `track_position?: string` and these
    // tests fail-fast before that lands.
    it('FlowsheetCreateSongFromCatalog accepts optional track_position', () => {
      const withoutPosition: FlowsheetCreateSongFromCatalog = {
        album_id: 1001,
        track_title: 'la paradoja',
        request_flag: false,
      };

      const withPosition: FlowsheetCreateSongFromCatalog = {
        ...withoutPosition,
        track_position: 'A1',
      };

      expect(withoutPosition.track_position).toBeUndefined();
      expect(withPosition.track_position).toBe('A1');
    });

    it('FlowsheetUpdateRequest accepts optional track_position', () => {
      const empty: FlowsheetUpdateRequest = {};
      const withPosition: FlowsheetUpdateRequest = {
        track_position: '1-12',
      };

      expect(empty.track_position).toBeUndefined();
      expect(withPosition.track_position).toBe('1-12');
    });

    it('FlowsheetV2TrackEntry accepts optional + nullable track_position', () => {
      const baseEntry: FlowsheetV2TrackEntry = {
        id: 1,
        show_id: 42,
        play_order: 100,
        add_time: '2024-06-15T14:30:00.000Z',
        entry_type: 'track',
        request_flag: false,
      };

      const withPosition: FlowsheetV2TrackEntry = {
        ...baseEntry,
        track_position: 'B3',
      };

      const nullPosition: FlowsheetV2TrackEntry = {
        ...baseEntry,
        track_position: null,
      };

      expect(baseEntry.track_position).toBeUndefined();
      expect(withPosition.track_position).toBe('B3');
      expect(nullPosition.track_position).toBeNull();
    });
  });

  describe('LookupRequest extended-metadata flags (PR #133)', () => {
    // These tests pin the *generated TypeScript* contract for `extended` and
    // `warm_cache`. If a future api.yaml edit accidentally adds `default: false`
    // back to either field, openapi-typescript will promote them to required
    // (`extended: boolean` instead of `extended?: boolean`) and every existing
    // LML/BS/iOS/dj-site caller stops typechecking — these tests fail-fast
    // before that lands.
    it('treats `extended` and `warm_cache` as optional (callers can omit both)', () => {
      const minimal: LookupRequest = {
        artist: 'Stereolab',
        album: 'Aluminum Tunes',
      };

      expect(minimal.artist).toBe('Stereolab');
      // Compile-time assertion: omitting `extended`/`warm_cache` must be legal.
      expect(minimal.extended).toBeUndefined();
      expect(minimal.warm_cache).toBeUndefined();
    });

    it('accepts `extended` and `warm_cache` when callers opt in', () => {
      const opted: LookupRequest = {
        artist: 'Jessica Pratt',
        album: 'On Your Own Love Again',
        extended: true,
        warm_cache: true,
      };

      expect(opted.extended).toBe(true);
      expect(opted.warm_cache).toBe(true);
    });
  });

  describe('DiscogsMatchResult extended-metadata fields (PR #133)', () => {
    // Same pattern as above: pin the consumer-facing contract that the
    // new extended-metadata fields are optional + nullable.
    it('accepts a result with none of the extended fields set', () => {
      const baseline: DiscogsMatchResult = {
        release_id: 12345,
        release_url: 'https://www.discogs.com/release/12345',
      };

      expect(baseline.discogs_artist_id).toBeUndefined();
      expect(baseline.tracklist).toBeUndefined();
      expect(baseline.genres).toBeUndefined();
      expect(baseline.styles).toBeUndefined();
      expect(baseline.label).toBeUndefined();
      expect(baseline.full_release_date).toBeUndefined();
      expect(baseline.artist_image_url).toBeUndefined();
      expect(baseline.profile_tokens).toBeUndefined();
    });

    it('accepts a result with all extended fields populated', () => {
      const full: DiscogsMatchResult = {
        release_id: 12345,
        release_url: 'https://www.discogs.com/release/12345',
        discogs_artist_id: 999,
        tracklist: [{ position: 'A1', title: 'In a Sentimental Mood' }],
        genres: ['Jazz'],
        styles: ['Modal'],
        label: 'Impulse Records',
        full_release_date: '1963-02-07',
        artist_image_url: 'https://img.discogs.com/foo.jpg',
        profile_tokens: [{ type: 'plainText', text: 'American jazz pianist.' }],
      };

      expect(full.discogs_artist_id).toBe(999);
      expect(full.label).toBe('Impulse Records');
      expect(full.profile_tokens?.[0].type).toBe('plainText');
    });

    it('accepts null for every nullable extended field', () => {
      const nulled: DiscogsMatchResult = {
        release_id: 12345,
        release_url: 'https://www.discogs.com/release/12345',
        discogs_artist_id: null,
        tracklist: null,
        genres: null,
        styles: null,
        label: null,
        full_release_date: null,
        artist_image_url: null,
        profile_tokens: null,
      };

      expect(nulled.label).toBeNull();
      expect(nulled.profile_tokens).toBeNull();
    });
  });
});
