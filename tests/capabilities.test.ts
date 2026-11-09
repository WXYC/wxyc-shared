import { describe, it, expect } from "vitest";
import {
  hasCapability,
  canEditWebsite,
  canAssignCapability,
  CAPABILITIES,
  CAPABILITY_ASSIGNERS,
  type Capability,
} from "../src/auth-client/capabilities.js";
import type { WXYCRole } from "../src/auth-client/roles.js";

describe("CAPABILITIES", () => {
  it.each(["editor", "webmaster", "reviews_beta"])("includes %s capability", (capability) => {
    expect(CAPABILITIES).toContain(capability);
  });
});

describe("hasCapability", () => {
  it.each<[Capability[] | null | undefined, Capability, boolean, string]>([
    [["editor"], "editor", true, "present capability"],
    [["webmaster", "editor"], "editor", true, "one of many"],
    [["webmaster"], "editor", false, "absent capability"],
    [[], "editor", false, "empty array"],
    [null, "editor", false, "null"],
    [undefined, "editor", false, "undefined"],
  ])(
    "given %j checking for %s returns %s (%s)",
    (capabilities, capability, expected) => {
      expect(hasCapability(capabilities, capability)).toBe(expected);
    }
  );
});

describe("canEditWebsite", () => {
  it.each<[Capability[] | null | undefined, boolean]>([
    [["editor"], true],
    [["webmaster"], false],
    [["editor", "webmaster"], true],
    [[], false],
    [null, false],
    [undefined, false],
  ])("given capabilities %j returns %s", (capabilities, expected) => {
    expect(canEditWebsite(capabilities)).toBe(expected);
  });
});

describe("CAPABILITY_ASSIGNERS", () => {
  it("allows only stationManager to assign editor by role", () => {
    expect(CAPABILITY_ASSIGNERS.editor.roles).toEqual(["stationManager"]);
  });

  it("allows webmaster capability to assign editor", () => {
    expect(CAPABILITY_ASSIGNERS.editor.capabilities).toContain("webmaster");
  });

  it("allows only stationManager to assign webmaster by role", () => {
    expect(CAPABILITY_ASSIGNERS.webmaster.roles).toEqual(["stationManager"]);
  });

  it("does not allow any capability to assign webmaster", () => {
    expect(CAPABILITY_ASSIGNERS.webmaster.capabilities).toHaveLength(0);
  });

  it("allows musicDirector and stationManager to assign reviews_beta by role", () => {
    expect(CAPABILITY_ASSIGNERS.reviews_beta.roles).toEqual(["musicDirector", "stationManager"]);
  });

  it("does not allow any capability to assign reviews_beta", () => {
    expect(CAPABILITY_ASSIGNERS.reviews_beta.capabilities).toHaveLength(0);
  });
});

describe("canAssignCapability by role x capability", () => {
  it.each<[WXYCRole, Capability, boolean]>([
    ["member", "reviews_beta", false],
    ["dj", "reviews_beta", false],
    ["musicDirector", "reviews_beta", true],
    ["stationManager", "reviews_beta", true],
    ["musicDirector", "editor", false],
    ["musicDirector", "webmaster", false],
    ["stationManager", "editor", true],
    ["stationManager", "webmaster", true],
  ])("%s assigning %s is %s", (role, capability, expected) => {
    expect(canAssignCapability({ role, capabilities: [] }, capability)).toBe(expected);
  });
});

describe("canAssignCapability", () => {
  // Helper to create user objects
  const user = (role: WXYCRole, capabilities: Capability[] = []) => ({
    role,
    capabilities,
  });

  describe("assigning editor", () => {
    it.each<
      [{ role: WXYCRole; capabilities: Capability[] }, boolean, string]
    >([
      [user("stationManager"), true, "stationManager can assign"],
      [user("dj", ["webmaster"]), true, "webmaster capability can assign"],
      [user("member", ["webmaster"]), true, "member with webmaster can assign"],
      [user("musicDirector"), false, "musicDirector alone cannot assign"],
      [user("dj"), false, "dj alone cannot assign"],
      [user("dj", ["editor"]), false, "editor capability cannot assign editor"],
    ])("given %j returns %s (%s)", (assigner, expected) => {
      expect(canAssignCapability(assigner, "editor")).toBe(expected);
    });
  });

  describe("assigning webmaster", () => {
    it.each<
      [{ role: WXYCRole; capabilities: Capability[] }, boolean, string]
    >([
      [user("stationManager"), true, "stationManager can assign"],
      [user("dj", ["webmaster"]), false, "webmaster cannot assign webmaster"],
      [user("musicDirector"), false, "musicDirector cannot assign"],
    ])("given %j returns %s (%s)", (assigner, expected) => {
      expect(canAssignCapability(assigner, "webmaster")).toBe(expected);
    });
  });

  describe("assigning reviews_beta", () => {
    it.each<
      [{ role: WXYCRole; capabilities: Capability[] }, boolean, string]
    >([
      [user("stationManager"), true, "stationManager can assign"],
      [user("musicDirector"), true, "musicDirector can assign"],
      [user("dj"), false, "dj cannot assign"],
      [user("member"), false, "member cannot assign"],
      [user("dj", ["webmaster"]), false, "webmaster cannot assign"],
      [
        user("dj", ["editor"]),
        false,
        "editor capability cannot assign",
      ],
      [user("dj", ["reviews_beta"]), false, "reviews_beta holder cannot assign"],
      [
        user("musicDirector", ["reviews_beta"]),
        true,
        "musicDirector assigns by role whatever it holds",
      ],
    ])("given %j returns %s (%s)", (assigner, expected) => {
      expect(canAssignCapability(assigner, "reviews_beta")).toBe(expected);
    });
  });
});
