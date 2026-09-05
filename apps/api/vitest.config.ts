import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Integration tests hit a real Dockerized test Postgres — no mocked DB layer
    // for anything touching invoice status or payments (rules/testing.md).
    setupFiles: ['./src/test/setup.ts'],
    hookTimeout: 30000,
    testTimeout: 15000,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgres://postgres:postgres@localhost:5433/invoice_saas_test',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'test-access-secret-do-not-use-in-prod',
      JWT_REFRESH_PEPPER: 'test-refresh-pepper-do-not-use-in-prod',
    },
    // Run test files serially — they share one Postgres/Redis instance and
    // truncate tables between tests; parallel files would race on that state.
    fileParallelism: false,
  },
});
