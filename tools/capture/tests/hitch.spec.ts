import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * Plate-transition hitch detector (`npm run hitch`; a diagnostic, not part of `capture`). Lightweight on purpose: it
 * records only each animation frame's interval with the rendered timeline position and stage state, plus long animation
 * frames and long tasks, so the measurement does not cause the stalls it looks for.
 * Procedure: production build, High tier, 1600x1000, the perf walk (22 px wheel steps) over all 54 plates. One full
 * traversal warms the page; then RUNS measured traversals on the same page, each from the top.
 * A stall (> 40 ms) is "recurring" when another run stalls in the same transition and progress band.
 * Output: HITCH_OUT (default docs/perf/hitch-latest.json).
 */

const root = join(import.meta.dirname, '..', '..', '..');
const outFile = join(root, process.env['HITCH_OUT'] ?? 'docs/perf/hitch-latest.json');
const RUNS = Number(process.env['HITCH_RUNS'] ?? 2);
/** Deep attribution (HITCH_PROBE=1): WebGPU resource creation per stall; perturbs timing, so never used for acceptance. */
const PROBE = process.env['HITCH_PROBE'] === '1';
const QUERY = process.env['HITCH_QUERY'] ?? 'tier=high';
test.setTimeout(60 * 60_000);

interface Frame { at: number; dt: number; t: number; moving: boolean; converged: boolean }
interface Loaf { start: number; duration: number; blocking: number; layout: number; scripts: { fn: string; src: string; invoker: string; ms: number }[] }

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0;
};
const r1 = (x: number) => Math.round(x * 10) / 10;

async function install(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __hitch: { on: boolean; frames: Frame[]; loaf: Loaf[]; tasks: { start: number; duration: number }[] } };
    w.__hitch = { on: false, frames: [], loaf: [], tasks: [] };
    const h = w.__hitch;
    let last = performance.now();
    const stage = document.querySelector('.stage')!;
    const tick = (now: number) => {
      if (h.on) h.frames.push({ at: now, dt: now - last, t: Number(document.body.dataset.t ?? NaN), moving: stage.classList.contains('moving'), converged: document.body.dataset.converged !== undefined });
      last = now;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    new PerformanceObserver((l) => {
      if (!h.on) return;
      for (const e of l.getEntries() as unknown as { startTime: number; duration: number; blockingDuration: number; scripts: { sourceFunctionName: string; sourceURL: string; invoker: string; duration: number; forcedStyleAndLayoutDuration: number }[] }[])
        h.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration, layout: e.scripts.reduce((a, s) => a + s.forcedStyleAndLayoutDuration, 0), scripts: e.scripts.filter((s) => s.duration > 5).map((s) => ({ fn: s.sourceFunctionName, src: s.sourceURL.split('/').pop() ?? '', invoker: s.invoker, ms: Math.round(s.duration) })) });
    }).observe({ type: 'long-animation-frame' });
    new PerformanceObserver((l) => {
      if (h.on) for (const e of l.getEntries()) h.tasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask' });
  });
}

async function walk(page: Page) {
  await page.mouse.move(800, 500);
  const height = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
  for (let y = 0; y < height; y += 22) {
    await page.mouse.wheel(0, 22);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(1500);
}

async function toTop(page: Page) {
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'auto' }));
  await page.waitForFunction(() => document.body.dataset.converged === '0', null, { timeout: 120_000 });
}

function analyse(frames: Frame[], loaf: Loaf[], tasks: { start: number; duration: number }[], ids: string[]) {
  const per = new Map<number, number[]>();
  const stalls: { transition: string; from: number; progress: number; dt: number; moving: boolean; at: number; loaf?: Loaf }[] = [];
  for (const f of frames) {
    if (!Number.isFinite(f.t)) continue;
    const from = Math.min(Math.floor(f.t), ids.length - 2);
    (per.get(from) ?? per.set(from, []).get(from)!).push(f.dt);
    if (f.dt > 40) {
      const l = loaf.find((e) => e.start <= f.at && e.start + e.duration >= f.at - f.dt);
      stalls.push({ transition: `${ids[from]}→${ids[from + 1]}`, from, progress: r1(f.t - from), dt: Math.round(f.dt), moving: f.moving, at: Math.round(f.at), ...(l ? { loaf: l } : {}) });
    }
  }
  const dts = frames.map((f) => f.dt);
  const transitions = [...per.entries()].sort((a, b) => a[0] - b[0]).map(([from, xs]) => ({
    transition: `${ids[from]}→${ids[from + 1]}`,
    frames: xs.length,
    maxMs: Math.round(Math.max(...xs)),
    over25: xs.filter((x) => x > 25).length,
    over40: xs.filter((x) => x > 40).length,
    p95Ms: r1(pct(xs, 0.95)),
  }));
  return {
    totals: { frames: frames.length, medianMs: r1(pct(dts, 0.5)), medianFps: r1(1000 / pct(dts, 0.5)), p95Ms: r1(pct(dts, 0.95)), maxMs: Math.round(Math.max(...dts)), over25: dts.filter((x) => x > 25).length, over40: dts.filter((x) => x > 40).length, longTasks: tasks.length, longAnimationFrames: loaf.length, transitionsWithStall: transitions.filter((t) => t.over40).length },
    transitions,
    stalls,
  };
}

