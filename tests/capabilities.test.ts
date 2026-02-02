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
  it.each(["editor", "webmaster"])("includes %s capability", (capability) => {
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
  it("allows admin and stationManager to assign editor", () => {
    expect(CAPABILITY_ASSIGNERS.editor.roles).toContain("admin");
    expect(CAPABILITY_ASSIGNERS.editor.roles).toContain("stationManager");
  });

  it("allows webmaster capability to assign editor", () => {
    expect(CAPABILITY_ASSIGNERS.editor.capabilities).toContain("webmaster");
  });

  it("allows admin and stationManager to assign webmaster", () => {
    expect(CAPABILITY_ASSIGNERS.webmaster.roles).toContain("admin");
    expect(CAPABILITY_ASSIGNERS.webmaster.roles).toContain("stationManager");
  });

  it("does not allow any capability to assign webmaster", () => {
    expect(CAPABILITY_ASSIGNERS.webmaster.capabilities).toHaveLength(0);
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
      [user("admin"), true, "admin can assign"],
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
      [user("admin"), true, "admin can assign"],
      [user("stationManager"), true, "stationManager can assign"],
      [user("dj", ["webmaster"]), false, "webmaster cannot assign webmaster"],
      [user("musicDirector"), false, "musicDirector cannot assign"],
    ])("given %j returns %s (%s)", (assigner, expected) => {
      expect(canAssignCapability(assigner, "webmaster")).toBe(expected);
    });
  });
});
