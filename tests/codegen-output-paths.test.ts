import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Guards the fix for WXYC/wxyc-shared#197: the Swift/Kotlin codegen scripts
// used to write into sibling scratch dirs (`-o ../wxyc-ios-64-copy/...`,
// `-o ../WXYC-Android/shared/api`) that don't exist in a normal checkout.
// Every `generate:*` output must stay in-repo and gitignored so a maintainer
// running `npm run generate` updates a real, intended tree.

const pkg = JSON.parse(
  readFileSync(join(__dirname, "..", "package.json"), "utf-8"),
) as { scripts: Record<string, string> };

/** Pull the output path out of a generate script's CLI (`-o`/`-output`/`--output`). */
function outputPath(script: string): string | null {
  const m = script.match(/(?:-o|--?output)\s+(\S+)/);
  return m ? m[1] : null;
}

const generateScripts = Object.entries(pkg.scripts).filter(([name]) =>
  /^generate:/.test(name),
);

describe("codegen output paths (#197)", () => {
  it("has the four generate:* scripts", () => {
    expect(generateScripts.map(([n]) => n).sort()).toEqual([
      "generate:kotlin",
      "generate:python",
      "generate:swift",
      "generate:typescript",
    ]);
  });

  it.each(generateScripts)(
    "%s writes inside the repo (no `../`, no absolute path)",
    (_name, script) => {
      const out = outputPath(script);
      // generate:typescript has no -o flag (the node script writes src/generated
      // internally); nothing to assert for it.
      if (out === null) return;
      expect(out.startsWith("../"), `escapes repo: ${out}`).toBe(false);
      expect(out.startsWith("/"), `absolute path: ${out}`).toBe(false);
    },
  );

  it("targets the documented in-repo destinations", () => {
    expect(outputPath(pkg.scripts["generate:swift"])).toBe("generated/swift");
    expect(outputPath(pkg.scripts["generate:kotlin"])).toBe("generated/kotlin");
    expect(outputPath(pkg.scripts["generate:python"])).toBe(
      "generated/python/models.py",
    );
  });
});
