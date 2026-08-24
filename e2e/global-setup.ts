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
 */
import { createE2EAuthClient, extractSetCookieHeaders, getE2EConfig, waitForService } from './setup.js';

export default async function setup(): Promise<void> {
  const config = getE2EConfig();

  // Best-effort: if the auth service isn't up yet (a fresh local stack;
  // staging is already health-polled by earlier bs-lml-gate.yml steps
  // before this ever runs), don't hang the whole run waiting on it here --
  // each consumer's own `getShared*` getters return `null` on a missing
  // fixture, and every consumer already has its own `hasCredentials`-style
  // self-skip or explicit non-null assertion for that case.
  try {
    await waitForService(`${config.baseUrl}/healthcheck`, 15000, 1000);
  } catch (error) {
    console.error('[global-setup] backend healthcheck did not become ready in time:', error);
  }

  const authClient = createE2EAuthClient();

  // -- Shared anonymous session --------------------------------------------
  // Needs no credentials, so this always attempts. Every anonymous
  // consumer (proxy, concerts, openapi-compliance's beforeAll,
  // e2e-contracts, auth.test.ts) reads this instead of minting its own.
  try {
    const anonResp = await authClient.post<{ token?: string; user?: { id?: string } }>(
      '/sign-in/anonymous',
      {}
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
  const hasCredentials = Boolean(config.testDjEmail && config.testDjPassword);
  if (hasCredentials) {
    try {
      const signInResp = await authClient.post<{ token?: string }>('/sign-in/email', {
        email: config.testDjEmail,
        password: config.testDjPassword,
      });
      if (signInResp.status === 200) {
        const setAuthTokenHeader = signInResp.headers.get('set-auth-token');
        const sessionToken = setAuthTokenHeader || signInResp.body?.token;
        const cookies = extractSetCookieHeaders(signInResp.headers);
        if (sessionToken) {
          process.env.E2E_GLOBAL_DJ_SESSION_TOKEN = sessionToken;
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
        console.error(`[global-setup] credentialed sign-in failed with status ${signInResp.status}`);
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
    const lookupResp = await authClient.post<{ email?: string | null }>('/wxyc/lookup-email', {
      identifier: `e2e-global-nonexistent-${Date.now()}`,
    });
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
