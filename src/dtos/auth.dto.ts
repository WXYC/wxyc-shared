/**
 * Auth-related DTOs
 *
 * These are data types only - no runtime auth logic.
 * Used by both backend and frontend for consistent role/permission handling.
 */

/** User roles in snake_case */
export type UserRole =
  | 'member'
  | 'dj'
  | 'librarian'
  | 'music_director'
  | 'station_manager';

/** Role hierarchy (higher number = more permissions) */
export const ROLE_HIERARCHY: Record<UserRole, number> = {
  member: 0,
  dj: 1,
  librarian: 2,
  music_director: 2,
  station_manager: 3,
};

/** Resources that can be protected */
export type Resource = 'bin' | 'catalog' | 'flowsheet';

/** Actions that can be performed on resources */
export type Action = 'read' | 'write';

/** Permission as resource:action string */
export type Permission = `${Resource}:${Action}`;

/** Role to permissions mapping */
export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  member: ['bin:read', 'catalog:read', 'flowsheet:read'],
  dj: ['bin:read', 'bin:write', 'catalog:read', 'flowsheet:read'],
  librarian: [
    'bin:read',
    'bin:write',
    'catalog:read',
    'catalog:write',
    'flowsheet:read',
    'flowsheet:write',
  ],
  music_director: [
    'bin:read',
    'bin:write',
    'catalog:read',
    'catalog:write',
    'flowsheet:read',
    'flowsheet:write',
  ],
  station_manager: [
    'bin:read',
    'bin:write',
    'catalog:read',
    'catalog:write',
    'flowsheet:read',
    'flowsheet:write',
  ],
};

/** App skin/theme preference */
export type AppSkin = 'classic' | 'modern-light' | 'modern-dark';

/** Shared user profile fields */
export interface UserProfile {
  id: string;
  username: string;
  email: string;
  dj_name?: string;
  real_name?: string;
  app_skin: AppSkin;
  role: UserRole;
}

/** Utility: check if role meets minimum level */
export function hasMinimumRole(
  userRole: UserRole,
  requiredRole: UserRole
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/** Utility: check if role has specific permission */
export function hasPermission(
  userRole: UserRole,
  permission: Permission
): boolean {
  return ROLE_PERMISSIONS[userRole].includes(permission);
}
