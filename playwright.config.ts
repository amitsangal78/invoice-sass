import { defineConfig,devices } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/e2e',fullyParallel:false,workers:1,
  outputDir:'.local/test-results',
  use:{baseURL:'http://localhost:3000',trace:'retain-on-failure',...devices['Desktop Chrome'],channel:process.env.PLAYWRIGHT_CHANNEL},
  webServer:{command:'npm run dev:all',url:'http://localhost:3000',reuseExistingServer:!process.env.CI,timeout:120_000},
});
