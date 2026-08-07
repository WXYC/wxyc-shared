# WXYC Shared Library

This is the shared library for WXYC services, published to GitHub Packages as `@wxyc/shared`.

## Tag Stability Policy (READ BEFORE EDITING `.github/workflows/`)

This repo publishes a reusable GitHub Actions workflow that other WXYC repos consume by tag:

- `check-charset-corpus-drift.yml` — consumed as `WXYC/wxyc-shared/.github/workflows/check-charset-corpus-drift.yml@gha/v1`

`gha/v1` is a **moving major tag**. It points at the latest commit on `main` that is non-breaking for the v1 contract. Consumers pin to `@gha/v1` to opt into compatible improvements; they pin to a SHA only if they want frozen behavior.

### Before changing any reusable workflow, decide: is this breaking?

A change is **breaking** if it does any of the following to a `workflow_call`-enabled file:

1. Adds a new required `inputs:` entry, or removes/renames an existing input.
2. Adds a new required `secrets:` entry, or removes/renames an existing secret.
3. Removes or renames an `outputs:` entry.
4. Changes the default value of an existing input in a way a consumer could depend on.
5. Changes observable behavior consumers rely on — e.g. the job no longer fails on a condition it previously failed on, the runner OS major version bumps, a step that produced an artifact stops producing it.

Anything else is **non-breaking**: bugfixes, perf work, internal refactors, *additive* optional inputs/outputs/secrets, dependency bumps that don't change observable behavior.

### The bump procedure

**Non-breaking change** — re-point `gha/v1` at the new commit after merge:

```bash
git fetch origin
git tag -f gha/v1 origin/main
git push --force origin gha/v1
```

**Breaking change** — *do not move `gha/v1`*. Cut `gha/v2` instead:

```bash
git tag -a gha/v2 -m "v2: <one-line summary of what broke>" origin/main
git push origin gha/v2
```

Then file a migration ticket in every consumer repo that pins `@gha/v1` for this workflow. Search the org with `gh search code 'WXYC/wxyc-shared/.github/workflows/<file>.yml@gha/v1'` to find them.

### Why this matters

Force-pushing `gha/v1` past a breaking change silently breaks every consumer's CI the next time their workflow fires. Consumers have no signal — the `@gha/v1` ref is the same string they had yesterday. The cost of cutting `gha/v2` is one tag and one round of consumer PRs; the cost of breaking `gha/v1` is debugging in a dozen repos at once.

### Caller permissions contract

Callers of `check-charset-corpus-drift.yml` must grant at minimum:

```yaml
permissions:
  contents: read
  packages: read   # `npm pack @wxyc/shared` authenticates to npm.pkg.github.com via the caller's GITHUB_TOKEN, forwarded as the `npm-token` secret
```

Granting less makes the `npm pack` step fail with an opaque 401 — the workflow does fail (not startup_failure), but `--silent` suppresses the error message and a reader of the caller's `permissions:` block won't see why.

**Both sides must declare every forwarded scope.** Reusable-workflow permissions intersect (caller ∩ callee) at job dispatch, and the intersection also governs the GITHUB_TOKEN the caller forwards into `secrets.npm-token`. Concretely: if the callee declares only `contents: read`, the forwarded token gets narrowed to `contents: read` regardless of what the caller granted — `npm pack` will 401. This file therefore declares `permissions: contents: read + packages: read` at workflow level even though no step in this file uses `packages: read` directly; it's there so the caller's grant can survive the intersection. The 2026-05-12 → 2026-05-14 org-wide drift outage (commit `a90dc3a` first added the narrow `permissions: contents: read` block; PR fixing it added `packages: read` back) is the receipt.

**Escalating the required caller permissions is itself a breaking change** (rule 5 above — observable behavior). If a revision of this workflow needs another scope from the caller (e.g., `id-token: write` for OIDC), cut `gha/v2` and migrate consumers. The asymmetry matters: dropping a required scope is non-breaking; adding one breaks every caller that hardened to the previous floor.

Watch for the **caller-callee narrowing trap** when changing the workflow's own `permissions:` block: if a reusable workflow declares `contents: write` at the workflow level (e.g., to push tags) but its callers hardened to `contents: read`, the matrix run startup_failures with no jobs and no obvious error. See [WXYC/Backend-Service#857](https://github.com/WXYC/Backend-Service/issues/857) (silent for 10 commits across 2 days) and PR [#858](https://github.com/WXYC/Backend-Service/pull/858) for the recovery pattern. `check-charset-corpus-drift.yml` is read-only today, so it can't trip this — but the trap applies to any future revision that takes a write scope, and a `gha/v2` migration is the safest way to surface it.

