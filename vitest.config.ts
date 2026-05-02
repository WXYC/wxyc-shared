import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // E2E tests live under e2e/ and are excluded from `npm test`.
    // tests/e2e-contracts.test.ts is also an E2E suite (see vitest.e2e.config.ts).
    exclude: ['e2e/**/*', 'tests/e2e-contracts.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/generated/**',  // Generated code - tested via integration
        'src/**/index.ts',   // Re-export files
      ],
    },
  },
});
