import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // forks isolates each test file's process; the anvil chain for e2e tests
    // is spawned ONCE for the whole run by the globalSetup (T1.4 harness).
    pool: 'forks',
    globals: false,
    globalSetup: ['scripts/devchain.ts'],
  },
});
