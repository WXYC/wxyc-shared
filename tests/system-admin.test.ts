import { describe, it, expect } from "vitest";
import { isSystemAdmin } from "../src/auth-client/auth.js";

describe("isSystemAdmin", () => {
  const cases: [{ role?: string | null }, boolean, string][] = [
    [{ role: "admin" }, true, "admin user"],
    [{ role: "user" }, false, "regular user"],
    [{ role: "stationManager" }, false, "station manager is not system admin"],
    [{ role: null }, false, "null role"],
    [{ role: undefined }, false, "undefined role"],
  ];

  it.each(cases)("given %j returns %s (%s)", (user, expected) => {
    expect(isSystemAdmin(user)).toBe(expected);
  });
});
