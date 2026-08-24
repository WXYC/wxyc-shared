/**
 * E2E Test Setup
 *
 * Shared setup for all E2E tests including API client creation
 * and authentication helpers.
 */

export interface E2EConfig {
  baseUrl: string;
  authUrl: string;
  testDjEmail?: string;
  testDjPassword?: string;
  /**
   * Username half of the same staging DJ account `testDjEmail` /
   * `testDjPassword` authenticate. Provisioning is tracked outside this
   * repo (issue #379's A2) — until the staging account + repository secret
   * exist, this stays unset and the username-sign-in assertions self-skip
   * exactly like the email/password ones do on `hasCredentials`. Do NOT
   * promote the username assertions to a fail-loud `E2E_REQUIRE_CREDENTIALS`
   * gate ahead of that provisioning landing in `bs-lml-gate.yml` — see the
   * comment on that assertion in `e2e/auth.test.ts`.
   */
  testDjUsername?: string;
  /**
   * Full Postgres connection string for the stack's database, used by tests
   * that must seed rows for endpoints with no create-via-API path (e.g.
   * `/concerts`, whose rows are produced by scraper/ETL jobs). Unset in
   * environments without direct DB reach — those tests self-skip their
   * seed-dependent assertions.
   */
  dbUrl?: string;
  /** Postgres schema the backend reads (per-worker in CI; `wxyc_schema` by default). */
  schemaName: string;
  /**
   * Issue #379 review finding #10's ratified fail-loud gate. When `true`,
   * `e2e/auth.test.ts`'s `beforeAll` throws if `testDjEmail`/`testDjPassword`
   * are not both set, instead of letting every credentialed assertion in
   * that file silently self-skip via `hasCredentials`. `bs-lml-gate.yml`
   * sets this now that `E2E_TEST_DJ_EMAIL`/`E2E_TEST_DJ_PASSWORD` are
   * provisioned repository secrets — a misconfigured or accidentally-removed
   * secret should fail the prod-promotion gate loudly, not pass green
   * having silently run zero credentialed assertions. Deliberately NOT
   * applied to `testDjUsername` — that credential is not yet provisioned in
   * every environment this suite runs in, so it keeps its own
   * `hasUsernameCredentials` self-skip (see `e2e/auth.test.ts` and
   * `e2e/README.md`) until it is.
   */
  requireCredentials: boolean;
}

/**
 * Get E2E configuration from environment variables
 */
export function getE2EConfig(): E2EConfig {
  return {
    baseUrl: process.env.E2E_BASE_URL || 'http://localhost:8080',
    authUrl: process.env.E2E_AUTH_URL || 'http://localhost:8081/auth',
    testDjEmail: process.env.E2E_TEST_DJ_EMAIL,
    testDjPassword: process.env.E2E_TEST_DJ_PASSWORD,
    testDjUsername: process.env.E2E_TEST_DJ_USERNAME,
    dbUrl: process.env.E2E_DB_URL,
    schemaName: process.env.E2E_SCHEMA_NAME || process.env.WXYC_SCHEMA_NAME || 'wxyc_schema',
    requireCredentials: process.env.E2E_REQUIRE_CREDENTIALS === 'true',
  };
}

/**
 * Simple HTTP client for E2E tests
 */
export class E2EClient {
  private baseUrl: string;
  private authToken?: string;

  constructor(config: E2EConfig) {
    this.baseUrl = config.baseUrl;
  }

  /**
   * Set authentication token for subsequent requests
   */
  setAuthToken(token: string): void {
    this.authToken = token;
  }

  /**
   * Clear authentication token
   */
  clearAuthToken(): void {
    this.authToken = undefined;
  }

  /**
   * Make a GET request
   */
  async get<T>(path: string, options?: RequestInit): Promise<E2EResponse<T>> {
    return this.request<T>('GET', path, options);
  }

