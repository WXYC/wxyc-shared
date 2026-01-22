/**
 * Flowsheet E2E Tests
 *
 * Tests for the flowsheet API endpoints.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createE2EClient, type E2EClient, waitForService, getE2EConfig } from './setup.js';
import type { FlowsheetEntryResponse, FlowsheetQueryParams } from '../src/dtos/flowsheet.dto.js';

describe('Flowsheet E2E', () => {
  let client: E2EClient;
  const config = getE2EConfig();

  beforeAll(async () => {
    // Wait for backend to be ready
    await waitForService(`${config.baseUrl}/health`);
    client = createE2EClient();
  });

  describe('GET /flowsheet', () => {
    it('should return flowsheet entries', async () => {
      const response = await client.get<FlowsheetEntryResponse[]>('/flowsheet');

      expect(response.ok).toBe(true);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('should support pagination', async () => {
      const page1 = await client.get<FlowsheetEntryResponse[]>('/flowsheet?page=0&limit=5');
      const page2 = await client.get<FlowsheetEntryResponse[]>('/flowsheet?page=1&limit=5');

      expect(page1.ok).toBe(true);
      expect(page2.ok).toBe(true);
      expect(page1.body.length).toBeLessThanOrEqual(5);
      expect(page2.body.length).toBeLessThanOrEqual(5);

      // Pages should have different entries (if there are enough)
      if (page1.body.length > 0 && page2.body.length > 0) {
        expect(page1.body[0]?.id).not.toBe(page2.body[0]?.id);
      }
    });

    it('should reject excessive limit', async () => {
      const response = await client.get<{ message: string }>('/flowsheet?limit=500');

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('too many');
    });

    it('should support shows_limit parameter', async () => {
      const response = await client.get<FlowsheetEntryResponse[]>('/flowsheet?shows_limit=1');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
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
