import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // e2e/**/*.test.ts includes all subdirectories (contract/, types/, etc.)
    // tests/e2e-contracts.test.ts is the cross-service invariants suite.
    include: ['e2e/**/*.test.ts', 'tests/e2e-contracts.test.ts'],
    // Issue #379 review fix-pass #2, finding #2: mints the shared
    // anonymous/credentialed sessions every test file below reads instead
    // of each minting its own -- see e2e/global-setup.ts's own doc comment
    // and e2e/auth.test.ts's budget-arithmetic comment for why this exists.
    globalSetup: ['./e2e/global-setup.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // E2E test FILES must run sequentially, not in parallel (this does not
    // affect tests running within the same file). Issue #379 review
    // fix-pass #3, finding #3: `pool: 'forks'` +
    // `poolOptions.forks.singleFork: true` was the vitest 3 way to express
    // this, but `singleFork` was removed from vitest 4's config schema
    // (this repo runs 4.1.10) -- an unrecognized key is silently ignored
    // rather than erroring, so this config had been running every e2e file
    // in PARALLEL (verified: ~3 workers on a 4-vCPU runner) since the
    // vitest 4 upgrade, a latent bug on `main` this sequential-budget work
    // surfaced rather than introduced. `fileParallelism: false` is the
    // current top-level option for the same effect (it forces
    // `maxWorkers` to 1). This is load-bearing, not a style preference:
    // every budget-arithmetic comment in this suite (see
    // e2e/auth.test.ts's) assumes one shared egress IP hitting
    // apps/auth/app.ts's rate-limit bucket file-by-file, not N files
    // racing the SAME shared credentialed session concurrently (which
    // would ALSO break e2e/recent-entries.test.ts and
    // tests/e2e-contracts.test.ts, both of which join/end the same DJ's
    // flowsheet show against that one shared session).
    pool: 'forks',
    fileParallelism: false,
  },
});
