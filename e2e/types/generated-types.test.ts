/**
 * Generated Types E2E Tests
 *
 * These tests validate that the generated TypeScript types correctly
 * parse real API responses from the backend.
 *
 * Prerequisites:
 * - npm run generate:typescript has been run
 * - Backend service running at E2E_BASE_URL (default: http://localhost:8080)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createE2EClient, E2EClient, getE2EConfig } from '../setup.js';
import {
  FlowsheetEntryResponse,
  FlowsheetEntryResponseFromJSON,
  instanceOfFlowsheetEntryResponse,
  AlbumSearchResult,
  AlbumSearchResultFromJSON,
  ScheduleShift,
  ScheduleShiftFromJSON,
  FormatEntry,
  FormatEntryFromJSON,
  GenreEntry,
  GenreEntryFromJSON,
  OnAirDJ,
  OnAirDJFromJSON,
  Rotation,
  RotationFromJSON,
} from '../../generated/typescript/models/index.js';

let client: E2EClient;

describe('Generated Type Parsing (E2E)', () => {
  beforeAll(async () => {
    const config = getE2EConfig();
    client = createE2EClient(config);
  });

  describe('FlowsheetEntryResponse', () => {
    it('parses real flowsheet entries without errors', async () => {
      const response = await client.get<unknown[]>('/flowsheet?limit=10');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      for (const raw of response.body) {
        // Parse using generated function
        const entry: FlowsheetEntryResponse = FlowsheetEntryResponseFromJSON(raw);

        // Verify required fields are present and typed correctly
        expect(typeof entry.id).toBe('number');
        expect(typeof entry.play_order).toBe('number');
        expect(typeof entry.show_id).toBe('number');
        expect(typeof entry.request_flag).toBe('boolean');

        // Verify instance check works
        expect(instanceOfFlowsheetEntryResponse(raw)).toBe(true);
      }
    });

    it('handles song entries with all optional fields', async () => {
      const response = await client.get<unknown[]>('/flowsheet?limit=50');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      // Find an entry with song data
      const songEntries = response.body.filter(
        (e: unknown) => (e as Record<string, unknown>).track_title
      );

      for (const raw of songEntries) {
        const entry = FlowsheetEntryResponseFromJSON(raw);

        // Song fields should be accessible
        if (entry.track_title) {
          expect(typeof entry.track_title).toBe('string');
        }
        if (entry.artist_name) {
          expect(typeof entry.artist_name).toBe('string');
        }
        if (entry.album_title) {
          expect(typeof entry.album_title).toBe('string');
        }
        if (entry.rotation_bin) {
          expect(['H', 'M', 'L', 'S']).toContain(entry.rotation_bin);
        }
      }
    });

    it('handles metadata fields correctly', async () => {
      const response = await client.get<unknown[]>('/flowsheet?limit=50');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      for (const raw of response.body) {
        const entry = FlowsheetEntryResponseFromJSON(raw);

        // Nullable fields should be undefined or the correct type
        if (entry.artwork_url !== undefined && entry.artwork_url !== null) {
          expect(typeof entry.artwork_url).toBe('string');
        }
        if (entry.spotify_url !== undefined && entry.spotify_url !== null) {
          expect(typeof entry.spotify_url).toBe('string');
        }
        if (entry.release_year !== undefined && entry.release_year !== null) {
          expect(typeof entry.release_year).toBe('number');
        }
      }
    });
  });

  describe('AlbumSearchResult', () => {
    it('parses real library search results', async () => {
      const response = await client.get<unknown[]>('/library?n=10');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      for (const raw of response.body) {
        const album: AlbumSearchResult = AlbumSearchResultFromJSON(raw);

        // Required fields
        expect(typeof album.id).toBe('number');
        expect(typeof album.album_title).toBe('string');
        expect(typeof album.artist_name).toBe('string');
        expect(typeof album.code_letters).toBe('string');
        expect(typeof album.code_number).toBe('number');

        // Optional rotation fields
        if (album.rotation_bin) {
          expect(['H', 'M', 'L', 'S']).toContain(album.rotation_bin);
        }
      }
    });
  });

  describe('ScheduleShift', () => {
    it('parses real schedule shifts with day enum', async () => {
      const response = await client.get<unknown[]>('/schedule/shifts');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      for (const raw of response.body) {
        const shift: ScheduleShift = ScheduleShiftFromJSON(raw);

        expect(typeof shift.id).toBe('number');
        expect(typeof shift.dj_id).toBe('number');
        expect(typeof shift.dj_name).toBe('string');
        expect(validDays).toContain(shift.day);
        expect(typeof shift.start_time).toBe('string');
        expect(typeof shift.end_time).toBe('string');
      }
    });
  });

  describe('FormatEntry', () => {
    it('parses format entries', async () => {
      const response = await client.get<unknown[]>('/library/formats');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      for (const raw of response.body) {
        const format: FormatEntry = FormatEntryFromJSON(raw);

        expect(typeof format.id).toBe('number');
        expect(typeof format.format_name).toBe('string');
      }
    });
  });

  describe('GenreEntry', () => {
    it('parses genre entries with genre enum', async () => {
      const response = await client.get<unknown[]>('/library/genres');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      const validGenres = [
        'Blues',
        'Rock',
        'Electronic',
        'Hiphop',
        'Jazz',
        'Classical',
        'Reggae',
        'Soundtracks',
        'OCS',
        'Unknown',
      ];

      for (const raw of response.body) {
        const genre: GenreEntry = GenreEntryFromJSON(raw);

        expect(typeof genre.id).toBe('number');
        expect(validGenres).toContain(genre.genre_name);
        expect(typeof genre.code_letters).toBe('string');
      }
    });
  });

  describe('OnAirDJ', () => {
    it('parses on-air DJ list', async () => {
      const response = await client.get<unknown[]>('/flowsheet/djs-on-air');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      for (const raw of response.body) {
        const dj: OnAirDJ = OnAirDJFromJSON(raw);

        expect(typeof dj.id).toBe('number');
        expect(typeof dj.dj_name).toBe('string');
      }
    });
  });

  describe('Rotation', () => {
    it('parses rotation entries with bin enum', async () => {
      const response = await client.get<unknown[]>('/library/rotation');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      const validBins = ['H', 'M', 'L', 'S'];

      for (const raw of response.body) {
        const rotation: Rotation = RotationFromJSON(raw);

        // Check key fields
        if (rotation.id !== undefined) {
          expect(typeof rotation.id).toBe('number');
        }
        if (rotation.play_freq) {
          expect(validBins).toContain(rotation.play_freq);
        }
        if (rotation.artist_name) {
          expect(typeof rotation.artist_name).toBe('string');
        }
      }
    });
  });
});
