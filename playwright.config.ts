import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置
 *
 * 两个产品各自有 Gateway 实例，通过 project 分离：
 * - FluxVita（企业版）：默认 http://localhost:18800
 * - Jowork（社区版）：默认 http://localhost:18810
 * - contracts（纯 API）：共享 FluxVita Gateway
 */
const FLUXVITA_URL = process.env['FLUXVITA_URL'] || 'http://localhost:18800';
const JOWORK_URL = process.env['JOWORK_URL'] || 'http://localhost:18810';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/e2e/.results',

  fullyParallel: true,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 1,
  workers: process.env['CI'] ? 1 : 3,

  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: './tests/e2e/.report' }],
  ],

  use: {
    headless: true,
    trace: 'on-first-retry',
    video: 'off',
    screenshot: 'off',
  },

  projects: [
    {
      name: 'setup',
      testMatch: /global-setup\.ts$/,
      use: { baseURL: FLUXVITA_URL },
    },
    {
      name: 'fluxvita',
      testDir: './tests/e2e/fluxvita',
      use: { ...devices['Desktop Chrome'], baseURL: FLUXVITA_URL },
      dependencies: ['setup'],
    },
    {
      name: 'jowork',
      testDir: './tests/e2e/jowork',
      use: { ...devices['Desktop Chrome'], baseURL: JOWORK_URL },
      dependencies: ['setup'],
    },
    {
      name: 'contracts',
      testDir: './tests/e2e/contracts',
      use: { baseURL: FLUXVITA_URL },
      dependencies: ['setup'],
    },
  ],
});
