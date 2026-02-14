# WXYC Shared Library

This is the shared library for WXYC services, published to GitHub Packages as `@wxyc/shared`.

## Architecture

This package provides:
- **DTOs** (`@wxyc/shared/dtos`) - Generated from OpenAPI spec (`api.yaml`)
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

DTOs are generated from `api.yaml`:
```bash
npm run generate:typescript  # TypeScript types
npm run generate:swift       # iOS types
npm run generate:kotlin      # Android types
```

Run `npm run check:breaking` before changing `api.yaml` to detect breaking changes.

## Testing

```bash
npm test              # Unit tests
npm run test:e2e      # E2E tests (requires running services)
```
