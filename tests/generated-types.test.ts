/**
 * Tests for generated TypeScript types
 *
 * Validates that the OpenAPI code generator produces correct TypeScript types
 * that can parse JSON responses and serialize back to JSON.
 */

import { describe, it, expect } from 'vitest';
import {
  FlowsheetEntryResponse,
  FlowsheetEntryResponseFromJSON,
  FlowsheetEntryResponseToJSON,
  instanceOfFlowsheetEntryResponse,
  Album,
  AlbumFromJSON,
  AlbumToJSON,
  DJ,
  DJFromJSON,
  ScheduleShift,
  ScheduleShiftFromJSON,
  SongRequest,
  SongRequestFromJSON,
  RotationBin,
  DayOfWeek,
  Genre,
  RequestStatus,
} from '../src/generated/models/index.js';

describe('Generated TypeScript Types', () => {
  describe('FlowsheetEntryResponse', () => {
    const sampleFlowsheetEntry = {
      id: 12345,
      play_order: 100,
      show_id: 42,
      request_flag: false,
      track_title: 'Test Song',
      album_title: 'Test Album',
      artist_name: 'Test Artist',
      record_label: 'Test Label',
      rotation_bin: 'H',
      artwork_url: 'https://example.com/artwork.jpg',
      spotify_url: 'https://open.spotify.com/track/abc123',
    };

    it('should parse JSON to FlowsheetEntryResponse', () => {
      const entry = FlowsheetEntryResponseFromJSON(sampleFlowsheetEntry);

      expect(entry.id).toBe(12345);
      expect(entry.play_order).toBe(100);
      expect(entry.show_id).toBe(42);
      expect(entry.request_flag).toBe(false);
      expect(entry.track_title).toBe('Test Song');
      expect(entry.artist_name).toBe('Test Artist');
      expect(entry.rotation_bin).toBe(RotationBin.H);
    });

    it('should validate required fields with instanceOf check', () => {
      expect(instanceOfFlowsheetEntryResponse(sampleFlowsheetEntry)).toBe(true);

      // Missing required field
      expect(
        instanceOfFlowsheetEntryResponse({
          id: 1,
          play_order: 1,
          show_id: 1,
          // missing request_flag
        })
      ).toBe(false);
    });

    it('should handle nullable metadata fields', () => {
      const entryWithNulls = FlowsheetEntryResponseFromJSON({
        ...sampleFlowsheetEntry,
        artwork_url: null,
        spotify_url: null,
        release_year: null,
      });

      // Null values become undefined in the typed object
      expect(entryWithNulls.artwork_url).toBeUndefined();
      expect(entryWithNulls.spotify_url).toBeUndefined();
      expect(entryWithNulls.release_year).toBeUndefined();
    });

    it('should round-trip JSON serialization', () => {
      const entry = FlowsheetEntryResponseFromJSON(sampleFlowsheetEntry);
      const json = FlowsheetEntryResponseToJSON(entry);
      const roundTrip = FlowsheetEntryResponseFromJSON(json);

      expect(roundTrip.id).toBe(entry.id);
      expect(roundTrip.track_title).toBe(entry.track_title);
      expect(roundTrip.rotation_bin).toBe(entry.rotation_bin);
    });

    it('should handle song entries without message field', () => {
      const songEntry = FlowsheetEntryResponseFromJSON(sampleFlowsheetEntry);
      expect(songEntry.message).toBeUndefined();
    });

    it('should handle message entries without song fields', () => {
      const messageEntry = FlowsheetEntryResponseFromJSON({
        id: 1,
        play_order: 50,
        show_id: 42,
        request_flag: false,
        message: 'Talkset - station ID',
      });

      expect(messageEntry.message).toBe('Talkset - station ID');
      expect(messageEntry.track_title).toBeUndefined();
    });
  });

  describe('Album', () => {
    const sampleAlbum = {
      id: 1001,
      artist_id: 500,
      album_title: 'Kind of Blue',
      code_number: 42,
      genre_id: 5,
      format_id: 2,
      label: 'Columbia Records',
      add_date: '2024-01-15T00:00:00Z',
    };

    it('should parse JSON to Album', () => {
      const album = AlbumFromJSON(sampleAlbum);

      expect(album.id).toBe(1001);
      expect(album.album_title).toBe('Kind of Blue');
      expect(album.label).toBe('Columbia Records');
    });

    it('should handle optional fields', () => {
      const minimalAlbum = AlbumFromJSON({
        id: 1,
        artist_id: 1,
        album_title: 'Minimal',
        code_number: 1,
        genre_id: 1,
        format_id: 1,
      });

      expect(minimalAlbum.label).toBeUndefined();
      expect(minimalAlbum.add_date).toBeUndefined();
    });

    it('should round-trip JSON serialization', () => {
      const album = AlbumFromJSON(sampleAlbum);
      const json = AlbumToJSON(album);

      expect(json.id).toBe(sampleAlbum.id);
      expect(json.album_title).toBe(sampleAlbum.album_title);
    });
  });

  describe('DJ', () => {
    it('should parse DJ with all fields', () => {
      const dj = DJFromJSON({
        id: 1,
        dj_name: 'DJ Test',
        real_name: 'John Doe',
        email: 'test@wxyc.org',
      });

      expect(dj.id).toBe(1);
      expect(dj.dj_name).toBe('DJ Test');
      expect(dj.real_name).toBe('John Doe');
      expect(dj.email).toBe('test@wxyc.org');
    });

    it('should parse DJ with only required fields', () => {
      const dj = DJFromJSON({
        id: 2,
        dj_name: 'Minimal DJ',
      });

      expect(dj.id).toBe(2);
      expect(dj.dj_name).toBe('Minimal DJ');
      expect(dj.real_name).toBeUndefined();
      expect(dj.email).toBeUndefined();
    });
  });

  describe('ScheduleShift', () => {
    it('should parse schedule shift with DayOfWeek enum', () => {
      const shift = ScheduleShiftFromJSON({
        id: 1,
        dj_id: 100,
        dj_name: 'Test DJ',
        day: 'Monday',
        start_time: '14:00',
        end_time: '16:00',
      });

      expect(shift.day).toBe(DayOfWeek.Monday);
      expect(shift.start_time).toBe('14:00');
      expect(shift.end_time).toBe('16:00');
    });
  });

  describe('SongRequest', () => {
    it('should parse song request with RequestStatus enum', () => {
      const request = SongRequestFromJSON({
        id: 1,
        device_id: 'device-123',
        message: 'Play some jazz please!',
        created_at: '2024-01-15T12:00:00Z',
        status: 'pending',
      });

      expect(request.status).toBe(RequestStatus.pending);
      expect(request.message).toBe('Play some jazz please!');
    });

    it('should handle all status values', () => {
      const pending = SongRequestFromJSON({
        id: 1,
        device_id: 'd1',
        message: 'msg',
        created_at: '2024-01-01T00:00:00Z',
        status: 'pending',
      });
      const played = SongRequestFromJSON({
        id: 2,
        device_id: 'd2',
        message: 'msg',
        created_at: '2024-01-01T00:00:00Z',
        status: 'played',
      });
      const rejected = SongRequestFromJSON({
        id: 3,
        device_id: 'd3',
        message: 'msg',
        created_at: '2024-01-01T00:00:00Z',
        status: 'rejected',
      });

      expect(pending.status).toBe(RequestStatus.pending);
      expect(played.status).toBe(RequestStatus.played);
      expect(rejected.status).toBe(RequestStatus.rejected);
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

    it('should define RequestStatus values', () => {
      expect(RequestStatus.pending).toBe('pending');
      expect(RequestStatus.played).toBe('played');
      expect(RequestStatus.rejected).toBe('rejected');
    });
  });
});
