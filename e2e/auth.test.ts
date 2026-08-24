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
  createE2EAuthClient,
  createE2EAuthHelper,
  getAnonymousToken,
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
  /**
   * Username half of the same staging DJ account. Provisioning (staging
   * account + repository secret) is tracked outside this repo — see
   * `E2EConfig.testDjUsername`'s doc comment in `setup.ts`. Self-skips like
   * `hasCredentials` rather than a fail-loud `E2E_REQUIRE_CREDENTIALS` gate,
   * deliberately: that gate only becomes safe once the credential actually
   * exists in every environment this suite runs in (issue #379's landing
   * order).
   */
  const hasUsernameCredentials = Boolean(config.testDjUsername && config.testDjPassword);

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

  // ── issue #379: better-auth core surface behavioral assertions ─────────
  //
  // These guard the api.yaml mirror added in #379 (wxyc-swift-auth Phase
  // A). Each test hits an auth-origin client (`createE2EAuthClient` — the
  // `client`/`authHelper` pair above talks to the backend origin and to
  // `/auth` through E2EAuthHelper's own fetch calls respectively, neither
  // of which fits an ad-hoc auth-origin request against a path E2EAuthHelper
  // doesn't wrap).
  describe('better-auth core surface (issue #379)', () => {
    let authClient: E2EClient;

    beforeAll(() => {
      authClient = createE2EAuthClient();
    });

    // ── set-auth-token header ─────────────────────────────────────────

    it.skipIf(!hasCredentials)(
      'POST /auth/sign-in/email returns set-auth-token header',
      async () => {
        const response = await authClient.post('/sign-in/email', {
          email: config.testDjEmail,
          password: config.testDjPassword,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('set-auth-token')).toBeTruthy();
      }
    );

    // Provisioning-gated per E2EConfig.testDjUsername's doc comment — see
    // hasUsernameCredentials above. Self-skips, never fail-loud, until the
    // staging account + secret exist.
    it.skipIf(!hasUsernameCredentials)(
      'POST /auth/sign-in/username returns set-auth-token header',
      async () => {
        const response = await authClient.post('/sign-in/username', {
          username: config.testDjUsername,
          password: config.testDjPassword,
        });

        expect(response.status).toBe(200);
        expect(response.headers.get('set-auth-token')).toBeTruthy();
      }
    );

    // ── anonymous sign-in shape ────────────────────────────────────────

    it('POST /auth/sign-in/anonymous returns token + user.id, no credentials needed', async () => {
      const response = await authClient.post<{ token?: string; user?: { id?: string } }>(
        '/sign-in/anonymous',
        {}
      );

      expect(response.status).toBe(200);
      // The token arrives on the header (bearer plugin) or in the body,
      // depending on plugin config — see AuthTokenAndUserResult in api.yaml.
      const headerToken = response.headers.get('set-auth-token');
      const bodyToken = response.body?.token;
      expect(headerToken || bodyToken, 'a session token must arrive on the header or the body').toBeTruthy();
      expect(response.body?.user?.id, 'anonymous sign-in must return a user id').toBeTruthy();
    });

    // ── /auth/token mint shape, both session kinds ──────────────────────

    it('GET /auth/token mints a JWT for an anonymous session', async () => {
      const sessionToken = await getAnonymousToken(config.authUrl);
      const response = await authClient.get<{ token?: string }>('/token', {
        headers: { Authorization: `Bearer ${sessionToken}` },
      });

      expect(response.status).toBe(200);
      expect(response.body?.token).toBeTruthy();
      // Basic JWT shape: three dot-separated segments.
      expect(response.body!.token!.split('.').length).toBe(3);
    });

    it.skipIf(!hasCredentials)(
      'GET /auth/token mints a JWT for a credentialed DJ session',
      async () => {
        const { cookies } = await authHelper.signIn(config.testDjEmail!, config.testDjPassword!);
        // Exchange via cookie (E2EAuthHelper's own mechanism) rather than a
        // bearer header here, so this test is independent of the
        // set-auth-token assertion above.
        const cookieHeader = cookies.map((c) => c.split(';')[0]).join('; ');
        const response = await authClient.get<{ token?: string }>('/token', {
          headers: { cookie: cookieHeader },
        });

        expect(response.status).toBe(200);
        expect(response.body?.token).toBeTruthy();
      }
    );

    // ── 401-vs-404 on GET /auth/token ───────────────────────────────────

    it('GET /auth/token returns 401 for a missing bearer', async () => {
      const response = await authClient.get('/token');
      expect(response.status).toBe(401);
    });

    it('GET /auth/token returns 401 for a garbage bearer', async () => {
      const response = await authClient.get('/token', {
        headers: { Authorization: 'Bearer not-a-real-session-token' },
      });
      expect(response.status).toBe(401);
    });

    it('POST /auth/token (wrong method) returns 404, not 401', async () => {
      // Only GET is registered for this path -- better-call has no route
      // to match a POST, so it 404s rather than 401ing or 405ing. Pins the
      // distinction the api.yaml operation description documents.
      const response = await authClient.post('/token');
      expect(response.status).toBe(404);
    });

    // ── lookup-email resolution + no-match ──────────────────────────────

    it.skipIf(!hasUsernameCredentials)(
      'POST /auth/wxyc/lookup-email resolves a known username to its email',
      async () => {
        const response = await authClient.post<{ email?: string | null }>('/wxyc/lookup-email', {
          identifier: config.testDjUsername,
        });

        expect(response.status).toBe(200);
        expect(response.body?.email).toBe(config.testDjEmail);
      }
    );

    it('POST /auth/wxyc/lookup-email returns { email: null } for an unknown username', async () => {
      const response = await authClient.post<{ email?: string | null }>('/wxyc/lookup-email', {
        identifier: `e2e-nonexistent-username-${Date.now()}`,
      });

      expect(response.status).toBe(200);
      expect(response.body?.email).toBeNull();
    });

    // ── send-verification-otp success shape ─────────────────────────────
    //
    // Not exercised against a real account: disableSignUp: true makes the
    // route answer {success: true} identically whether or not the address
    // exists, and a synthetic address never triggers a real send (see
    // apps/auth's sendVerificationOTP -- an unknown email is a silent
    // discard, not an error). The verify leg (POST /auth/sign-in/email-otp)
    // is unassertable here for the same reason api.yaml's operation
    // description carries: nobody reads the mailed code in this harness.
    it('POST /auth/email-otp/send-verification-otp returns { success: true } for any address', async () => {
      const response = await authClient.post<{ success?: boolean }>('/email-otp/send-verification-otp', {
        email: `e2e-otp-probe-${Date.now()}@wxyc.org`,
        type: 'sign-in',
      });

      expect(response.status).toBe(200);
      expect(response.body?.success).toBe(true);
    });

    // ── sign-out invalidation ────────────────────────────────────────────

    it.skipIf(!hasCredentials)(
      'POST /auth/sign-out invalidates the session -- it 401s on GET /auth/token afterward',
      async () => {
        const signInResponse = await authClient.post<{ token?: string }>('/sign-in/email', {
          email: config.testDjEmail,
          password: config.testDjPassword,
        });
        const sessionToken =
          signInResponse.headers.get('set-auth-token') || signInResponse.body?.token;
        expect(sessionToken, 'sign-in must yield a session token to sign out with').toBeTruthy();

        const signOutResponse = await authClient.post<{ success?: boolean }>('/sign-out', undefined, {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        expect(signOutResponse.status).toBe(200);
        expect(signOutResponse.body?.success).toBe(true);

        const tokenResponse = await authClient.get('/token', {
          headers: { Authorization: `Bearer ${sessionToken}` },
        });
        expect(tokenResponse.status, 'a signed-out session token must 401 on /auth/token').toBe(401);
      }
    );

    // ── rate-limit body shape -- MUST RUN LAST ──────────────────────────
    //
    // authMutationRateLimit (apps/auth/app.ts) is ONE limiter instance
    // mounted on every /auth/sign-in/*, /auth/email-otp/send-verification-otp,
    // and /auth/wxyc/lookup-email path -- 10 requests / 15 min per
    // X-Real-IP, shared across all of them for this suite's egress IP. This
    // test deliberately exhausts that shared budget, so it is the last test
    // in this file on purpose: every credentialed assertion above that
    // needs the same budget must run first. Uses send-verification-otp with
    // a synthetic, timestamped address (see the success-shape test above)
    // so it never sends real mail.
    it('POST /auth/email-otp/send-verification-otp returns AuthPlainErrorResponse-shaped 429 once rate limited', async () => {
      let last: Awaited<ReturnType<typeof authClient.post<{ error?: string }>>> | undefined;
      for (let i = 0; i < 15; i++) {
        last = await authClient.post<{ error?: string }>('/email-otp/send-verification-otp', {
          email: `e2e-ratelimit-probe-${Date.now()}-${i}@wxyc.org`,
          type: 'sign-in',
        });
        if (last.status === 429) break;
      }

      expect(last?.status, 'expected a 429 within 15 rapid requests').toBe(429);
      expect(typeof last?.body?.error, 'AuthPlainErrorResponse is { error: string }').toBe('string');
    });
  });
});
