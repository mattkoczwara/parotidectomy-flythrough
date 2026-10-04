import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNG } from 'pngjs';

/*
 * Label and legibility criteria (plan §5, §14), measured on the rendered scene of every settled plate:
 * - at most 6 labels in landscape and 4 in portrait; no two overlap; all inside the scene;
 * - label text >= 4.5:1 against its scrim composited over the pixels beneath it;
 * - leader hairline >= 3:1 against its halo composited over the pixels beneath it;
 * - focus structures sit at least 15 L* above the field (luminance rule), sampled at their label anchors.
 * Colours are read from the page's computed styles, so the checks follow the stylesheet.
 */

const out = join(import.meta.dirname, '..', 'output');
mkdirSync(out, { recursive: true });

type RGBA = [number, number, number, number];
const parse = (css: string): RGBA => {
  const m = css.match(/rgba?\(([^)]+)\)/);
  if (!m) throw new Error(`unparsed colour ${css}`);
  const [r, g, b, a = '1'] = m[1]!.split(/[ ,/]+/).filter(Boolean);
  return [Number(r), Number(g), Number(b), Number(a)];
};
const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = ([r, g, b]: readonly number[]) => 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
const contrast = (a: readonly number[], b: readonly number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x! + 0.05) / (y! + 0.05);
};
const over = (top: RGBA, under: readonly number[]) => [0, 1, 2].map((i) => top[i]! * top[3] + under[i]! * (1 - top[3]));
const lstar = (rgb: readonly number[]) => {
  const y = lum(rgb);
  return y > 0.008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y;
};

async function plateIds(page: Page): Promise<string[]> {
  await page.goto('/');
  return page.$$eval('[data-plate]', (els) => els.map((e) => e.id));
}

interface PlateCheck {
  id: string;
  labels: number;
  overlaps: number;
  outside: number;
  minTextContrast: number;
  minLeaderContrast: number;
  focusLstarAboveField: number | null;
}

