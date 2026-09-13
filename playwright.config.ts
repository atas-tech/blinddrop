import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

const chromiumExecutable = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || [
  '/usr/bin/chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium-browser'
].find(existsSync);

export default defineConfig({
  testDir: './e2e',
  timeout: 30 * 1000,
  expect: {
    timeout: 5000
  },
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumExecutable ? {
          launchOptions: { executablePath: chromiumExecutable }
        } : {})
      },
    },
  ],
  webServer: {
    command: 'node --import tsx scripts/test-stack.ts',
    port: 3000,
    reuseExistingServer: false,
    timeout: 60 * 1000,
    gracefulShutdown: { signal: 'SIGTERM', timeout: 5000 },
  },
});
