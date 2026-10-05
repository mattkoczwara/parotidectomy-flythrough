import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/*
 * Quality tiers at run time (plan §9): the tier reported on <body data-tier> is the tier the stage renders.
 * Behavioural proof: data-tier together with data-pipeline (read back from the built pipeline: TRAA + GTAO for High,
 * FXAA for Mid). Visual proof, on one plate where the two differ visibly (the operative bed, where the AO shades the
 * wound): a settled picture after a run-time switch matches the cold load of that tier (the determinism criterion,
 * < 0.5% of pixels) and not the other one.
 */

const out = join(import.meta.dirname, '..', 'output');
mkdirSync(out, { recursive: true });
const PLATE = 'bed';
const SAME = 0.005;
const DIFFERENT = 0.05; // at the 0.02 threshold

const errors: string[] = [];
test.beforeEach(({ page }) => {
  errors.length = 0;
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
});
test.afterEach(() => expect(errors).toEqual([]));

async function settled(page: Page) {
  const index = await page.evaluate((id) => [...document.querySelectorAll('[data-plate]')].findIndex((e) => e.id === id), PLATE);
  await page.waitForFunction((i) => document.body.dataset.converged === String(i) && !document.querySelector('.poster'), index, { timeout: 120_000 });
}
async function shot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.locator('#stage-canvas').screenshot());
}
/** Share of pixels that differ: at 0.1 (the determinism criterion) for "the same picture"; at the finer 0.02 for "a different
 *  tier", since the AO and the anti-aliasing change many pixels by a little (about 11% of pixels at 0.02 on this plate). */
function ratio(a: PNG, b: PNG, name: string, threshold = 0.1): number {
  const d = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold });
  if (n) writeFileSync(join(out, `tier-${name}.diff.png`), PNG.sync.write(d));
  return n / (a.width * a.height);
}
const reported = (page: Page) => page.evaluate(() => ({ tier: document.body.dataset.tier, pipeline: document.body.dataset.pipeline, reason: document.body.dataset.tierReason }));
const PIPELINE = { high: 'traa+ao', mid: 'fxaa' } as const;

async function reference(page: Page, tier: 'high' | 'mid') {
  await page.goto(`/?tier=${tier}&ref=1#${PLATE}`);
  await settled(page);
  expect(await reported(page)).toMatchObject({ tier, pipeline: PIPELINE[tier] });
  return shot(page);
}

test('run-time tier selection changes the rendered tier; label, pipeline and picture agree', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const refs = { high: await reference(page, 'high'), mid: await reference(page, 'mid') };
  expect(ratio(refs.high, refs.mid, 'high-vs-mid', 0.02), 'High and Mid differ visibly on this plate').toBeGreaterThan(DIFFERENT);

  // Auto on a capable GPU: the steady-state warm-up (after the first convergence) keeps High.
  await page.goto(`/#${PLATE}`);
  await page.waitForFunction(() => document.body.dataset.tierP95 !== undefined, null, { timeout: 120_000 });
  await settled(page);
  expect(await reported(page)).toMatchObject({ tier: 'high', pipeline: 'traa+ao' });
  expect(await page.locator('#quality').inputValue()).toBe('auto');

  const select = async (tier: 'high' | 'mid', step: string) => {
    await page.selectOption('#quality', tier);
    await page.waitForTimeout(100);
    await settled(page);
    expect(await reported(page), step).toMatchObject({ tier, pipeline: PIPELINE[tier] });
    const pic = await shot(page);
    const other = tier === 'high' ? 'mid' : 'high';
    expect(ratio(pic, refs[tier], `${step}-same`), `${step}: matches the ${tier} reference`).toBeLessThan(SAME);
    expect(ratio(pic, refs[other], `${step}-other`, 0.02), `${step}: differs from the ${other} reference`).toBeGreaterThan(DIFFERENT);
  };
  await select('high', 'high-to-high');
  await select('mid', 'high-to-mid');
  await select('high', 'mid-to-high');
  await page.selectOption('#quality', 'mid');
  await select('mid', 'mid-to-mid');

  // A switch in the middle of a settle stops it cleanly (no stale TRAA history) and the new tier settles.
  await page.selectOption('#quality', 'high');
  await page.waitForFunction(() => document.body.dataset.converged === undefined);
  await page.waitForTimeout(300); // part-way through the High accumulation
  await select('mid', 'switch-during-settle');
});

test('a manual tier persists across a reload; Auto is restored', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await page.goto(`/#${PLATE}`);
  await settled(page);
  for (const tier of ['mid', 'high'] as const) {
    await page.selectOption('#quality', tier);
    await page.reload();
    await settled(page);
    expect(await page.locator('#quality').inputValue()).toBe(tier);
    expect(await reported(page)).toMatchObject({ tier, pipeline: PIPELINE[tier] });
    expect(await page.evaluate(() => document.body.dataset.tierP95), 'a manual tier is not measured').toBeUndefined();
  }
  await page.selectOption('#quality', 'auto');
  await page.reload();
  await settled(page);
  expect(await page.locator('#quality').inputValue()).toBe('auto');
  expect(await reported(page)).toMatchObject({ tier: 'high', pipeline: 'traa+ao' });
});

test('Auto steps down when High cannot be sustained (CPU throttled), and renders Mid', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  const midRef = await reference(page, 'mid');
  const cdp = await page.context().newCDPSession(page);
  await page.goto(`/#${PLATE}`);
  // The first convergence unthrottled (the cold shader build is not what Auto measures); the warm-up starts right after it.
  await page.waitForFunction(() => performance.getEntriesByName('atlas:converged').length > 0, null, { timeout: 120_000, polling: 10 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
  try {
    await page.waitForFunction(() => document.body.dataset.tier === 'mid', null, { timeout: 120_000 });
  } finally {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  }
  const r = await reported(page);
  expect(r).toMatchObject({ tier: 'mid', pipeline: 'fxaa' });
  expect(r.reason).toMatch(/^warm-up/);
  expect(await page.locator('#quality').inputValue()).toBe('auto');
  await settled(page);
  expect(ratio(await shot(page), midRef, 'auto-downgrade'), 'the downgraded picture is Mid').toBeLessThan(SAME);
});
