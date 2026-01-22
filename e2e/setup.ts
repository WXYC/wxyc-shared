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
