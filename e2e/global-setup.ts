/**
 * Vitest globalSetup for the e2e suite (issue #379 review fix-pass #2,
 * finding #2 -- see vitest.e2e.config.ts's `globalSetup` option).
 *
 * Runs ONCE, in the main process, before any e2e test file is forked. It
 * mints the handful of live sessions/probes that would otherwise be
 * re-minted once per file against the SAME shared, cross-service
 * rate-limit budget: apps/auth/app.ts's authMutationRateLimit is ONE
 * reused Express middleware instance mounted across nine path prefixes
 * (every /auth/sign-in/* route, /auth/sign-up,
 * /auth/email-otp/send-verification-otp, /auth/forget-password,
 * /auth/wxyc/lookup-email, /auth/wxyc/complete-onboarding, and the three
 * /auth/device/{code,approve,deny} paths), keyed on X-Real-IP -- 10
 * requests / 15 min, shared by every file in one `npm run test:e2e`
 * invocation (vitest.e2e.config.ts runs every e2e/**\/*.test.ts file plus
 * tests/e2e-contracts.test.ts sequentially against one egress IP).
 *
 * Before this file existed, seven files independently signed in a combined
 * 15 times against that one 10-request bucket in a single run -- see
 * `e2e/auth.test.ts`'s budget-arithmetic comment for the full recount and
 * the resulting per-file totals now that every anonymous/credentialed
 * consumer reads the fixtures here instead.
 *
 * Data crosses from this file into every test file via `process.env`,
 * which Node's `child_process.fork` inherits at fork time -- vitest awaits
 * this function to completion, including every mutation below, before
 * spawning any worker process, so the values are guaranteed present (or
 * absent, on failure -- see each getter's own doc comment in `./setup.ts`)
 * by the time a test file's own `beforeAll` runs.
 *
 * Issue #379 review fix-pass #3 additions:
 *   - finding #2: once `E2E_TEST_DJ_USERNAME` is provisioned, the
 *     credentialed mint below switches from `/sign-in/email` to
 *     `/sign-in/username` -- see that section's own comment for why.
 *   - finding #7a: every live fetch below carries an explicit
 *     `AbortSignal.timeout`, and this file now also polls the AUTH
 *     origin's own readiness (better-auth's built-in `GET /ok`) before
 *     minting anything -- the pre-existing backend `/healthcheck` poll
 *     only ever covered the BACKEND origin, and no bs-lml-gate.yml step
 *     polls `BS_STAGING_AUTH_URL` before the E2E step runs.
 *   - finding #7b: `E2E_SKIP_SHARED_AUTH_MINTS=true` skips every mint
 *     below entirely -- set it for a targeted single-file run of a file
 *     that needs no auth at all (e.g. `flowsheet.test.ts`), so that run
 *     doesn't spend covered requests against the shared budget for
 *     fixtures nothing in it will read. Vitest's `globalSetup` API gives
 *     this module no reliable, stable way to introspect which test files
 *     were actually selected for the run, so an explicit opt-out is the
 *     documented mechanism rather than fragile file-list heuristics.
 */
import { createE2EAuthClient, extractSetCookieHeaders, getE2EConfig, waitForService } from './setup.js';

/** Default timeout for each individual live request this file makes. */
const FETCH_TIMEOUT_MS = 10_000;

/**
 * Poll better-auth's own built-in `GET /ok` liveness route (verified in
 * `e2e/contract/openapi-compliance.test.ts`'s origin-verification test --
 * `dist/api/routes/ok.mjs`, always registered, no auth) until it answers
 * `{ok: true}`. `waitForService` (this module's sibling helper) can't be
 * reused here: it probes with `HEAD`, and better-auth only registers `GET`
 * for this path -- a wrong-method request 404s (the same 401-vs-404 split
 * `GET /auth/token`'s api.yaml description documents), which would read as
 * permanently unhealthy even once the service is actually up.
 */
