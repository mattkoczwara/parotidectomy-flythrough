import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';

/*
 * The instrument (plan §4) and the pages around the atlas, against the production build:
 * - the instrument opens by keyboard, its depth dial and view buttons change the picture and return on reset or on a
 *   new plate, a click asks about a structure, and the Explore chapter's operation controls drive the scene;
 * - the reference pages render and carry their content;
 * - the print presentation drops the scene and keeps the text, figures and notes.
 */

const out = join(import.meta.dirname, '..', 'output');
mkdirSync(out, { recursive: true });

async function converged(page: Page, index: number) {
  await page.waitForFunction((i) => document.body.dataset.converged === String(i), index, { timeout: 90_000 });
}
const shot = async (page: Page) => PNG.sync.read(await page.locator('#stage-canvas').screenshot());
function differs(a: PNG, b: PNG): number {
  const n = pixelmatch(a.data, b.data, undefined, a.width, a.height, { threshold: 0.1 });
  return n / (a.width * a.height);
}
async function settle(page: Page) {
  // The change applies on the next frame, which withdraws `converged`; the scene then converges again (TRAA reseeded).
  await page.waitForTimeout(400);
  await page.waitForFunction(() => document.body.dataset.converged !== undefined, undefined, { timeout: 60_000 });
}
const plateIndex = (page: Page, id: string) => page.evaluate((pid) => [...document.querySelectorAll('[data-plate]')].findIndex((e) => e.id === pid), id);

test('the instrument opens by keyboard and its controls change and restore the picture', async ({ page }) => {
  await page.goto('/#where-parotid');
  await converged(page, await plateIndex(page, 'where-parotid'));
  const base = await shot(page);

  const toggle = page.locator('.instrument-toggle');
  await toggle.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.instrument')).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');

  // The depth dial: muscle off.
  await page.locator('input[name="dial-muscle"][value="0"]').check();
  await settle(page);
  const dialled = await shot(page);
  expect(differs(base, dialled), 'muscle off changes the picture').toBeGreaterThan(0.005);

  // The view buttons turn the camera and offer the way back.
  await page.getByRole('button', { name: 'Turn the view to the right' }).click();
  await settle(page);
  await expect(page.locator('.reset-view')).toBeVisible();

  // Putting everything back restores the authored picture.
  await page.getByRole('button', { name: 'Back to the authored scene' }).click();
  await settle(page);
  await expect(page.locator('.reset-view')).toBeHidden();
  expect(differs(base, await shot(page)), 'reset restores the authored picture').toBeLessThan(0.005);

  // Escape puts the instrument down and returns focus to its button.
  await page.keyboard.press('Escape');
  await expect(page.locator('.instrument')).toBeHidden();
  await expect(toggle).toBeFocused();
});

test('a click asks about a structure, and a new plate returns the dial to the authored scene', async ({ page }) => {
  await page.goto('/#where-parotid');
  await converged(page, await plateIndex(page, 'where-parotid'));
  await page.locator('.instrument-toggle').click();
  const box = (await page.locator('#stage-canvas').boundingBox())!;
  // Try a grid of points around the gland until one lands on a structure.
  let named = '';
  for (const fx of [0.62, 0.7, 0.55, 0.78, 0.5]) {
    for (const fy of [0.45, 0.55, 0.35, 0.65]) {
      await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy);
      await page.waitForTimeout(150);
      named = (await page.locator('.inst-card h3').first().textContent().catch(() => '')) ?? '';
      if (named) break;
    }
    if (named) break;
  }
  expect(named.length, 'a structure card appears').toBeGreaterThan(0);

  await page.locator('input[name="dial-bone"][value="0"]').check();
  await expect(page.locator('input[name="dial-bone"][value="0"]')).toBeChecked();
  // Explicit navigation to the next plate puts the dial back.
  await page.keyboard.press('Escape'); // puts the instrument down; focus returns to its button, so the plate keys work
  await page.keyboard.press('j');
  await converged(page, (await plateIndex(page, 'where-parotid')) + 1);
  await expect(page.locator('input[name="dial-bone"][value="1"]')).toBeChecked();
});

