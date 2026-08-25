import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // e2e/**/*.test.ts includes all subdirectories (contract/, types/, etc.)
    // tests/e2e-contracts.test.ts is the cross-service invariants suite.
    include: ['e2e/**/*.test.ts', 'tests/e2e-contracts.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // E2E test FILES must run sequentially, not in parallel (this does not
    // affect tests running within the same file). `pool: 'forks'` +
    // `poolOptions.forks.singleFork: true` was the vitest 3 way to express
    // this, but `singleFork` was removed from vitest 4's config schema
    // (this repo runs 4.1.10) -- an unrecognized key is silently IGNORED
    // rather than erroring, so since the vitest 4 upgrade this config has
    // been running every e2e file in parallel (default `maxWorkers` is
    // `max(availableParallelism() - 1, 1)`, i.e. ~3 workers on a 4-vCPU
    // runner). `fileParallelism: false` is the current top-level option for
    // the same effect.
    //
    // This is load-bearing, not a style preference. Two concrete races the
    // parallel default exposes today:
    //   - e2e/recent-entries.test.ts and tests/e2e-contracts.test.ts both
    //     sign in as the SAME staging DJ and join/end that DJ's flowsheet
    //     show. Run concurrently, one file's `end` tears down the show the
    //     other is still adding entries to.
    //   - every file signs in against apps/auth/app.ts's rate limiter,
    //     which keys on a single shared egress IP. Concurrent files spend
    //     that one bucket in bursts rather than file-by-file.
    pool: 'forks',
    fileParallelism: false,
  },
});
