import type { WXYCRole } from "./roles.js";
import type { Capability } from "./capabilities.js";

// ============================================================================
// Authorization Enum
// ============================================================================

/**
 * Numeric authorization levels for role hierarchy comparison.
 * Higher values indicate more privileges.
 *
 * This enum enables simple numeric comparison: SM (3) >= DJ (1)
 */
export enum Authorization {
  /** Base member - no special access */
  NO = 0,
  /** DJ - can access flowsheet and bin */
  DJ = 1,
  /** Music Director - can manage catalog */
  MD = 2,
  /** Station Manager - can manage roster */
  SM = 3,
  /** Admin - full access */
  ADMIN = 4,
}

/**
 * Human-readable labels for authorization levels.
 */
export const AUTHORIZATION_LABELS: Record<Authorization, string> = {
  [Authorization.NO]: "Member",
  [Authorization.DJ]: "DJ",
  [Authorization.MD]: "Music Director",
  [Authorization.SM]: "Station Manager",
  [Authorization.ADMIN]: "Admin",
};

// ============================================================================
// Role <-> Authorization Mapping
// ============================================================================

/**
 * Maps a WXYCRole string to the Authorization enum.
 *
 * Handles variations:
 * - Standard roles: "member", "dj", "musicDirector", "stationManager", "admin"
 * - Snake case: "station_manager", "music_director"
 * - Better-auth defaults: "owner", "user"
 *
 * @param role - The role string from better-auth
 * @returns The corresponding Authorization enum value
 */
export function roleToAuthorization(
  role: WXYCRole | string | null | undefined
): Authorization {
  if (!role) {
    return Authorization.NO;
  }

  const normalized = role.toLowerCase().trim();

  switch (normalized) {
    case "admin":
    case "owner":
      return Authorization.ADMIN;
    case "stationmanager":
    case "station_manager":
      return Authorization.SM;
    case "musicdirector":
    case "music_director":
    case "music-director":
      return Authorization.MD;
    case "dj":
      return Authorization.DJ;
    case "member":
    case "user":
    default:
      return Authorization.NO;
  }
}

/**
 * Maps an Authorization level back to a WXYCRole string.
 */
export function authorizationToRole(auth: Authorization): WXYCRole {
  switch (auth) {
    case Authorization.ADMIN:
      return "admin";
    case Authorization.SM:
      return "stationManager";
    case Authorization.MD:
      return "musicDirector";
    case Authorization.DJ:
      return "dj";
    case Authorization.NO:
    default:
      return "member";
  }
}

// ============================================================================
// Branded Types for Compile-Time Enforcement
// ============================================================================

/** Brand marker for role-based authorization */
declare const RoleBrand: unique symbol;

/** Brand marker for capability-based authorization */
declare const CapabilityBrand: unique symbol;

/**
 * A user object that has been verified to have at least a certain role.
 * The brand ensures this type can only be created through checkRole().
 */
export type RoleAuthorizedUser<R extends Authorization> = {
  id: string;
  username: string;
  email: string;
  authority: Authorization;
  capabilities: Capability[];
  readonly [RoleBrand]: R;
};

/**
 * A user object that has been verified to have a specific capability.
 * The brand ensures this type can only be created through checkCapability().
 */
export type CapabilityAuthorizedUser<C extends Capability> = {
  id: string;
  username: string;
  email: string;
  authority: Authorization;
  capabilities: Capability[];
  readonly [CapabilityBrand]: C;
};

/**
 * A user object verified for both a role AND a capability.
 */
export type FullyAuthorizedUser<
  R extends Authorization,
  C extends Capability
> = RoleAuthorizedUser<R> & CapabilityAuthorizedUser<C>;

// ============================================================================
// Authorization Check Results
// ============================================================================

export type AuthCheckSuccess<T> = {
  authorized: true;
  user: T;
};

export type AuthCheckFailure = {
  authorized: false;
  reason: "unauthenticated" | "insufficient_role" | "missing_capability";
};

export type AuthCheckResult<T> = AuthCheckSuccess<T> | AuthCheckFailure;

// ============================================================================
// Client-Side Authorization Checks
// ============================================================================

/**
 * Base user type for authorization checks.
 */
export type AuthorizableUser = {
  id?: string;
  username?: string;
  email?: string;
  authority: Authorization;
  capabilities?: Capability[];
};

/**
 * Check if a user has the required role level.
 *
 * Returns a branded user type on success, ensuring the type system
 * enforces that authorization was checked.
 *
 * @example
 * ```ts
 * const result = checkRole(user, Authorization.SM);
 * if (!result.authorized) {
 *   return <AccessDenied />;
 * }
 * // result.user is now RoleAuthorizedUser<Authorization.SM>
 * return <AdminPanel user={result.user} />;
 * ```
 */
export function checkRole<R extends Authorization>(
  user: AuthorizableUser | null | undefined,
  requiredRole: R
): AuthCheckResult<RoleAuthorizedUser<R>> {
  if (!user) {
    return { authorized: false, reason: "unauthenticated" };
  }

  if (user.authority < requiredRole) {
    return { authorized: false, reason: "insufficient_role" };
  }

  // Cast to branded type - this is safe because we verified the role
  return {
    authorized: true,
    user: {
      id: user.id ?? "",
      username: user.username ?? "",
      email: user.email ?? "",
      authority: user.authority,
      capabilities: user.capabilities ?? [],
    } as RoleAuthorizedUser<R>,
  };
}

/**
 * Check if a user has a required capability.
 *
 * Returns a branded user type on success, ensuring the type system
 * enforces that authorization was checked.
 *
 * @example
 * ```ts
 * const result = checkCapability(user, "editor");
 * if (!result.authorized) {
 *   return <AccessDenied />;
 * }
 * // result.user is now CapabilityAuthorizedUser<"editor">
 * return <EditorTools user={result.user} />;
 * ```
 */
export function checkCapability<C extends Capability>(
  user: AuthorizableUser | null | undefined,
  capability: C
): AuthCheckResult<CapabilityAuthorizedUser<C>> {
  if (!user) {
    return { authorized: false, reason: "unauthenticated" };
  }

  if (!user.capabilities?.includes(capability)) {
    return { authorized: false, reason: "missing_capability" };
  }

  // Cast to branded type - this is safe because we verified the capability
  return {
    authorized: true,
    user: {
      id: user.id ?? "",
      username: user.username ?? "",
      email: user.email ?? "",
      authority: user.authority,
      capabilities: user.capabilities,
    } as CapabilityAuthorizedUser<C>,
  };
}

/**
 * Check if a user has both a required role AND capability.
 */
export function checkRoleAndCapability<R extends Authorization, C extends Capability>(
  user: AuthorizableUser | null | undefined,
  requiredRole: R,
  capability: C
): AuthCheckResult<FullyAuthorizedUser<R, C>> {
  const roleResult = checkRole(user, requiredRole);
  if (!roleResult.authorized) {
    return roleResult;
  }

  const capResult = checkCapability(user, capability);
  if (!capResult.authorized) {
    return capResult;
  }

  return {
    authorized: true,
    user: roleResult.user as FullyAuthorizedUser<R, C>,
  };
}
