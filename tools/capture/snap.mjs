/*
 * Quick look at plates while authoring (not a check): loads the running dev or preview server in real Chrome with
 * WebGPU, waits for each plate to converge, and writes the stage as PNG. With --sheet the plates are tiled into a
 * single contact sheet. Usage:
 *
 *   node tools/capture/snap.mjs <plate-id>... [--url http://localhost:4321] [--out dir] [--w 1280] [--h 800]
 *        [--sheet name.png] [--cols 2] [--clean] [--eval "js run in the page after convergence"] [--wait ms]
 *        [--patch '{"op":{"peel":1},"variantMix":{"resection":{"ecd":1}},"camera":{"azimuth":-20},"structures":{"skin":{"presence":0}}}']
 *
 * --patch (dev server only) merges the JSON into the plate's resolved state, applies it and settles: a look at a
 * state no plate authors yet. `op`, `variantMix`, `camera` and `structures` merge key by key.
 *
 * Plate ids may be given as `id` or `id@t` is not supported: use the director's console for fractional t.
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const clean = args.includes('--clean');
const flagValues = new Set(['--patch', '--url', '--out', '--w', '--h', '--sheet', '--cols', '--eval', '--wait', '--tier', '--backend']);
const ids = args.filter((a, i) => !a.startsWith('--') && !flagValues.has(args[i - 1] ?? ''));
const url = opt('url', 'http://localhost:4321');
const out = resolve(opt('out', join(import.meta.dirname, 'output', 'snap')));
const width = Number(opt('w', 1280));
const height = Number(opt('h', 800));
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on('console', (m) => {
  if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 300));
});
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

const files = [];
for (const id of ids) {
  const q = new URLSearchParams({ capture: '1', snap: String(Date.now()) });
  if (opt('tier')) q.set('tier', opt('tier'));
  if (opt('backend')) q.set('backend', opt('backend'));
  await page.goto(`${url}/?${q}#${id}`);
  if (clean) await page.addStyleTag({ content: '.labels,.leaders,.orient,.gauge,.instrument-toggle,.reset-view{display:none!important}' });
  const index = await page.evaluate((pid) => [...document.querySelectorAll('[data-plate]')].findIndex((e) => e.id === pid), id);
  if (index < 0) {
    console.log(`no plate "${id}"`);
    continue;
  }
  try {
    await page.waitForFunction((i) => document.body.dataset.converged === String(i), index, { timeout: 120_000 });
  } catch {
    console.log(`${id}: did not converge`);
  }
  const patchArg = opt('patch') ? JSON.parse(opt('patch')) : null;
  const patches = Array.isArray(patchArg) ? patchArg : patchArg ? [patchArg] : [null];
  for (const [pi, patch] of patches.entries()) {
    if (patch) {
      await page.evaluate(async (patch) => {
        const a = window.__atlas;
        const base = structuredClone(a.evaluate(a.track, a.current));
        const merge = (dst, src) => { for (const [k, v] of Object.entries(src)) dst[k] = v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k]) ? merge(dst[k], v) : v; return dst; };
        const state = merge(base, patch);
        if (patch.camera?.frame) state.camera.frames = [{ ids: patch.camera.frame, weight: 1 }];
        a.hold(state);
        a.stage.apply(state);
        a.stage.render();
        await a.stage.settle();
      }, patch);
      await page.waitForTimeout(Number(opt('wait', 800)));
    }
    if (opt('eval')) {
      const result = await page.evaluate(opt('eval'));
      if (result !== undefined) console.log(JSON.stringify(result));
      await page.waitForTimeout(Number(opt('wait', 1500)));
    }
    const file = join(out, patches.length > 1 ? `${id}.${pi}.png` : `${id}.png`);
    await page.locator('.stage').screenshot({ path: file });
    files.push(file);
    console.log(file);
  }
  continue;
}
await browser.close();

if (opt('sheet') && files.length) {
  const cols = Number(opt('cols', 2));
  const tw = Math.floor(width / (files.length > 1 ? 1 : 1));
  const rows = Math.ceil(files.length / cols);
  const cellW = Math.floor(1600 / cols);
  const cellH = Math.round((cellW * height) / width);
  const composites = await Promise.all(files.map(async (f, i) => ({ input: await sharp(f).resize(cellW, cellH).toBuffer(), left: (i % cols) * cellW, top: Math.floor(i / cols) * cellH })));
  const sheet = join(out, opt('sheet'));
  await sharp({ create: { width: cellW * cols, height: cellH * rows, channels: 3, background: '#000' } }).composite(composites).png().toFile(sheet);
  console.log('sheet', sheet, tw);
}
