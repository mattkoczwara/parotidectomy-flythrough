import type { Track } from './compile.ts';
import { defaultStructure, type LabelState, type SceneState, type StructureState } from './state.ts';

const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);
const smooth = (x: number) => x * x * (3 - 2 * x);
const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** Eased progress of a transition window [start, end] at transition fraction f. */
function windowed(f: number, [start, end]: readonly [number, number]) {
  return smooth(clamp01((f - start) / (end - start)));
}

/** Shortest-path angle interpolation in degrees. */
function lerpAngle(a: number, b: number, k: number) {
  const d = ((((b - a) % 360) + 540) % 360) - 180;
  return a + d * k;
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Scene state at timeline position t. Integer t is a plate plateau and returns that plate's state exactly;
 * fractional t is a transition. Pure: the result depends on (track, t) only, so forward scrub, backward scrub,
 * deep link and cold load all agree.
 */
export function evaluate(track: Track, t: number): SceneState {
  const last = track.plates.length - 1;
  const tc = Math.min(Math.max(Number.isFinite(t) ? t : 0, 0), last);
  const i = Math.min(Math.floor(tc), last);
  const f = tc - i;
  if (f === 0 || i === last) return track.plates[i]!;

  const a = track.plates[i]!;
  const b = track.plates[i + 1]!;
  const tr = track.transitions[i + 1]!;
  const wc = windowed(f, tr.camera);
  const ws = windowed(f, tr.structures);
  const wo = windowed(f, tr.op);
  const wl = windowed(f, tr.labels);

  const aFrame = a.camera.frames[0]?.ids ?? [];
  const bFrame = b.camera.frames[0]?.ids ?? [];
  const frames = sameIds(aFrame, bFrame)
    ? b.camera.frames
    : [
        { ids: aFrame, weight: 1 - wc },
        { ids: bFrame, weight: wc },
      ].filter((fr) => fr.ids.length > 0);

  const structures: Record<string, StructureState> = {};
  for (const id of new Set([...Object.keys(a.structures), ...Object.keys(b.structures)])) {
    // A structure missing on one side is treated as absent there, with the other side's appearance.
    const sb = b.structures[id] ?? { ...(a.structures[id] ?? defaultStructure), presence: 0 };
    const sa = a.structures[id] ?? { ...sb, presence: 0 };
    structures[id] = {
      presence: lerp(sa.presence, sb.presence, ws),
      opacity: lerp(sa.opacity, sb.opacity, ws),
      mode: ws < 0.5 ? sa.mode : sb.mode,
      emphasis: ws < 0.5 ? sa.emphasis : sb.emphasis,
    };
  }

  const op: Record<string, number> = {};
  for (const key of new Set([...Object.keys(a.op), ...Object.keys(b.op)])) {
    op[key] = lerp(a.op[key] ?? 0, b.op[key] ?? 0, tr.opKeys[key] ? windowed(f, tr.opKeys[key]) : wo);
  }

  // Variants cross-fade as weights over the operative window (or an `opKeys.variants` window) so pieces move
  // continuously between variant plates; the discrete variant in force switches at that window's midpoint.
  const wv = tr.opKeys['variants'] ? windowed(f, tr.opKeys['variants']) : wo;
  const variantMix: Record<string, Record<string, number>> = {};
  for (const key of new Set([...Object.keys(a.variantMix), ...Object.keys(b.variantMix)])) {
    const mix: Record<string, number> = {};
    for (const [name, w] of Object.entries(a.variantMix[key] ?? {})) mix[name] = (mix[name] ?? 0) + w * (1 - wv);
    for (const [name, w] of Object.entries(b.variantMix[key] ?? {})) mix[name] = (mix[name] ?? 0) + w * wv;
    variantMix[key] = mix;
  }

  const labels: LabelState[] = [];
  const inB = new Map(b.labels.map((l) => [l.structureId, l]));
  const inA = new Map(a.labels.map((l) => [l.structureId, l]));
  for (const l of a.labels) labels.push({ ...(inB.get(l.structureId) ?? l), weight: inB.has(l.structureId) ? 1 : 1 - wl });
  for (const l of b.labels) if (!inA.has(l.structureId)) labels.push({ ...l, weight: wl });

  return {
    camera: {
      azimuth: lerpAngle(a.camera.azimuth, b.camera.azimuth, wc),
      elevation: lerp(a.camera.elevation, b.camera.elevation, wc),
      zoom: lerp(a.camera.zoom, b.camera.zoom, wc),
      frames,
    },
    structures,
    gauge: lerp(a.gauge, b.gauge, ws),
    op,
    variants: wv < 0.5 ? a.variants : b.variants,
    variantMix,
    labels: labels.filter((l) => l.weight > 0),
    light: { preset: wc < 0.5 ? a.light.preset : b.light.preset, exposure: lerp(a.light.exposure, b.light.exposure, wc) },
  };
}

/** Index of the plate whose plateau is at or before t. */
export function plateAt(track: Track, t: number): number {
  return Math.min(Math.max(Math.floor(t), 0), track.plates.length - 1);
}

/**
 * Long-jump rule: moving more than `threshold` plates at once (deep link, chapter navigation, a fast drag)
 * dissolves to the destination instead of replaying the procedure. Reduced motion always dissolves.
 */
export function shouldDissolve(from: number, to: number, reducedMotion: boolean, threshold = 1.5): boolean {
  return reducedMotion ? from !== to : Math.abs(to - from) > threshold;
}
