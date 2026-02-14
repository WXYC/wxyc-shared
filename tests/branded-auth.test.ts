import { describe, it, expect } from "vitest";
import {
  Authorization,
  AUTHORIZATION_LABELS,
  roleToAuthorization,
  authorizationToRole,
  checkRole,
  checkCapability,
  type RoleAuthorizedUser,
  type CapabilityAuthorizedUser,
} from "../src/auth-client/authorization.js";
import type { WXYCRole } from "../src/auth-client/roles.js";
import type { Capability } from "../src/auth-client/capabilities.js";

describe("Authorization enum", () => {
  it("has correct numeric values for hierarchy", () => {
    expect(Authorization.NO).toBe(0);
    expect(Authorization.DJ).toBe(1);
    expect(Authorization.MD).toBe(2);
    expect(Authorization.SM).toBe(3);
  });

  it("supports numeric comparison for hierarchy", () => {
    expect(Authorization.SM > Authorization.MD).toBe(true);
    expect(Authorization.MD > Authorization.DJ).toBe(true);
    expect(Authorization.DJ > Authorization.NO).toBe(true);
  });
});

describe("AUTHORIZATION_LABELS", () => {
  it("has labels for all authorization levels", () => {
    expect(AUTHORIZATION_LABELS[Authorization.NO]).toBe("Member");
    expect(AUTHORIZATION_LABELS[Authorization.DJ]).toBe("DJ");
    expect(AUTHORIZATION_LABELS[Authorization.MD]).toBe("Music Director");
    expect(AUTHORIZATION_LABELS[Authorization.SM]).toBe("Station Manager");
  });
});

describe("roleToAuthorization", () => {
  const cases: [WXYCRole | string | null | undefined, Authorization, string][] = [
    ["admin", Authorization.SM, "admin maps to SM"],
    ["stationManager", Authorization.SM, "stationManager role"],
    ["station_manager", Authorization.SM, "snake_case variant"],
    ["musicDirector", Authorization.MD, "musicDirector role"],
    ["music_director", Authorization.MD, "snake_case variant"],
    ["dj", Authorization.DJ, "dj role"],
    ["member", Authorization.NO, "member role"],
    ["user", Authorization.NO, "user fallback"],
    ["owner", Authorization.SM, "owner maps to SM"],
    [null, Authorization.NO, "null defaults to NO"],
    [undefined, Authorization.NO, "undefined defaults to NO"],
    ["unknown", Authorization.NO, "unknown defaults to NO"],
  ];

  it.each(cases)("maps %s to %s (%s)", (role, expected) => {
    expect(roleToAuthorization(role)).toBe(expected);
  });
});

describe("authorizationToRole", () => {
  const cases: [Authorization, WXYCRole][] = [
    [Authorization.SM, "stationManager"],
    [Authorization.MD, "musicDirector"],
    [Authorization.DJ, "dj"],
    [Authorization.NO, "member"],
  ];

  it.each(cases)("maps Authorization.%s to %s", (auth, expected) => {
    expect(authorizationToRole(auth)).toBe(expected);
  });
});

