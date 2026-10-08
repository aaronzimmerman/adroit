import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Git fixture setup is I/O heavy; keep a generous but bounded timeout.
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
