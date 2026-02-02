import type { WXYCRole } from "./roles.js";

/**
 * Cross-cutting capabilities that can be granted to any user.
 * These are independent of the DJ role hierarchy.
 */
export const CAPABILITIES = ["editor", "webmaster"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * Policy as data: who can assign which capabilities.
 *
 * Delegation chain:
 *   Admin/StationManager -> can assign webmaster or editor
 *   Webmaster (capability) -> can assign editor only
 */
export const CAPABILITY_ASSIGNERS: Record<
  Capability,
  { roles: readonly WXYCRole[]; capabilities: readonly Capability[] }
> = {
  editor: {
    roles: ["admin", "stationManager"],
    capabilities: ["webmaster"],
  },
  webmaster: {
    roles: ["admin", "stationManager"],
    capabilities: [],
  },
} as const;

/**
 * Check if a user has a specific capability.
 */
export function hasCapability(
  capabilities: Capability[] | null | undefined,
  capability: Capability
): boolean {
  return capabilities?.includes(capability) ?? false;
}

/**
 * Check if a user can edit website content.
 */
export function canEditWebsite(
  capabilities: Capability[] | null | undefined
): boolean {
  return hasCapability(capabilities, "editor");
}

/**
 * Check if a user can assign a specific capability to another user.
 * Uses policy-as-data from CAPABILITY_ASSIGNERS.
 */
export function canAssignCapability(
  user: {
    role: WXYCRole | null | undefined;
    capabilities: Capability[] | null | undefined;
  },
  capability: Capability
): boolean {
  const rules = CAPABILITY_ASSIGNERS[capability];

  // Check if user's role grants assignment permission
  if (user.role && rules.roles.includes(user.role)) {
    return true;
  }

  // Check if any of user's capabilities grant assignment permission
  if (user.capabilities) {
    return rules.capabilities.some((c) => user.capabilities!.includes(c));
  }

  return false;
}
