import type { WXYCRole } from "./roles.js";

/**
 * Cross-cutting capabilities that can be granted to any user.
 * These are independent of the DJ role hierarchy.
 */
export const CAPABILITIES = ["editor", "webmaster", "reviews_beta", "archive_admin"] as const;

export type Capability = (typeof CAPABILITIES)[number];

/** Screen labels for each capability. Total, so a new capability cannot ship without one. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  editor: "Editor",
  webmaster: "Webmaster",
  reviews_beta: "Reviews beta",
  archive_admin: "Archive admin",
};

/**
 * Policy as data: who can assign which capabilities.
 *
 * Delegation chain:
 *   StationManager -> can assign webmaster, editor, reviews_beta or archive_admin (no capability delegates reviews_beta or archive_admin)
 *   Webmaster (capability) -> can assign editor only
 */
export const CAPABILITY_ASSIGNERS: Record<
  Capability,
  { roles: readonly WXYCRole[]; capabilities: readonly Capability[] }
> = {
  editor: {
    roles: ["stationManager"],
    capabilities: ["webmaster"],
  },
  webmaster: {
    roles: ["stationManager"],
    capabilities: [],
  },
  reviews_beta: {
    roles: ["stationManager"],
    capabilities: [],
  },
  archive_admin: {
    roles: ["stationManager"],
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