test('the Explore chapter carries operation controls that drive the scene and reset', async ({ page }) => {
  await page.goto('/#explore');
  const index = await plateIndex(page, 'explore');
  await converged(page, index);
  const base = await shot(page);
  await page.locator('.instrument-toggle').click();
  await expect(page.locator('.inst-op')).toBeVisible();

  await page.locator('input[name="op-resection"][value="superficial"]').check();
  await page.locator('input[data-op="progress"]').fill('70');
  await settle(page);
  const mid = await shot(page);
  expect(differs(base, mid), 'the operation moves the pieces').toBeGreaterThan(0.01);

  await page.locator('input[data-op="progress"]').fill('100');
  await page.locator('input[name="op-barrier"][value="smas"]').check();
  await settle(page);
  expect(differs(mid, await shot(page)), 'closing changes the picture again').toBeGreaterThan(0.002);

  await page.getByRole('button', { name: 'Back to the authored scene' }).click();
  await settle(page);
  expect(differs(base, await shot(page)), 'reset restores the authored scene').toBeLessThan(0.005);

  // Leaving the chapter hides the operation controls.
  await page.keyboard.press('Escape');
  await page.keyboard.press('k');
  await converged(page, index - 1);
  await page.locator('.instrument-toggle').click();
  await expect(page.locator('.instrument')).toBeVisible();
  await expect(page.locator('.inst-op')).toBeHidden();
});

test('on a narrow screen the instrument is a sheet inside the scene', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/#where-parotid');
  await converged(page, await plateIndex(page, 'where-parotid'));
  await page.locator('.instrument-toggle').click();
  const stage = (await page.locator('.stage').boundingBox())!;
  const sheet = (await page.locator('.instrument').boundingBox())!;
  expect(sheet.x).toBeGreaterThanOrEqual(stage.x - 1);
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(stage.x + stage.width + 1);
  expect(sheet.y).toBeGreaterThanOrEqual(stage.y - 1);
  expect(sheet.y + sheet.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
  expect(sheet.height).toBeLessThanOrEqual(stage.height * 0.65);
});

for (const [path, heading, probe] of [
  ['/method/', 'Method', 'h2'],
  ['/credits/', 'Credits and sources', '.credit-list li, .bibliography li'],
  ['/glossary/', 'Glossary', 'dt'],
] as const) {
  test(`reference page ${path} renders its content without errors`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    const res = await page.goto(path);
    expect(res?.status()).toBe(200);
    await expect(page.locator('h1')).toHaveText(heading);
    expect(await page.locator(probe).count(), `${path}: content`).toBeGreaterThan(4);
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.locator('nav[aria-label="Reference pages"] a[aria-current="page"]')).toHaveCount(1);
    expect(errors, 'no console errors').toEqual([]);
  });
}

test('the glossary covers every term with a claim behind it', async ({ page }) => {
  await page.goto('/glossary/');
  const n = await page.locator('dt').count();
  expect(n).toBeGreaterThanOrEqual(40);
  const defs = await page.locator('.gloss').evaluateAll((els) => els.map((e) => e.querySelectorAll('dd').length));
  for (const d of defs) expect(d).toBe(2);
});

test('print drops the scene and keeps the text, the figures and the notes', async ({ page }) => {
  await page.goto('/#compare');
  await converged(page, await plateIndex(page, 'compare'));
  await page.evaluate(async () => {
    const imgs = [...document.querySelectorAll<HTMLImageElement>('.plate-figure img')];
    for (const i of imgs) i.loading = 'eager';
    await Promise.all(imgs.map((i) => i.decode().catch(() => undefined)));
  });
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('.stage')).toBeHidden();
  await expect(page.locator('.masthead')).toBeHidden();
  const info = await page.$$eval('[data-plate]', (els) =>
    els.map((a) => {
      const img = a.querySelector<HTMLImageElement>('.plate-figure img');
      return { id: a.id, img: !!img && getComputedStyle(img).display !== 'none' && img.naturalWidth > 0 };
    }),
  );
  writeFileSync(join(out, 'print.json'), JSON.stringify(info, null, 2));
  for (const p of info) expect(p.img, `${p.id}: figure in print`).toBe(true);
  const closedNote = await page.evaluate(() => {
    window.dispatchEvent(new Event('beforeprint'));
    return [...document.querySelectorAll<HTMLDetailsElement>('details[data-note]')].every((n) => n.open);
  });
  expect(closedNote, 'notes open for print').toBe(true);
  await page.emulateMedia({ media: 'screen' });
});
