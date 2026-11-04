import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['tests/**/*.test.ts', 'packages/**/*.test.ts', 'apps/**/*.test.ts'],
    setupFiles: ['./tests/test-setup.ts'],
    testTimeout: 15000,
  },
});
