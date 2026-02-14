/**
 * Pure authorization utilities - no React or better-auth client dependencies.
 * Use this entry point for server-side code or when you only need the
 * permission/role/capability utilities without the React auth client.
 */

/**
 * Check if a user has the better-auth system admin role.
 * This is orthogonal to the WXYC station role hierarchy (member/dj/md/sm).
 */
export function isSystemAdmin(user: { role?: string | null }): boolean {
  return user.role === "admin";
}

export * from "./permissions.js";
export * from "./roles.js";
export * from "./capabilities.js";
export * from "./authorization.js";
