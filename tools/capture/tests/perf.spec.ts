import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Performance measurement on the assembled atlas (54 plates) (plan §9, §14), run with `npm run perf` (not part of `capture`).
 * - frame pacing while scrolling through every transition: High (WebGPU) at 2560x1440 and 1600x1000, Mid
 *   (WebGL2) with the CPU throttled 4x; the scene renders every frame while it moves;
 * - cold-load payload (bytes transferred) and time to an interactive scene on a 50 Mbps link.
 * The GPU is not throttled (an RTX 3070 here); Mid-class hardware is approximated, not measured (STATUS).
 */

const root = join(import.meta.dirname, '..', '..', '..');
const reportFile = join(root, 'docs/perf/m5-report.json');
const header = { date: new Date().toISOString(), gpu: 'NVIDIA GeForce RTX 3070 (driver 617.14)', browser: 'Chrome (Playwright channel "chrome")' };
// A failed test restarts the worker and with it this module, so each result is merged into the file as it is made.
function record(key: string, value: unknown) {
  let report: Record<string, unknown> = {};
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8')) as Record<string, unknown>;
  } catch {
    /* first result */
  }
  mkdirSync(join(root, 'docs/perf'), { recursive: true });
  writeFileSync(reportFile, JSON.stringify({ ...report, ...header, [key]: value }, null, 2) + '\n');
}
// 54 plates are about 80,000 px of scrolling at 22 px per wheel event: each run takes minutes, longer when throttled.
test.setTimeout(30 * 60_000);
const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};

async function scrollRun(page: Page, query: string) {
  await page.goto(`/?${query}#face`);
  await page.waitForFunction(() => document.body.dataset.converged === '0', null, { timeout: 90_000 });
  await page.evaluate(() => {
    const w = window as unknown as { __frames: number[] };
    w.__frames = [];
    let last = performance.now();
    const tick = (t: number) => {
      if (document.querySelector('.stage')!.classList.contains('moving')) w.__frames.push(t - last);
      last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(800, 500);
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y < height; y += 22) {
    await page.mouse.wheel(0, 22);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(800);
  const frames = await page.evaluate(() => (window as unknown as { __frames: number[] }).__frames);
  const tier = await page.evaluate(() => ({ tier: document.body.dataset.tier, backend: document.body.dataset.backend }));
  return { ...tier, frames: frames.length, medianMs: +pct(frames, 0.5).toFixed(2), p95Ms: +pct(frames, 0.95).toFixed(2), medianFps: +(1000 / pct(frames, 0.5)).toFixed(1) };
}

test('High tier frame pacing at 1600x1000', async ({ page }) => {
  record('high_1600x1000', await scrollRun(page, 'tier=high'));
});

// 1440p in device pixels: a window larger than this monitor would be partly off-screen, where Chrome throttles
// animation frames, so a 1707x960 viewport at device scale 1.5 renders a 2560x1440 canvas instead.
test.describe('at 1440p', () => {
  test.use({ viewport: { width: 1707, height: 960 }, deviceScaleFactor: 1.5 });
  test('High tier frame pacing at 2560x1440 device pixels', async ({ page }) => {
    const r = await scrollRun(page, 'tier=high');
    record('high_2560x1440_device_px', { ...r, canvas: await page.evaluate(() => { const c = document.querySelector('canvas')!; return `${c.width}x${c.height}`; }) });
  });
});

test('Mid tier (WebGL2) with the CPU throttled 4x', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.setViewportSize({ width: 1600, height: 1000 });
  record('mid_webgl2_cpu4x_1600x1000', await scrollRun(page, 'tier=mid&backend=webgl'));
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
});

test('cold-load payload and time to interactive on 50 Mbps', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 20, downloadThroughput: (50e6 / 8) | 0, uploadThroughput: (10e6 / 8) | 0 });
  let bytes = 0;
  cdp.on('Network.loadingFinished', (e: { encodedDataLength: number }) => (bytes += e.encodedDataLength));
  await page.goto('/?tier=high');
  await page.waitForFunction(() => document.body.dataset.converged === '0', null, { timeout: 120_000 });
  const marks = await page.evaluate(() => ({
    ready: performance.getEntriesByName('atlas:ready')[0]?.startTime ?? null,
    converged: performance.getEntriesByName('atlas:converged')[0]?.startTime ?? null,
    domContentLoaded: (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming).domContentLoadedEventEnd,
  }));
  record('cold_load_50mbps', { bytesTransferred: bytes, megabytes: +(bytes / 1e6).toFixed(2), sceneInteractiveMs: marks.ready && Math.round(marks.ready), firstPlateConvergedMs: marks.converged && Math.round(marks.converged), textReadableMs: Math.round(marks.domContentLoaded) });
});
