/*
 * Render headroom above the display's refresh rate (not a check). `npm run perf` paces frames to vsync, so on a 56-60 Hz
 * display it can show that every refresh was met, not how much time each frame leaves spare. This one-off run starts
 * Chrome with vsync and the frame-rate limit off, records the display rate on a static page, then scrolls the
 * whole atlas as perf.spec.ts does. While the scene moves it reports the interval between frames that submitted GPU
 * work (throughput, with back-pressure from the GPU) and, per such frame, the time from its first GPU submit to the
 * queue's completion (GPU work plus any queueing). Writes docs/perf/uncapped.json. `npm run build` first.
 *
 *   node tools/capture/uncapped.mjs
 */
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dirname, '..', '..');
const PORT = 4325;
const preview = spawn('npm', ['run', 'preview', '-w', '@atlas/site', '--', '--port', String(PORT)], { cwd: root, shell: true, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
  } catch {}
  await sleep(300);
}
const pct = (xs, p) => [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(xs.length * p))] ?? 0;
const stats = (xs) => ({ frames: xs.length, medianMs: +pct(xs, 0.5).toFixed(2), p95Ms: +pct(xs, 0.95).toFixed(2), p99Ms: +pct(xs, 0.99).toFixed(2), medianFps: +(1000 / pct(xs, 0.5)).toFixed(1) });
const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--enable-unsafe-webgpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] });
const report = { date: new Date().toISOString(), gpu: 'NVIDIA GeForce RTX 3070', flags: '--disable-gpu-vsync --disable-frame-rate-limit' };
try {
  {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto('data:text/html,<body style="background:%23222">ceiling</body>');
    const xs = await page.evaluate(() => new Promise((res) => { const f = []; let last = performance.now(); const t0 = last; const tick = (t) => { f.push(t - last); last = t; if (t - t0 < 4000) requestAnimationFrame(tick); else res(f.slice(10)); }; requestAnimationFrame(tick); }));
    report.static_page_display_pacing = stats(xs); // the display rate: a static page still paces to vsync
    await page.close();
  }
  for (const [key, viewport, deviceScaleFactor] of [['high_1600x1000', { width: 1600, height: 1000 }, 1], ['high_2560x1440_device_px', { width: 1707, height: 960 }, 1.5]]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor });
    const page = await context.newPage();
    // Count only animation frames that submitted GPU work (the director skips frames whose state did not change), and
    // time each such frame's GPU work from its first submit to the queue's completion.
    await page.addInitScript(() => {
      const submit = GPUQueue.prototype.submit;
      window.__sub = { n: 0, first: 0, queue: null };
      GPUQueue.prototype.submit = function (...a) {
        if (!window.__sub.first) window.__sub.first = performance.now();
        window.__sub.n++;
        window.__sub.queue = this;
        return submit.apply(this, a);
      };
    });
    await page.goto(`http://localhost:${PORT}/?tier=high#face`);
    await page.waitForFunction(() => document.body.dataset.converged === '0', null, { timeout: 90_000 });
    await page.evaluate(() => {
      window.__frames = [];
      window.__gpu = [];
      window.__subT = [];
      window.__doneT = [];
      let lastRendered = 0;
      let seen = window.__sub.n;
      const tick = (t) => {
        const s = window.__sub;
        if (s.n !== seen) {
          seen = s.n;
          const moving = document.querySelector('.stage').classList.contains('moving');
          if (moving && lastRendered) window.__frames.push(t - lastRendered);
          const start = s.first;
          window.__subT.push(start);
          s.queue.onSubmittedWorkDone().then(() => {
            const now = performance.now();
            window.__doneT.push(now);
            if (moving) window.__gpu.push(now - start);
          });
          lastRendered = t;
        }
        s.first = 0;
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
    // GPU throughput: frames completed per 250 ms bin, counted only in bins that end with at least three submitted
    // frames still outstanding (the GPU never waited for work in that bin), as milliseconds per frame.
    const { subT, doneT } = await page.evaluate(() => ({ subT: window.__subT, doneT: window.__doneT }));
    const BINW = 250;
    const perFrame = [];
    let si = 0;
    let di = 0;
    for (let b = Math.min(...doneT); b + BINW <= Math.max(...doneT); b += BINW) {
      while (si < subT.length && subT[si] <= b + BINW) si++;
      const before = di;
      while (di < doneT.length && doneT[di] <= b + BINW) di++;
      if (si - di >= 3 && di - before > 0) perFrame.push(BINW / (di - before));
    }
    report[key] = { renderedFrameInterval: stats(await page.evaluate(() => window.__frames)), gpuSubmitToDone: stats(await page.evaluate(() => window.__gpu)), gpuSaturatedMsPerFrame: { bins: perFrame.length, median: +pct(perFrame, 0.5).toFixed(2), p95: +pct(perFrame, 0.95).toFixed(2) }, canvas: await page.evaluate(() => { const c = document.querySelector('canvas'); return `${c.width}x${c.height}`; }), backend: await page.evaluate(() => document.body.dataset.backend) };
    console.log(key, JSON.stringify(report[key]));
    await context.close();
  }
} finally {
  await browser.close();
  // the server runs under a shell: stop the whole tree (Windows keeps the grandchild alive otherwise)
  if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(preview.pid), '/T', '/F']);
  else preview.kill();
}
console.log('static page', JSON.stringify(report.static_page_display_pacing));
writeFileSync(join(root, 'docs/perf/uncapped.json'), JSON.stringify(report, null, 2) + '\n');
process.exit(0);
