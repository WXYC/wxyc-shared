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
 */
function extractSetCookieHeaders(headers: Headers): string[] {
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
