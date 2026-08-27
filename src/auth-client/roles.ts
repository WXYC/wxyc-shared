/**
 * All WXYC station roles, ordered by privilege level (highest first).
 *
 * This ordering is load-bearing: it is the single declaration of the role
 * chain. `Authorization` in authorization.ts is its ascending numeric
 * projection (pinned by test), and Backend-Service's grant matrix is
 * CI-checked to be monotone along this chain. Permission grants themselves
 * live in Backend-Service's `auth.roles.ts` — this package deliberately
 * carries no grant table (the JWT transports a role, not a permission set,
 * so a client-side copy could only drift; one did, and was removed).
 *
 * Note: "admin" is a better-auth system role (auth_user.role), not a station
 * role. Use isSystemAdmin() from auth.ts for system admin checks, and
 * canonicalizeRole() from authorization.ts to resolve alias strings.
 */
export const ROLES = [
  "stationManager",
  "musicDirector",
  "dj",
  "member",
] as const;
export type WXYCRole = (typeof ROLES)[number];
