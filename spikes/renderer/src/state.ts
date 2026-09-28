/**
 * Pure spike timeline: plate index t → semantic scene state. Mirrors the planned
 * @atlas/timeline contract (state is a function of t alone) so that cold load, forward
 * scrub and backward scrub are comparable.
 */

export interface SpikeState {
  /** 0 = skin intact, 1 = cutaway window fully open. */
  window: number;
  /** Superficial-lobe presence: 1 = solid, lower = ghosted (alpha hash). */
  glandOpacity: number;
  /** 0..1 strength of the non-emissive focus contour on the facial nerve. */
  nerveFocus: number;
  /** Dissection front along the baked peel field, 0 (none) … 1 (lobe fully reflected). */
  peel: number;
  /** Context dimming of non-focus tissue (0 = none). */
  contextDim: number;
}

export const plates: readonly SpikeState[] = [
  { window: 0, glandOpacity: 1, nerveFocus: 0, peel: 0, contextDim: 0 },
  { window: 1, glandOpacity: 1, nerveFocus: 0, peel: 0, contextDim: 0 },
  { window: 1, glandOpacity: 0.28, nerveFocus: 1, peel: 0, contextDim: 0.45 },
  { window: 1, glandOpacity: 1, nerveFocus: 0.6, peel: 0.6, contextDim: 0.2 },
  { window: 1, glandOpacity: 1, nerveFocus: 0.6, peel: 1.0, contextDim: 0.2 },
];

const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

export function evaluate(t: number): SpikeState {
  const clamped = Math.min(Math.max(t, 0), plates.length - 1);
  const i = Math.min(Math.floor(clamped), plates.length - 2);
  const k = smooth(clamped - i);
  const a = plates[i]!;
  const b = plates[i + 1]!;
  return {
    window: lerp(a.window, b.window, k),
    glandOpacity: lerp(a.glandOpacity, b.glandOpacity, k),
    nerveFocus: lerp(a.nerveFocus, b.nerveFocus, k),
    peel: lerp(a.peel, b.peel, k),
    contextDim: lerp(a.contextDim, b.contextDim, k),
  };
}
