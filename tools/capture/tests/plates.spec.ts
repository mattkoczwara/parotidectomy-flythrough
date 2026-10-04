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
  test.setTimeout(30 * 60_000); // one cold load per plate
  const ids = await plateIds(page);
  for (const [i, id] of ids.entries()) {
    await page.goto(`/?capture=1&cold=${i}#${id}`); // a fresh load, not a same-document hash change
    await waitConverged(page, i);
    writeFileSync(join(plates, `${id}.png`), await page.locator('.stage').screenshot());
  }
});

test('plates are deterministic: cold load vs forward and backward scroll arrival', async ({ page }) => {
  test.setTimeout(90 * 60_000); // 54 cold loads and two sequential passes (the criterion itself is unchanged)
  const ids = await plateIds(page);
  const results: Record<string, { forward: number; backward: number }> = {};
  const scrollToPlate = async (id: string) => {
    await page.evaluate((pid) => {
      const el = document.getElementById(pid)!;
      const line = innerHeight * parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--reading-line'));
      scrollTo({ top: el.getBoundingClientRect().top + scrollY - line + 24, behavior: 'auto' });
    }, id);
  };
  // Cold: a fresh load straight onto each plate.
  const cold: PNG[] = [];
  for (const [i, id] of ids.entries()) {
    await page.goto(`/?capture=1&cold=${i}#${id}`); // a fresh load, not a same-document hash change
    await waitConverged(page, i);
    cold.push(await stageShot(page));
  }
  // Forward: one pass from the first plate to the last, arriving at each by scrolling from the one before.
  const forward: PNG[] = [];
  await page.goto(`/?capture=1&pass=forward#${ids[0]}`);
  await waitConverged(page, 0);
  forward.push(await stageShot(page));
  for (let k = 1; k < ids.length; k++) {
    await scrollToPlate(ids[k]!);
    await page.waitForTimeout(250);
    await waitConverged(page, k);
    forward.push(await stageShot(page));
  }
  // Backward: one pass from the last plate to the first.
  const backward: PNG[] = new Array(ids.length);
  await page.goto(`/?capture=1&pass=backward#${ids[ids.length - 1]}`);
  await waitConverged(page, ids.length - 1);
  backward[ids.length - 1] = await stageShot(page);
  for (let k = ids.length - 2; k >= 0; k--) {
    await scrollToPlate(ids[k]!);
    await page.waitForTimeout(250);
    await waitConverged(page, k);
    backward[k] = await stageShot(page);
  }
  for (const [i, id] of ids.entries()) {
    results[id] = { forward: ratio(cold[i]!, forward[i]!, `${id}-forward`), backward: ratio(cold[i]!, backward[i]!, `${id}-backward`) };
    if (results[id]!.forward > 0.005 || results[id]!.backward > 0.005) {
      for (const [n, img] of [['cold', cold[i]!], ['forward', forward[i]!], ['backward', backward[i]!]] as const) writeFileSync(join(out, `${id}-${n}.png`), PNG.sync.write(img));
    }
  }
  writeFileSync(join(out, 'determinism.json'), JSON.stringify(results, null, 2));
  for (const [id, r] of Object.entries(results)) {
    expect.soft(r.forward, `${id}: forward arrival`).toBeLessThan(0.005);
    expect.soft(r.backward, `${id}: backward arrival`).toBeLessThan(0.005);
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

test('reduced motion renders plateau states only (dissolves, no camera flights)', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await waitConverged(page, 0);
  await page.evaluate(() => {
    const seen: string[] = [];
    (window as unknown as { __t: string[] }).__t = seen;
    new MutationObserver(() => seen.push(document.body.dataset.t ?? '')).observe(document.body, { attributes: true, attributeFilter: ['data-t'] });
  });
  await page.mouse.move(400, 500);
  for (let k = 0; k < 60; k++) {
    await page.mouse.wheel(0, 90);
    await page.waitForTimeout(40);
  }
  await page.waitForTimeout(1500);
  const seen = await page.evaluate(() => (window as unknown as { __t: string[] }).__t);
  expect(seen.length).toBeGreaterThan(0);
  for (const t of seen) expect(Number(t) % 1, `rendered t ${t}`).toBe(0);
});

test('static tier: every plate has its figure and description without the 3D scene', async ({ page }) => {
  await page.goto('/?static');
  await expect(page.locator('body')).toHaveClass(/static/);
  await expect(page.locator('.stage')).toBeHidden();
  const plates = await page.$$eval('[data-plate]', (els) =>
    els.map((a) => {
      const img = a.querySelector<HTMLImageElement>('.plate-figure img');
      const cap = a.querySelector<HTMLElement>('.plate-figure figcaption');
      return { id: a.id, img: !!img && getComputedStyle(img).display !== 'none', caption: (cap?.innerText ?? '').length };
    }),
  );
  for (const p of plates) {
    expect(p.img, `${p.id}: figure shown`).toBe(true);
    expect(p.caption, `${p.id}: description`).toBeGreaterThan(40);
  }
});
