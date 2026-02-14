import { describe, it, expect } from "vitest";
import {
  hasPermission,
  canAssignRoles,
  canManageRoster,
  getAssignableRoles,
  ROLES,
  ROLE_PERMISSIONS,
} from "../src/auth-client/roles.js";

describe("hasPermission", () => {
  const permissionCases = [
    // SM has roster access (top of hierarchy)
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

describe("canAssignRoles", () => {
  const cases = [
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
  it("stationManager can assign all roles", () => {
    expect(getAssignableRoles("stationManager")).toEqual([...ROLES]);
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
