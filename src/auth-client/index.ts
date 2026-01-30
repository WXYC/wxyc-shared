"use client";

import { createAuthClient } from "better-auth/react";
import {
  adminClient,
  usernameClient,
  jwtClient,
  organizationClient,
} from "better-auth/client/plugins";

/**
 * Roles that grant extended archive access (90 days instead of 14).
 */
export const DJ_ROLES = ["dj", "musicDirector", "stationManager"] as const;
export type DJRole = (typeof DJ_ROLES)[number];

/**
 * Check if a role grants DJ-level archive access.
 */
export function isDJRole(role: string | null | undefined): role is DJRole {
  return DJ_ROLES.includes(role as DJRole);
}

/**
 * Get the base URL for the auth service.
 * On client-side, prefers same-origin proxy to ensure session cookies are set correctly.
 */
function getBaseURL(): string {
  const envURL = process?.env?.NEXT_PUBLIC_BETTER_AUTH_URL;

  if (typeof window !== "undefined") {
    if (envURL) {
      try {
        const url = new URL(envURL);
        // If configured URL is cross-origin, use same-origin proxy instead
        if (url.origin !== window.location.origin) {
          return `${window.location.origin}/auth`;
        }
        return envURL;
      } catch {
        // If envURL isn't a valid absolute URL, treat it as a path
        return envURL.startsWith("/")
          ? `${window.location.origin}${envURL}`
          : `${window.location.origin}/auth`;
      }
    }
    return `${window.location.origin}/auth`;
  }

  return envURL || "https://api.wxyc.org/auth";
}

/**
 * Create an auth client configured for the Better Auth server.
 */
export function createWXYCAuthClient(baseURL: string) {
  return createAuthClient({
    baseURL,
    fetchOptions: {
      credentials: "include" as RequestCredentials,
    },
    plugins: [
      adminClient(),
      usernameClient(),
      jwtClient(),
      organizationClient(),
    ],
  });
}

const baseURL = getBaseURL();

/**
 * Default auth client using environment variable for base URL.
 * Falls back to same-origin /auth or production URL.
 */
export const authClient = createWXYCAuthClient(baseURL);

/**
 * Get JWT token from better-auth /token endpoint.
 * Use this for API calls that require authentication.
 */
export async function getJWTToken(): Promise<string | null> {
  try {
    const response = await fetch(`${baseURL}/token`, {
      method: "GET",
      credentials: "include",
    });

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as { token?: string };
    return data.token ?? null;
  } catch (error) {
    console.error("Failed to get JWT token:", error);
    return null;
  }
}

// Re-export types from better-auth for convenience
export type { Session, User } from "better-auth/types";
