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

// `generated/python/` is gitignored and imported by nothing, here or anywhere
// in the org: both Python consumers run their own copy of
// `scripts/generate_api_models.sh` against `api.yaml` and commit
// `generated/api_models.py` in their own repo. CLAUDE.md's consumer table said
// otherwise, which is how #302 nearly landed a `--strict-nullable` fix in
// `package.json` alone and changed nothing for either consumer.
describe("CLAUDE.md's codegen consumer table (#302)", () => {
  const claudeMd = readFileSync(join(__dirname, "..", "CLAUDE.md"), "utf-8");

  /** The `| generate:python | ... |` row of the "Output locations and consumers" table. */
  const pythonRow = () => {
    const row = claudeMd
      .split("\n")
      .find((line) => /^\|\s*`generate:python`\s*\|/.test(line));
    expect(row, "generate:python row missing from the consumer table").toBeDefined();
    return row as string;
  };

  it("does not name either Python service as a consumer of generated/python/", () => {
    // The fact, not a phrasing: whatever the row says, it must not send a
    // reader to change this repo's output expecting a consumer to see it.
    expect(pythonRow()).not.toMatch(/request-o-matic|library-metadata-lookup/);
  });

  it("points at the script the Python consumers actually run", () => {
    // A reader who learns the table row is empty still needs to know where
    // Python models do come from, or the correction just relocates the
    // confusion.
    expect(claudeMd).toContain("scripts/generate_api_models.sh");
  });
});

// The same claim lived in README.md's Contributing checklist, where a
// contributor is more likely to meet it than in CLAUDE.md's reference table —
// and a guard that reads only CLAUDE.md leaves the more-trafficked copy
// unguarded. Both files are checked here for the same reason: the belief that
// `generate:python` feeds a consumer is what scoped #302 wrong, and it does not
// matter which document plants it.
describe("no doc claims generate:python feeds a consumer (#302, #304)", () => {
  const docs = ["CLAUDE.md", "README.md"] as const;

  it.each(docs)("%s does not tell the reader to regenerate for a Python service", (doc) => {
    const text = readFileSync(join(__dirname, "..", doc), "utf-8");
    // Pin the misleading *instruction*, not co-occurrence. Naming the two
    // services near `generate:python` is fine and in fact necessary — the
    // corrected CLAUDE.md paragraph does exactly that to explain where the
    // models really come from. (This repo writes each paragraph as one long
    // line, so a co-occurrence filter flags whole explanatory paragraphs.)
    // What must not survive is a sentence telling the reader that running this
    // script updates models a Python service uses.
    const claimsItFeedsAConsumer = [
      /Python services consume/i,
      /generate:python`?\s*(?:\S+\s+){0,6}?to update the generated Python models/i,
    ];
    const offending = text
      .split("\n")
      .filter((line) => claimsItFeedsAConsumer.some((re) => re.test(line)));
    expect(offending, `${doc} still ties generate:python to a consumer`).toEqual([]);
  });
});

// Shared by both `.d.ts`-reading guards below (#297 and #303): each pins a
// different generated interface within the same 323KB generated file, and
// each slices out one top-level interface block the same way. Read the file
// once, and share the slicing logic, rather than each describe re-reading
// the whole file and re-implementing the same `indexOf`/`slice` pair.
const dts = readFileSync(
  join(__dirname, "..", "src", "generated", "openapi-types.d.ts"),
  "utf-8",
);

/** Slice one top-level interface block (e.g. `BulkResolveLibrariesRequest: { ... };`) out of the generated `.d.ts`. */
function schemaBlock(name: string): string {
  const start = dts.indexOf(`${name}: {`);
  expect(start, `${name} missing from generated types`).toBeGreaterThan(-1);
  return dts.slice(start, dts.indexOf("\n        };", start));
}

// A property carrying an OpenAPI `default` is emitted non-optional by
// openapi-typescript (its `defaultNonNullable` option, on by default) even when
// the property is absent from `required`. That reasoning holds for a response —
// the server fills the default in — and is wrong for a request body the client
// constructs. `include_tracks` shipped briefly with `default: false` and
// generated as `include_tracks: boolean`, which made `{ inputs }` a compile
// error in every TS consumer, for the one field whose contract is "omitted is
// the default". The spec-level guard lives in api-spec.test.ts; this one pins
// the artifact that consumers actually import, because the spec assertion alone
// cannot see what the generator did with it.
describe("generated request types stay constructible (#297)", () => {
  const requestBlock = () => schemaBlock("BulkResolveLibrariesRequest");

  it("emits include_tracks as optional", () => {
    expect(requestBlock()).toMatch(/\binclude_tracks\?:/);
  });

  it("keeps inputs required", () => {
    // Guards the assertion above against passing for the wrong reason — e.g. a
    // regex that matches because the whole block vanished.
    expect(requestBlock()).toMatch(/\n\s+inputs: /);
  });
});

// Same trap, same guard, for the #303 response-side marker. `include_tracks`
// was bitten by `default: false` forcing a non-optional emit despite being
// absent from `required`; `tracks_contract_version` carries the identical
// risk because its whole job is to be distinguishably *absent* for a
// producer that predates it. api.yaml deliberately gives it no schema-level
// `default` (mirroring `LookupResponse.api_version`'s precedent) — this pins
// the artifact consumers actually import, because the spec-level assertion
// in api-spec.test.ts cannot see what the generator did with it.
//
// #310 added `nullable: true` on top of that (LML ships
// `"tracks_contract_version": null` on every response, and `null` is not a
// valid instance of `enum: [1]` without it) — openapi-typescript renders
// that as a `| null` union member alongside the optional marker, so the
// full emitted type is `tracks_contract_version?: 1 | null;`, not just
// `tracks_contract_version?: 1;`. Pinning the wider pattern would pass
// whether or not the `| null` half is actually there, silently losing the
// #310 regression guard.
describe("generated tracks_contract_version marker stays optional and nullable (#303, #310)", () => {
  const responseBlock = () => schemaBlock("BulkResolveLibrariesResponse");

  it("emits tracks_contract_version as optional and nullable", () => {
    expect(responseBlock()).toMatch(/\btracks_contract_version\?: 1 \| null;/);
  });

  it("keeps results required", () => {
    // Guards the assertion above against passing for the wrong reason — e.g.
    // a regex that matches because the whole block vanished.
    expect(responseBlock()).toMatch(/\n\s+results: /);
  });
});
