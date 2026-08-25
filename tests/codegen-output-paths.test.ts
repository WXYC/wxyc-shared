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

// Same precedent as #302 above, for the `generate:swift` row: it said
// "Nobody" / "wxyc-dj-ios, wxyc-ios-64 hand-author types mirroring api.yaml",
// which stopped being true once wxyc-ios-64 started vendoring this repo's
// generated Swift output directly (WXYC/wxyc-ios-64#598) rather than
// hand-authoring it — and WXYC/wxyc-shared#357 (CalendarDate) made the gap
// concrete by giving that vendored output a real behavioral consumer.
// wxyc-dj-ios vendors it too (WXYC/wxyc-dj-ios#75, PR #78 merged 2026-08-17),
// keeping a documented handful of DTOs hand-authored *beside* the vendored
// tree rather than instead of it — so the row must not describe either
// consumer as hand-authoring in place of vendoring.
describe("CLAUDE.md's codegen consumer table names the Swift consumer correctly (#357)", () => {
  const claudeMd = readFileSync(join(__dirname, "..", "CLAUDE.md"), "utf-8");

  /** The `| generate:swift | ... |` row of the "Output locations and consumers" table. */
  const swiftRow = () => {
    const row = claudeMd
      .split("\n")
      .find((line) => /^\|\s*`generate:swift`\s*\|/.test(line));
    expect(row, "generate:swift row missing from the consumer table").toBeDefined();
    return row as string;
  };

  it("names wxyc-ios-64 as a consumer of generated/swift/, not 'Nobody'", () => {
    expect(swiftRow()).toMatch(/wxyc-ios-64/);
    expect(swiftRow()).not.toMatch(/\|\s*Nobody\s*\|/);
  });

  it("names wxyc-dj-ios as a consumer too, not just wxyc-ios-64", () => {
    // Both Swift consumers vendor this output. An earlier version of this row
    // named only ios-64 and cast dj-ios as still-hand-authoring-until-#79,
    // which was already false when written: dj-ios's own vendored tree
    // (Packages/WXYCAPIModels/, ~262 files) merged 2026-08-17.
    expect(swiftRow()).toMatch(/wxyc-dj-ios/);
  });

  it("attributes hand-authoring to dj-ios only, never to wxyc-ios-64", () => {
    // The invariant is about ATTRIBUTION, not sentence order, so assert it
    // per sentence rather than by slicing the cell at a `;`. That earlier
    // heuristic (`whereFrom.split(";")[0]`) encoded one particular phrasing:
    // rewriting the cell without a semicolon silently widened the slice to
    // the whole cell and failed on dj-ios's own — correct — hand-author
    // mention. A guard that breaks when the prose it guards is improved is
    // measuring the prose, not the claim.
    const cells = swiftRow().split("|").map((c) => c.trim());
    const whereFrom = cells[4];
    expect(whereFrom, "unexpected table cell layout").toMatch(/wxyc-ios-64/);
    const handAuthorSentences = whereFrom
      .split(/(?<=\.)\s+/)
      .filter((sentence) => /hand-author/.test(sentence));
    for (const sentence of handAuthorSentences) {
      expect(sentence, "hand-authoring must not be attributed to wxyc-ios-64").not.toMatch(
        /wxyc-ios-64/,
      );
    }
  });
});

// #357's other two now-false claims, both about Swift specifically (Python's
// equivalent claims are pinned by the #302 describe block above).
describe("CLAUDE.md no longer claims Swift codegen changes reach no consumer (#357)", () => {
  const claudeMd = readFileSync(join(__dirname, "..", "CLAUDE.md"), "utf-8");

  it("does not claim editing codegen flags changes nothing for a Swift consumer", () => {
    // The literal sentence #357 called out: wxyc-ios-64 vendors generate:swift's
    // output directly, so editing this repo's Swift codegen flags is a real
    // change for that repo, not a no-op.
    expect(claudeMd).not.toMatch(
      /changes nothing for any Python, Swift,? (?:and|or) Kotlin consumer/,
    );
  });

  it("does not claim the hand-authored Swift types all live in the consumer repo", () => {
    // The closing paragraph used to say this unconditionally; wxyc-ios-64 is
    // the exception (it vendors generated output), so an unqualified version
    // of this claim is false again.
    expect(claudeMd).not.toMatch(
      /For Swift\/Kotlin the hand-authored types live in the consumer repo/,
    );
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

// #316: the identical defect on LookupResponse.api_version / .identity — LML
// never sets either field (not even when `include_identity: true`), and
// serves `/lookup` without `response_model_exclude_none`, so both ship
// `null` on every response today.
//
// `api_version` is a scalar enum, so `nullable: true` on the property is
// enough — openapi-typescript renders it right there as `2 | null`.
//
// `identity` took a different shape. It stayed a bare `$ref` (OpenAPI 3.0
// ignores sibling keys — including `nullable: true` — written next to a
// bare `$ref`, so that alone would have done nothing); nullability instead
// lives on the *referenced* `LookupIdentityBlock` schema itself. An
// `allOf`-wrapped nullable ref was tried first and rejected: it made oasdiff
// report a spurious `response-required-property-removed` on
// `identity/resolved` (`LookupIdentityBlock.required` is untouched — the
// finding doesn't correspond to any real change on the wire), on top of the
// `identity`-became-nullable finding the ticket already expected. Marking
// the schema nullable instead makes `null` reachable through the *type
// alias* rather than at the property: `identity?:
// components["schemas"]["LookupIdentityBlock"];` (no `| null` on this
// line), with the `| null` living on `LookupIdentityBlock` itself. Both
// shapes are equivalent for a TypeScript consumer — `null` is reachable
// either way — but only one of the two produces exactly the two expected
// oasdiff findings, so this pins the actual emitted shape rather than the
// originally-planned one.
describe("generated LookupResponse markers stay optional and nullable (#316)", () => {
  const responseBlock = () => schemaBlock("LookupResponse");

  it("emits api_version as optional and nullable, nullable right on the property", () => {
    expect(responseBlock()).toMatch(/\bapi_version\?: 2 \| null;/);
  });

  it("emits identity as optional, referencing the LookupIdentityBlock type alias (no `| null` at the property)", () => {
    expect(responseBlock()).toMatch(
      /\bidentity\?: components\["schemas"\]\["LookupIdentityBlock"\];/,
    );
  });

  it("keeps results required", () => {
    // Guards the assertions above against passing for the wrong reason —
    // e.g. a regex that matches because the whole block vanished.
    expect(responseBlock()).toMatch(/\n\s+results: /);
  });

  it("makes null reachable through the LookupIdentityBlock type alias itself", () => {
    const start = dts.indexOf("LookupIdentityBlock: {");
    expect(start, "LookupIdentityBlock missing from generated types").toBeGreaterThan(-1);
    const closeIdx = dts.indexOf("} | null;", start);
    expect(
      closeIdx,
      "LookupIdentityBlock's closing brace is not followed by `| null;` — nullability was lost",
    ).toBeGreaterThan(-1);
    const block = dts.slice(start, closeIdx + "} | null;".length);
    // Guards against the slice picking up some other `} | null;` far away in
    // the file — the resolved property must still be inside it.
    expect(block).toMatch(/\bresolved: components\["schemas"\]\["IdentityResolution"\]\[\];/);
  });
});
