import { defineConfig } from '@playwright/test';

/* Browsers come from PLAYWRIGHT_BROWSERS_PATH when the environment provides
 * them (this project's dev container does). Otherwise run:
 *     npx playwright install chromium
 */

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,          // the suite shares one database
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html'], ['list']] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { browserName: 'chromium', viewport: { width: 1480, height: 950 } },
  }],
  webServer: [
    {
      command: 'npm run dev:api',
      url: 'http://127.0.0.1:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      /* The suite signs in repeatedly from one address, which the sign-in
       * rate limit is designed to stop. Raised here so the limiter is tested
       * by its own unit tests rather than by accidentally throttling the
       * browser. The per-account lockout stays at its real value. */
      env: {
        ...process.env,
        RATE_LIMIT_LOGIN_MAX: '10000',
        RATE_LIMIT_API_MAX: '100000',
      },
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
