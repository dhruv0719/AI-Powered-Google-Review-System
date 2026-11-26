import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: '',
      MIGRATION_DATABASE_URL: '',
    },
  },
});
