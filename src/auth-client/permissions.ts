/**
 * All resources and their available actions.
 * This is the single source of truth for permissions.
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