  /**
   * Make a POST request
   */
  async post<T>(path: string, body?: unknown, options?: RequestInit): Promise<E2EResponse<T>> {
    return this.request<T>('POST', path, {
      ...options,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Make a PUT request
   */
  async put<T>(path: string, body?: unknown, options?: RequestInit): Promise<E2EResponse<T>> {
    return this.request<T>('PUT', path, {
      ...options,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Make a PATCH request
   */
  async patch<T>(path: string, body?: unknown, options?: RequestInit): Promise<E2EResponse<T>> {
    return this.request<T>('PATCH', path, {
      ...options,
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  /**
   * Make a DELETE request
   */
  async delete<T>(path: string, options?: RequestInit): Promise<E2EResponse<T>> {
    return this.request<T>('DELETE', path, options);
  }

  private async request<T>(
    method: string,
    path: string,
    options?: RequestInit
  ): Promise<E2EResponse<T>> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...((options?.headers as Record<string, string>) || {}),
    };

    if (this.authToken) {
      headers['Authorization'] = `Bearer ${this.authToken}`;
    }

    const response = await fetch(url, {
      ...options,
      method,
      headers,
    });

    let body: T | null = null;
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('application/json')) {
      body = await response.json();
    }

    return {
      status: response.status,
      headers: response.headers,
      body: body as T,
      ok: response.ok,
    };
  }
}

export interface E2EResponse<T> {
  status: number;
  headers: Headers;
  body: T;
  ok: boolean;
}

/**
 * Create a new E2E client instance
 */
export function createE2EClient(config?: Partial<E2EConfig>): E2EClient {
  return new E2EClient({ ...getE2EConfig(), ...config });
}

/**
 * An E2EClient bound to the auth origin (`config.authUrl`) rather than the
 * backend origin (`config.baseUrl`) `createE2EClient` uses.
 *
 * `E2EClient` reads only `baseUrl` internally, so pointing one at the
 * better-auth routes added in issue #379 (`/sign-in/email`, `/token`, …)
 * needs an override rather than the default client — named explicitly here
 * so every auth-schema compliance assertion shares one client rather than
 * each inlining `createE2EClient({ baseUrl: config.authUrl })`.
 */
export function createE2EAuthClient(config?: Partial<E2EConfig>): E2EClient {
  const merged = { ...getE2EConfig(), ...config };
  return new E2EClient({ ...merged, baseUrl: merged.authUrl });
}

/**
 * Wait for a service to be ready
 */
export async function waitForService(
  url: string,
  timeoutMs = 30000,
  intervalMs = 1000
): Promise<void> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    try {
      const response = await fetch(url, { method: 'HEAD' });
      if (response.ok) {
        return;
      }
    } catch {
      // Service not ready yet
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Service at ${url} did not become ready within ${timeoutMs}ms`);
}

/**
 * Authentication helper for E2E tests.
 * Signs in via better-auth and obtains a JWT for backend requests.
 */
export class E2EAuthHelper {
  private authUrl: string;
  private sessionCookies: string[] = [];

  constructor(authUrl: string) {
    this.authUrl = authUrl;
  }

  /**
   * Sign in with email/password via better-auth.
   * Returns the session cookies for subsequent requests.
   */
  async signIn(email: string, password: string): Promise<{ cookies: string[]; session: unknown }> {
    const response = await fetch(`${this.authUrl}/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
      redirect: 'manual',
    });

    if (!response.ok && response.status !== 302) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `Sign-in failed with status ${response.status}: ${body}`
      );
    }

    // Extract Set-Cookie headers
    this.sessionCookies = extractSetCookieHeaders(response.headers);

    const session = response.headers.get('content-type')?.includes('json')
      ? await response.json()
      : null;

    return { cookies: this.sessionCookies, session };
  }

  /**
   * Get a JWT token using the session cookies from a prior sign-in.
   * Returns the decoded payload alongside the raw token.
   */
  async getJWTToken(): Promise<{ token: string; payload: Record<string, unknown> } | null> {
    if (this.sessionCookies.length === 0) {
      throw new Error('Must call signIn() before getJWTToken()');
    }

    const cookieHeader = this.sessionCookies
      .map((c) => c.split(';')[0])
      .join('; ');

    const response = await fetch(`${this.authUrl}/token`, {
      method: 'GET',
      headers: { cookie: cookieHeader },
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { token?: string };
    const token = data.token;
    if (!token) {
      return null;
    }

    // Decode JWT payload (no verification — the backend does that)
    const payloadB64 = token.split('.')[1];
    if (!payloadB64) {
      return null;
    }
    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    );

    return { token, payload };
  }

  /**
   * Convenience: sign in and immediately configure an E2EClient with the JWT.
   */
  async authenticateClient(
    client: E2EClient,
    email: string,
    password: string
  ): Promise<{ payload: Record<string, unknown> }> {
    await this.signIn(email, password);
    const jwt = await this.getJWTToken();

    if (!jwt) {
      throw new Error('Failed to obtain JWT after sign-in');
    }

    client.setAuthToken(jwt.token);
    return { payload: jwt.payload };
  }
}

/**
 * Extract Set-Cookie header values from a Response.
 * Handles runtimes where getSetCookie() may not be available.
 *
 * Exported so callers outside this module (e.g. `e2e/auth.test.ts`, which
 * needs the session cookies from a raw `E2EClient` sign-in response rather
 * than going through `E2EAuthHelper.signIn`) can reuse the same fallback
 * logic instead of re-deriving it.
 */
export function extractSetCookieHeaders(headers: Headers): string[] {
  if (typeof headers.getSetCookie === 'function') {
    const cookies = headers.getSetCookie();
    if (cookies.length > 0) return cookies;
  }

  const raw = headers.get('set-cookie');
  if (!raw) return [];

  // Split on ", " followed by a cookie-name=
  return raw.split(/,\s*(?=[A-Za-z0-9_.-]+=)/).map((s) => s.trim());
}

/**
 * Create an auth helper using the E2E config
 */
export function createE2EAuthHelper(config?: Partial<E2EConfig>): E2EAuthHelper {
  const merged = { ...getE2EConfig(), ...config };
  return new E2EAuthHelper(merged.authUrl);
}

/**
 * Sign in anonymously via better-auth and return a session token.
 *
 * This is the auth mechanism the iOS and Android apps use for endpoints
 * gated on an anonymous session rather than a DJ login (`/proxy/*`). The
 * token arrives either in the `set-auth-token` response header or the JSON
 * body, depending on the better-auth plugin config.
 */
export async function getAnonymousToken(authUrl: string): Promise<string> {
  const response = await fetch(`${authUrl}/sign-in/anonymous`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Anonymous sign-in failed: ${response.status} ${text}`);
  }

  const headerToken = response.headers.get('set-auth-token');
  if (headerToken) return headerToken;

  const body = (await response.json().catch(() => ({}))) as { token?: string };
  if (body.token) return body.token;

  throw new Error('No session token received from anonymous sign-in');
}

/**
 * Anonymous session -> JWT. Endpoints gated by `requirePermissions` (e.g.
 * `/concerts`) verify a JWT against JWKS rather than accepting the
 * better-auth session token directly (which the `/proxy` session middleware
 * does). Exchange the anonymous session token at `/token` for the JWT the
 * backend will honour.
 */
export async function getAnonymousJwt(authUrl: string): Promise<string> {
  const sessionToken = await getAnonymousToken(authUrl);
  const response = await fetch(`${authUrl}/token`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Token exchange failed: ${response.status} ${text}`);
  }
  const body = (await response.json()) as { token?: string };
  if (!body.token) throw new Error('No JWT returned from /token');
  return body.token;
}

// ── Cross-file shared fixtures (issue #379 review fix-pass #2, finding #2) ──
//
// `e2e/global-setup.ts` runs once, in the main process, before any e2e test
// file is forked, and mints the handful of live sessions/probes below that
// would otherwise be re-minted once per file against the SAME shared,
// cross-service rate-limit budget (apps/auth/app.ts's authMutationRateLimit
// -- 10 requests / 15 min per X-Real-IP, one bucket shared across nine path
// prefixes). It exposes them via `process.env`, which Node's
// `child_process.fork` inherits at fork time -- global setup completes,
// including these mutations, before vitest spawns any worker. The getters
// below are the one place every consumer reads them from, so the env-var
// names and JSON shapes are defined exactly once. See
// `e2e/auth.test.ts`'s budget-arithmetic comment for the full accounting
// this collapses.

/** The shared anonymous session `e2e/global-setup.ts` mints once per run. */
export interface SharedAnonymousSession {
  /** Whichever of `setAuthTokenHeader` / `bodyToken` the mint found -- for consumers that just need a working token and don't care which channel it arrived on. */
  sessionToken: string;
  /** The raw `set-auth-token` response header value from the mint, or `null` if the response didn't carry one. */
  setAuthTokenHeader: string | null;
  /** The raw response body's `token` field from the mint, or `undefined` if the response didn't carry one. */
  bodyToken?: string;
  userId?: string;
}

/**
 * Read the anonymous session `e2e/global-setup.ts` minted for this run.
 * Returns `null` if global setup didn't run, or its anonymous sign-in
 * failed (e.g. the auth service was unreachable) -- callers that need one
 * should assert non-null themselves so the failure is attributed to the
 * right test rather than surfacing as a confusing downstream 401.
 *
 * Keeping `setAuthTokenHeader` and `bodyToken` as separate fields (rather
 * than only the collapsed `sessionToken`) is load-bearing, not redundancy:
 * `CONTRACTS.ANONYMOUS_SIGN_IN_SHAPE` (header-or-body) and
 * `CONTRACTS.SET_AUTH_TOKEN_NEVER_ROTATES`'s deterministic-prefix property
 * (header must start with the body token followed by ".") both need to
 * see which channel carried which value, not just "a token arrived
 * somewhere" -- collapsing the two would force those contract tests back
 * onto their own live sign-in calls.
 */
export function getSharedAnonymousSession(): SharedAnonymousSession | null {
  const sessionToken = process.env.E2E_GLOBAL_ANON_SESSION_TOKEN;
  if (!sessionToken) return null;
  return {
    sessionToken,
    setAuthTokenHeader: process.env.E2E_GLOBAL_ANON_SET_AUTH_TOKEN_HEADER || null,
    bodyToken: process.env.E2E_GLOBAL_ANON_BODY_TOKEN || undefined,
    userId: process.env.E2E_GLOBAL_ANON_USER_ID || undefined,
  };
}

/** The shared credentialed (DJ) session `e2e/global-setup.ts` mints once per run, when configured. */
export interface SharedDjSession {
  sessionToken: string;
  /** The raw `set-auth-token` header value from the mint, or `null` if the response didn't carry one. */
  setAuthTokenHeader: string | null;
  /** A ready-to-send `Cookie:` header value (`name=value; name2=value2`), or `null` if none were set. */
  cookieHeader: string | null;
}

/**
 * Read the credentialed (DJ) session `e2e/global-setup.ts` minted for this
 * run. Returns `null` when no DJ account is configured (global setup skips
 * this mint entirely in that case) or the mint failed -- every consumer
 * already self-skips its credentialed assertions via its own
 * `hasCredentials` check, so a `null` here is expected and not itself an
 * error.
 */
export function getSharedDjSession(): SharedDjSession | null {
  const sessionToken = process.env.E2E_GLOBAL_DJ_SESSION_TOKEN;
  if (!sessionToken) return null;
  return {
    sessionToken,
    setAuthTokenHeader: process.env.E2E_GLOBAL_DJ_SET_AUTH_TOKEN_HEADER || null,
    cookieHeader: process.env.E2E_GLOBAL_DJ_COOKIE_HEADER || null,
  };
}

/**
 * The shared `POST /auth/wxyc/lookup-email` "no match" probe
 * `e2e/global-setup.ts` runs once per run against a synthetic, timestamped,
 * guaranteed-nonexistent identifier. Both `e2e/auth.test.ts`'s behavioral
 * no-match assertion and `e2e/contract/openapi-compliance.test.ts`'s
 * schema-compliance assertion for the same response need only that the
 * identifier doesn't resolve, so one probe serves both.
 */
export interface SharedLookupEmailNullProbe {
  status: number;
  body: { email?: string | null };
}

export function getSharedLookupEmailNullProbe(): SharedLookupEmailNullProbe | null {
  const status = process.env.E2E_GLOBAL_LOOKUP_EMAIL_NULL_STATUS;
  const body = process.env.E2E_GLOBAL_LOOKUP_EMAIL_NULL_BODY;
  if (!status || !body) return null;
  try {
    return { status: Number(status), body: JSON.parse(body) };
  } catch {
    return null;
  }
}

/**
 * Exchange a session token (anonymous or credentialed) for a JWT via the
 * free (non-rate-limited -- GET /auth/token is not in apps/auth/app.ts's
 * rateLimitedPaths) `/auth/token` endpoint. Every consumer of a SHARED
 * session mints its own JWT this way rather than sharing one JWT across
 * files: JWTs are cheap to mint, each file wants its own decoded
 * payload/expiry, and there is no rate-limit reason to share the mint
 * itself, only the underlying session that would otherwise need re-minting.
 */
export async function exchangeSessionForJwt(
  sessionToken: string,
  authUrl?: string
): Promise<{ token: string; payload: Record<string, unknown> } | null> {
  const authClient = createE2EAuthClient(authUrl ? { authUrl } : undefined);
  const response = await authClient.get<{ token?: string }>('/token', {
    headers: { Authorization: `Bearer ${sessionToken}` },
  });
  if (response.status !== 200 || !response.body?.token) return null;
  const jwt = response.body.token;
  const payloadB64 = jwt.split('.')[1];
  const payload: Record<string, unknown> = payloadB64
    ? JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf-8'))
    : {};
  return { token: jwt, payload };
}

/**
 * Poll a function until it returns a non-null value or times out.
 *
 * @param fn - Async function that returns `null` when the condition is not yet met
 * @param timeoutMs - Maximum time to wait (default 15s)
 * @param intervalMs - Delay between polls (default 500ms)
 * @returns The first non-null value returned by `fn`
 * @throws Error if the timeout is reached
 */
export async function pollUntil<T>(
  fn: () => Promise<T | null>,
  timeoutMs = 15000,
  intervalMs = 500
): Promise<T> {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const result = await fn();
    if (result !== null) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
}
