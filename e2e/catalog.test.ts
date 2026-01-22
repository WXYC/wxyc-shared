/**
 * Catalog (Library) E2E Tests
 *
 * Tests for the library/catalog API endpoints.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createE2EClient, type E2EClient, waitForService, getE2EConfig } from './setup.js';
import type { AlbumSearchResult, FormatEntry, GenreEntry } from '../src/dtos/catalog.dto.js';

describe('Catalog E2E', () => {
  let client: E2EClient;
  const config = getE2EConfig();

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/health`);
    client = createE2EClient();
  });

  describe('GET /library', () => {
    it('should search albums by artist name', async () => {
      const response = await client.get<AlbumSearchResult[]>('/library?artist_name=test');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should search albums by album name', async () => {
      const response = await client.get<AlbumSearchResult[]>('/library?album_name=test');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should limit results with n parameter', async () => {
      const response = await client.get<AlbumSearchResult[]>('/library?artist_name=a&n=5');

      expect(response.ok).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(5);
    });

    it('should return 404 for no results', async () => {
      const response = await client.get<{ message: string }>(
        '/library?artist_name=xyznonexistent123'
      );

      // API returns 404 for no results
      expect(response.status).toBe(404);
    });
  });

  describe('GET /library/formats', () => {
    it('should return list of formats', async () => {
      const response = await client.get<FormatEntry[]>('/library/formats');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Verify format structure
      const format = response.body[0];
      expect(format).toHaveProperty('id');
      expect(format).toHaveProperty('format_name');
    });
  });

  describe('GET /library/genres', () => {
    it('should return list of genres', async () => {
      const response = await client.get<GenreEntry[]>('/library/genres');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      expect(response.body.length).toBeGreaterThan(0);

      // Verify genre structure
      const genre = response.body[0];
      expect(genre).toHaveProperty('id');
      expect(genre).toHaveProperty('genre_name');
    });
  });

  describe('GET /library/rotation', () => {
    it('should return current rotation', async () => {
      const response = await client.get<unknown[]>('/library/rotation');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
