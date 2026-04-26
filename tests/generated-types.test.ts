/**
 * Tests for generated TypeScript types
 *
 * Validates that the codegen script produces correct TypeScript types with
 * enum const objects that match the OpenAPI spec values.
 */

import { describe, it, expect } from 'vitest';
import {
  type FlowsheetEntryResponse,
  type Album,
  type Label,
  type DJ,
  type ScheduleShift,
  type SongRequest,
  type AlbumMetadataResponse,
  type ArtistMetadataResponse,
  type TrackListItem,
  type ReconciledIdentity,
  RotationBin,
  DayOfWeek,
  Genre,
  Format,
  RequestStatus,
  MetadataSource,
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
  });
});
