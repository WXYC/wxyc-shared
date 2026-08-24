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
  extractSetCookieHeaders,
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
  let authClient: E2EClient;
  const config = getE2EConfig();

  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);
  /**
   * Username half of the same staging DJ account. Provisioning (staging
   * account + repository secret) is tracked outside this repo — see
   * `E2EConfig.testDjUsername`'s doc comment in `setup.ts`. Self-skips like
   * `hasCredentials` rather than a fail-loud gate, deliberately: that gate
   * only becomes safe once the credential actually exists in every
   * environment this suite runs in (issue #379's landing order).
   *
   * Gates ONLY `POST /auth/sign-in/username` — the one assertion that
   * actually needs username + password to authenticate. Split from
   * `canResolveUsernameToEmail` below per the issue #379 review's finding
   * #12: an earlier version of this file used one flag for both, so an env
   * shape with `E2E_TEST_DJ_USERNAME` + `E2E_TEST_DJ_PASSWORD` set but
   * `E2E_TEST_DJ_EMAIL` unset made the lookup-email-resolution test
   * (below) eligible to run and then fail on `config.testDjEmail` being
   * `undefined` — a config-shape bug, not a signal about the contract
   * under test.
   */
  const hasUsernameCredentials = Boolean(config.testDjUsername && config.testDjPassword);
  /**
   * Gates `POST /auth/wxyc/lookup-email`'s resolution assertion, which
   * needs the username to look up AND the email to assert the response
   * equals — no password. Deliberately independent of
   * `hasUsernameCredentials` above (see that flag's doc comment).
   */
  const canResolveUsernameToEmail = Boolean(config.testDjUsername && config.testDjEmail);

  /**
   * The shared credentialed sign-in, captured ONCE in `beforeAll` rather
   * than per test. Issue #379 review finding #7: an earlier version of
   * this file called `authHelper.authenticateClient` (or POSTed
   * `/sign-in/email` directly) once per test — seven times across the
   * "DJ sign-in" / "Authenticated catalog access" / "Authenticated DJ bin
   * access" blocks alone — every one of which spends one request against
   * the shared, cross-file rate-limit budget documented near this file's
   * end. `client` gets `setAuthToken`'d here too, so every test below that
   * needs an authenticated backend request just uses `client` directly.
   */
  let credentialedSignIn: {
    payload: Record<string, unknown>;
    setAuthTokenHeader: string | null;
    sessionCookies: string[];
  } | null = null;

  /**
   * The shared anonymous sign-in, same reasoning as `credentialedSignIn`.
   * `POST /auth/sign-in/anonymous` needs no credentials, so it always runs,
   * and every request it costs is spent regardless of whether a DJ account
   * is configured — worth consolidating for exactly the same reason.
   */
  let anonymousSignIn: {
    sessionToken: string;
    userId: string | undefined;
  } | null = null;

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
    authHelper = createE2EAuthHelper();
    authClient = createE2EAuthClient();

    // Issue #379 review finding #10: fail loud, not silent-skip, when the
    // gate explicitly requires credentials. Without this, a repository
    // secret silently going missing (renamed, revoked, a typo'd env key in
    // bs-lml-gate.yml) makes every credentialed assertion below self-skip
    // via `hasCredentials` and the gate run stays green having tested
    // nothing. Deliberately scoped to email/password only — see
    // `hasUsernameCredentials`'s doc comment above for why the username
    // credential keeps its self-skip instead.
    if (config.requireCredentials && !hasCredentials) {
      throw new Error(
        'E2E_REQUIRE_CREDENTIALS=true but E2E_TEST_DJ_EMAIL / E2E_TEST_DJ_PASSWORD are not both set. ' +
          'Every credentialed assertion in e2e/auth.test.ts would otherwise silently self-skip. ' +
          'Check the E2E_TEST_DJ_EMAIL / E2E_TEST_DJ_PASSWORD secrets on the caller (see bs-lml-gate.yml).'
      );
    }

    if (hasCredentials) {
      const signInResp = await authClient.post<{ token?: string }>('/sign-in/email', {
        email: config.testDjEmail,
        password: config.testDjPassword,
      });
      if (signInResp.status === 200) {
        const setAuthTokenHeader = signInResp.headers.get('set-auth-token');
        const sessionToken = setAuthTokenHeader || signInResp.body?.token;
        const sessionCookies = extractSetCookieHeaders(signInResp.headers);
        if (sessionToken) {
          const jwtResp = await authClient.get<{ token?: string }>('/token', {
            headers: { Authorization: `Bearer ${sessionToken}` },
          });
          if (jwtResp.status === 200 && jwtResp.body?.token) {
            const jwt = jwtResp.body.token;
            client.setAuthToken(jwt);
            const payloadB64 = jwt.split('.')[1];
            const payload: Record<string, unknown> = payloadB64
              ? JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
              : {};
            credentialedSignIn = { payload, setAuthTokenHeader, sessionCookies };
          }
        }
      }
    }

    const anonResp = await authClient.post<{ token?: string; user?: { id?: string } }>(
      '/sign-in/anonymous',
      {}
    );
    if (anonResp.status === 200) {
      const headerToken = anonResp.headers.get('set-auth-token');
      const sessionToken = headerToken || anonResp.body?.token;
      if (sessionToken) {
        anonymousSignIn = { sessionToken, userId: anonResp.body?.user?.id };
      }
    }
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
  //
  // Every test below reads the shared `credentialedSignIn` fixture from
  // `beforeAll` rather than signing in itself — see that field's doc
  // comment. `client` is already carrying the resulting JWT.

  describe('DJ sign-in and JWT token flow', () => {
    it.skipIf(!hasCredentials)('should sign in and obtain a JWT with a valid WXYC role', () => {
      expect(credentialedSignIn, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
      const payload = credentialedSignIn!.payload;

      // The JWT must contain a role recognized by the backend
      expect(payload).toHaveProperty('role');
      expect(VALID_WXYC_ROLES).toContain(payload.role);

      // The JWT must contain a user ID
      const userId = payload.sub || payload.id;
      expect(userId).toBeTruthy();
    });

    it.skipIf(!hasCredentials)(
      'JWT role should NOT be a better-auth built-in that the backend does not recognize',
      () => {
        expect(credentialedSignIn, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
        const payload = credentialedSignIn!.payload;

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
    it.skipIf(!hasCredentials)('GET /library should return 200 with valid auth', async () => {
      const response = await client.get('/library?artist_name=test');

      // Should succeed (200) or return 404 (no results) — never 401/403
      expect(response.status === 200 || response.status === 404).toBe(true);
    });

    it.skipIf(!hasCredentials)('GET /library/formats should return 200 with valid auth', async () => {
      const response = await client.get('/library/formats');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it.skipIf(!hasCredentials)('GET /library/genres should return 200 with valid auth', async () => {
      const response = await client.get('/library/genres');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });

    it.skipIf(!hasCredentials)('GET /library/rotation should return 200 with valid auth', async () => {
      const response = await client.get('/library/rotation');

      expect(response.ok).toBe(true);
      expect(Array.isArray(response.body)).toBe(true);
    });
  });

  // ── DJ bin access ─────────────────────────────────────────────────────

  describe('Authenticated DJ bin access', () => {
    it.skipIf(!hasCredentials)('GET /djs/bin should return 200 with valid auth', async () => {
      expect(credentialedSignIn, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
      const payload = credentialedSignIn!.payload;
      const userId = payload.sub || payload.id;
      const response = await client.get(`/djs/bin?dj_id=${userId}`);

      // Should succeed or 404 (no bin entries) — never 401/403
      expect(response.status === 200 || response.status === 404).toBe(true);
    });
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
  // A). Each test hits `authClient` (bound to the auth origin — see
  // `createE2EAuthClient`'s doc comment in `./setup.ts`), and reuses the
  // shared `credentialedSignIn` / `anonymousSignIn` fixtures wherever the
  // assertion doesn't specifically need its own fresh sign-in.
  describe('better-auth core surface (issue #379)', () => {
    // ── set-auth-token header ─────────────────────────────────────────

    it.skipIf(!hasCredentials)('POST /auth/sign-in/email returns set-auth-token header', () => {
      expect(credentialedSignIn, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
      expect(credentialedSignIn!.setAuthTokenHeader).toBeTruthy();
    });

    // Provisioning-gated per E2EConfig.testDjUsername's doc comment — see
    // hasUsernameCredentials above. Self-skips, never fail-loud, until the
    // staging account + secret exist. Necessarily its own live call (there
    // is no shared username sign-in to reuse) — costed in the
    // budget-arithmetic comment near this file's end.
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

    it('POST /auth/sign-in/anonymous returns token + user.id, no credentials needed', () => {
      // The token arrives on the header (bearer plugin) or in the body,
      // depending on plugin config — see AuthTokenAndUserResult in
      // api.yaml. `anonymousSignIn` is only populated when one of the two
      // was found (see beforeAll), so a non-null value already proves that
      // half; only the user id needs its own assertion here.
      expect(anonymousSignIn, 'a session token must arrive on the header or the body').not.toBeNull();
      expect(anonymousSignIn!.userId, 'anonymous sign-in must return a user id').toBeTruthy();
    });

    // ── /auth/token mint shape, both session kinds ──────────────────────
    //
    // Neither of the two tests below spends a rate-limited request: GET
    // /auth/token is not one of apps/auth/app.ts's rateLimitedPaths.

    it('GET /auth/token mints a JWT for an anonymous session', async () => {
      expect(anonymousSignIn, 'expected the shared beforeAll anonymous sign-in to have succeeded').not.toBeNull();
      const response = await authClient.get<{ token?: string }>('/token', {
        headers: { Authorization: `Bearer ${anonymousSignIn!.sessionToken}` },
      });

      expect(response.status).toBe(200);
      expect(response.body?.token).toBeTruthy();
      // Basic JWT shape: three dot-separated segments.
      expect(response.body!.token!.split('.').length).toBe(3);
    });

    it.skipIf(!hasCredentials)('GET /auth/token mints a JWT for a credentialed DJ session', async () => {
      expect(credentialedSignIn, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
      // Exchange via cookie (the session cookies the shared sign-in
      // captured) rather than a bearer header, so this test is independent
      // of the set-auth-token assertion above — and reuses the shared
      // sign-in's cookies rather than signing in again.
      const cookieHeader = credentialedSignIn!.sessionCookies.map((c) => c.split(';')[0]).join('; ');
      expect(cookieHeader, 'expected the shared sign-in to have set at least one session cookie').toBeTruthy();

      const response = await authClient.get<{ token?: string }>('/token', {
        headers: { cookie: cookieHeader },
      });

      expect(response.status).toBe(200);
      expect(response.body?.token).toBeTruthy();
    });

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
    //
    // Gated on canResolveUsernameToEmail, NOT hasUsernameCredentials (issue
    // #379 review finding #12) — this assertion needs the username to look
    // up and the email to assert equality against, never a password.

    it.skipIf(!canResolveUsernameToEmail)(
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
    // description now carries explicitly (issue #379 review finding #11):
    // nobody reads the mailed code in this harness.
    it('POST /auth/email-otp/send-verification-otp returns { success: true } for any address', async () => {
      const response = await authClient.post<{ success?: boolean }>('/email-otp/send-verification-otp', {
        email: `e2e-otp-probe-${Date.now()}@wxyc.org`,
        type: 'sign-in',
      });

      expect(response.status).toBe(200);
      expect(response.body?.success).toBe(true);
    });

    // ── sign-out invalidation ────────────────────────────────────────────
    //
    // Deliberately signs in AGAIN here rather than reusing the shared
    // `credentialedSignIn` fixture: this test invalidates the session it
    // signs in with, and every other test in this file that needs an
    // authenticated `client` depends on the shared session staying alive
    // for the file's whole run. This is the one place in the file where a
    // second live /sign-in/email call is necessary, not an oversight — see
    // the budget-arithmetic comment below, which counts it.

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

    // ── rate-limit 429 shape -- MODELED FROM SOURCE, NOT EXERCISED LIVE ──
    //
    // Issue #379 review finding #7. This file used to end here with a
    // 15-request burst against POST /auth/email-otp/send-verification-otp,
    // deliberately exhausting the shared Express `authMutationRateLimit`
    // bucket (10 requests / 15 min per X-Real-IP -- apps/auth/app.ts
    // mounts ONE reused rate-limit middleware instance across NINE path
    // prefixes: every /auth/sign-in/* route, /auth/sign-up,
    // /auth/email-otp/send-verification-otp, /auth/forget-password,
    // /auth/wxyc/lookup-email, /auth/wxyc/complete-onboarding, and the
    // three /auth/device/{code,approve,deny} paths). That loop is gone,
    // and no replacement live 429 assertion exists anywhere in this repo's
    // e2e suite. The budget arithmetic, worked through in full so a future
    // editor doesn't re-add a live 429 test without re-doing this math:
    //
    //   - This file's OWN other assertions, after the consolidation above
    //     (one shared credentialed sign-in and one shared anonymous
    //     sign-in in beforeAll instead of one call per test), still spend
    //     5 requests against the shared bucket today (hasUsernameCredentials
    //     false, canResolveUsernameToEmail false -- the common case until
    //     that credential is provisioned): 1x /sign-in/email (the shared
    //     beforeAll sign-in), 1x /sign-in/email again (POST /auth/sign-out's
    //     own -- necessarily separate, see that test's comment), 1x
    //     /sign-in/anonymous (the shared beforeAll sign-in), 1x
    //     /wxyc/lookup-email (the unconditional no-match case), and 1x
    //     /email-otp/send-verification-otp (the unconditional
    //     success-shape case). POST /auth/sign-in/username and the
    //     lookup-email resolution case each add one more once their
    //     credential is provisioned.
    //   - This is ONE of several files sharing the SAME bucket in the SAME
    //     `npm run test:e2e` invocation: vitest.e2e.config.ts runs every
    //     e2e/**/*.test.ts file plus tests/e2e-contracts.test.ts
    //     sequentially (pool: 'forks', singleFork: true) against one
    //     egress IP. Every sibling file below was independently
    //     consolidated onto shared beforeAll sign-ins for the same reason
    //     as this file, and still isn't free: e2e/contract/openapi-
    //     compliance.test.ts spends 2 (one shared /sign-in/anonymous, one
    //     /wxyc/lookup-email, in its "Auth Endpoints (#379)" describe
    //     block), e2e/catalog.test.ts and e2e/recent-entries.test.ts spend
    //     1 each (their own single beforeAll sign-in), and
    //     tests/e2e-contracts.test.ts spends 3 (one shared credentialed
    //     sign-in reused by every credentialed contract test in that file,
    //     the BEARER_IS_JWT_NOT_SESSION test's own necessarily-separate
    //     sign-in, and one shared /sign-in/anonymous reused by
    //     ANONYMOUS_SIGN_IN_SHAPE and both SET_AUTH_TOKEN_NEVER_ROTATES
    //     assertions).
    //   - Summed: 5 (this file) + 2 + 1 + 1 + 3 = 12, already past the
    //     10-request ceiling BEFORE bs-lml-gate.yml's subsequent
    //     wxyc-canary smoke step, which signs in against the SAME staging
    //     host from the SAME runner inside the SAME 15-minute window.
    //
    //   The arithmetic does not close, so per the review's own
    //   instruction: don't exercise 429 live at all here. The two shapes
    //   an operation in this section can actually return are documented
    //   directly on each 429 response in api.yaml and verified against
    //   source rather than a live probe:
    //     - AuthRateLimitedResponse (`{message: string}`, an
    //       `X-Retry-After` header, no guaranteed JSON Content-Type) --
    //       better-auth's OWN internal per-path limiter
    //       (apps/auth/node_modules/better-auth/dist/api/rate-limiter/index.mjs
    //       rateLimitResponse), 3 requests/10s on any /sign-in* path, 3/60s
    //       on /email-otp/send-verification-otp -- what a client meets
    //       FIRST in practice, since its window is far tighter than the
    //       express layer's.
    //     - AuthPlainErrorResponse (`{error: string}`) -- the express-layer
    //       fallback (apps/auth/app.ts authMutationRateLimit), reachable
    //       only once the internal limiter above is cleared.
    //   If a live 429 assertion is ever wanted again, it needs its own
    //   budget -- e.g. a dedicated, rarely-run suite against a throwaway
    //   IP/host -- not a line item in a file a shared-IP prod-promotion
    //   gate runs on every merge.
  });
});
