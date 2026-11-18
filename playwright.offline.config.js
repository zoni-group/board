import { defineConfig, devices } from '@playwright/test';

// Service workers only run in production builds, so this suite serves `dist/`.
// Run with `npm run test:e2e:offline`, which builds first.
export default defineConfig({
  testDir: './test/e2e-offline',
  timeout: 45000,
  use: { baseURL: 'http://127.0.0.1:5179', trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite preview --host 127.0.0.1 --port 5179 --strictPort',
    url: 'http://127.0.0.1:5179',
    reuseExistingServer: !process.env.CI,
    timeout: 30000,
  },
});