## Architecture

This package provides:
- **DTOs** (`@wxyc/shared/dtos`) - Generated from OpenAPI spec (`api.yaml`)
- **Auto-DJ** (`@wxyc/shared/auto-dj`) - Auto-DJ type contracts: the orchestrator <-> Arduino management-channel messages + virtual switch API, plus a discriminated-union type and type guards
- **Auth Client** (`@wxyc/shared/auth-client`) - Better Auth client with role/capability system
- **Validation** (`@wxyc/shared/validation`) - Shared validation utilities
- **Test Utilities** (`@wxyc/shared/test-utils`) - Fixtures and factories for testing

## Key Files

- `api.yaml` - OpenAPI 3.0 spec, single source of truth for API types
- `tsup.config.ts` - Build configuration with multiple entry points
- `src/auth-client/` - Authorization system with roles, capabilities, and branded types

## Authorization Model

The auth system has two dimensions:
1. **Roles** (hierarchical): member < dj < musicDirector < stationManager
2. **Capabilities** (cross-cutting): `editor`, `webmaster` - can be granted to any user

Use `Authorization` enum for numeric comparisons, branded types (`RoleAuthorizedUser`, `CapabilityAuthorizedUser`) for compile-time enforcement.

## Publishing

Published to GitHub Packages on version tags:
```bash
npm version patch|minor|major
git push origin main --tags
```

The `.github/workflows/publish.yml` workflow handles the rest.

## Code Generation

DTOs are generated from `api.yaml`. TypeScript uses `openapi-typescript` (pure Node.js); Swift and Kotlin use the Java-based `openapi-generator-cli`; Python uses `datamodel-code-generator` via a standalone script rather than an npm one-liner (see below):
```bash
npm run generate:typescript  # TypeScript types (openapi-typescript, no JVM)  -> src/generated/
npm run generate:python      # Python pydantic models (datamodel-codegen)     -> generated/python/
npm run generate:swift       # Swift types (openapi-generator-cli, requires Java)  -> generated/swift/
npm run generate:kotlin      # Kotlin types (openapi-generator-cli, requires Java) -> generated/kotlin/
```

The TypeScript codegen script (`scripts/generate-models.js`) produces:
- `src/generated/openapi-types.d.ts` -- raw openapi-typescript output
- `src/generated/models/index.ts` -- re-export layer with const objects for enums

All four output trees are **in-repo and gitignored** (`src/generated/`, `generated/`) — they're regenerated artifacts, never committed here.

### Output locations and consumers

**Only `generate:typescript` produces output anyone consumes.** It ships the DTOs in the published package. The other three are local reference trees: a maintainer regenerates one and diffs it against a consumer's hand-written or independently-generated types. Editing this repo's codegen flags therefore changes nothing for any Python, Swift, or Kotlin consumer — the "Who'd notice a change here" column is the one to read before assuming otherwise.

