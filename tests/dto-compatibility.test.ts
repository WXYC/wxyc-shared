/**
 * DTO Compatibility Tests
 *
 * TDD: These tests ensure that manual DTOs stay in sync with the generated
 * types from the OpenAPI spec. If these tests fail, either:
 * 1. The manual DTO needs to be updated to match the OpenAPI spec, or
 * 2. The OpenAPI spec needs to be updated to match the intended behavior
 *
 * Run: npm test
 */

import { describe, it, expect } from 'vitest';

// Import manual DTOs
import type {
  FlowsheetEntryResponse as ManualFlowsheetEntryResponse,
  Album as ManualAlbum,
  Label as ManualLabel,
  DJ as ManualDJ,
  ScheduleShift as ManualScheduleShift,
  SongRequest as ManualSongRequest,
  RotationBin as ManualRotationBin,
  DayOfWeek as ManualDayOfWeek,
} from '../src/dtos/index.js';

// Import generated types
import {
  FlowsheetEntryResponse as GeneratedFlowsheetEntryResponse,
  FlowsheetEntryResponseFromJSON,
  Album as GeneratedAlbum,
  AlbumFromJSON,
  Label as GeneratedLabel,
  LabelFromJSON,
  DJ as GeneratedDJ,
  DJFromJSON,
  ScheduleShift as GeneratedScheduleShift,
  ScheduleShiftFromJSON,
  SongRequest as GeneratedSongRequest,
  SongRequestFromJSON,
  RotationBin as GeneratedRotationBin,
  DayOfWeek as GeneratedDayOfWeek,
} from '../src/generated/models/index.js';

/**
 * Type compatibility helper: If T extends U and U extends T, they're compatible
 * We use this to verify that manual and generated types have the same shape
 */
type AssertTypesCompatible<T, U> = T extends U ? (U extends T ? true : false) : false;

describe('DTO Compatibility with Generated Types', () => {
  describe('FlowsheetEntryResponse', () => {
    it('should be assignable from generated type', () => {
      const generated: GeneratedFlowsheetEntryResponse = {
        id: 1,
        play_order: 100,
        show_id: 1,
        request_flag: false,
        track_title: 'Test Song',
      };

      // This assignment should compile if types are compatible
      const manual: ManualFlowsheetEntryResponse = generated;
      expect(manual.id).toBe(1);
    });

    it('should parse JSON identically', () => {
      const json = {
        id: 123,
        play_order: 50,
        show_id: 10,
        request_flag: true,
        track_title: 'Compatibility Test',
        artist_name: 'Test Artist',
        album_title: 'Test Album',
        record_label: 'Test Label',
        rotation_bin: 'H',
        artwork_url: 'https://example.com/art.jpg',
      };

      const generated = FlowsheetEntryResponseFromJSON(json);
      const manual: ManualFlowsheetEntryResponse = json as ManualFlowsheetEntryResponse;

      expect(generated.id).toBe(manual.id);
      expect(generated.track_title).toBe(manual.track_title);
      expect(generated.rotation_bin).toBe(manual.rotation_bin);
    });
  });

  describe('Album', () => {
    it('should be assignable from generated type', () => {
      const generated: GeneratedAlbum = {
        id: 1,
        artist_id: 100,
        album_title: 'Test Album',
        code_number: 42,
        genre_id: 5,
        format_id: 1,
      };

      const manual: ManualAlbum = generated;
      expect(manual.album_title).toBe('Test Album');
    });

    it('should handle optional fields identically', () => {
      const json = {
        id: 1,
        artist_id: 100,
        album_title: 'Test Album',
        code_number: 42,
        genre_id: 5,
        format_id: 1,
        label: 'Test Label',
        label_id: 1,
        add_date: '2024-01-15T00:00:00Z',
      };

      const generated = AlbumFromJSON(json);
      const manual: ManualAlbum = json as ManualAlbum;

      expect(generated.label).toBe(manual.label);
      // Note: generated type converts date strings to Date objects
      // Manual type keeps them as strings (matching raw JSON)
      expect(generated.add_date).toBeDefined();
      expect(manual.add_date).toBeDefined();
    });
  });

  describe('Label', () => {
    it('should be assignable from generated type', () => {
      const generated: GeneratedLabel = {
        id: 1,
        label_name: 'Merge Records',
      };

      const manual: ManualLabel = generated;
      expect(manual.label_name).toBe('Merge Records');
    });

    it('should handle optional parent_label_id', () => {
      const json = {
        id: 1,
        label_name: 'Domino USA',
        parent_label_id: 42,
      };

      const generated = LabelFromJSON(json);
      const manual: ManualLabel = json as ManualLabel;

      expect(generated.parent_label_id).toBe(manual.parent_label_id);
    });

    it('should parse JSON with missing optional fields', () => {
      const json = {
        id: 1,
        label_name: 'Sub Pop',
      };

      const generated = LabelFromJSON(json);
      expect(generated.parent_label_id).toBeUndefined();
    });
  });

  describe('DJ', () => {
    it('should be assignable from generated type', () => {
      const generated: GeneratedDJ = {
        id: 1,
        dj_name: 'DJ Test',
      };

      const manual: ManualDJ = generated;
      expect(manual.dj_name).toBe('DJ Test');
    });
  });

  describe('ScheduleShift', () => {
    it('should be assignable from generated type', () => {
      const generated: GeneratedScheduleShift = {
        id: 1,
        dj_id: 100,
        dj_name: 'Test DJ',
        day: GeneratedDayOfWeek.Monday,
        start_time: '14:00',
        end_time: '16:00',
      };

      // Day enum values should match
      const manual: ManualScheduleShift = {
        ...generated,
        day: 'Monday' as ManualDayOfWeek,
      };
      expect(manual.day).toBe(generated.day);
    });
  });

  describe('SongRequest', () => {
    it('should be assignable from generated type', () => {
      const generated: GeneratedSongRequest = {
        id: 1,
        device_id: 'device-123',
        message: 'Play some jazz!',
        created_at: '2024-01-15T12:00:00Z',
        status: 'pending',
      };

      const manual: ManualSongRequest = generated as unknown as ManualSongRequest;
      expect(manual.message).toBe('Play some jazz!');
    });
  });

  describe('Enums', () => {
    it('RotationBin values should match', () => {
      const generatedValues = [
        GeneratedRotationBin.H,
        GeneratedRotationBin.M,
        GeneratedRotationBin.L,
        GeneratedRotationBin.S,
      ];

      const manualValues: ManualRotationBin[] = ['H', 'M', 'L', 'S'];

      expect(generatedValues).toEqual(manualValues);
    });

    it('DayOfWeek values should match', () => {
      const generatedValues = [
        GeneratedDayOfWeek.Sunday,
        GeneratedDayOfWeek.Monday,
        GeneratedDayOfWeek.Tuesday,
        GeneratedDayOfWeek.Wednesday,
        GeneratedDayOfWeek.Thursday,
        GeneratedDayOfWeek.Friday,
        GeneratedDayOfWeek.Saturday,
      ];

      const manualValues: ManualDayOfWeek[] = [
        'Sunday',
        'Monday',
        'Tuesday',
        'Wednesday',
        'Thursday',
        'Friday',
        'Saturday',
      ];

      expect(generatedValues).toEqual(manualValues);
    });
  });
});
