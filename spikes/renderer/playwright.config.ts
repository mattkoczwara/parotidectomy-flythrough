import { defineConfig } from '@playwright/test';

// Real Chrome with the GPU enabled: WebGPU needs hardware, and the spike measures real frame times.
export default defineConfig({
  testDir: 'tests',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'output/test-results',
  use: {
    baseURL: 'http://localhost:5175',
    channel: 'chrome',
    headless: false,
    viewport: { width: 2560, height: 1440 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--window-position=0,0', '--disable-gpu-vsync', '--disable-frame-rate-limit'],
    },
  },
  webServer: {
    command: 'npx vite preview --port 5175 --strictPort',
    port: 5175,
    reuseExistingServer: false,
  },
});