async function waitForAuthService(authUrl: string, timeoutMs = 15000, intervalMs = 1000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(`${authUrl}/ok`, {
        method: 'GET',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (response.ok) {
        const body = (await response.json().catch(() => ({}))) as { ok?: boolean };
        if (body.ok) return;
      }
    } catch {
      // Not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Auth service at ${authUrl}/ok did not become ready within ${timeoutMs}ms`);
}

export default async function setup(): Promise<void> {
  if (process.env.E2E_SKIP_SHARED_AUTH_MINTS === 'true') {
    console.log('[global-setup] E2E_SKIP_SHARED_AUTH_MINTS=true -- skipping every shared mint.');
    return;
  }

  const config = getE2EConfig();

  // Best-effort: if a service isn't up yet (a fresh local stack; staging is
  // already health-polled by earlier bs-lml-gate.yml steps before this ever
  // runs), don't hang the whole run waiting on it here -- each consumer's
  // own `getShared*` getters return `null` on a missing fixture, and every
  // consumer already has its own `hasCredentials`-style self-skip or
  // explicit non-null assertion for that case.
  try {
    await waitForService(`${config.baseUrl}/healthcheck`, 15000, 1000);
  } catch (error) {
    console.error('[global-setup] backend healthcheck did not become ready in time:', error);
  }
  try {
    await waitForAuthService(config.authUrl, 15000, 1000);
  } catch (error) {
    console.error('[global-setup] auth service (GET /ok) did not become ready in time:', error);
  }

  const authClient = createE2EAuthClient();

  // -- Shared anonymous session --------------------------------------------
  // Needs no credentials, so this always attempts. Every anonymous
  // consumer (proxy, concerts, openapi-compliance's beforeAll,
  // e2e-contracts, auth.test.ts) reads this instead of minting its own.
  try {
    const anonResp = await authClient.post<{ token?: string; user?: { id?: string } }>(
      '/sign-in/anonymous',
      {},
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (anonResp.status === 200) {
      const headerToken = anonResp.headers.get('set-auth-token');
      const bodyToken = anonResp.body?.token;
      const token = headerToken || bodyToken;
      if (token) {
        process.env.E2E_GLOBAL_ANON_SESSION_TOKEN = token;
        // Kept distinct from the collapsed token above -- consumers
        // validating the header-vs-body shape itself (ANONYMOUS_SIGN_IN_SHAPE)
        // or the deterministic-prefix property (SET_AUTH_TOKEN_NEVER_ROTATES)
        // need to see which channel carried which value, not just "a token
        // arrived somewhere" -- see getSharedAnonymousSession's doc comment.
        if (headerToken) process.env.E2E_GLOBAL_ANON_SET_AUTH_TOKEN_HEADER = headerToken;
        if (bodyToken) process.env.E2E_GLOBAL_ANON_BODY_TOKEN = bodyToken;
        if (anonResp.body?.user?.id) {
          process.env.E2E_GLOBAL_ANON_USER_ID = anonResp.body.user.id;
        }
      } else {
        console.error('[global-setup] anonymous sign-in returned 200 but no session token');
      }
    } else {
      console.error(`[global-setup] anonymous sign-in failed with status ${anonResp.status}`);
    }
  } catch (error) {
    // Non-fatal: consumers self-skip or assert non-null on a missing
    // fixture, attributing the failure to themselves rather than dying
    // here and taking down every OTHER file (most of which don't need
    // auth at all) with an unhandled globalSetup rejection.
    console.error('[global-setup] anonymous sign-in threw:', error);
  }

  // -- Shared credentialed (DJ) session -------------------------------------
  // Skipped entirely when no DJ account is configured -- every consumer
  // already self-skips its own credentialed assertions via hasCredentials
  // in that case, so there is nothing to share.
  //
  // Issue #379 review fix-pass #3, finding #2: once E2E_TEST_DJ_USERNAME is
  // provisioned (bs-lml-gate.yml already wires the secret through), mint
  // via /sign-in/username INSTEAD of /sign-in/email. This is what lets
  // e2e/auth.test.ts's "POST /auth/sign-in/username returns set-auth-token
  // header" assertion become free (reading this shared fixture) rather
  // than a second live sign-in -- the email route's equivalent assertion
  // moves to piggyback on that file's POST /auth/sign-out test, which
  // already makes its own dedicated /sign-in/email call to get a session
  // to invalidate. See e2e/auth.test.ts's budget-arithmetic comment for
  // the full trade this makes; a session token authenticates identically
  // as a bearer regardless of which route minted it, so every OTHER
  // consumer of this fixture (catalog, recent-entries, e2e-contracts) is
  // unaffected by which route was used.
  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);
  const hasUsernameCredentials = Boolean(config.testDjUsername && config.testDjPassword);
  if (hasCredentials) {
    try {
      let mintRoute: 'email' | 'username' = 'email';
      let signInResp = hasUsernameCredentials
        ? await authClient.post<{ token?: string }>(
            '/sign-in/username',
            { username: config.testDjUsername, password: config.testDjPassword },
            { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
          )
        : await authClient.post<{ token?: string }>(
            '/sign-in/email',
            { email: config.testDjEmail, password: config.testDjPassword },
            { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
          );
      if (hasUsernameCredentials) mintRoute = 'username';

      // Issue #379 review fix-pass #4, finding #4: once E2E_TEST_DJ_USERNAME
      // exists, /sign-in/username is the SOLE source of the shared DJ
      // session -- a bad or mismatched username secret would otherwise
      // leave this fixture unset and 401 every credentialed assertion
      // across four files (this one, catalog, recent-entries,
      // e2e-contracts), not just the username-specific test that's
      // actually broken. Retry once via /sign-in/email so the fixture
      // still materializes; this costs an extra covered request, but only
      // in the failure case -- see this file's and e2e/auth.test.ts's
      // budget-arithmetic comments for the worst-case accounting.
      if (hasUsernameCredentials && signInResp.status !== 200) {
        console.error(
          `[global-setup] /sign-in/username failed with status ${signInResp.status} -- retrying the shared DJ session mint via /sign-in/email so the fixture doesn't go unset. This usually means E2E_TEST_DJ_USERNAME (or its paired password) is misconfigured; the username-specific set-auth-token assertion in e2e/auth.test.ts will report that explicitly via mintRoute.`
        );
        signInResp = await authClient.post<{ token?: string }>(
          '/sign-in/email',
          { email: config.testDjEmail, password: config.testDjPassword },
          { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
        );
        mintRoute = 'email';
      }

      if (signInResp.status === 200) {
        const setAuthTokenHeader = signInResp.headers.get('set-auth-token');
        const sessionToken = setAuthTokenHeader || signInResp.body?.token;
        const cookies = extractSetCookieHeaders(signInResp.headers);
        if (sessionToken) {
          process.env.E2E_GLOBAL_DJ_SESSION_TOKEN = sessionToken;
          process.env.E2E_GLOBAL_DJ_SESSION_ROUTE = mintRoute;
          console.log(`[global-setup] shared DJ session minted via /sign-in/${mintRoute}`);
        } else {
          console.error('[global-setup] credentialed sign-in returned 200 but no session token');
        }
        if (setAuthTokenHeader) {
          process.env.E2E_GLOBAL_DJ_SET_AUTH_TOKEN_HEADER = setAuthTokenHeader;
        }
        if (cookies.length > 0) {
          process.env.E2E_GLOBAL_DJ_COOKIE_HEADER = cookies.map((c) => c.split(';')[0]).join('; ');
        }
      } else {
        console.error(
          `[global-setup] credentialed sign-in failed with status ${signInResp.status} (route: ${mintRoute}) -- shared DJ session fixture will be unset; every credentialed consumer self-skips or asserts non-null on that.`
        );
      }
    } catch (error) {
      console.error('[global-setup] credentialed sign-in threw:', error);
    }
  }

  // -- Shared lookup-email "no match" probe --------------------------------
  // Unconditional -- needs no credentials, just a synthetic identifier
  // guaranteed not to resolve. Serves both e2e/auth.test.ts's behavioral
  // no-match assertion and openapi-compliance.test.ts's schema-compliance
  // assertion for the same response.
  try {
    const lookupResp = await authClient.post<{ email?: string | null }>(
      '/wxyc/lookup-email',
      { identifier: `e2e-global-nonexistent-${Date.now()}` },
      { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }
    );
    if (lookupResp.status === 200) {
      process.env.E2E_GLOBAL_LOOKUP_EMAIL_NULL_STATUS = String(lookupResp.status);
      process.env.E2E_GLOBAL_LOOKUP_EMAIL_NULL_BODY = JSON.stringify(lookupResp.body ?? {});
    } else {
      console.error(`[global-setup] lookup-email probe failed with status ${lookupResp.status}`);
    }
  } catch (error) {
    console.error('[global-setup] lookup-email probe threw:', error);
  }
}
