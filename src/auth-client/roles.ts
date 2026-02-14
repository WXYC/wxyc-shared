import type { Permission, Resource, Action } from "./permissions.js";

/**
 * All WXYC station roles, ordered by privilege level (highest first).
 *
 * Note: "admin" is a better-auth system role (auth_user.role), not a station role.
 * Use isSystemAdmin() from auth.ts for system admin checks.
 */
export const ROLES = [
  "stationManager",
  "musicDirector",
  "dj",
  "member",
] as const;
export type WXYCRole = (typeof ROLES)[number];

/**
 * Permission grants for each role.
 */
export const ROLE_PERMISSIONS: Record<WXYCRole, Permission> = {
  stationManager: {
    catalog: ["read", "write"],
    bin: ["read", "write"],
    flowsheet: ["read", "write"],
    roster: ["read", "write"],
  },
  musicDirector: {
    catalog: ["read", "write"],
    bin: ["read", "write"],
    flowsheet: ["read", "write"],
  },
  dj: {
    catalog: ["read"],
    bin: ["read", "write"],
    flowsheet: ["read", "write"],
  },
  member: {
    catalog: ["read"],
    bin: ["read", "write"],
    flowsheet: ["read"],
  },
};

/**
 * Check if a role has a specific permission.
 */
export function hasPermission<R extends Resource>(
  role: WXYCRole | null | undefined,
  resource: R,
  action: Action<R>
): boolean {
  if (!role) return false;
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  const actions = perms[resource];
  return actions?.includes(action as never) ?? false;
}

/**
 * Check if a role can access the roster (user management).
 */
export function canManageRoster(role: WXYCRole | null | undefined): boolean {
  return hasPermission(role, "roster", "write");
}

/**
 * Check if a role can assign other roles.
 * Only stationManager can assign roles.
 */
export function canAssignRoles(role: WXYCRole | null | undefined): boolean {
  return role === "stationManager";
}

/**
 * Get assignable roles for a given role.
 * Station managers can assign any station role.
 */
export function getAssignableRoles(
  role: WXYCRole | null | undefined
): WXYCRole[] {
  if (role === "stationManager") {
    return [...ROLES];
  }
  return [];
}
