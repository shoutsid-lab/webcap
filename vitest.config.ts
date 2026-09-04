import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // forks isolates each test file's process; e2e suites spawn anvil as a child.
    pool: 'forks',
    globals: false,
  },
});