test('plate-transition hitches over warmed full traversals', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (m) => (m.type() === 'error' || m.type() === 'warning') && consoleErrors.push(`${m.type()}: ${m.text()}`));
  page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
  if (PROBE)
    await page.addInitScript(() => {
      const log: { at: number; name: string; ms: number }[] = [];
      Object.assign(window, { __gpu: log });
      const proto = (globalThis as unknown as { GPUDevice?: { prototype: Record<string, unknown> } }).GPUDevice?.prototype;
      if (!proto) return;
      for (const name of ['createRenderPipeline', 'createRenderPipelineAsync', 'createShaderModule', 'createBindGroup', 'createBindGroupLayout', 'createTexture', 'createBuffer', 'createSampler']) {
        const f = proto[name] as (...a: unknown[]) => unknown;
        proto[name] = function (this: unknown, ...args: unknown[]) {
          const t = performance.now();
          const r = f.apply(this, args);
          log.push({ at: t, name, ms: performance.now() - t });
          return r;
        };
      }
    });
  await page.goto(`/?${QUERY}#face`);
  await page.waitForFunction(() => document.body.dataset.converged === '0', null, { timeout: 120_000 });
  const ids = await page.$$eval('[data-plate]', (els) => els.map((e) => e.id));
  await install(page);
  await walk(page); // warm-up traversal: every plate's shaders and pipelines built once
  const runs = [];
  for (let k = 0; k < RUNS; k++) {
    await toTop(page);
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const w = window as unknown as { __gpu?: unknown[] };
      if (w.__gpu) w.__gpu.length = 0;
      const h = (window as unknown as { __hitch: { on: boolean; frames: unknown[]; loaf: unknown[]; tasks: unknown[] } }).__hitch;
      h.frames = [];
      h.loaf = [];
      h.tasks = [];
      h.on = true;
    });
    await walk(page);
    const data = await page.evaluate(() => {
      const h = (window as unknown as { __hitch: { on: boolean; frames: Frame[]; loaf: Loaf[]; tasks: { start: number; duration: number }[] } }).__hitch;
      h.on = false;
      return { frames: h.frames, loaf: h.loaf, tasks: h.tasks };
    });
    const run = analyse(data.frames, data.loaf, data.tasks, ids);
    if (PROBE) {
      const gpuLog = await page.evaluate(() => (window as unknown as { __gpu?: { at: number; name: string; ms: number }[] }).__gpu ?? []);
      (run as Record<string, unknown>)['gpuCreations'] = gpuLog.length;
      for (const st of run.stalls) {
        const from = st.at - st.dt - 2;
        const gpu: Record<string, { n: number; ms: number }> = {};
        for (const g of gpuLog.filter((g) => g.at >= from && g.at < st.at)) {
          const e = (gpu[g.name] ??= { n: 0, ms: 0 });
          e.n++;
          e.ms = r1(e.ms + g.ms);
        }
        Object.assign(st, { gpu });
      }
    }
    runs.push(run);
  }
  // Recurring: a stall in the same transition and progress band (±0.1) in another run.
  const recurring = new Set<string>();
  for (const [i, r] of runs.entries())
    for (const s of r.stalls)
      if (runs.some((o, j) => j !== i && o.stalls.some((q) => q.from === s.from && Math.abs(q.progress - s.progress) <= 0.1))) recurring.add(`${s.transition} @${s.progress}`);
  const tier = await page.evaluate(() => ({ tier: document.body.dataset.tier, pipeline: document.body.dataset.pipeline, backend: document.body.dataset.backend }));
  const report = { date: new Date().toISOString(), query: QUERY, ...tier, runs: runs.map((r) => ({ ...r, stalls: r.stalls })), recurring: [...recurring].sort(), consoleErrors };
  mkdirSync(join(outFile, '..'), { recursive: true });
  writeFileSync(outFile, JSON.stringify(report, null, 2) + '\n');
  for (const [i, r] of runs.entries()) console.log(`run ${i + 1}:`, JSON.stringify(r.totals));
  console.log('recurring stalls:', report.recurring.length, report.recurring.join(', '));
  expect(consoleErrors).toEqual([]);
});
