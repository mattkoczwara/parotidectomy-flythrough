import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/*
 * Plate capture and behaviour checks against the production build (plan §14, owner refinements):
 * - static fallback figures (apps/site/public/plates/<id>.png) from settled, converged plates;
 * - determinism: cold deep link vs forward vs backward scroll arrival (< 0.5% pixels differ);
 * - passive scrolling never moves focus; only settled plates are announced; explicit navigation focuses the heading.
 */

const root = join(import.meta.dirname, '..', '..', '..');
const out = join(import.meta.dirname, '..', 'output');
const plates = join(root, 'apps/site/public/plates');
mkdirSync(out, { recursive: true });
mkdirSync(plates, { recursive: true });

async function plateIds(page: Page): Promise<string[]> {
  await page.goto('/');
  return page.$$eval('[data-plate]', (els) => els.map((e) => e.id));
}

async function waitConverged(page: Page, index: number) {
  await page.waitForFunction((i) => document.body.dataset.converged === String(i), index, { timeout: 90_000 });
}

async function stageShot(page: Page): Promise<PNG> {
  return PNG.sync.read(await page.locator('.stage').screenshot());
}

function ratio(a: PNG, b: PNG, name: string): number {
  const d = new PNG({ width: a.width, height: a.height });
  const n = pixelmatch(a.data, b.data, d.data, a.width, a.height, { threshold: 0.1 });
  if (n) writeFileSync(join(out, `${name}.diff.png`), PNG.sync.write(d));
  return n / (a.width * a.height);
}

test('static fallback figure for every plate', async ({ page }) => {
  const ids = await plateIds(page);
  for (const [i, id] of ids.entries()) {
    await page.goto(`/?capture=1&cold=${i}#${id}`); // a fresh load, not a same-document hash change
    await waitConverged(page, i);
    writeFileSync(join(plates, `${id}.png`), await page.locator('.stage').screenshot());
  }
});

test('plates are deterministic: cold load vs forward and backward scroll arrival', async ({ page }) => {
  const ids = await plateIds(page);
  const results: Record<string, { forward: number; backward: number }> = {};
  const scrollToPlate = async (id: string) => {
    await page.evaluate((pid) => {
      const el = document.getElementById(pid)!;
      const line = innerHeight * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reading-line'));
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - line + 24, behavior: 'auto' });
    }, id);
  };
  for (const [i, id] of ids.entries()) {
    await page.goto(`/?capture=1&cold=${i}#${id}`); // a fresh load, not a same-document hash change
    await waitConverged(page, i);
    const cold = await stageShot(page);

    await page.goto(`/?capture=1&from=first-${i}#${ids[0]}`);
    await waitConverged(page, 0);
    for (let k = 1; k <= i; k++) {
      await scrollToPlate(ids[k]!);
      await page.waitForTimeout(250);
    }
    await waitConverged(page, i);
    const forward = await stageShot(page);

    await page.goto(`/?capture=1&from=last-${i}#${ids[ids.length - 1]}`);
    await waitConverged(page, ids.length - 1);
    for (let k = ids.length - 2; k >= i; k--) {
      await scrollToPlate(ids[k]!);
      await page.waitForTimeout(250);
    }
    await waitConverged(page, i);
    const backward = await stageShot(page);
    results[id] = { forward: ratio(cold, forward, `${id}-forward`), backward: ratio(cold, backward, `${id}-backward`) };
    if (results[id]!.forward > 0.005 || results[id]!.backward > 0.005) {
      for (const [n, img] of [['cold', cold], ['forward', forward], ['backward', backward]] as const) writeFileSync(join(out, `${id}-${n}.png`), PNG.sync.write(img));
    }
  }
  writeFileSync(join(out, 'determinism.json'), JSON.stringify(results, null, 2));
  for (const r of Object.values(results)) {
    expect(r.forward).toBeLessThan(0.005);
    expect(r.backward).toBeLessThan(0.005);
  }
});

test('passive scrolling never moves focus and announces only settled plates', async ({ page }) => {
  await page.goto('/');
  await waitConverged(page, 0);
  const before = await page.evaluate(() => document.activeElement?.tagName);
  await page.evaluate(() => {
    const live = document.querySelector('.live')!;
    (window as unknown as { __announcements: string[] }).__announcements = [];
    new MutationObserver(() => (window as unknown as { __announcements: string[] }).__announcements.push(live.textContent ?? '')).observe(live, { childList: true, characterData: true, subtree: true });
  });
  await page.mouse.move(400, 500);
  for (let k = 0; k < 40; k++) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(30);
  }
  // No snapping: the scroll may rest on a plateau (settles and announces once) or in a transition (announces nothing).
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.activeElement?.tagName);
  const settled = await page.evaluate(() => document.body.dataset.settled);
  const announcements = await page.evaluate(() => (window as unknown as { __announcements: string[] }).__announcements);
  writeFileSync(join(out, 'announcements.json'), JSON.stringify({ settled: settled ?? null, announcements }, null, 2));
  expect(after).toBe(before);
  // Continuous scrolling across several plates announces only where the scroll came to rest.
  expect(announcements.length).toBeLessThanOrEqual(settled === undefined ? 0 : 1);
});

test('explicit navigation moves focus to the destination heading once settled', async ({ page }) => {
  const ids = await plateIds(page);
  await page.goto('/');
  await waitConverged(page, 0);
  await page.keyboard.press('j');
  await waitConverged(page, 1);
  const focused = await page.evaluate(() => document.activeElement?.closest('[data-plate]')?.id);
  expect(focused).toBe(ids[1]);
});
