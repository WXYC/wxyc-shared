/**
 * Catalog (Library) E2E Tests
 *
 * Tests for the library/catalog API endpoints.
 *
 * IMPORTANT: All /library endpoints require authentication (catalog:read).
 * Tests that verify response content need a valid JWT. The auth.test.ts file
 * covers the authenticated access patterns. These tests authenticate first
 * when credentials are available, or document the expected 401 otherwise.
 *
 * Prerequisites:
 * - Backend service running at E2E_BASE_URL (default: http://localhost:8080)
 * - Auth service running at E2E_AUTH_URL (default: http://localhost:8081/auth)
 * - Test DJ account (E2E_TEST_DJ_EMAIL / E2E_TEST_DJ_PASSWORD) for authenticated tests
 */

import { describe, it, expect, beforeAll } from 'vitest';
import {
  createE2EClient,
  createE2EAuthHelper,
  type E2EClient,
  type E2EAuthHelper,
  waitForService,
  getE2EConfig,
} from './setup.js';
import type { AlbumSearchResult, FormatEntry, GenreEntry } from '../src/dtos/catalog.dto.js';

describe('Catalog E2E', () => {
  let client: E2EClient;
  let authHelper: E2EAuthHelper;
  const config = getE2EConfig();

  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
    authHelper = createE2EAuthHelper();

    // Authenticate if credentials are available
    if (hasCredentials) {
      await authHelper.authenticateClient(
        client,
        config.testDjEmail!,
        config.testDjPassword!
      );
    }
  });

  describe('GET /library (requires catalog:read)', () => {
    it.skipIf(!hasCredentials)('should search albums by artist name', async () => {
      const response = await client.get<AlbumSearchResult[]>('/library?artist_name=test');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it.skipIf(!hasCredentials)('should search albums by album name', async () => {
      const response = await client.get<AlbumSearchResult[]>('/library?album_name=test');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it.skipIf(!hasCredentials)('should limit results with n parameter', async () => {
      const response = await client.get<AlbumSearchResult[]>('/library?artist_name=a&n=5');

      expect(response.ok).toBe(true);
      expect(response.body.length).toBeLessThanOrEqual(5);
    });

    it.skipIf(!hasCredentials)('should return 404 for no results', async () => {
      const response = await client.get<{ message: string }>(
        '/library?artist_name=xyznonexistent123'
      );

      // API returns 404 for no results
      expect(response.status).toBe(404);
    });

    it('should return 401 without authentication', async () => {
      const unauthClient = createE2EClient();
      const response = await unauthClient.get('/library?artist_name=test');

      expect(response.status).toBe(401);
    });
  });

  describe('GET /library/formats (requires catalog:read)', () => {
    it.skipIf(!hasCredentials)('should return list of formats', async () => {
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

  describe('GET /library/genres (requires catalog:read)', () => {
    it.skipIf(!hasCredentials)('should return list of genres', async () => {
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

  describe('GET /library/rotation (requires catalog:read)', () => {
    it.skipIf(!hasCredentials)('should return current rotation', async () => {
      const response = await client.get<unknown[]>('/library/rotation');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });
});
