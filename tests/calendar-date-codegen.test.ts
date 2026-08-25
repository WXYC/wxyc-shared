/**
 * Guards WXYC/wxyc-shared#357: the Swift codegen fix for #351 (Swift decoded
 * `format: date` as `Foundation.Date`, an absolute instant, which decoded a
 * day early for any client west of UTC and re-encoded as a date-time instead
 * of round-tripping the bare `YYYY-MM-DD` wire string).
 *
 * This repo's CI never runs `generate:swift` (no Java step) or `generate:kotlin`
 * — see the "Output locations and consumers" section of CLAUDE.md — so
 * nothing here actually exercises the generator. These tests instead pin the
 * static wiring a maintainer would otherwise have to re-derive by reading
 * three separate files: the support file exists, swift6.yaml's typeMappings
 * points at it, package.json declares the postgenerate:swift hook that
 * copies it in, and -- the one piece a plain existence check can't catch,
 * per the ticket -- that hook's destination path is *derived* from
 * swift6.yaml's own projectName/useSPMFileStructure rather than a hardcoded
 * twin, so a future projectName rename can't silently desync it.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import {
  deriveModelsRoot,
  loadSwift6Config,
} from "../scripts/copy-swift-support-files.js";

const repoRoot = join(__dirname, "..");

describe("CalendarDate support file (#357)", () => {
  it("exists at openapi-config/swift-support/CalendarDate.swift", () => {
    const path = join(repoRoot, "openapi-config", "swift-support", "CalendarDate.swift");
    expect(existsSync(path), `missing ${path}`).toBe(true);
  });

  it("is Codable via singleValueContainer, Comparable, Sendable, Hashable, and CustomStringConvertible", () => {
    const source = readFileSync(
      join(repoRoot, "openapi-config", "swift-support", "CalendarDate.swift"),
      "utf-8",
    );
    expect(source).toMatch(/struct CalendarDate:\s*Sendable,\s*Hashable/);
    expect(source).toContain("extension CalendarDate: Comparable");
    expect(source).toContain("extension CalendarDate: CustomStringConvertible");
    expect(source).toContain("extension CalendarDate: Codable");
    expect(source).toContain("decoder.singleValueContainer()");
    expect(source).toContain("encoder.singleValueContainer()");
  });

  it("bounds the year to 0...9999, so every constructible value can be written on the wire", () => {
    // The type's whole purpose is that a CalendarDate and its YYYY-MM-DD wire
    // string are the same value. `description` renders with %04d and `parse`
    // demands exactly 10 UTF-8 bytes of digits in fixed positions, so a year
    // outside 0...9999 encodes to something this type's own decoder rejects
    // (10000-01-01 is 11 bytes; -005-01-01 is 10 but leads with 0x2D). The
    // public component initializer validated month and day but originally not
    // year, which made such a value constructible. The behavioral proof lives
    // in wxyc-ios-64's suite (#941); this is the guard that reddens *this*
    // repo's CI if the bound is ever dropped, since nothing here compiles Swift
    // beyond the typecheck step.
    const source = readFileSync(
      join(repoRoot, "openapi-config", "swift-support", "CalendarDate.swift"),
      "utf-8",
    );
    expect(source).toMatch(/\(0\.\.\.9999\)\.contains\(year\)/);
  });

  it("never uses DateFormatter/ISO8601DateFormatter/Calendar on the init(from:) decode path", () => {
    const source = readFileSync(
      join(repoRoot, "openapi-config", "swift-support", "CalendarDate.swift"),
      "utf-8",
    );
    const decodeStart = source.indexOf("public init(from decoder");
    expect(decodeStart, "init(from:) not found").toBeGreaterThan(-1);
    const decodeEnd = source.indexOf("\n    }", decodeStart);
    const decodeBody = source.slice(decodeStart, decodeEnd);
    // The decode path calls Self.parse(raw); assert that helper itself
    // (which does the actual scanning) never reaches for the banned APIs.
    // `Calendar\(` (a construction/call), not a bare "Calendar" substring --
    // `CalendarDate`/`CalendarDateError` legitimately contain that substring.
    const usesBannedAPI = /DateFormatter|ISO8601DateFormatter|Calendar\(/;
    expect(decodeBody).not.toMatch(usesBannedAPI);

    const parseStart = source.indexOf("static func parse(");
    expect(parseStart, "parse(_:) not found").toBeGreaterThan(-1);
    const parseEnd = source.indexOf("\n    }", parseStart);
    const parseBody = source.slice(parseStart, parseEnd);
    expect(parseBody).not.toMatch(usesBannedAPI);
  });
});

describe("swift6.yaml typeMappings (#357)", () => {
  const config = loadSwift6Config(repoRoot);

  it("maps format: date to CalendarDate", () => {
    expect(config.typeMappings).toBeDefined();
    expect(config.typeMappings.date).toBe("CalendarDate");
  });

  it("does not remap date-time (Foundation.Date stays correct for true instants)", () => {
    // The generator keys typeMappings on its OWN internal type names, and for
    // instants that name is `DateTime` -- NOT the OpenAPI spelling `date-time`.
    // Asserting only the `date-time` key is vacuous: the generator ignores that
    // key entirely, so the assertion passes through the very regression it
    // names. Measured, not reasoned: adding `DateTime: ProbeDateTime` to
    // swift6.yaml and regenerating retypes 44 model files and takes the
    // surviving `Date` property declarations from 67 to 0, while
    // `typeMappings["date-time"]` stays undefined throughout.
    //
    // `DateTime` is therefore the load-bearing assertion. The `date-time` line
    // stays as a cheap guard against someone adding the key under the
    // plausible-but-inert spelling and believing they had changed something.
    expect(config.typeMappings.DateTime).toBeUndefined();
    expect(config.typeMappings["date-time"]).toBeUndefined();
  });
});

describe("package.json postgenerate:swift hook (#357)", () => {
  const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8")) as {
    scripts: Record<string, string>;
  };

  it("declares postgenerate:swift", () => {
    expect(pkg.scripts["postgenerate:swift"]).toBeDefined();
  });

  it("postgenerate:swift runs the support-file copy script", () => {
    // npm runs `post<script>` hooks automatically -- this just has to exist
    // and point at the right file for that to fire after generate:swift.
    expect(pkg.scripts["postgenerate:swift"]).toContain("copy-swift-support-files.js");
  });
});

describe("postgenerate:swift destination is derived, not a hardcoded twin (#357)", () => {
  it("derives Sources/<projectName>/ under useSPMFileStructure: true", () => {
    const destination = deriveModelsRoot({ projectName: "WXYCAPI", useSPMFileStructure: true });
    expect(destination).toBe(join("generated", "swift", "Sources", "WXYCAPI"));
  });

  it("tracks a different projectName rather than a fixed 'WXYCAPI' literal", () => {
    // The regression this guards: a hardcoded destination string wouldn't
    // move when projectName does, and this repo's CI never runs
    // generate:swift to notice the resulting compile failure downstream.
    const destination = deriveModelsRoot({
      projectName: "SomeRenamedProject",
      useSPMFileStructure: true,
    });
    expect(destination).toBe(join("generated", "swift", "Sources", "SomeRenamedProject"));
    expect(destination).not.toContain("WXYCAPI");
  });

  it("falls back to <projectName>/Classes/OpenAPIs/ when useSPMFileStructure is false", () => {
    // Measured against the real generator, not inferred: running it with
    // `useSPMFileStructure: false` emits `WXYCAPI/Classes/OpenAPIs/Models/...`,
    // i.e. the projectName segment is present in BOTH layouts. An earlier
    // version of this branch returned `generated/swift/Classes/OpenAPIs` and
    // this test certified it -- so the one branch that exists purely to
    // survive a silent flag flip was itself the silent desync, copying the
    // support file outside the emitted package and producing exactly the
    // "cannot find type 'CalendarDate' in scope" it was written to prevent.
    const destination = deriveModelsRoot({ projectName: "WXYCAPI", useSPMFileStructure: false });
    expect(destination).toBe(join("generated", "swift", "WXYCAPI", "Classes", "OpenAPIs"));
  });

  it("throws rather than silently emitting a bad path when projectName is missing", () => {
    expect(() => deriveModelsRoot({ useSPMFileStructure: true })).toThrow(/projectName/);
  });

  it("the live swift6.yaml's own projectName flows through the same derivation used at generate time", () => {
    const config = loadSwift6Config(repoRoot);
    const destination = deriveModelsRoot(config);
    expect(destination.endsWith(join("Sources", config.projectName))).toBe(true);
  });
});
