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
    // E2E tests run sequentially by default
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
