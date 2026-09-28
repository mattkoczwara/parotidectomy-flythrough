import { defineConfig } from '@playwright/test';

// Real Chrome with the GPU (WebGPU needs hardware); the production build served by `astro preview`.
export default defineConfig({
  testDir: 'tests',
  timeout: 240_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'output/test-results',
  use: {
    baseURL: 'http://localhost:4322',
    channel: 'chrome',
    headless: false,
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    launchOptions: { args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] },
  },
  webServer: {
    command: 'npm run preview -w @atlas/site -- --port 4322',
    cwd: '../..',
    port: 4322,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
