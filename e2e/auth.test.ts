/**
 * Authentication & Authorization E2E Tests
 *
 * Tests the full auth flow: sign-in → JWT → authorized backend requests.
 * Also verifies that unauthenticated/unauthorized requests are properly rejected.
 *
 * Prerequisites:
 * - Backend service running at E2E_BASE_URL (default: http://localhost:8080)
 * - Auth service running at E2E_AUTH_URL (default: http://localhost:8081/auth)
 * - Test DJ account exists (E2E_TEST_DJ_EMAIL / E2E_TEST_DJ_PASSWORD)
 *
 * Run with: npm run test:e2e
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

/** The WXYC roles recognized by the backend's requirePermissions middleware. */
const VALID_WXYC_ROLES = ['member', 'dj', 'musicDirector', 'stationManager', 'admin'] as const;

describe('Auth E2E', () => {
  let client: E2EClient;
  let authHelper: E2EAuthHelper;
  const config = getE2EConfig();

  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
    authHelper = createE2EAuthHelper();
  });

  // ── Unauthenticated access ────────────────────────────────────────────

  describe('Unauthenticated requests to protected endpoints', () => {
    it('GET /library should return 401 without auth', async () => {
      // Ensure no token is set
      client.clearAuthToken();
      const response = await client.get('/library?artist_name=test');

      expect(response.status).toBe(401);
    });

    it('GET /library/formats should return 401 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/library/formats');

      expect(response.status).toBe(401);
    });

    it('GET /library/genres should return 401 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/library/genres');

      expect(response.status).toBe(401);
    });

    it('GET /library/rotation should return 401 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/library/rotation');

      expect(response.status).toBe(401);
    });

    it('POST /flowsheet should return 401 without auth', async () => {
      client.clearAuthToken();
      const response = await client.post('/flowsheet', {});

      expect(response.status).toBe(401);
    });

    it('GET /djs/bin should return 401 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/djs/bin?dj_id=fake');

      expect(response.status).toBe(401);
    });
  });

  // ── Public endpoints ──────────────────────────────────────────────────

  describe('Public endpoints should NOT require auth', () => {
    it('GET /flowsheet should return 200 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/flowsheet');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it('GET /flowsheet/latest should return 200 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/flowsheet/latest');

      // May be 200 or 404 (if no entries exist), but never 401/403
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
    });

    it('GET /flowsheet/djs-on-air should return 200 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/flowsheet/djs-on-air');

      expect(response.ok).toBe(true);
    });

    it('GET /flowsheet/on-air should return 200 without auth', async () => {
      client.clearAuthToken();
      const response = await client.get('/flowsheet/on-air');

      expect(response.ok).toBe(true);
    });
  });

  // ── Authenticated flow ────────────────────────────────────────────────

  describe('DJ sign-in and JWT token flow', () => {
    it.skipIf(!hasCredentials)(
      'should sign in and obtain a JWT with a valid WXYC role',
      async () => {
        const { payload } = await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        // The JWT must contain a role recognized by the backend
        expect(payload).toHaveProperty('role');
        expect(VALID_WXYC_ROLES).toContain(payload.role);

        // The JWT must contain a user ID
        const userId = payload.sub || payload.id;
        expect(userId).toBeTruthy();
      }
    );

    it.skipIf(!hasCredentials)(
      'JWT role should NOT be a better-auth built-in that the backend does not recognize',
      async () => {
        const { payload } = await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        // These built-in better-auth roles are NOT in WXYCRoles on
        // Backend-Service main (until the admin-role branch merges).
        // If they appear in the JWT, authenticated requests will 403.
        const unrecognizedRoles = ['owner'];
        expect(unrecognizedRoles).not.toContain(payload.role);
      }
    );
  });

  // ── Authorized catalog access ─────────────────────────────────────────

  describe('Authenticated catalog access', () => {
    it.skipIf(!hasCredentials)(
      'GET /library should return 200 with valid auth',
      async () => {
        await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        const response = await client.get('/library?artist_name=test');

        // Should succeed (200) or return 404 (no results) — never 401/403
        expect(response.status === 200 || response.status === 404).toBe(true);
      }
    );

    it.skipIf(!hasCredentials)(
      'GET /library/formats should return 200 with valid auth',
      async () => {
        await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        const response = await client.get('/library/formats');

        expect(response.ok).toBe(true);
        expect(Array.isArray(response.body)).toBe(true);
      }
    );

    it.skipIf(!hasCredentials)(
      'GET /library/genres should return 200 with valid auth',
      async () => {
        await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        const response = await client.get('/library/genres');

        expect(response.ok).toBe(true);
        expect(Array.isArray(response.body)).toBe(true);
      }
    );

    it.skipIf(!hasCredentials)(
      'GET /library/rotation should return 200 with valid auth',
      async () => {
        await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        const response = await client.get('/library/rotation');

        expect(response.ok).toBe(true);
        expect(Array.isArray(response.body)).toBe(true);
      }
    );
  });

  // ── DJ bin access ─────────────────────────────────────────────────────

  describe('Authenticated DJ bin access', () => {
    it.skipIf(!hasCredentials)(
      'GET /djs/bin should return 200 with valid auth',
      async () => {
        const { payload } = await authHelper.authenticateClient(
          client,
          config.testDjEmail!,
          config.testDjPassword!
        );

        const userId = payload.sub || payload.id;
        const response = await client.get(`/djs/bin?dj_id=${userId}`);

        // Should succeed or 404 (no bin entries) — never 401/403
        expect(response.status === 200 || response.status === 404).toBe(true);
      }
    );
  });

  // ── Invalid token ─────────────────────────────────────────────────────

  describe('Invalid or tampered tokens', () => {
    it('should return 401 for a garbage bearer token', async () => {
      client.setAuthToken('not-a-real-jwt');
      const response = await client.get('/library?artist_name=test');

      expect(response.status).toBe(401);
      client.clearAuthToken();
    });

    it('should return 401 for an expired token', async () => {
      // Construct a JWT-shaped string with exp in the past (no valid signature)
      const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(
        JSON.stringify({
          sub: 'fake-user',
          role: 'dj',
          exp: Math.floor(Date.now() / 1000) - 3600,
          iat: Math.floor(Date.now() / 1000) - 7200,
        })
      ).toString('base64url');
      const fakeToken = `${header}.${payload}.invalid-signature`;

      client.setAuthToken(fakeToken);
      const response = await client.get('/library?artist_name=test');

      expect(response.status).toBe(401);
      client.clearAuthToken();
    });
  });
});
