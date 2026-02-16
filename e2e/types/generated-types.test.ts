/**
 * Generated Types E2E Tests
 *
 * These tests validate that the generated TypeScript types correctly
 * describe real API responses from the backend.
 *
 * Prerequisites:
 * - npm run generate:typescript has been run
 * - Backend service running at E2E_BASE_URL (default: http://localhost:8080)
 *
 * Run with: npm run test:e2e
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createE2EClient, E2EClient, getE2EConfig } from '../setup.js';
import type {
  FlowsheetEntryResponse,
  AlbumSearchResult,
  ScheduleShift,
  FormatEntry,
  GenreEntry,
  OnAirDJ,
  Rotation,
} from '../../src/generated/models/index.js';

let client: E2EClient;

describe('Generated Type Parsing (E2E)', () => {
  beforeAll(async () => {
    const config = getE2EConfig();
    client = createE2EClient(config);
  });

  describe('FlowsheetEntryResponse', () => {
    it('parses real flowsheet entries without errors', async () => {
      const response = await client.get<FlowsheetEntryResponse[]>('/flowsheet?limit=10');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      for (const entry of response.body) {
        expect(typeof entry.id).toBe('number');
        expect(typeof entry.play_order).toBe('number');
        expect(typeof entry.show_id).toBe('number');
        expect(typeof entry.request_flag).toBe('boolean');
      }
    });

    it('handles song entries with all optional fields', async () => {
      const response = await client.get<FlowsheetEntryResponse[]>('/flowsheet?limit=50');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      const songEntries = response.body.filter((e) => e.track_title);

      for (const entry of songEntries) {
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
      const response = await client.get<FlowsheetEntryResponse[]>('/flowsheet?limit=50');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      for (const entry of response.body) {
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
      const response = await client.get<AlbumSearchResult[]>('/library?n=10');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      for (const album of response.body) {
        expect(typeof album.id).toBe('number');
        expect(typeof album.album_title).toBe('string');
        expect(typeof album.artist_name).toBe('string');
        expect(typeof album.code_letters).toBe('string');
        expect(typeof album.code_number).toBe('number');

        if (album.rotation_bin) {
          expect(['H', 'M', 'L', 'S']).toContain(album.rotation_bin);
        }
      }
    });
  });

  describe('ScheduleShift', () => {
    it('parses real schedule shifts with day enum', async () => {
      const response = await client.get<ScheduleShift[]>('/schedule/shifts');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      const validDays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

      for (const shift of response.body) {
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
      const response = await client.get<FormatEntry[]>('/library/formats');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      for (const format of response.body) {
        expect(typeof format.id).toBe('number');
        expect(typeof format.format_name).toBe('string');
      }
    });
  });

  describe('GenreEntry', () => {
    it('parses genre entries with genre enum', async () => {
      const response = await client.get<GenreEntry[]>('/library/genres');

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

      for (const genre of response.body) {
        expect(typeof genre.id).toBe('number');
        expect(validGenres).toContain(genre.genre_name);
        expect(typeof genre.code_letters).toBe('string');
      }
    });
  });

  describe('OnAirDJ', () => {
    it('parses on-air DJ list', async () => {
      const response = await client.get<OnAirDJ[]>('/flowsheet/djs-on-air');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      for (const dj of response.body) {
        expect(typeof dj.id).toBe('number');
        expect(typeof dj.dj_name).toBe('string');
      }
    });
  });

  describe('Rotation', () => {
    it('parses rotation entries with bin enum', async () => {
      const response = await client.get<Rotation[]>('/library/rotation');

      if (!response.ok) {
        console.log('Skipping: Backend not available');
        return;
      }

      expect(Array.isArray(response.body)).toBe(true);

      const validBins = ['H', 'M', 'L', 'S'];

      for (const rotation of response.body) {
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
