import { describe, it, expect } from "vitest";
import {
  hasCapability,
  canEditWebsite,
  canAssignCapability,
  CAPABILITIES,
  CAPABILITY_ASSIGNERS,
  CAPABILITY_LABELS,
  type Capability,
} from "../src/auth-client/capabilities.js";
import type { WXYCRole } from "../src/auth-client/roles.js";

describe("CAPABILITIES", () => {
  it.each(["editor", "webmaster", "reviews_beta", "archive_admin"])("includes %s capability", (capability) => {
    expect(CAPABILITIES).toContain(capability);
  });
});

describe("CAPABILITY_LABELS", () => {
  it.each(CAPABILITIES)("has a label for %s", (capability) => {
    expect(CAPABILITY_LABELS[capability]).toBeTruthy();
  });

  it.each<[Capability, string]>([
    ["editor", "Editor"],
    ["webmaster", "Webmaster"],
    ["reviews_beta", "Reviews beta"],
    ["archive_admin", "Archive admin"],
  ])("labels %s as %s", (capability, label) => {
    expect(CAPABILITY_LABELS[capability]).toBe(label);
  });

  it("labels nothing outside CAPABILITIES and never says Supervisor", () => {
    expect(Object.keys(CAPABILITY_LABELS).sort()).toEqual([...CAPABILITIES].sort());
    for (const label of Object.values(CAPABILITY_LABELS)) {
      expect(label).not.toMatch(/supervisor/i);
    }
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

  it("allows only stationManager to assign reviews_beta by role", () => {
    expect(CAPABILITY_ASSIGNERS.reviews_beta.roles).toEqual(["stationManager"]);
  });

  it("does not allow any capability to assign reviews_beta", () => {
    expect(CAPABILITY_ASSIGNERS.reviews_beta.capabilities).toHaveLength(0);
  });

  it("allows only stationManager to assign archive_admin by role", () => {
    expect(CAPABILITY_ASSIGNERS.archive_admin.roles).toEqual(["stationManager"]);
  });

  it("does not allow any capability to assign archive_admin", () => {
    expect(CAPABILITY_ASSIGNERS.archive_admin.capabilities).toHaveLength(0);
  });

  it.each(CAPABILITIES)("has an assigner row for %s", (capability) => {
    expect(CAPABILITY_ASSIGNERS[capability]).toBeDefined();
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
      [user("musicDirector"), false, "musicDirector cannot assign"],
      [user("dj"), false, "dj cannot assign"],
      [user("member"), false, "member cannot assign"],
      [user("dj", ["webmaster"]), false, "webmaster cannot assign"],
      [
        user("musicDirector", ["webmaster"]),
        false,
        "musicDirector with webmaster cannot assign",
      ],
      [user("dj", ["reviews_beta"]), false, "reviews_beta holder cannot assign"],
      [
        user("musicDirector", ["reviews_beta"]),
        false,
        "musicDirector with reviews_beta cannot assign",
      ],
    ])("given %j returns %s (%s)", (assigner, expected) => {
      expect(canAssignCapability(assigner, "reviews_beta")).toBe(expected);
    });
  });

  describe("assigning archive_admin", () => {
    it.each<
      [{ role: WXYCRole; capabilities: Capability[] }, boolean, string]
    >([
      [user("stationManager"), true, "stationManager can assign"],
      [user("musicDirector"), false, "musicDirector cannot assign"],
      [user("dj"), false, "dj cannot assign"],
      [user("member"), false, "member cannot assign"],
      [user("dj", ["webmaster"]), false, "webmaster cannot assign"],
      [user("musicDirector", ["webmaster"]), false, "musicDirector with webmaster cannot assign"],
      [user("dj", ["archive_admin"]), false, "archive_admin holder cannot assign"],
      [user("musicDirector", ["archive_admin"]), false, "musicDirector with archive_admin cannot assign"],
    ])("given %j returns %s (%s)", (assigner, expected) => {
      expect(canAssignCapability(assigner, "archive_admin")).toBe(expected);
    });
  });
});
