import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/*
 * M0 renderer feasibility spike (docs/plan.md §0). Every configuration runs on real Chrome with
 * the GPU. Results are appended to output/results.json and summarised in ADR-0001.
 */

const out = join(import.meta.dirname, '..', 'output');
mkdirSync(out, { recursive: true });
const resultsPath = join(out, 'results.json');
const results: Record<string, unknown> = existsSync(resultsPath) ? JSON.parse(readFileSync(resultsPath, 'utf8')) : {};
const record = (key: string, value: unknown) => {
  results[key] = value;
  writeFileSync(resultsPath, JSON.stringify(results, null, 2));
};

const configs = [
  { backend: 'webgpu', tier: 'high', ghost: 'layer' },
  { backend: 'webgl', tier: 'high', ghost: 'layer' },
  { backend: 'webgl', tier: 'mid', ghost: 'layer' },
] as const;

const PLATES = [0, 1, 2, 3, 4];

async function open(page: Page, query: string) {
  await page.goto(`/?capture=1&${query}`);
  await page.waitForFunction(() => document.body.dataset.ready === '1', null, { timeout: 60_000 });
}

async function capture(page: Page) {
  return PNG.sync.read(await page.locator('canvas').screenshot());
}

function diff(a: PNG, b: PNG, name: string) {
  const d = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
  const ratio = n / (a.width * a.height);
  if (ratio > 0) writeFileSync(join(out, `${name}.diff.png`), PNG.sync.write(d));
  return ratio;
}

for (const c of configs) {
  const q = `backend=${c.backend}&tier=${c.tier}&ghost=${c.ghost}`;
  const label = `${c.backend}-${c.tier}-${c.ghost}`;

  test(`${label}: backend and scene`, async ({ page }) => {
    await open(page, `${q}&t=0`);
    const info = await page.evaluate(() => window.spike.info());
    record(`${label}.info`, info);
    expect(info.backend).toBe(c.backend === 'webgl' ? 'webgl2' : 'webgpu');
  });

  test(`${label}: deterministic plates (cold load vs forward vs backward scrub)`, async ({ page }) => {
    const ratios: Record<string, { forward: number; backward: number }> = {};
    for (const t of PLATES) {
      await open(page, `${q}&t=${t}`);
      await page.evaluate(() => window.spike.settle());
      const cold = await capture(page);
      writeFileSync(join(out, `${label}-plate${t}.png`), PNG.sync.write(cold));

      await open(page, `${q}&t=0`);
      await page.evaluate((to) => window.spike.scrub(0, to, 40).then(() => window.spike.settle()), t);
      const forward = await capture(page);

      await open(page, `${q}&t=4`);
      await page.evaluate((to) => window.spike.scrub(4, to, 40).then(() => window.spike.settle()), t);
      const backward = await capture(page);

      ratios[`plate${t}`] = {
        forward: diff(cold, forward, `${label}-plate${t}-forward`),
        backward: diff(cold, backward, `${label}-plate${t}-backward`),
      };
    }
    record(`${label}.determinism`, ratios);
    for (const r of Object.values(ratios)) {
      expect(r.forward).toBeLessThan(0.005);
      expect(r.backward).toBeLessThan(0.005);
    }
  });

  test(`${label}: frame time`, async ({ page }) => {
    await open(page, `${q}&t=2`);
    const ghosted = await page.evaluate(() => window.spike.measure(6, true));
    await page.evaluate(() => window.spike.setT(3.5));
    const peeling = await page.evaluate(() => window.spike.measure(4, true));
    record(`${label}.perf`, { ghosted, peeling });
  });
}

test('frame pacing without GPU timestamp readback', async ({ page }) => {
  const pacing: Record<string, unknown> = {};
  for (const q of ['backend=webgpu&tier=high', 'backend=webgl&tier=high', 'backend=webgl&tier=mid']) {
    await open(page, `${q}&t=2&timing=0`);
    pacing[q] = await page.evaluate(() => window.spike.measure(6, true));
  }
  record('pacing.noTimestamps', pacing);
});

test('mid tier under 4x CPU throttle (WebGL2)', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page, 'backend=webgl&tier=mid&t=2&timing=0');
  const ghosted = await page.evaluate(() => window.spike.measure(6, true));
  record('webgl-mid-throttled.perf', { viewport: '1920x1080', cpuThrottle: 4, ghosted });
});

test('ghost stability: alpha-hash vs single-layer (WebGPU high)', async ({ page }) => {
  const stability: Record<string, number> = {};
  for (const ghost of ['hash', 'layer']) {
    await open(page, `backend=webgpu&tier=high&ghost=${ghost}&t=2`);
    await page.evaluate(() => window.spike.settle());
    const a = await capture(page);
    writeFileSync(join(out, `ghost-${ghost}.png`), PNG.sync.write(a));
    // Same state, 7 more frames: a stable resolve should be unchanged; stipple shows as flicker.
    await page.evaluate(() => window.spike.frames(7));
    const b = await capture(page);
    stability[ghost] = diff(a, b, `ghost-${ghost}-flicker`);
  }
  record('ghost.flickerRatio', stability);
});

test('backend parity: WebGPU vs WebGL2 (high tier) per plate', async () => {
  const parity: Record<string, number> = {};
  for (const t of PLATES) {
    const a = PNG.sync.read(readFileSync(join(out, `webgpu-high-layer-plate${t}.png`)));
    const b = PNG.sync.read(readFileSync(join(out, `webgl-high-layer-plate${t}.png`)));
    parity[`plate${t}`] = diff(a, b, `parity-plate${t}`);
  }
  record('parity.webgpuVsWebgl2', parity);
});
