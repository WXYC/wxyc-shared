import { describe, it, expect } from "vitest";
import {
  hasPermission,
  canPromoteToAdmin,
  canAssignRoles,
  canManageRoster,
  getAssignableRoles,
  ROLES,
  ROLE_PERMISSIONS,
} from "../src/auth-client/roles.js";

describe("hasPermission", () => {
  const permissionCases = [
    // Admin has everything
    { role: "admin", resource: "roster", action: "read", expected: true },
    { role: "admin", resource: "roster", action: "write", expected: true },
    { role: "admin", resource: "catalog", action: "write", expected: true },

    // SM has roster access
    {
      role: "stationManager",
      resource: "roster",
      action: "read",
      expected: true,
    },
    {
      role: "stationManager",
      resource: "roster",
      action: "write",
      expected: true,
    },

    // MD has no roster access
    {
      role: "musicDirector",
      resource: "roster",
      action: "read",
      expected: false,
    },
    {
      role: "musicDirector",
      resource: "roster",
      action: "write",
      expected: false,
    },
    {
      role: "musicDirector",
      resource: "catalog",
      action: "write",
      expected: true,
    },

    // DJ has limited access
    { role: "dj", resource: "catalog", action: "read", expected: true },
    { role: "dj", resource: "catalog", action: "write", expected: false },
    { role: "dj", resource: "flowsheet", action: "write", expected: true },

    // Member has most limited access
    { role: "member", resource: "catalog", action: "read", expected: true },
    { role: "member", resource: "catalog", action: "write", expected: false },
    { role: "member", resource: "flowsheet", action: "read", expected: true },
    { role: "member", resource: "flowsheet", action: "write", expected: false },

    // Edge cases
    { role: null, resource: "catalog", action: "read", expected: false },
    { role: undefined, resource: "catalog", action: "read", expected: false },
  ] as const;

  it.each(permissionCases)(
    "$role has $resource:$action = $expected",
    ({ role, resource, action, expected }) => {
      expect(hasPermission(role, resource, action)).toBe(expected);
    }
  );
});

describe("canManageRoster", () => {
  const cases = [
    { role: "admin", expected: true },
    { role: "stationManager", expected: true },
    { role: "musicDirector", expected: false },
    { role: "dj", expected: false },
    { role: "member", expected: false },
    { role: null, expected: false },
  ] as const;

  it.each(cases)("$role can manage roster = $expected", ({ role, expected }) => {
    expect(canManageRoster(role)).toBe(expected);
  });
});

describe("canPromoteToAdmin", () => {
  const cases = [
    { role: "admin", expected: true },
    { role: "stationManager", expected: false },
    { role: "musicDirector", expected: false },
    { role: "dj", expected: false },
    { role: "member", expected: false },
    { role: null, expected: false },
  ] as const;

  it.each(cases)(
    "$role can promote to admin = $expected",
    ({ role, expected }) => {
      expect(canPromoteToAdmin(role)).toBe(expected);
    }
  );
});

describe("canAssignRoles", () => {
  const cases = [
    { role: "admin", expected: true },
    { role: "stationManager", expected: true },
    { role: "musicDirector", expected: false },
    { role: "dj", expected: false },
    { role: "member", expected: false },
    { role: null, expected: false },
  ] as const;

  it.each(cases)("$role can assign roles = $expected", ({ role, expected }) => {
    expect(canAssignRoles(role)).toBe(expected);
  });
});

describe("getAssignableRoles", () => {
  it("admin can assign all roles", () => {
    expect(getAssignableRoles("admin")).toEqual([...ROLES]);
  });

  it("stationManager can assign all except admin", () => {
    const assignable = getAssignableRoles("stationManager");
    expect(assignable).toContain("stationManager");
    expect(assignable).toContain("musicDirector");
    expect(assignable).toContain("dj");
    expect(assignable).toContain("member");
    expect(assignable).not.toContain("admin");
  });

  const nonAssignerRoles = ["musicDirector", "dj", "member", null] as const;

  it.each(nonAssignerRoles)("%s cannot assign any roles", (role) => {
    expect(getAssignableRoles(role)).toEqual([]);
  });
});

describe("ROLE_PERMISSIONS completeness", () => {
  it.each([...ROLES])("%s has defined permissions", (role) => {
    expect(ROLE_PERMISSIONS[role]).toBeDefined();
    expect(Object.keys(ROLE_PERMISSIONS[role]).length).toBeGreaterThan(0);
  });
});
