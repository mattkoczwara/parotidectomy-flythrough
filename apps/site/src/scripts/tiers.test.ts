import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tier } from '@atlas/stage';
import { TierManager, type TierChoice } from './tiers.ts';

/** A stage that renders what it is asked for (Stage.setTier after the fix). */
const fakeStage = (backend: 'webgpu' | 'webgl2' = 'webgpu', tier: Tier = 'high') => ({
  backend,
  tier,
  calls: [] as Tier[],
  setTier(t: Tier) {
    this.calls.push(t);
    this.tier = t;
  },
  render() {},
});

const manager = (choice: TierChoice, opts: { backend?: 'webgpu' | 'webgl2'; forced?: boolean } = {}) => {
  const stage = fakeStage(opts.backend);
  const changes: [Tier, string][] = [];
  const tm = new TierManager(stage as never, choice, opts.forced ?? false, (t, r) => changes.push([t, r]));
  stage.setTier(tm.initial());
  stage.calls.length = 0;
  return { tm, stage, changes };
};

/** Animation frames at a fixed interval (ms), from a fake clock. */
function framesEvery(interval: number | ((i: number) => number)) {
  let now = 0;
  let i = 0;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    now += typeof interval === 'number' ? interval : interval(i++);
    queueMicrotask(() => cb(now));
    return 0;
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
  vi.stubGlobal('document', { body: { dataset: {} as Record<string, string> } });
});

describe('TierManager', () => {
  it('starts Auto at High on WebGPU and Mid on WebGL2; a manual choice starts where it says', () => {
    expect(manager('auto').stage.tier).toBe('high');
    expect(manager('auto', { backend: 'webgl2' }).stage.tier).toBe('mid');
    expect(manager('mid').stage.tier).toBe('mid');
    expect(manager('high').stage.tier).toBe('high');
  });

  it('switches High to Mid and back at run time, reporting the tier the stage renders', () => {
    const { tm, stage, changes } = manager('auto');
    tm.choose('mid');
    expect(stage.tier).toBe('mid');
    tm.choose('high');
    expect(stage.tier).toBe('high');
    tm.choose('high'); // High → High: nothing to rebuild
    expect(stage.calls).toEqual(['mid', 'high']);
    expect(changes.map(([t]) => t)).toEqual(['mid', 'high']);
  });

  it('reports what the stage actually renders, not the request', () => {
    const { tm, stage, changes } = manager('high');
    stage.setTier = function (this: typeof stage) {
      /* a stage that ignored the request (the old defect) */
    } as never;
    tm.choose('mid');
    expect(changes).toEqual([['high', 'viewer choice']]);
  });

  it('steps Auto down when the run-time p95 exceeds 30 fps, and choosing Auto again keeps that verdict', () => {
    const { tm, stage, changes } = manager('auto');
    for (let i = 0; i <= 91; i++) tm.frame(i * 40);
    expect(stage.tier).toBe('mid');
    expect(changes[0]![1]).toMatch(/^run-time p95/);
    tm.choose('high'); // a manual High overrides it
    expect(stage.tier).toBe('high');
    tm.choose('auto');
    expect(stage.tier).toBe('mid');
  });

  it('never changes a forced tier or a manual choice automatically', () => {
    for (const [choice, forced] of [['high', true], ['high', false]] as const) {
      const { tm, stage } = manager(choice, { forced });
      for (let i = 0; i <= 91; i++) tm.frame(i * 40);
      expect(stage.tier).toBe('high');
    }
  });

  it('keeps High when the steady-state warm-up is within budget, ignoring one-time stalls', async () => {
    framesEvery((i) => (i === 30 ? 3800 : 16.7)); // a pipeline build in the middle of the sample
    const { tm, stage } = manager('auto');
    await tm.warmUp(2000);
    expect(stage.tier).toBe('high');
    expect(tm.stats.p95).toBeLessThan(20);
  });

  it('steps Auto down when the steady-state warm-up misses its budget', async () => {
    framesEvery(25);
    const { tm, stage, changes } = manager('auto');
    await tm.warmUp(2000);
    expect(stage.tier).toBe('mid');
    expect(changes[0]![1]).toMatch(/^warm-up p95/);
    tm.choose('auto');
    expect(stage.tier).toBe('mid');
  });

  it('steps Auto down when every warm-up frame is a stall (no sample is not a pass)', async () => {
    framesEvery(400);
    const { tm, stage, changes } = manager('auto');
    await tm.warmUp(2000);
    expect(stage.tier).toBe('mid');
    expect(changes[0]![1]).toMatch(/^warm-up kept/);
  });

  it('does not warm up a manual or forced tier', async () => {
    framesEvery(25);
    const { tm, stage } = manager('high');
    await tm.warmUp(2000);
    expect(stage.tier).toBe('high');
  });
});