describe("checkRole", () => {
  const createUser = (authority: Authorization) => ({
    id: "user-1",
    username: "testuser",
    email: "test@example.com",
    authority,
    capabilities: [] as Capability[],
  });

  describe("returns unauthorized for invalid users", () => {
    it("returns unauthenticated for null user", () => {
      const result = checkRole(null, Authorization.DJ);
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.reason).toBe("unauthenticated");
      }
    });

    it("returns unauthenticated for undefined user", () => {
      const result = checkRole(undefined, Authorization.DJ);
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.reason).toBe("unauthenticated");
      }
    });
  });

  describe("returns insufficient_role when role is too low", () => {
    const insufficientCases: [Authorization, Authorization, string][] = [
      [Authorization.NO, Authorization.DJ, "NO cannot access DJ-required"],
      [Authorization.NO, Authorization.SM, "NO cannot access SM-required"],
      [Authorization.DJ, Authorization.MD, "DJ cannot access MD-required"],
      [Authorization.DJ, Authorization.SM, "DJ cannot access SM-required"],
      [Authorization.MD, Authorization.SM, "MD cannot access SM-required"],
    ];

    it.each(insufficientCases)(
      "user with %s cannot access %s-required resource (%s)",
      (userAuth, required) => {
        const result = checkRole(createUser(userAuth), required);
        expect(result.authorized).toBe(false);
        if (!result.authorized) {
          expect(result.reason).toBe("insufficient_role");
        }
      }
    );
  });

  describe("returns authorized when role is sufficient", () => {
    const sufficientCases: [Authorization, Authorization, string][] = [
      [Authorization.DJ, Authorization.DJ, "exact match"],
      [Authorization.SM, Authorization.DJ, "higher role"],
      [Authorization.SM, Authorization.SM, "SM accessing SM"],
    ];

    it.each(sufficientCases)(
      "user with %s can access %s-required resource (%s)",
      (userAuth, required) => {
        const result = checkRole(createUser(userAuth), required);
        expect(result.authorized).toBe(true);
        if (result.authorized) {
          expect(result.user.authority).toBe(userAuth);
        }
      }
    );
  });
});

describe("checkCapability", () => {
  const createUser = (capabilities: Capability[]) => ({
    id: "user-1",
    username: "testuser",
    email: "test@example.com",
    authority: Authorization.DJ,
    capabilities,
  });

  describe("returns unauthorized for invalid users", () => {
    it("returns unauthenticated for null user", () => {
      const result = checkCapability(null, "editor");
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.reason).toBe("unauthenticated");
      }
    });

    it("returns unauthenticated for undefined user", () => {
      const result = checkCapability(undefined, "editor");
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.reason).toBe("unauthenticated");
      }
    });
  });

  describe("returns missing_capability when capability is absent", () => {
    it("returns missing_capability for empty capabilities array", () => {
      const result = checkCapability(createUser([]), "editor");
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.reason).toBe("missing_capability");
      }
    });

    it("returns missing_capability when only has other capability", () => {
      const result = checkCapability(createUser(["webmaster"]), "editor");
      expect(result.authorized).toBe(false);
      if (!result.authorized) {
        expect(result.reason).toBe("missing_capability");
      }
    });
  });

  describe("returns authorized when capability is present", () => {
    it("returns authorized when has exact capability", () => {
      const result = checkCapability(createUser(["editor"]), "editor");
      expect(result.authorized).toBe(true);
    });

    it("returns authorized when has capability among others", () => {
      const result = checkCapability(createUser(["webmaster", "editor"]), "editor");
      expect(result.authorized).toBe(true);
    });
  });
});

describe("Type Safety (compile-time checks)", () => {
  it("branded types prevent unauthorized access at compile time", () => {
    // This test verifies the type system works correctly.
    // The @ts-expect-error comments prove that invalid code is caught.

    // Function that requires SM authorization
    function requiresSM(_user: RoleAuthorizedUser<Authorization.SM>): void {}

    // @ts-expect-error - Plain user should not be assignable to branded type
    const plainUser = { authority: Authorization.SM };
    requiresSM(plainUser);
  });

  it("different authorization levels are not interchangeable", () => {
    function requiresSM(_user: RoleAuthorizedUser<Authorization.SM>): void {}
    function requiresDJ(_user: RoleAuthorizedUser<Authorization.DJ>): void {}

    // This would be valid if we used checkRole and got an authorized result
    // but direct casting should fail
    // @ts-expect-error - DJ branded user should not satisfy SM requirement
    const djUser: RoleAuthorizedUser<Authorization.DJ> = {} as any;
    requiresSM(djUser);
  });

  it("different capabilities are not interchangeable", () => {
    function requiresEditor(_user: CapabilityAuthorizedUser<"editor">): void {}

    // @ts-expect-error - webmaster branded user should not satisfy editor requirement
    const webmasterUser: CapabilityAuthorizedUser<"webmaster"> = {} as any;
    requiresEditor(webmasterUser);
  });
});
