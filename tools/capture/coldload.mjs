/*
 * Cold-load timing for look development (not a check): serves the production build, opens the atlas cold in real
 * Chrome (WebGPU) and reports when the scene was interactive, when the first plate converged, and how many render
 * pipelines and node materials three built by then. `npm run build` first.
 *
 *   node tools/capture/coldload.mjs [#plate-id] [--runs 2]
 */
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const args = process.argv.slice(2);
const hash = args.find((a) => a.startsWith('#')) ?? '';
const runs = Number(args[args.indexOf('--runs') + 1] || 2) || 2;
const PORT = 4324;
const preview = spawn('npm', ['run', 'preview', '-w', '@atlas/site', '--', '--port', String(PORT)], { cwd: root, shell: true, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {}
  await sleep(300);
}
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist'] });
try {
  for (let r = 0; r < runs; r++) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    // Long main-thread tasks (synchronous shader/pipeline builds land here) and the frame intervals after ready.
    await page.addInitScript(() => {
      const w = window;
      w.__lt = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) w.__lt.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
      w.__frames = [];
      const tick = (t) => { w.__frames.push(t); requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    await page.goto(`http://localhost:${PORT}/?capture=1&r=${r}${hash}`);
    await page.waitForFunction(() => document.querySelector('#stage-canvas')?.dataset.ready === '1', null, { timeout: 120_000 });
    const ready = Date.now() - t0;
    await page.waitForFunction(() => document.body.dataset.converged !== undefined, null, { timeout: 180_000 });
    const converged = Date.now() - t0;
    const stats = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const lt = window.__lt;
      const ready = performance.getEntriesByName('atlas:ready')[0]?.startTime ?? 0;
      const after = lt.filter(([s]) => s >= ready - 50);
      const f = window.__frames.filter((t) => t >= ready);
      const gaps = f.slice(1).map((t, i) => t - f[i]);
      return { readyAt: Math.round(ready), longTasksAfterReady: after.length, longTaskMsAfterReady: after.reduce((a, [, d]) => a + d, 0), biggest: after.sort((a, b) => b[1] - a[1]).slice(0, 6), frames: f.length, slowFrames: gaps.filter((g) => g > 40).length, slowFrameMs: Math.round(gaps.filter((g) => g > 40).reduce((a, b) => a + b, 0)) };
    });
    console.log(JSON.stringify({ run: r, plate: hash || '#face', readyMs: ready, firstConvergedMs: converged, ...stats }));
    await context.close();
  }
} finally {
  await browser.close();
  preview.kill();
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(preview.pid), '/t', '/f'], { stdio: 'ignore' });
}
