/**
 * Quality tier manager (plan §9). High: GTAO + TRAA on WebGPU. Mid: FXAA, no AO (WebGPU or WebGL2).
 * Auto starts High on WebGPU (Mid on WebGL2), keeps High after a 2 s steady-state warm-up only if the 95th-percentile
 * frame interval is within budget, and steps down during use if frames stay slow. The viewer can override; a forced
 * tier (?tier=, capture mode) is never changed automatically, so captures stay deterministic.
 */
import type { Stage, Tier } from '@atlas/stage';

export type TierChoice = 'auto' | Tier;

/** High keeps 60 fps with headroom (p95 <= 20 ms, plan §14); step down if sustained p95 exceeds 30 fps. */
const WARMUP_BUDGET_MS = 20;
const RUNTIME_LIMIT_MS = 34;
/** Longer intervals are loading or a one-time shader/pipeline build, not the sustained cost of the tier. */
const STALL_MS = 250;
/** A warm-up that kept fewer intervals than this could not sustain High (every frame was a stall). */
const MIN_SAMPLES = 30;

export const p95 = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
};
export const median = (xs: readonly number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

type TierStage = Pick<Stage, 'backend' | 'tier' | 'setTier' | 'render'>;

export class TierManager {
  private intervals: number[] = [];
  private last = 0;
  /** Auto's verdict: where Auto starts, lowered when it steps down; choosing Auto again returns here, not to High. */
  private autoTier: Tier;
  /** Last measurement, published on <body data-tier-*> for the performance harness. */
  stats = { p95: 0, median: 0, frames: 0 };

  constructor(
    private readonly stage: TierStage,
    public choice: TierChoice,
    private readonly forced: boolean,
    private readonly onChange: (tier: Tier, reason: string) => void,
  ) {
    this.autoTier = stage.backend === 'webgpu' ? 'high' : 'mid';
  }

  /** The tier to start with, before any measurement. */
  initial(): Tier {
    return this.choice === 'auto' ? this.autoTier : this.choice;
  }

  /**
   * Warm-up: render every animation frame for `ms`; in auto mode drop to Mid if High misses its budget. Run it once the
   * first plate has converged (its shaders built), so it measures whether High is sustainable, not the one-time build.
   */
  async warmUp(ms = 2000): Promise<void> {
    if (this.forced || this.choice !== 'auto' || this.stage.tier !== 'high') return;
    const xs: number[] = [];
    await new Promise<void>((done) => {
      const t0 = performance.now();
      let prev = t0;
      let measured = 0;
      const tick = (now: number) => {
        this.stage.render();
        // Skip the first frames and any stall; measure `ms` of steady frames (within four times that in all).
        if (now - t0 > 250 && now - prev < STALL_MS) {
          xs.push(now - prev);
          measured += now - prev;
        }
        prev = now;
        if (measured < ms - 250 && now - t0 < ms * 4) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
    this.publish(xs);
    if (xs.length < MIN_SAMPLES) this.downgrade(`warm-up kept ${xs.length} frames`);
    else if (this.stats.p95 > WARMUP_BUDGET_MS) this.downgrade(`warm-up p95 ${this.stats.p95.toFixed(1)} ms`);
  }

  /** Called for every rendered frame while the scene is moving. */
  frame(now: number) {
    if (this.last && now - this.last < STALL_MS) this.intervals.push(now - this.last);
    this.last = now;
    if (this.intervals.length < 90) return;
    this.publish(this.intervals);
    this.intervals = [];
    if (!this.forced && this.choice === 'auto' && this.stage.tier === 'high' && this.stats.p95 > RUNTIME_LIMIT_MS) this.downgrade(`run-time p95 ${this.stats.p95.toFixed(1)} ms`);
  }

  /** The viewer's choice (masthead control). */
  choose(choice: TierChoice) {
    this.choice = choice;
    this.set(this.initial(), 'viewer choice');
  }

  private downgrade(reason: string) {
    this.autoTier = 'mid';
    this.set('mid', reason);
  }

  private set(tier: Tier, reason: string) {
    if (this.stage.tier === tier) return;
    this.stage.setTier(tier);
    this.onChange(this.stage.tier, reason); // what the stage now renders, not what was asked for
  }

  private publish(xs: readonly number[]) {
    this.stats = { p95: p95(xs), median: median(xs), frames: xs.length };
    document.body.dataset.tierP95 = this.stats.p95.toFixed(1);
    document.body.dataset.tierMedian = this.stats.median.toFixed(1);
  }
}
