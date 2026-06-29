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

DTOs are generated from `api.yaml`. TypeScript uses `openapi-typescript` (pure Node.js); Swift and Kotlin use the Java-based `openapi-generator-cli`:
```bash
npm run generate:typescript  # TypeScript types (openapi-typescript, no JVM)  -> src/generated/
npm run generate:python      # Python pydantic models (datamodel-codegen)     -> generated/python/
npm run generate:swift       # Swift types (openapi-generator-cli, requires Java)  -> generated/swift/
npm run generate:kotlin      # Kotlin types (openapi-generator-cli, requires Java) -> generated/kotlin/
```

The TypeScript codegen script (`scripts/generate-models.js`) produces:
- `src/generated/openapi-types.d.ts` -- raw openapi-typescript output
- `src/generated/models/index.ts` -- re-export layer with const objects for enums

All four output trees are **in-repo and gitignored** (`src/generated/`, `generated/`) — they're regenerated artifacts, never committed here. TypeScript is the only output consumed by this package's own build (it ships the DTOs); Python/Swift/Kotlin are produced for downstream consumers.

### Output locations and consumers

| Script | Output (gitignored) | Consumer(s) | How the consumer uses it today |
|---|---|---|---|
| `generate:typescript` | `src/generated/` | Backend-Service, dj-site (via `@wxyc/shared/dtos`) | Imported from the published package |
| `generate:python` | `generated/python/` | request-o-matic, library-metadata-lookup | Pydantic models |
| `generate:swift` | `generated/swift/` | wxyc-dj-ios (DJ tool / device-auth), wxyc-ios-64 (listener) | **Hand-maintained** — reference/diff aid only |
| `generate:kotlin` | `generated/kotlin/` | WXYC-Android | **Hand-maintained** — reference/diff aid only |

The Swift/Kotlin consumers **do not yet consume the generated output** — they hand-author types that mirror `api.yaml` (e.g. `wxyc-dj-ios`'s `Packages/WXYCAPI/Sources/WXYCAPI/DTOs/`). So `generated/swift` and `generated/kotlin` are a local reference a maintainer regenerates and diffs against when hand-updating a consumer after an `api.yaml` change — not a tree any consumer checks in. (`library-scanner`, formerly a Swift consumer, is now an archived/read-only repo.)

Migrating each consumer onto the generated output is tracked separately, blocked by this output-path fix (#197): WXYC/wxyc-dj-ios#75, WXYC/WXYC-Android#25, WXYC/wxyc-ios-64#412 — all sub-issues of the codegen umbrella #106. Once a consumer migrates, its `-o` path (or its own build step) should point at wherever that repo checks the generated client in; until then these stay in-repo.

Run `npm run check:breaking` before changing `api.yaml` to detect breaking changes.

## Testing

```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests (requires running services)
```

## Testing Standards

This project follows **Test-Driven Development (TDD)**. All code changes must be test-driven - this is not optional.

### TDD Workflow

1. **Red**: Write a failing test that describes the desired behavior. Run it and verify it fails for the expected reason.
2. **Green**: Write the minimum code necessary to make the test pass. Run the test and confirm it passes.
3. **Refactor**: Look for opportunities to improve the code while keeping tests green. Re-run tests after each change.
4. **Repeat**: Continue this cycle until the feature is complete.

**Key principle**: No production code without a failing test first.
