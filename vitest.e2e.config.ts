import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // e2e/**/*.test.ts includes all subdirectories (contract/, types/, etc.)
    include: ['e2e/**/*.test.ts'],
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
