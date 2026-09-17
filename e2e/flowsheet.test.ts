/**
 * Flowsheet E2E Tests
 *
 * Tests for the flowsheet API endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EClient, type E2EClient, waitForService, getE2EConfig } from './setup.js';
import type {
  FlowsheetEntryResponse,
  FlowsheetQueryParams,
  FlowsheetV2Entry,
  FlowsheetV2PaginatedResponse,
} from '../src/dtos/index.js';

describe('Flowsheet E2E', () => {
  let client: E2EClient;
  const config = getE2EConfig();

  beforeAll(async () => {
    // Wait for backend to be ready
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
  });

  describe('GET /flowsheet', () => {
    // The default branch answers with the pagination envelope, not a bare
    // array. These assertions read `.entries` because asserting
    // `Array.isArray(body)` here passed review for years while never matching
    // the wire — the endpoint has served an object the whole time.
    it('should return the pagination envelope, not a bare array', async () => {
      const response = await client.get<FlowsheetV2PaginatedResponse>('/flowsheet');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(false);
      expect(Array.isArray(response.body.entries)).toBe(true);
      expect(typeof response.body.total).toBe('number');
      expect(typeof response.body.totalPages).toBe('number');
    });

    // Three states, and absent is not null: an absent key means the on-air
    // lookup failed and the banner should stay hidden, where null positively
    // asserts automation. Only this branch carries the field at all.
    it('should carry on_air as an object, null, or an absent key', async () => {
      const response = await client.get<FlowsheetV2PaginatedResponse>('/flowsheet');

      if ('on_air' in response.body) {
        const onAir = response.body.on_air;
        if (onAir !== null) expect(typeof onAir?.dj_name).toBe('string');
      }
    });

    it('should support pagination', async () => {
      const page1 = await client.get<FlowsheetV2PaginatedResponse>('/flowsheet?page=0&limit=5');
      const page2 = await client.get<FlowsheetV2PaginatedResponse>('/flowsheet?page=1&limit=5');

      expect(page1.ok).toBe(true);
      expect(page2.ok).toBe(true);
      expect(page1.body.entries.length).toBeLessThanOrEqual(5);
      expect(page2.body.entries.length).toBeLessThanOrEqual(5);
      expect(page1.body.page).toBe(0);
      expect(page2.body.page).toBe(1);

      // Pages should have different entries (if there are enough)
      if (page1.body.entries.length > 0 && page2.body.entries.length > 0) {
        expect(page1.body.entries[0]?.id).not.toBe(page2.body.entries[0]?.id);
      }
    });

    it('should reject excessive limit', async () => {
      const response = await client.get<{ message: string }>('/flowsheet?limit=500');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('too many');
    });

    // The other branch: shows_limit drops the envelope entirely and answers
    // with a bare array of the same union. Asserting BOTH shapes is the point —
    // one route, two response types, and a client that assumes either one
    // universally breaks on the other.
    it('should answer shows_limit with a bare array, not the envelope', async () => {
      const response = await client.get<FlowsheetV2Entry[]>('/flowsheet?shows_limit=1');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
      for (const entry of response.body) expect(typeof entry.entry_type).toBe('string');
    });
  });

  describe('GET /flowsheet/on-air', () => {
    it('should return on-air status', async () => {
      const response = await client.get<{ djs: unknown[]; onAir: string }>('/flowsheet/on-air');

      expect(response.ok).toBe(true);
      expect(response.body).toHaveProperty('djs');
      expect(response.body).toHaveProperty('onAir');
    });
  });

  // Note: POST/PUT/DELETE tests require authentication
  // These would be added in a full E2E suite with proper auth setup
});