| Script | Output (gitignored) | Who'd notice a change here | Where those types actually come from |
|---|---|---|---|
| `generate:typescript` | `src/generated/` | **Backend-Service, dj-site** | Imported from the published `@wxyc/shared/dtos` |
| `generate:python` | `generated/python/` | Nobody yet | Canonical script now lives here (`scripts/generate-python-models.sh`, #107); both Python services still run their own unmigrated local copy (see below) until each ships its own migration PR |
| `generate:swift` | `generated/swift/` | Nobody | wxyc-dj-ios, wxyc-ios-64 hand-author types mirroring `api.yaml` |
| `generate:kotlin` | `generated/kotlin/` | Nobody | WXYC-Android hand-authors types mirroring `api.yaml` |

**Where the Python models really come from, and where that's headed.** As of #107, the canonical Python codegen script is `scripts/generate-python-models.sh` in this repo, living next to `api.yaml`. That colocation solves only half of what its two predecessors had to do: those scripts lived in the *consumer* repo and had to go find the spec elsewhere (a sibling wxyc-shared checkout, worktree-aware via `git rev-parse --git-common-dir`, or a GitHub download), while this one already has the spec next door. It does **not** solve the other half — locating *this script* from a consumer repo — and the org's global CLAUDE.md requiring a worktree for all new development makes that the normal case, not an edge case: a caller's cwd is typically `<repo>/.worktrees/<branch>`, and a plain `../wxyc-shared` from there resolves to `<repo>/.worktrees/wxyc-shared`, which doesn't exist. It takes `--input`/`--output` flags, defaults to this repo's own `api.yaml` -> `generated/python/models.py`, and downloads from `raw.githubusercontent.com` only in the fallback case of being invoked without a local `api.yaml` at all. **Today, both Python services still run their own pre-#107 copy** — `scripts/generate_api_models.sh` in [library-metadata-lookup](https://github.com/WXYC/library-metadata-lookup/blob/main/scripts/generate_api_models.sh) and [request-o-matic](https://github.com/WXYC/request-o-matic/blob/main/scripts/generate_api_models.sh) — and commit the result as `generated/api_models.py` in their own repo; migrating each one onto the shared script is separate, per-repo follow-up work (their own PR, their own review), not part of #107's change here. Once a consumer migrates, the worktree-safe invocation is:

```bash
WXYC_SHARED="$(dirname "$(git rev-parse --git-common-dir)")/../wxyc-shared"
bash "$WXYC_SHARED/scripts/generate-python-models.sh" --output generated/api_models.py
```

run from anywhere inside the consumer's own checkout, worktree or not — `git rev-parse --git-common-dir` reports the consumer's main repo root even from inside a linked worktree, so `../wxyc-shared` resolves relative to *that*, not to cwd (verified byte-identical against LML's current output, modulo the regenerate-with header line, when run this way — `ruff format` picks up the *consumer's* `pyproject.toml` line-length because the output path lives inside their tree).

The `datamodel-code-generator` version pin — previously three-way drifted (LML `datamodel-code-generator[http]==0.56.1`, request-o-matic `datamodel-code-generator==0.57.0`, this repo unpinned) — now lives in exactly one place: `DATAMODEL_CODEGEN_PIN` inside `scripts/generate-python-models.sh`, currently `datamodel-code-generator[http]==0.56.1`. When `uv` is available the script runs that exact version on a pinned interpreter (`uvx --python 3.12`), ignoring whatever else is on PATH or in a local venv. That is **not** a full lockfile, though: black, isort, and pydantic are pulled in transitively and left to float, and 0.56.1 still formats via black+isort by default (it emits a `FutureWarning` saying so) — a transitive release that changes formatting output can still produce a different diff on two machines that both honor this pin. "The generator version and interpreter are pinned" is the accurate claim; "output is guaranteed byte-identical everywhere" is not one this script makes. Without `uv` it falls back to a local `.venv`/PATH-resolved `datamodel-codegen` (resolved against the *caller's* cwd, matching the old scripts' resolution order — not against this repo's own checkout, which would never find a consumer's venv) and warns, without failing, if that binary's version doesn't match the pin. **This is why #107 was sequenced ahead of #302** (`--strict-nullable`): with three invocations there were three places to add the flag and three places for it to drift further; with one, it's one edit. request-o-matic's own pin (0.57.0) does not automatically become 0.56.1 by this repo's script existing — reconciling it is part of that consumer's migration PR, not something this repo can do on request-o-matic's behalf.

For Swift/Kotlin the hand-authored types live in the consumer repo (e.g. `wxyc-dj-ios`'s `Packages/WXYCAPI/Sources/WXYCAPI/DTOs/`). (`library-scanner`, formerly a Swift consumer, is now an archived/read-only repo.)

Migrating each consumer onto the generated output is tracked separately, blocked by this output-path fix (#197): WXYC/wxyc-dj-ios#75, WXYC/WXYC-Android#25, WXYC/wxyc-ios-64#412 — all sub-issues of the codegen umbrella #106. Once a consumer migrates, its `-o` path (or its own build step) should point at wherever that repo checks the generated client in; until then these stay in-repo.

### Swift codegen uses the `swift6` generator

`generate:swift` runs `openapi-generator-cli` with `-g swift6` against `openapi-config/swift6.yaml` (the `swift5` generator and its `openapi-config/swift.yaml` are retired — `swift5` doesn't emit `Sendable`, which is a hard requirement for Swift 6 strict-concurrency consumers like `wxyc-ios-64`). The `swift6` templates bake `Sendable, Codable, Hashable` onto every generated model unconditionally — there's no `sendable` flag to toggle. `swift6.yaml` also sets `enumUnknownDefaultCase`/`oneOfUnknownDefaultCase` so unrecognized enum/oneOf values decode into an `unknownDefault` case instead of throwing, matching the degrade-don't-throw discipline the mobile consumers rely on.

Two gotchas, both verified against the current `api.yaml`:

1. **`identifiableModels: false` is required, not cosmetic.** Its swift6 default is `true`. Left on, the synthesized oneOf catch-all (e.g. `V2FlowsheetLatestGet200Response`) gets an `extension … : Identifiable {}` with no `id` conformance, and the generated package fails to compile. `swift6.yaml` sets it to `false`, which drops every `Identifiable` extension — verify with `grep -rl ": Identifiable" generated/swift | wc -l` (should be `0`).
2. **`generateApis: false` does not suppress the `APIs/` directory under `swift6`.** It still emits `Sources/WXYCAPI/APIs/DefaultAPI.swift` (~148KB) and friends even though this repo only wants models. That's harmless for the in-repo reference tree, but any consumer that vendors `generated/swift` (WXYC/wxyc-ios-64#598 and future Swift consumers) must drop `APIs/` themselves — don't rely on the config to keep it out.

### Python codegen and `nullable` on required fields

`scripts/generate-python-models.sh` runs `datamodel-codegen` **with `--strict-nullable`** (#302): a `required` + `nullable: true` property generates as `X | None = Field(...)` — the value nullable, the key still required (the ellipsis is pydantic's required marker, not a default). This is what makes the required-but-nullable idiom this spec uses wherever a null carries meaning (`BulkResolveProvenanceEntry.confidence`, `BulkResolveTrackIdentity.resolved_artist_name`, `CompilationTrackSuggestions.discogs_release_id`) actually expressible through the generated Python models. A bats test pins the flag's presence; don't remove it, and don't reshape `api.yaml` to route around the generator.

**The retained side effect (know it before regenerating a consumer):** the same flag stops *optional non-nullable* properties from generating as `Optional` (that was a byproduct of the old defaulting bug, not the contract). After a consumer regenerates, explicitly passing `None` to those fields raises `ValidationError`, and inbound JSON `null` for them becomes a 422. The measured blast radius at 1.30.0 was 72 changed field declarations — 36 widened (the fix), 36 narrowed (the side effect) — and the narrowed list lives in #302. Each Python consumer (library-metadata-lookup, request-o-matic) audits its construction sites and inbound-null surface as part of its own regen PR; LML's audit found seven production sites needing present-but-null guards (Discogs API and cache reads), fixed ahead of its regen.

## Breaking-change gate

Run `npm run check:breaking` before changing `api.yaml`. It runs `oasdiff breaking` against `origin/main` with `--fail-on ERR`, mirroring the `breaking-changes.yml` PR job.

Both sides pass `--err-ignore oasdiff-err-ignore.txt`, a whitelist of findings that are breaking by oasdiff's static rules but provably not on the wire (e.g. a property reachable only through an array that has never shipped a non-empty value). Every entry needs a written justification in the file. Three properties to keep in mind:

- **Entries are diff-scoped.** A line matches only while its change is in `main`..PR; once merged it stops matching and is inert. Prune dead *entries* — never the file. Both callers pass the path unconditionally and oasdiff exits 121 when it is missing, so deleting an emptied file turns the next api.yaml PR red with an auto-comment blaming breaking changes that don't exist. An entry-free file of comments is the floor; `scripts/check-breaking-changes.sh` fails fast with that explanation if it goes missing.
- **Entries are verbatim oasdiff message text.** A substring won't match. An oasdiff release that rewords a finding silently un-matches its entry, so a red job after an oasdiff upgrade means re-pasting the new wording, not re-litigating the change.
- **The file is not an escape hatch for real breaks.** A genuine breaking change gets a contract-version conversation, not a line in the whitelist.

## Testing

```bash
npm test              # Unit tests
npm run lint:e2e      # Typecheck the e2e/ suite (no live stack needed)
npm run test:e2e      # E2E tests (requires running services)
```

The `e2e/` directory is excluded from both `lint` (base `tsconfig.json` excludes `e2e`) and `npm test` (vitest excludes `e2e/**`), and the live suite (`npm run test:e2e`) only runs from another repo's deploy gate (`bs-lml-gate.yml`). To keep a broken `e2e/` file from merging green and first surfacing as a `bs-lml-gate` failure that blocks BS/LML prod promotion, PR CI runs `lint:e2e` — `tsc -p tsconfig.e2e.json`, a typecheck-only pass over `e2e/**` with `rootDir: "."` so the e2e files aren't flagged as outside the base `rootDir: "./src"`. It does not run the stack; it's cheap and dependency-free. See #266.

## Testing Standards

This project follows **Test-Driven Development (TDD)**. All code changes must be test-driven - this is not optional.

### TDD Workflow

1. **Red**: Write a failing test that describes the desired behavior. Run it and verify it fails for the expected reason.
2. **Green**: Write the minimum code necessary to make the test pass. Run the test and confirm it passes.
3. **Refactor**: Look for opportunities to improve the code while keeping tests green. Re-run tests after each change.
4. **Repeat**: Continue this cycle until the feature is complete.

**Key principle**: No production code without a failing test first.
