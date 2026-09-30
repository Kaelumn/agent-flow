import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { conditions: ['development'] },
  test: { testTimeout: 30_000, hookTimeout: 30_000 },
});
