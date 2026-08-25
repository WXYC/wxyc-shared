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
  exchangeSessionForJwt,
  getSharedAnonymousSession,
  getSharedDjSession,
  getSharedLookupEmailNullProbe,
  type E2EClient,
  waitForService,
  getE2EConfig,
} from './setup.js';

/** The WXYC roles recognized by the backend's requirePermissions middleware. */
const VALID_WXYC_ROLES = ['member', 'dj', 'musicDirector', 'stationManager', 'admin'] as const;

describe('Auth E2E', () => {
  let client: E2EClient;
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
   * The credentialed session's decoded JWT payload and the JWT string
   * itself, derived ONCE in `beforeAll` from `e2e/global-setup.ts`'s shared
   * DJ session (issue #379 review fix-pass #2, finding #2) via the free,
   * non-rate-limited `GET /auth/token` exchange. `credentialedJwt` also
   * backs the auth-token-leak fix below (fix-pass #2, finding #1): both
   * "Authenticated catalog access" and "Authenticated DJ bin access" apply
   * it again in their OWN `beforeAll`, since the two describes above them
   * (`Unauthenticated requests...`, `Public endpoints...`) clear `client`'s
   * token in every one of their tests and nothing previously restored it.
   */
  let credentialedJwt: string | null = null;
  let credentialedPayload: Record<string, unknown> | null = null;

  beforeAll(async () => {
    await waitForService(`${config.baseUrl}/healthcheck`);
    client = createE2EClient();
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

    // Authenticate using the DJ session e2e/global-setup.ts already minted
    // for this run, rather than signing in again — issue #379 review
    // fix-pass #2, finding #2. See this file's budget-arithmetic comment
    // near its end for the full per-file accounting.
    if (hasCredentials) {
      const shared = getSharedDjSession();
      if (shared) {
        const exchanged = await exchangeSessionForJwt(shared.sessionToken, config.authUrl);
        if (exchanged) {
          credentialedJwt = exchanged.token;
          credentialedPayload = exchanged.payload;
          client.setAuthToken(credentialedJwt);
        }
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
  // Every test below reads the shared `credentialedPayload` fixture from
  // the outer `beforeAll` rather than signing in itself. Neither test here
  // makes a network call at all, so the auth-token-leak fix two describes
  // down (see its own comment) doesn't apply to this one.

  describe('DJ sign-in and JWT token flow', () => {
    it.skipIf(!hasCredentials)('should sign in and obtain a JWT with a valid WXYC role', () => {
      expect(credentialedPayload, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
      const payload = credentialedPayload!;

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
        expect(credentialedPayload, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
        const payload = credentialedPayload!;

        // These built-in better-auth roles are NOT in WXYCRoles on
        // Backend-Service main (until the admin-role branch merges).
        // If they appear in the JWT, authenticated requests will 403.
        const unrecognizedRoles = ['owner'];
        expect(unrecognizedRoles).not.toContain(payload.role);
      }
    );
  });

  // ── Authorized catalog access ─────────────────────────────────────────
  //
  // AUTH-TOKEN-LEAK FIX (issue #379 review fix-pass #2, finding #1): the
  // two describes above (`Unauthenticated requests...`, `Public
  // endpoints...`) call `client.clearAuthToken()` ten times combined and
  // nothing restores it afterward. Without this describe's OWN `beforeAll`
  // re-applying the shared JWT, every request below would silently 401
  // instead of the intended 200/404 -- and each test's own assertion
  // (`status === 200 || status === 404`) is the pin that catches a
  // regression here: a 401 satisfies neither branch and fails loudly. Do
  // NOT remove this `beforeAll` on the assumption that the outer one
  // already set the token; it did, but two earlier describes have since
  // cleared it.

  describe('Authenticated catalog access', () => {
    beforeAll(() => {
      if (credentialedJwt) client.setAuthToken(credentialedJwt);
    });

    it.skipIf(!hasCredentials)('GET /library should return 200 with valid auth', async () => {
      const response = await client.get('/library?artist_name=test');

      // Should succeed (200) or return 404 (no results) — never 401/403.
      // This is the pin: a leaked/cleared token 401s here instead.
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
  //
  // Same auth-token-leak fix as "Authenticated catalog access" above --
  // see that describe's comment.

  describe('Authenticated DJ bin access', () => {
    beforeAll(() => {
      if (credentialedJwt) client.setAuthToken(credentialedJwt);
    });

    it.skipIf(!hasCredentials)('GET /djs/bin should return 200 with valid auth', async () => {
      expect(credentialedPayload, 'expected the shared beforeAll sign-in to have succeeded').not.toBeNull();
      const userId = credentialedPayload!.sub || credentialedPayload!.id;
      const response = await client.get(`/djs/bin?dj_id=${userId}`);

      // Should succeed or 404 (no bin entries) — never 401/403. This is
      // the pin: a leaked/cleared token 401s here instead.
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
  // `createE2EAuthClient`'s doc comment in `./setup.ts`), and reads
  // `e2e/global-setup.ts`'s shared fixtures wherever the assertion doesn't
  // specifically need its own fresh, dedicated sign-in.
  describe('better-auth core surface (issue #379)', () => {
    // ── set-auth-token header ─────────────────────────────────────────

    // e2e/global-setup.ts mints the shared DJ session via /sign-in/email
    // UNLESS E2E_TEST_DJ_USERNAME is also configured, in which case it
    // mints via /sign-in/username instead (see that file's comment on its
    // credentialed-mint section). So this assertion only reads the shared
    // fixture when the mint actually went through the email route --
    // otherwise the shared fixture reflects the USERNAME route's response,
    // and asserting on it here would silently validate the wrong
    // operation. In that case, POST /auth/sign-out below carries this
    // assertion instead, off its own dedicated /sign-in/email call --
    // see this file's budget-arithmetic comment for the full accounting.
    it.skipIf(!hasCredentials || hasUsernameCredentials)(
      'POST /auth/sign-in/email returns set-auth-token header',
      () => {
        const shared = getSharedDjSession();
        expect(shared, 'expected e2e/global-setup.ts to have minted a shared DJ session via /sign-in/email').not.toBeNull();
        expect(shared!.setAuthTokenHeader).toBeTruthy();
      }
    );

    // Provisioning-gated per E2EConfig.testDjUsername's doc comment — see
    // hasUsernameCredentials above. Self-skips, never fail-loud, until the
    // staging account + secret exist. Reads e2e/global-setup.ts's shared DJ
    // session rather than signing in itself: once E2E_TEST_DJ_USERNAME
    // exists, global-setup mints that shared session via THIS exact route
    // specifically so this assertion is free — see this file's
    // budget-arithmetic comment for the trade that makes (the email
    // route's equivalent assertion above moves to POST /auth/sign-out
    // instead of running here a second time).
    it.skipIf(!hasUsernameCredentials)(
      'POST /auth/sign-in/username returns set-auth-token header',
      () => {
        const shared = getSharedDjSession();
        expect(shared, 'expected e2e/global-setup.ts to have minted a shared DJ session via /sign-in/username').not.toBeNull();
        expect(shared!.setAuthTokenHeader).toBeTruthy();
      }
    );

    // ── anonymous sign-in shape ────────────────────────────────────────

    it('POST /auth/sign-in/anonymous returns token + user.id, no credentials needed', () => {
      // The token arrives on the header (bearer plugin) or in the body,
      // depending on plugin config — see AuthTokenAndUserResult in
      // api.yaml.
      const shared = getSharedAnonymousSession();
      expect(shared, 'a session token must arrive on the header or the body').not.toBeNull();
      expect(shared!.setAuthTokenHeader || shared!.bodyToken).toBeTruthy();
      expect(shared!.userId, 'anonymous sign-in must return a user id').toBeTruthy();
    });

    // ── /auth/token mint shape, both session kinds ──────────────────────
    //
    // Neither of the two tests below spends a rate-limited request: GET
    // /auth/token is not one of apps/auth/app.ts's rateLimitedPaths.

    it('GET /auth/token mints a JWT for an anonymous session', async () => {
      const shared = getSharedAnonymousSession();
      expect(shared, 'expected e2e/global-setup.ts to have minted a shared anonymous session').not.toBeNull();
      const response = await authClient.get<{ token?: string }>('/token', {
        headers: { Authorization: `Bearer ${shared!.sessionToken}` },
      });

      expect(response.status).toBe(200);
      expect(response.body?.token).toBeTruthy();
      // Basic JWT shape: three dot-separated segments.
      expect(response.body!.token!.split('.').length).toBe(3);
    });

    it.skipIf(!hasCredentials)('GET /auth/token mints a JWT for a credentialed DJ session', async () => {
      const shared = getSharedDjSession();
      expect(shared, 'expected e2e/global-setup.ts to have minted a shared DJ session').not.toBeNull();
      // Exchange via cookie (the session cookies the shared sign-in
      // captured) rather than a bearer header, so this test is independent
      // of the set-auth-token assertion above.
      expect(shared!.cookieHeader, 'expected the shared DJ session to have set at least one session cookie').toBeTruthy();

      const response = await authClient.get<{ token?: string }>('/token', {
        headers: { cookie: shared!.cookieHeader! },
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

    it('POST /auth/wxyc/lookup-email returns { email: null } for an unknown username', () => {
      // Reads e2e/global-setup.ts's shared no-match probe rather than
      // issuing its own /wxyc/lookup-email call (issue #379 review
      // fix-pass #2, finding #2) -- the same underlying response also
      // backs openapi-compliance.test.ts's schema-compliance assertion for
      // this endpoint.
      const probe = getSharedLookupEmailNullProbe();
      expect(probe, 'expected e2e/global-setup.ts to have run the shared lookup-email probe').not.toBeNull();
      expect(probe!.status).toBe(200);
      expect(probe!.body?.email).toBeNull();
    });

    // ── send-verification-otp success shape ─────────────────────────────
    //
    // Not exercised against a real account: disableSignUp: true makes the
    // route answer {success: true} identically whether or not the address
    // exists, and a synthetic address never triggers a real send (see
    // apps/auth's sendVerificationOTP -- an unknown email is a silent
    // discard, not an error). This is a deliberately dedicated live call
    // (not shareable -- every consumer needs a fresh, unique synthetic
    // address to avoid the internal per-path limiter, so there's nothing
    // to memoize) — costed in the budget-arithmetic comment below. The
    // verify leg (POST /auth/sign-in/email-otp) has NO live coverage at
    // all in this suite today — see that operation's api.yaml description
    // for why, and for what re-enabling it would cost.
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
    // Deliberately signs in AGAIN here rather than reusing the shared DJ
    // session: this test invalidates the session it signs in with, and
    // every other test in this file (and in catalog.test.ts,
    // recent-entries.test.ts, tests/e2e-contracts.test.ts) that needs an
    // authenticated `client` depends on the shared session staying alive
    // for the whole run. This is the one place in the file where a second
    // live /sign-in/email call is necessary, not an oversight — see the
    // budget-arithmetic comment below, which counts it.
    //
    // This call's own set-auth-token header is also asserted below, not
    // just used to derive a session token. When E2E_TEST_DJ_USERNAME is
    // configured, e2e/global-setup.ts's shared DJ session mint moves to
    // /sign-in/username (see that file's comment), so the dedicated
    // "POST /auth/sign-in/email returns set-auth-token header" test above
    // self-skips in that case — THIS is the only remaining live call that
    // proves the email route sets the header then. When username creds
    // aren't configured, this is simply a harmless, redundant
    // re-confirmation of what the dedicated test above already checked
    // off the shared fixture — no extra network cost either way.

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
        expect(
          signInResponse.headers.get('set-auth-token'),
          'POST /auth/sign-in/email must set set-auth-token'
        ).toBeTruthy();

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
    // Issue #379 review finding #7 (fix-pass #1), re-audited and tightened
    // in fix-pass #2 finding #2 and fix-pass #3 finding #2. This file used
    // to end here with a 15-request burst against POST /auth/email-otp/
    // send-verification-otp, deliberately exhausting the shared Express
    // `authMutationRateLimit` bucket (10 requests / 15 min per X-Real-IP --
    // apps/auth/app.ts mounts ONE reused rate-limit middleware instance
    // across NINE path prefixes: every /auth/sign-in/* route, /auth/sign-up,
    // /auth/email-otp/send-verification-otp, /auth/forget-password,
    // /auth/wxyc/lookup-email, /auth/wxyc/complete-onboarding, and the
    // three /auth/device/{code,approve,deny} paths). That loop is gone,
    // and no replacement live 429 assertion exists anywhere in this repo's
    // e2e suite. bs-lml-gate.yml has never actually run (zero workflow
    // runs as of this writing), so there is no "it's been green" evidence
    // to lean on -- the budget arithmetic below is the only thing standing
    // between this suite and a self-inflicted 429 storm on its first real
    // run, and it has to close on its own.
    //
    // `e2e/global-setup.ts` mints the shared anonymous/credentialed
    // sessions and the shared lookup-email probe ONCE, in the main
    // process, before any test file is forked -- see that file's own doc
    // comment. Every consumer below reads those fixtures (or exchanges a
    // shared SESSION token for its own JWT via the free, non-rate-limited
    // GET /auth/token) instead of minting its own.
    //
    // Full per-file accounting, PARAMETERIZED on which credentials are
    // configured -- the two username-gated assertions above
    // (POST /auth/sign-in/username's set-auth-token check, and
    // POST /auth/wxyc/lookup-email's resolution check) are gated ONLY on
    // E2E_TEST_DJ_USERNAME, which bs-lml-gate.yml already wires through
    // (see that workflow's env block) -- so they activate the MOMENT that
    // one secret is provisioned, with no code change required. Do not
    // read the "email creds" column below as the permanent steady state:
    //
    //   | Source                                     | No creds | Email creds (today) | + username creds |
    //   |----------------------------------------------|:--------:|:--------------------:|:-----------------:|
    //   | e2e/global-setup.ts                           |    2     |          3            |         3          |
    //   | e2e/auth.test.ts (this file)                  |    1     |          2            |         3          |
    //   | e2e/contract/openapi-compliance.test.ts       |    1     |          1            |         1          |
    //   | e2e/catalog.test.ts                           |    0     |          0            |         0          |
    //   | e2e/recent-entries.test.ts                    |    0     |          0            |         0          |
    //   | e2e/concerts.test.ts                          |    0     |          0            |         0          |
    //   | e2e/proxy.test.ts                             |    0     |          0            |         0          |
    //   | tests/e2e-contracts.test.ts                   |    0     |          0            |         0          |
    //   | **Total (this run)**                          |  **4**   |        **6**          |       **7**        |
    //   | wxyc-canary smoke step (bs-lml-gate.yml only)  |   n/a    |         +1             |        +1          |
    //   | **Grand total**                                |  **4**   |        **7**          |       **8**        |
    //   | Headroom under the 10-request/15-min ceiling   |    6     |          3            |         2          |
    //
    //   Per-source detail:
    //     - e2e/global-setup.ts: 1x /sign-in/anonymous (unconditional) +
    //       1x /wxyc/lookup-email (the shared no-match probe,
    //       unconditional) + 1x credentialed sign-in, ONLY when a DJ
    //       account is configured -- via /sign-in/email normally, or via
    //       /sign-in/username instead once E2E_TEST_DJ_USERNAME exists
    //       (see that file's own comment for why the route switches).
    //     - e2e/auth.test.ts: 1x /email-otp/send-verification-otp
    //       (unconditional -- needs a fresh synthetic address every time,
    //       so nothing to share) + POST /auth/sign-out's own dedicated
    //       /sign-in/email (only when credentialed -- invalidates the
    //       shared session, so it can't reuse it; this call ALSO now
    //       carries the email route's set-auth-token assertion once
    //       username creds exist and the shared mint has moved off email)
    //       + POST /auth/wxyc/lookup-email's resolution check (only once
    //       username creds exist -- needs the REAL username, can't share
    //       with the null-probe). The two set-auth-token header tests for
    //       email and username never both cost a live request in the same
    //       run: exactly one of them reads the shared fixture for free,
    //       and the other is covered by a call that already exists for a
    //       different reason (sign-out's sign-in, or the shared mint
    //       itself).
    //     - e2e/contract/openapi-compliance.test.ts: the "matches
    //       AuthTokenAndUserResult schema" test's own dedicated
    //       /sign-in/anonymous (unconditional) -- it needs the FULL raw
    //       response to validate against the schema, which the shared
    //       fixture (token + user id only) doesn't carry.
    //     - catalog / recent-entries / concerts / proxy / e2e-contracts:
    //       all read a shared fixture (or exchange it for a JWT via the
    //       free GET /auth/token) and cost nothing themselves.
    //
    //   The math has to hold with ZERO slack spent on a deliberate 429
    //   probe, so per the review's own instruction: don't exercise 429
    //   live at all. The two shapes an operation in this section can
    //   actually return are documented directly on each 429 response in
    //   api.yaml and verified against source rather than a live probe:
    //     - AuthRateLimitedResponse (`{message: string}`, an
    //       `X-Retry-After` header, no guaranteed JSON Content-Type) --
    //       better-auth's OWN internal per-path limiter
    //       (apps/auth/node_modules/better-auth/dist/api/rate-limiter/index.mjs
    //       rateLimitResponse). The window is NOT uniform: 3 requests/10s
    //       on /sign-in/email, /sign-in/username, and /sign-in/anonymous,
    //       but 3 requests/60s on /sign-in/email-otp AND
    //       /email-otp/send-verification-otp specifically -- the emailOTP
    //       plugin's own `rateLimit` array overrides the generic
    //       `/sign-in*` rule for that one path (see api.yaml's
    //       AuthRateLimitedResponse description for the full mechanism).
    //       Either way, this is what a client meets FIRST in practice,
    //       since both windows are far tighter than the express layer's.
    //     - AuthPlainErrorResponse (`{error: string}`) -- the express-layer
    //       fallback (apps/auth/app.ts authMutationRateLimit), reachable
    //       only once the internal limiter above is cleared. Also carries
    //       a standard `Retry-After` header (plus `RateLimit` /
    //       `RateLimit-Policy`) via express-rate-limit@8.6.2's
    //       `standardHeaders: 'draft-7'` config -- see AuthPlainErrorResponse's
    //       own api.yaml description.
    //   If a live 429 assertion is ever wanted again, it needs its own
    //   budget -- e.g. a dedicated, rarely-run suite against a throwaway
    //   IP/host -- not a line item in a file a shared-IP prod-promotion
    //   gate runs on every merge. Before adding ANY new live request
    //   anywhere in this table's files, re-verify the grand total against
    //   the 10-request ceiling first -- including the "+ username creds"
    //   column, which is only 2 requests of headroom, not the more
    //   comfortable 3 the email-only column has today.
  });
});
