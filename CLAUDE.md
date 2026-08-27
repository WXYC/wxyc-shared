# WXYC Shared Library

This is the shared library for WXYC services, published to GitHub Packages as `@wxyc/shared`.

## Tag Stability Policy (READ BEFORE EDITING `.github/workflows/`)

This repo publishes reusable GitHub Actions workflows that other WXYC repos consume by tag:

- `check-charset-corpus-drift.yml` — consumed as `WXYC/wxyc-shared/.github/workflows/check-charset-corpus-drift.yml@gha/v1` (14 consumers as of 2026-08-07)
- `check-api-spec-drift.yml` — consumed as `WXYC/wxyc-shared/.github/workflows/check-api-spec-drift.yml@gha/v1` (added by #323 for #319; no consumers yet — the Python services adopt it as part of library-metadata-lookup#1159 / request-o-matic#218)

`gha/v1` is a **moving major tag**. It points at the latest commit on `main` that is non-breaking for the v1 contract. Consumers pin to `@gha/v1` to opt into compatible improvements; they pin to a SHA only if they want frozen behavior.

**One tag covers every reusable workflow in this repo, but each workflow is its own contract.** That is a known wart, not a design: a `gha/v2` cut forced by a break in one workflow freezes `gha/v1` for consumers of the *other* workflows, so no future non-breaking improvement can reach them without violating the freeze. Splitting into per-workflow tags (`charset/v1`, `spec-drift/v1`) is the fix; it is deliberately not coupled to any one change. Until then, weigh a `v2` cut against every consumer set, not just the one whose workflow broke.

**Pinning `@gha/v1` on `uses:` does not pin everything.** It pins the workflow YAML. The *script* the workflow executes comes from whatever the `wxyc-shared-ref` input says, which defaults to `main`. A consumer that pins `@gha/v1` and leaves `wxyc-shared-ref` unset therefore runs tagged YAML against main's script — 4 of the 14 charset consumers (request-o-matic, wikidata-cache, archive, wxyc-archive-search) are in that state as of 2026-08-07. Either set `wxyc-shared-ref: gha/v1` everywhere or drop the input; the mixed state means "pinned to `gha/v1`" is not a statement about what actually ran.

### Before changing any reusable workflow, decide: is this breaking?

A change is **breaking** if it does any of the following to a `workflow_call`-enabled file:

1. Adds a new required `inputs:` entry, or removes/renames an existing input.
2. Adds a new required `secrets:` entry, or removes/renames an existing secret.
3. Removes or renames an `outputs:` entry.
4. Changes the default value of an existing input in a way a consumer could depend on.
5. Changes observable behavior consumers rely on — e.g. the job no longer fails on a condition it previously failed on, the runner OS major version bumps, a step that produced an artifact stops producing it.

Anything else is **non-breaking**: bugfixes, perf work, internal refactors, *additive* optional inputs/outputs/secrets, dependency bumps that don't change observable behavior.

**Rule 5 is about the runner OS, not about action majors.** An `actions/checkout@v6→v7` or `actions/setup-node@v6→v7` bump inside a reusable workflow is a dependency bump under the non-breaking list above, provided `runs-on` is unchanged and no input/secret/output/permission moved with it. This came up concretely: `gha/v1` sat at `1858cba` for 2.5 months while `main` carried exactly those two bumps (`484b3d8`, `867d35f`, both 2026-07-16), and reading rule 5 to cover them would have cost a `gha/v2` migration across 12 repos to deliver a zero-behavior change. Check `git diff gha/v1 origin/main -- .github/workflows/<file>.yml` before assuming a long tag lag means a large contract delta — most commits on `main` never touch a published workflow.

**Adding a brand-new `workflow_call` file is additive and non-breaking — but the tag still has to move for anyone to reach it.** A file that does not exist at `gha/v1` makes `uses: …@gha/v1` fail at *workflow startup*, not at a step, so the consumer sees a run with no jobs rather than a useful error. "Additive, so no tag action needed" is the trap; the correct reading is "additive, so the non-breaking bump procedure applies." (WXYC/wxyc-shared#319's Constraints section originally said the former, and #323 said the latter — this paragraph is the reconciliation.)

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

Then file a migration ticket in every consumer repo that pins `@gha/v1` for this workflow.

**Do not size that migration with `gh search code`.** The code-search index lags and silently under-reports: on 2026-08-07 it returned 6 consumers of `check-charset-corpus-drift.yml` when the true count was 14 — it missed `wxyc-etl`, which publishes the org's *other* reusable workflow. Enumerate by walking every repo's workflow directory instead:

```bash
for r in $(gh repo list WXYC --limit 100 --json name --jq '.[].name'); do
  gh api "repos/WXYC/$r/contents/.github/workflows" --jq '.[].path' 2>/dev/null \
    | while read -r p; do
        gh api "repos/WXYC/$r/contents/$p" --jq '.content' 2>/dev/null | base64 -d \
          | grep -q 'wxyc-shared/.github/workflows/<file>.yml@' && echo "$r $p"
      done
done
```

A missed consumer is worse than a slow search: it stays on a frozen `gha/v1` after everyone else migrates, and nobody finds out until its next scheduled run fails.

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

1. **Roles** — a chain: member < dj < musicDirector < stationManager. **This repo owns role identity and order only**: `ROLES` (the chain's single declaration, highest first), `ROLE_ALIASES` + `canonicalizeRole()` (the one alias table — fail-closed, for servers), and `Authorization`/`roleToAuthorization` (the ascending numeric projection — fail-open to `NO`, for client display gating; pinned against `ROLES` by test). **Permission grants live in Backend-Service's `auth.roles.ts`, not here.** The chain is not enforced by any runtime fallback — Backend-Service's middleware checks each role's flat grant set, and a CI invariant there proves the grants are monotone along this chain. This package deliberately carries no grant table: the JWT transports a role, not a permission set, so a client-side copy could only drift (one did — `ROLE_PERMISSIONS`, removed in 5.0.0 with zero external consumers). A client needs thresholds (`roleToAuthorization(...) >= MD`), never per-resource grants.
2. **Capabilities** (cross-cutting): `editor`, `webmaster` - can be granted to any user. The escape hatch for anything that can't be expressed monotonically along the role chain.

Use `Authorization` enum for numeric comparisons, branded types (`RoleAuthorizedUser`, `CapabilityAuthorizedUser`) for compile-time enforcement. When adding an alias string, remember `ROLE_ALIASES` is pinned by deep-equal in Backend-Service's `shared-type-compatibility.test.ts` — a widening here deliberately turns BS CI red on its next dependency bump so the admin-flag implications get reviewed there, not discovered.

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

**`generate:typescript` and `generate:swift` produce output real consumers vendor; `generate:python` and `generate:kotlin` are still local reference trees only.** TypeScript ships the DTOs in the published package; Swift's `generated/swift/` is vendored directly into `wxyc-ios-64`'s `Shared/WXYCAPIModels/` (pinned via that repo's `contract-version.json` — see "Swift codegen uses the `swift6` generator" below). Editing this repo's codegen flags for TypeScript or Swift is therefore a real change for a downstream repo; editing Python or Kotlin flags changes nothing until each of those gets its own migration — the "Who'd notice a change here" column is the one to read before assuming otherwise, per repo, not per language.

| Script | Output (gitignored) | Who'd notice a change here | Where those types actually come from |
|---|---|---|---|
| `generate:typescript` | `src/generated/` | **Backend-Service, dj-site** | Imported from the published `@wxyc/shared/dtos` |
| `generate:python` | `generated/python/` | Nobody yet | Canonical script now lives here (`scripts/generate-python-models.sh`, #107); both Python services still run their own unmigrated local copy (see below) until each ships its own migration PR |
| `generate:swift` | `generated/swift/` | **wxyc-ios-64, wxyc-dj-ios** | Both vendor this output directly, each regenerated against its own pinned wxyc-shared commit: ios-64 into `Shared/WXYCAPIModels/` (WXYC/wxyc-ios-64#598), dj-ios into `Packages/WXYCAPIModels/` (WXYC/wxyc-dj-ios#75, merged 2026-08-17 — ~262 files). dj-ios keeps a handful of DTOs hand-authored alongside the vendored tree (`Packages/WXYCAPI/Sources/WXYCAPI/DTOs/`), each for a reason its CLAUDE.md records per type — a deliberate residue, not an unmigrated remainder. **They are not symmetric on `Infrastructure/`** — see the `CalendarDate` section below, which is where that asymmetry bites |
| `generate:kotlin` | `generated/kotlin/` | Nobody | WXYC-Android hand-authors types mirroring `api.yaml` |

**Where the Python models really come from, and where that's headed.** As of #107, the canonical Python codegen script is `scripts/generate-python-models.sh` in this repo, living next to `api.yaml`. That colocation solves only half of what its two predecessors had to do: those scripts lived in the *consumer* repo and had to go find the spec elsewhere (a sibling wxyc-shared checkout, worktree-aware via `git rev-parse --git-common-dir`, or a GitHub download), while this one already has the spec next door. It does **not** solve the other half — locating *this script* from a consumer repo — and the org's global CLAUDE.md requiring a worktree for all new development makes that the normal case, not an edge case: a caller's cwd is typically `<repo>/.worktrees/<branch>`, and a plain `../wxyc-shared` from there resolves to `<repo>/.worktrees/wxyc-shared`, which doesn't exist. It takes `--input`/`--output`/`--ref` flags, defaults to this repo's own `api.yaml` -> `generated/python/models.py`, and downloads from `raw.githubusercontent.com` only in the fallback case of being invoked without a local `api.yaml` at all — see "Pinning the spec ref" below for what `--ref` controls on that download and why #319 made it necessary. **Today, both Python services still run their own pre-#107 copy** — `scripts/generate_api_models.sh` in [library-metadata-lookup](https://github.com/WXYC/library-metadata-lookup/blob/main/scripts/generate_api_models.sh) and [request-o-matic](https://github.com/WXYC/request-o-matic/blob/main/scripts/generate_api_models.sh) — and commit the result as `generated/api_models.py` in their own repo; migrating each one onto the shared script is separate, per-repo follow-up work (their own PR, their own review), not part of #107's change here. Once a consumer migrates, the worktree-safe invocation is:

```bash
WXYC_SHARED="$(dirname "$(git rev-parse --git-common-dir)")/../wxyc-shared"
bash "$WXYC_SHARED/scripts/generate-python-models.sh" --output generated/api_models.py
```

run from anywhere inside the consumer's own checkout, worktree or not — `git rev-parse --git-common-dir` reports the consumer's main repo root even from inside a linked worktree, so `../wxyc-shared` resolves relative to *that*, not to cwd (verified byte-identical against LML's current output, modulo the regenerate-with header line, when run this way — `ruff format` picks up the *consumer's* `pyproject.toml` line-length because the output path lives inside their tree).

The `datamodel-code-generator` version pin — previously three-way drifted (LML `datamodel-code-generator[http]==0.56.1`, request-o-matic `datamodel-code-generator==0.57.0`, this repo unpinned) — now lives in exactly one place: `DATAMODEL_CODEGEN_PIN` inside `scripts/generate-python-models.sh`, currently `datamodel-code-generator[http]==0.56.1`. When `uv` is available the script runs that exact version on a pinned interpreter (`uvx --python 3.12`), ignoring whatever else is on PATH or in a local venv. That is **not** a full lockfile, though: black, isort, and pydantic are pulled in transitively and left to float, and 0.56.1 still formats via black+isort by default (it emits a `FutureWarning` saying so) — a transitive release that changes formatting output can still produce a different diff on two machines that both honor this pin. "The generator version and interpreter are pinned" is the accurate claim; "output is guaranteed byte-identical everywhere" is not one this script makes. Without `uv` it falls back to a local `.venv`/PATH-resolved `datamodel-codegen` (found by walking up from the invocation directory looking for `.venv/bin/datamodel-codegen`, nearest match wins — not against this repo's own checkout, which would never find a consumer's venv, and not just the caller's bare cwd, which misses a `.venv` sitting at an ancestor whenever the script is invoked from a subdirectory of the caller's repo. An earlier version of this fix jumped straight to the caller's git-derived repo root instead, which regressed the opposite layout — `.venv` living beside a subdirectory's own `pyproject.toml`, not at the repo root — and depended on `git` being installed at all; the upward walk needs neither git nor any particular directory layout, so it is a strict superset of both the original bug and that regression. See #311.) and warns, without failing, if that binary's version doesn't match the pin. **This is why #107 was sequenced ahead of #302** (`--strict-nullable`): with three invocations there were three places to add the flag and three places for it to drift further; with one, it's one edit. request-o-matic's own pin (0.57.0) does not automatically become 0.56.1 by this repo's script existing — reconciling it is part of that consumer's migration PR, not something this repo can do on request-o-matic's behalf.

For Kotlin the hand-authored types still live in the consumer repo. Swift no longer works that way: **both** Swift consumers vendor this repo's generated output (see "Swift codegen uses the `swift6` generator" below). `wxyc-dj-ios`'s remaining hand-authored DTOs (`Packages/WXYCAPI/Sources/WXYCAPI/DTOs/`) sit *beside* its vendored `Packages/WXYCAPIModels/`, not instead of it, and its CLAUDE.md gives a per-type reason for each — a wire shape `api.yaml` doesn't actually match, a field the app deliberately never sends, an enum whose generated cases the UI already switches over exhaustively. Read that table before assuming any given one is just waiting on a migration. (`library-scanner`, formerly a Swift consumer, is now an archived/read-only repo.)

Migrating each consumer onto the generated output is tracked separately, blocked by this output-path fix (#197): WXYC/WXYC-Android#25 and WXYC/wxyc-ios-64#412 remain; WXYC/wxyc-dj-ios#75 is **done** (closed; PR WXYC/wxyc-dj-ios#78 merged 2026-08-17). All are sub-issues of the codegen umbrella #106. Once a consumer migrates, its `-o` path (or its own build step) should point at wherever that repo checks the generated client in; until then these stay in-repo.

### Swift codegen uses the `swift6` generator

`generate:swift` runs `openapi-generator-cli` with `-g swift6` against `openapi-config/swift6.yaml` (the `swift5` generator and its `openapi-config/swift.yaml` are retired — `swift5` doesn't emit `Sendable`, which is a hard requirement for Swift 6 strict-concurrency consumers like `wxyc-ios-64`). The `swift6` templates bake `Sendable, Codable, Hashable` onto every generated model unconditionally — there's no `sendable` flag to toggle. `swift6.yaml` also sets `enumUnknownDefaultCase`/`oneOfUnknownDefaultCase` so unrecognized enum/oneOf values decode into an `unknownDefault` case instead of throwing, matching the degrade-don't-throw discipline the mobile consumers rely on.

Two gotchas, both verified against the current `api.yaml`:

1. **`identifiableModels: false` is required, not cosmetic.** Its swift6 default is `true`. Left on, the synthesized oneOf catch-all (e.g. `V2FlowsheetLatestGet200Response`) gets an `extension … : Identifiable {}` with no `id` conformance, and the generated package fails to compile. `swift6.yaml` sets it to `false`, which drops every `Identifiable` extension — verify with `grep -rl ": Identifiable" generated/swift | wc -l` (should be `0`).
2. **`generateApis: false` does not suppress the `APIs/` directory under `swift6`.** It still emits `Sources/WXYCAPI/APIs/DefaultAPI.swift` (~148KB) and friends even though this repo only wants models. That's harmless for the in-repo reference tree, but any consumer that vendors `generated/swift` (WXYC/wxyc-ios-64#598 and future Swift consumers) must drop `APIs/` themselves — don't rely on the config to keep it out.

### `format: date` maps to `CalendarDate`, not `Foundation.Date` (WXYC/wxyc-shared#351, #357)

`format: date` and `format: date-time` are **not the same wire concept**, and the Swift generator must not treat them as one. `format: date-time` is a true instant — a point on the UTC timeline — and `Foundation.Date` is the correct type for it; those 52 sites are untouched by anything below. `format: date` is a **calendar date**: a day on a wall calendar with no time-of-day and no timezone. The 7 in `api.yaml` today are `CatalogExportRow.rotation_kill_date`, `RotationEntry.add_date`/`.kill_date`, `Rotation.add_date`/`.kill_date`, `KillRotationRequest.kill_date`, and `Concert.starts_on`, plus the two `GET /concerts` `from`/`to` query params. Decoding a calendar date into `Foundation.Date` fabricates a UTC-midnight instant the value never had, which silently renders a day early for any client west of UTC and re-encodes as a date-time (`"2026-08-20T00:00:00.000Z"`) instead of round-tripping the bare `"2026-08-20"` the server expects.

`openapi-config/swift6.yaml` fixes this with a format-scoped mapping:

```yaml
typeMappings:
  date: CalendarDate
```

The #355 spike confirmed this generator version keys `typeMappings` on the OpenAPI `format`, not the base `type` — mapping `date` retargets exactly the 7 `format: date` schema properties plus the 2 `GET /concerts` query params, 9 spec sites in all, and leaves all 52 `format: date-time` properties on `Date`. Verified by exhaustive diff, not sampling.

Downstream of those 7 spec properties the generator emits **9** `CalendarDate` property declarations across **6** model files, and the gap is worth knowing before you conclude a count is wrong: `RotationWithAlbum` is an `allOf` over `RotationEntry`, which the generator flattens, so `add_date`/`kill_date` are emitted twice. The six files are `CatalogExportRow`, `KillRotationRequest`, `Concert`, `RotationEntry`, `Rotation`, and `RotationWithAlbum`; the 2 query params land in `APIs/`, which this repo's vendoring consumers drop. Alongside them 67 `Date` property declarations are unmoved — a *composite*-expanded count, likewise not equal to the 52 spec sites, and for the same reason. **Both counts are live numbers, not constants** — re-derive them (`grep -c 'format: date$' api.yaml`, `grep -c 'format: date-time' api.yaml`) rather than trusting this paragraph. It has already gone stale once, and instructively: written against api.yaml 1.36.0 it read "9 schema properties + 2 query params (11 sites)" and "43 `format: date-time`", both of which were exactly right *then*. Ten minor versions later `format: date` had fallen to 9 and `date-time` risen to 52, so a rebase turned two correct numbers into two wrong ones with nothing failing. The counts are worth stating — they are what "verified by exhaustive diff, not sampling" means concretely — but they are a measurement of a moving target, and any PR that sits long enough to be rebased must re-take it.

`typeMappings` only substitutes the emitted type *name* — it does not synthesize the type. `CalendarDate` itself is hand-vendored at `openapi-config/swift-support/CalendarDate.swift` (`Codable` via `singleValueContainer` to/from the bare `YYYY-MM-DD` string, `Comparable` by `(year, month, day)` tuple with no `Calendar`/`TimeZone` in the comparison, `Sendable`, `Hashable`; the sanctioned instant→day bridge is `init(_:in:)`/`today(in:)`, so that conversion idiom exists in exactly one place instead of being reinvented per call site). The `postgenerate:swift` npm hook (`scripts/copy-swift-support-files.js`) copies it into `generated/swift/Sources/WXYCAPI/Infrastructure/` immediately after `generate:swift` runs — npm invokes `post<script>` hooks automatically, so this is ordinary generator output with no manual step for a consumer to remember. That destination is *derived* from `swift6.yaml`'s own `projectName`/`useSPMFileStructure` rather than hardcoded (see `tests/calendar-date-codegen.test.ts`), because this repo's CI never runs `generate:swift` (next paragraph) — a `projectName` rename is the one desync a plain existence check can't catch.

**CI typechecks `CalendarDate.swift` directly, not through `generate:swift`.** This repo's CI has no Java step (Java-based codegen — `generate:swift` and `generate:kotlin` — has always been dev-only here), so it can never run the generator to prove the support file still compiles. `.github/workflows/ci.yml` instead runs `swiftc -typecheck -swift-version 6 -strict-concurrency=complete` against the file directly, in a pinned `swift:6.2.4-noble` Docker container matching `wxyc-ios-64`'s Swift 6.2 toolchain. The flags are load-bearing: a bare `swiftc` typechecks in Swift 5 mode, which would pass code that fails to compile in `wxyc-ios-64`'s `swift-tools-version:6.2` / strict-concurrency package.

The behavioral test suite for `CalendarDate` (round-trip, timezone-shift regression, total ordering, malformed-input rejection, leap years, instant→day bridging) lives in `wxyc-ios-64` (WXYC/wxyc-ios-64#941), not here — that repo is `CalendarDate`'s compilation home and the only place with a Swift test runner in CI.

**The adoption gate, stated so it is satisfiable.** #357's Constraints originally borrowed wxyc-ios-64#941's rule that a consumer's regen diff must come back *empty*, a non-empty one being its own red flag. That rule is sound for a regen at an unchanged pin and unreachable for this change: both Swift consumers pin api.yaml **1.36.0** against a `main` now past **1.47.0**, so any regen at a bumped pin necessarily carries ten minor versions of unrelated schema drift. The gate that means what the empty-diff rule was reaching for is: **the `CalendarDate`-attributable hunks are exactly the retyped `format: date` properties plus the new `Infrastructure/CalendarDate.swift`, and nothing else in the diff traces to this change.** Everything else in that diff is the pin bump's business, reviewed on its own terms.

**Consumers that stage `Infrastructure/` through an allow-list must add `CalendarDate.swift` in the same PR as the pin bump.** The two Swift consumers are not symmetric here, and only one is exposed. `wxyc-ios-64` does `rsync -a --delete .../Infrastructure/` and picks up new generator support files for free. `wxyc-dj-ios` deliberately does not: its `scripts/regenerate-api-types.sh` rsyncs `Models/` whole but stages `Infrastructure/` through a six-name `INFRA_KEEP` allow-list, because most of the generator's full `Infrastructure/` output is an HTTP client a models-only package never calls, and one file in it is actively harmful: `Extensions.swift` declares `extension String: @retroactive CodingKey`, whose `String.init?(intValue:)` wins overload resolution wherever `String.init` is passed as a bare function value over an `Int`, so `[1, 2, 3].map(String.init)` yields `[nil, nil, nil]` — app-wide, no import required at the use site, from the moment the module is linked. So a dj-ios regen at a pin carrying this change vendors six models referencing a type it just filtered out — *cannot find type 'CalendarDate' in scope*. Its count guard cannot catch this: `(( STAGED_INFRA == ${#INFRA_KEEP[@]} ))` counts a staging directory built by looping over `INFRA_KEEP`, so it is equal by construction. Tracked as step 1 of WXYC/wxyc-dj-ios#79, which must land in the *same* PR as dj-ios's pin bump, never after it.

### Python codegen and `nullable` on required fields

`scripts/generate-python-models.sh` runs `datamodel-codegen` **with `--strict-nullable`** (#302): a `required` + `nullable: true` property generates as `X | None = Field(...)` — the value nullable, the key still required (the ellipsis is pydantic's required marker, not a default). This is what makes the required-but-nullable idiom this spec uses wherever a null carries meaning (`BulkResolveProvenanceEntry.confidence`, `BulkResolveTrackIdentity.resolved_artist_name`, `CompilationTrackSuggestions.discogs_release_id`) actually expressible through the generated Python models. A bats test pins the flag's presence; don't remove it, and don't reshape `api.yaml` to route around the generator.

**The retained side effect (know it before regenerating a consumer):** the same flag stops *optional non-nullable* properties from generating as `Optional` (that was a byproduct of the old defaulting bug, not the contract). After a consumer regenerates, explicitly passing `None` to those fields raises `ValidationError`, and inbound JSON `null` for them becomes a 422. The measured blast radius at 1.30.0 was 72 changed field declarations — 36 widened (the fix), 36 narrowed (the side effect) — and the narrowed list lives in #302. Each Python consumer (library-metadata-lookup, request-o-matic) audits its construction sites and inbound-null surface as part of its own regen PR; LML's audit found seven production sites needing present-but-null guards (Discogs API and cache reads), fixed ahead of its regen. **Until a consumer's regen ticket merges (LML: library-metadata-lookup#1153; ROM: request-o-matic#218), that repo's committed `api_models.py` still has the old non-Optional shapes — do not write producer code that emits the documented nulls against an unregenerated model.**

### Pinning the spec ref (and detecting drift)

`scripts/generate-python-models.sh`'s GitHub download fallback (taken only when a caller has no local `api.yaml` next to the script — see the table above) used to hardcode `main`. That meant an `api.yaml` merge here silently changed what an unpinned caller downloaded on its *next* run, with no commit in the caller's repo and no signal to anyone — [#319](https://github.com/WXYC/wxyc-shared/issues/319). The fix has two independent halves, matching #319's decided "A + B'":

**A — pin the download with `--ref`.** Pass `--ref <git-ref>`, or set the `WXYC_SHARED_REF` env var (the flag wins if both are given), to pin the download to a specific wxyc-shared commit instead of tracking `main`:

```bash
bash "$WXYC_SHARED/scripts/generate-python-models.sh" --ref <commit-sha> --output generated/api_models.py
```

**Prefer a commit SHA over a tag.** Tags in this repo are not immutable by policy — `gha/v1` is explicitly a *moving* major tag (see the Tag Stability Policy above) — so a SHA is the only ref that actually pins; a tag can move out from under a caller exactly the way `main` already does. `--ref` accepts tags too (nothing stops you), but a SHA is the only choice that makes "pinned" mean what it sounds like.

Leaving `--ref`/`WXYC_SHARED_REF` unset is still permitted — the download just falls back to `main` — but the script now prints a loud, impossible-to-miss warning to stderr when it takes that path, instead of downloading silently. Erroring outright on an unpinned download was considered and rejected: this script has existing unpinned callers today (both Python consumers currently run their own pre-#107 copies, and even post-migration nothing forces a caller to pass `--ref`), and turning an unset flag into a hard failure would break every one of them with no migration window. The warning is the honest middle ground — CI callers should always pass `--ref`, but the script does not get to unilaterally decide that for every caller.

`--ref`/`WXYC_SHARED_REF` only affects the download fallback: `--input` and a local `PROJECT_DIR/api.yaml` both still win outright (a `Note:` on stderr says so if you passed `--ref` alongside either), matching the resolution order this script already had.

**B' — detect drift on a schedule, without a cross-repo credential.** #319's ticket proposed (option B) having this repo `repository_dispatch` into each Python consumer on every `api.yaml` merge, which needs a new write-scoped token stored *here*, forwarding into two other repos. B' does the same job without that credential: `.github/workflows/check-api-spec-drift.yml` is a read-only reusable workflow a consumer calls **on its own schedule**, comparing its pinned ref against wxyc-shared's current `main`. The consumer's own thin caller workflow decides what "stale" means for it — open an issue, open a regen PR, just log it — using its own `GITHUB_TOKEN`, not a token from this repo.

**The drift signal is api.yaml's CONTENT (a SHA-256 hash), not `info.version` (PR #323 review).** An earlier draft of this workflow compared `info.version` strings between the two refs. A survey of the last 15 commits touching `api.yaml` on this repo's `main` found 9 of 15 did **not** bump `info.version` — including a commit titled "make include_tracks omittable in the generated types" and commits that add fields outright. Per library-metadata-lookup#1117, the observed staleness symptom included a *docstring* divergence: `datamodel-codegen` renders `description:` into `Field(description=...)`, so even a "docs-only" `api.yaml` commit changes a consumer's generated `api_models.py`. A version-string comparison would have reported `drift: false` on all nine of those — a check that says "current" while a consumer is genuinely stale is worse than no check at all, which is exactly the failure mode #319 itself describes ("a check nobody believes"). `check-spec-drift.sh` therefore takes both refs' full `api.yaml` content, already fetched and hashed by the workflow step, and compares the hashes; `info.version` at each ref is still surfaced as an output and in the summary (useful for a human skimming the report) but plays no role in the `drift` decision. `scripts/__tests__/check-spec-drift.test.sh` pins the regression case explicitly: same version string, different content hash, must report `drift: true`.

```yaml
# in a Python consumer repo, e.g. .github/workflows/wxyc-shared-drift.yml
on:
  schedule:
    - cron: '0 13 * * 1'   # weekly, Monday 13:00 UTC
  workflow_dispatch: {}
permissions:
  contents: read
jobs:
  check-drift:
    uses: WXYC/wxyc-shared/.github/workflows/check-api-spec-drift.yml@main
    with:
      pinned-ref: '<the commit SHA generate-python-models.sh --ref is pinned to>'
  # a following job gated on `needs: check-drift` and
  # `if: needs.check-drift.outputs.drift == 'true'` is where the consumer
  # decides what to do -- that job declares its OWN write permissions in the
  # consumer's own workflow file, not here.
```

Inputs: `pinned-ref` (required) — the ref the caller wants checked; `wxyc-shared-ref` (optional, default `main`) — which ref of *this reusable workflow's own script* to run, independent of which api.yaml refs are being compared (those are always the caller's `pinned-ref` vs. wxyc-shared's current `main`). Outputs: `drift` (`"true"`/`"false"`), `current-sha`, `current-version`, `pinned-version` — plus a human-readable summary in the job log and `$GITHUB_STEP_SUMMARY`.

**Permissions contract: `contents: read` only, and nothing else.** Every read this workflow does is unauthenticated public content — `git ls-remote` for wxyc-shared's `main` SHA (doesn't count against the GitHub REST API rate limit, unlike `gh api`) and `raw.githubusercontent.com` fetches for api.yaml at two refs, the same fetch the download fallback above already makes. No secrets are declared or needed. Per the Tag Stability Policy above, reusable-workflow permissions intersect caller ∩ callee — escalating this workflow's required floor in a future revision is itself a breaking change and needs a `gha/v2` cut, not a same-file edit; this file is new today with no `gha/v1` implications yet, which is exactly why that note belongs here before the first caller adopts it.

**`${{ }}` expressions never go inline into a `run:` block.** `inputs.pinned-ref` and every `steps.*.outputs.*` value this workflow's shell steps need are passed through that step's `env:` and referenced as a shell variable (`"$PINNED_REF"`), never spliced directly into the script text (`... "${{ inputs.pinned-ref }}"`). GitHub Actions substitutes `${{ }}` textually before the shell parses the script, so an inline expression turns a caller-controlled string — `pinned-ref` is exactly that, since a caller may wire it to a `workflow_dispatch` input or a branch name — into executable shell. `actionlint` does not flag `inputs.*` as untrusted, so this doesn't show up as a lint failure; it's a manual review discipline, not an automated one. Keep new `run:` steps in this file to the same pattern.

This workflow is deliberately never a hard gate: `check-spec-drift.sh` (the comparison logic it runs) always exits `0` on a successful comparison, drift or not — see that script's own header for why a passing exit even when `drift: 'true'` is the correct behavior, not a bug.

`scripts/generate-python-models.sh`'s `--ref` support and this workflow are both new as of #319 and have no `gha/v1` implications: neither is `check-charset-corpus-drift.yml`, so the Tag Stability Policy's bump procedure doesn't apply to them yet. After this PR merges, tag `gha/v1` should be moved to include it (`git tag -f gha/v1 origin/main && git push --force origin gha/v1`, per the non-breaking bump procedure above) so a consumer pinning `@gha/v1` picks it up — that tag move is a maintainer release action taken after merge, not part of this PR.

## Breaking-change gate

Run `npm run check:breaking` before changing `api.yaml`. It runs `oasdiff breaking` against `origin/main` with `--fail-on ERR`, mirroring the `breaking-changes.yml` PR job.

Both sides pass `--err-ignore oasdiff-err-ignore.txt`, a whitelist of findings that are breaking by oasdiff's static rules but provably not on the wire (e.g. a property reachable only through an array that has never shipped a non-empty value). Every entry needs a written justification in the file. Three properties to keep in mind:

- **Entries are diff-scoped.** A line matches only while its change is in `main`..PR; once merged it stops matching and is inert. Prune dead *entries* — never the file. Both callers pass the path unconditionally and oasdiff exits 121 when it is missing, so deleting an emptied file turns the next api.yaml PR red with an auto-comment blaming breaking changes that don't exist. An entry-free file of comments is the floor; `scripts/check-breaking-changes.sh` fails fast with that explanation if it goes missing.
- **Entries are verbatim oasdiff message text.** A substring won't match. An oasdiff release that rewords a finding silently un-matches its entry, so a red job after an oasdiff upgrade means re-pasting the new wording, not re-litigating the change.
- **The file is not an escape hatch for real breaks.** A genuine breaking change gets a contract-version conversation, not a line in the whitelist.

## Version bump gate

**Any content change to `api.yaml` must move `info.version` (line ~9) forward.** `check-version-bump.yml` fails a PR that changes `api.yaml`'s content without also raising `info.version` — additive path/schema/field → minor, description/docs-only → patch; a version that moves *backwards* fails too (a reused number republishes an already-used identity for a different shape). The diff is byte-level, deliberately: a `#`-comment or whitespace edit *inside `api.yaml`* counts as content and requires a bump (`datamodel-codegen` renders descriptions into generated output, and byte-level is the only definition that never argues). A PR that leaves `api.yaml` byte-identical — edits to any other file, comments included — never trips the gate, regardless of what `info.version` says.

This exists because `info.version` had stopped meaning anything: a survey of five consecutive `api.yaml`-touching commits found all five landed at an unchanged `1.35.0` (the last bump before them was `8c35e97`), including `363718c`, which added a whole path (`/config/secrets`) and schema (`AppSecrets`) with no version move at all. Downstream consumers record `info.version` as a human-readable identity of "what shape did I generate against" (see WXYC/wxyc-ios-64's `contract-version.json`) — a version that doesn't move makes that identity false. `363718c` is reconciled by this PR's own version bump (`1.35.0` → `1.36.0`), which covers both its change and this one; there is no separate retroactive commit.

Run `npm run check:version-bump` locally before opening a PR that touches `api.yaml`, the same way `npm run check:breaking` is run before the breaking-change gate. Like `check-spec-drift.sh` (#319), the decision is driven by comparing `api.yaml`'s content against the base ref, not by trusting a version string in isolation — the difference here is that this gate *fails the job*, where the spec-drift check is deliberately informational only (it answers a different question: "is a *consumer's pin* stale", not "did *this PR* forget to bump").

`tests/api-spec.test.ts` pins the current `info.version` as a literal sentinel (`pins info.version to the released contract version`) — bumping the version means updating that literal in the same PR, or the test suite (not just CI) tells you the bump didn't happen.

When two contract PRs touch `api.yaml` in parallel worktrees, only the one that lands first bumps against the version it started from. The second is protected structurally, not by a merge queue or a merge-time re-check — neither exists in this repo. What actually defends it: the gate runs on GitHub's `refs/pull/N/merge` preview (which folds in whatever `main` holds when the job runs), and once the first PR lands, the second's rebase hits a conflict on the `version:` line — both edited it — forcing a push, and the push re-fires the gate against the new base. When resolving that conflict, take the **higher** version and raise it: rebase's ours/theirs inversion makes the intuitive "keep mine" silently restore the older number, which the gate rejects as backward motion. Don't pre-emptively bump on behalf of a sibling PR you can see is coming; the rebase conflict is the mechanism that makes the second author bump deliberately. Also know what the gate is not: with no `required_status_checks` rule on `main` (and org admins holding ruleset bypass), a red X is a signal a reviewer must notice, not a merge block.

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
