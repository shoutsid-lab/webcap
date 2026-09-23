import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // forks isolates each test file's process; the anvil chain for e2e tests
    // is spawned ONCE per test-run process by the globalSetup (T1.4 harness)
    // on a free port with a per-PID chain file, so concurrent `vitest`
    // invocations never share a chain (shared port/file + pkill used to cause
    // NONCE_EXPIRED flakes). Files run sequentially: e2e files share the
    // run's anvil and fund transfers from the same account, so parallel forks
    // would race on nonces.
    pool: 'forks',
    fileParallelism: false,
    globals: false,
    globalSetup: ['scripts/devchain.ts'],
  },
});