async function checkPlate(page: Page, id: string, index: number, query: string): Promise<PlateCheck> {
  await page.goto(`/?${query}&cold=${Date.now()}#${id}`);
  await page.waitForFunction((i) => document.body.dataset.converged === String(i), index, { timeout: 90_000 });
  const info = await page.evaluate(() => {
    const stage = document.querySelector('.stage')!.getBoundingClientRect();
    const labels = [...document.querySelectorAll<HTMLElement>('.labels li')].map((li) => {
      const r = li.getBoundingClientRect();
      return { x: r.left - stage.left, y: r.top - stage.top, w: r.width, h: r.height, emphasis: li.dataset.emphasis };
    });
    const halos = [...document.querySelectorAll<SVGLineElement>('.leaders line.halo')].map((l) => ['x1', 'y1', 'x2', 'y2'].map((k) => Number(l.getAttribute(k))));
    const dots = [...document.querySelectorAll<SVGCircleElement>('.leaders circle')].map((c) => [Number(c.getAttribute('cx')), Number(c.getAttribute('cy'))]);
    // probes styled like real labels and leaders (a plate may have none)
    const li = document.createElement('li');
    document.querySelector('.labels')!.append(li);
    const probes: Record<string, Element> = { '.labels li': li };
    for (const cls of ['halo', 'line']) {
      const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      l.setAttribute('class', cls);
      document.querySelector('.leaders')!.append(l);
      probes[`.leaders line.${cls}`] = l;
    }
    const cs = (sel: string, prop: string) => getComputedStyle(probes[sel]!).getPropertyValue(prop);
    queueMicrotask(() => Object.values(probes).forEach((p) => p.remove()));
    return {
      stage: { w: stage.width, h: stage.height },
      labels,
      halos,
      dots,
      ink: cs('.labels li', 'color'),
      scrim: cs('.labels li', 'background-color'),
      halo: cs('.leaders line.halo', 'stroke'),
      haloOpacity: cs('.leaders line.halo', 'stroke-opacity'),
      line: cs('.leaders line.line', 'stroke'),
      lineOpacity: cs('.leaders line.line', 'stroke-opacity'),
      field: getComputedStyle(document.body).backgroundColor,
    };
  });
  // the scene alone: hide the overlays and screenshot the canvas
  await page.addStyleTag({ content: '.labels, .leaders, .orient { visibility: hidden !important; }' });
  const png = PNG.sync.read(await page.locator('#stage-canvas').screenshot());
  const px = (x: number, y: number) => {
    const i = (Math.min(png.height - 1, Math.max(0, Math.round(y))) * png.width + Math.min(png.width - 1, Math.max(0, Math.round(x)))) * 4;
    return [png.data[i]!, png.data[i + 1]!, png.data[i + 2]!];
  };
  const ink = parse(info.ink);
  const scrim = parse(info.scrim);
  const withOpacity = (c: RGBA, o: string) => [c[0], c[1], c[2], c[3] * (o ? Number(o) : 1)] as RGBA;
  const halo = withOpacity(parse(info.halo), info.haloOpacity);
  const line = withOpacity(parse(info.line), info.lineOpacity);

  let minText = Infinity;
  for (const l of info.labels) {
    for (let y = l.y + 2; y < l.y + l.h - 2; y += 3) {
      for (let x = l.x + 2; x < l.x + l.w - 2; x += 3) minText = Math.min(minText, contrast(ink, over(scrim, px(x, y))));
    }
  }
  let minLeader = Infinity;
  for (const [x1, y1, x2, y2] of info.halos) {
    const n = Math.max(2, Math.hypot(x2! - x1!, y2! - y1!) / 4);
    for (let k = 1; k < n; k++) {
      const under = px(x1! + ((x2! - x1!) * k) / n, y1! + ((y2! - y1!) * k) / n);
      const haloEff = over(halo, under);
      minLeader = Math.min(minLeader, contrast(over(line, haloEff), haloEff));
    }
  }
  let overlaps = 0;
  let outside = 0;
  for (const [i, a] of info.labels.entries()) {
    if (a.x < 0 || a.y < 0 || a.x + a.w > info.stage.w || a.y + a.h > info.stage.h) outside++;
    for (const b of info.labels.slice(i + 1)) if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) overlaps++;
  }
  // Luminance rule at focus anchors: median L* of a 7x7 patch beside the leader dot.
  const fieldL = lstar(parse(info.field));
  const focusDots = info.labels.map((l, k) => ({ l, d: info.dots[k] })).filter((e) => e.l.emphasis === 'focus' && e.d);
  let focusAbove: number | null = null;
  for (const { d } of focusDots) {
    const vals: number[] = [];
    for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) vals.push(lstar(px(d![0]! + dx, d![1]! + dy)));
    vals.sort((a, b) => a - b);
    const above = vals[Math.floor(vals.length / 2)]! - fieldL;
    focusAbove = focusAbove === null ? above : Math.min(focusAbove, above);
  }
  return {
    id,
    labels: info.labels.length,
    overlaps,
    outside,
    minTextContrast: info.labels.length ? +minText.toFixed(2) : Infinity,
    minLeaderContrast: info.halos.length ? +minLeader.toFixed(2) : Infinity,
    focusLstarAboveField: focusAbove === null ? null : +focusAbove.toFixed(1),
  };
}

for (const layout of [
  { name: 'landscape', viewport: { width: 1600, height: 1000 }, max: 6 },
  { name: 'portrait', viewport: { width: 390, height: 844 }, max: 4 },
]) {
  test(`labels are legible and within limits (${layout.name})`, async ({ page }) => {
    test.setTimeout(30 * 60_000); // every plate, cold
    await page.setViewportSize(layout.viewport);
    await page.addInitScript(() => localStorage.setItem('atlas.depth', 'clinical')); // the most labels
    const ids = await plateIds(page);
    const results: PlateCheck[] = [];
    for (const [i, id] of ids.entries()) results.push(await checkPlate(page, id, i, 'labels=1'));
    writeFileSync(join(out, `labels-${layout.name}.json`), JSON.stringify(results, null, 2));
    for (const r of results) {
      expect.soft(r.labels, `${r.id}: label count`).toBeLessThanOrEqual(layout.max);
      expect.soft(r.overlaps, `${r.id}: overlapping labels`).toBe(0);
      expect.soft(r.outside, `${r.id}: labels outside the scene`).toBe(0);
      expect.soft(r.minTextContrast, `${r.id}: label text contrast`).toBeGreaterThanOrEqual(4.5);
      expect.soft(r.minLeaderContrast, `${r.id}: leader contrast`).toBeGreaterThanOrEqual(3);
      if (r.focusLstarAboveField !== null) expect.soft(r.focusLstarAboveField, `${r.id}: focus L* above field`).toBeGreaterThanOrEqual(15);
    }
  });
}
