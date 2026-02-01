import type { Permission, Resource, Action } from "./permissions.js";

/**
 * All WXYC roles, ordered by privilege level (highest first).
 */
export const ROLES = [
  "admin",
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
  admin: {
    catalog: ["read", "write"],
    bin: ["read", "write"],
    flowsheet: ["read", "write"],
    roster: ["read", "write"],
  },
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
 * Only admin and stationManager can assign roles.
 */
export function canAssignRoles(role: WXYCRole | null | undefined): boolean {
  return role === "admin" || role === "stationManager";
}

/**
 * Check if a role can promote to admin.
 * Only admin can promote to admin.
 */
export function canPromoteToAdmin(role: WXYCRole | null | undefined): boolean {
  return role === "admin";
}

/**
 * Get assignable roles for a given role.
 * Admins can assign any role, SMs can assign up to SM.
 */
export function getAssignableRoles(
  role: WXYCRole | null | undefined
): WXYCRole[] {
  if (role === "admin") {
    return [...ROLES];
  }
  if (role === "stationManager") {
    return ["stationManager", "musicDirector", "dj", "member"];
  }
  return [];
}
