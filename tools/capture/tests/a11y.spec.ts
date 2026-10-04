import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Automated accessibility audit (axe-core, WCAG 2.2 A and AA rules) of the atlas in its three states and the reference
 * pages. Automated rules catch only part of what matters; keyboard behaviour, announcements and reduced motion are
 * asserted in plates.spec.ts and instrument.spec.ts, and the semantic document is checked below by reading it as a
 * screen reader would (headings in order, every plate an article with a heading, description and figure).
 */

const out = join(import.meta.dirname, '..', 'output');
mkdirSync(out, { recursive: true });
const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

type Finding = { id: string; impact: string | null | undefined; help: string; nodes: number; sample: string };
const findings: Record<string, Finding[]> = {};

async function audit(page: Page, name: string, exclude: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(tags);
  for (const e of exclude) builder = builder.exclude(e);
  const result = await builder.analyze();
  findings[name] = result.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length, sample: v.nodes[0]?.target.join(' ') ?? '' }));
  writeFileSync(join(out, 'a11y.json'), JSON.stringify(findings, null, 2));
  return result.violations;
}

test('the atlas page has no automated accessibility violations (scene running)', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.converged === '0', undefined, { timeout: 90_000 });
  // The canvas is a labelled image; the scene's own pixels are not auditable by rule.
  const v = await audit(page, 'atlas');
  expect(v.map((x) => `${x.id}: ${x.help} (${x.nodes.length})`), 'violations').toEqual([]);
});

test('with the instrument open', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.converged === '0', undefined, { timeout: 90_000 });
  await page.locator('.instrument-toggle').click();
  const v = await audit(page, 'instrument');
  expect(v.map((x) => `${x.id}: ${x.help} (${x.nodes.length})`), 'violations').toEqual([]);
});

test('with the evidence drawer open', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => document.body.dataset.converged === '0', undefined, { timeout: 90_000 });
  await page.locator('.para-src').first().click();
  await expect(page.locator('dialog.evidence')).toBeVisible();
  const v = await audit(page, 'evidence');
  expect(v.map((x) => `${x.id}: ${x.help} (${x.nodes.length})`), 'violations').toEqual([]);
});

test('the static tier', async ({ page }) => {
  await page.goto('/?static');
  const v = await audit(page, 'static');
  expect(v.map((x) => `${x.id}: ${x.help} (${x.nodes.length})`), 'violations').toEqual([]);
});

for (const path of ['/method/', '/credits/', '/glossary/']) {
  test(`reference page ${path}`, async ({ page }) => {
    await page.goto(path);
    const v = await audit(page, path);
    expect(v.map((x) => `${x.id}: ${x.help} (${x.nodes.length})`), 'violations').toEqual([]);
  });
}

test('the document reads in order without the scene: headings, plates, figures', async ({ page }) => {
  await page.goto('/?static');
  const outline = await page.evaluate(() => {
    const heads = [...document.querySelectorAll('h1, h2, h3')].map((h) => Number(h.tagName[1]));
    const plates = [...document.querySelectorAll<HTMLElement>('[data-plate]')].map((a) => ({
      id: a.id,
      heading: !!a.querySelector('h3')?.textContent?.trim(),
      description: (a.querySelector('.plate-figure figcaption')?.textContent ?? '').length,
      figure: !!a.querySelector('.plate-figure img'),
    }));
    return { heads, plates, landmarks: ['main', 'nav', 'header'].map((t) => document.querySelectorAll(t).length) };
  });
  // No heading level is skipped on the way down.
  for (let i = 1; i < outline.heads.length; i++) expect(outline.heads[i]! - outline.heads[i - 1]!, `heading ${i}`).toBeLessThanOrEqual(1);
  expect(outline.plates.length).toBe(54);
  for (const p of outline.plates) {
    expect(p.heading, `${p.id}: heading`).toBe(true);
    expect(p.description, `${p.id}: description`).toBeGreaterThan(40);
    expect(p.figure, `${p.id}: figure`).toBe(true);
  }
  expect(outline.landmarks[0]).toBe(1);
});
