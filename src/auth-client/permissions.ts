/**
 * All resources and their available actions, as the CLIENT understands them.
 *
 * **Not the source of truth for server-side gates**, despite what this comment
 * used to claim. Backend-Service builds its own better-auth access-control
 * statement in `shared/authentication/src/auth.roles.ts`, and that is what
 * `requirePermissions` actually enforces; the JWT carries a role, not a
 * permission set, so the two tables never meet at runtime. They have already
 * diverged in both directions — `roster` exists only here, `flowsheet: manage`
 * (WXYC/Backend-Service#2235) only there — and nothing ties them.
 *
 * Adding an action for a server-side gate belongs in `auth.roles.ts`. Mirror it
 * here only if a client needs to reason about it, which today none do: dj-site
 * gates on `roleToAuthorization(...)`, and `ROLE_PERMISSIONS`/`hasPermission`
 * below have no consumer outside `canManageRoster`.
 */
export const RESOURCES = {
  catalog: ["read", "write"],
  bin: ["read", "write"],
  flowsheet: ["read", "write"],
  roster: ["read", "write"],
} as const;

export type Resource = keyof typeof RESOURCES;
export type Action<R extends Resource> = (typeof RESOURCES)[R][number];

/**
 * A permission is a resource + action pair.
 */
export type Permission = {
  [R in Resource]?: readonly Action<R>[];
};
