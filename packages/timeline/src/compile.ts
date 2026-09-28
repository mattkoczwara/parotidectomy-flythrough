import { defaultStructure, type PlateSpec, type SceneState, type StructureState, type TransitionSpec } from './state.ts';

export interface Track {
  readonly ids: readonly string[];
  /** Absolute state at each plate's plateau. */
  readonly plates: readonly SceneState[];
  /** transitions[i] shapes the move from plate i-1 into plate i (transitions[0] is unused). */
  readonly transitions: readonly Required<TransitionSpec>[];
}

const defaultTransition: Required<TransitionSpec> = {
  camera: [0, 1],
  structures: [0, 1],
  op: [0, 1],
  labels: [0.6, 1],
};

const emptyState: SceneState = {
  camera: { azimuth: 0, elevation: 0, zoom: 1, frames: [] },
  structures: {},
  gauge: 0,
  op: {},
  variants: {},
  labels: [],
  light: { preset: 'studio', exposure: 1 },
};

/**
 * Accumulates per-plate deltas into absolute plateau states. Because every plateau is absolute, a deep link
 * or a cold load evaluates a plate directly, with no replay of earlier plates.
 */
export function compile(specs: readonly PlateSpec[], initial: SceneState = emptyState): Track {
  if (specs.length === 0) throw new RangeError('a track needs at least one plate');
  const ids = specs.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate plate id "${dup}"`);

  const plates: SceneState[] = [];
  let prev = initial;
  for (const { delta } of specs) {
    const structures: Record<string, StructureState> = { ...prev.structures };
    for (const [id, patch] of Object.entries(delta.structures ?? {})) {
      structures[id] = { ...(structures[id] ?? defaultStructure), ...patch };
    }
    const { frame, ...cameraRest } = delta.camera ?? {};
    const next: SceneState = {
      camera: {
        ...prev.camera,
        ...cameraRest,
        frames: frame ? [{ ids: [...frame], weight: 1 }] : prev.camera.frames,
      },
      structures,
      gauge: delta.gauge ?? prev.gauge,
      op: { ...prev.op, ...delta.op },
      variants: { ...prev.variants, ...delta.variants },
      labels: delta.labels ? delta.labels.map((l, i) => ({ structureId: l.structureId, priority: l.priority ?? i, weight: 1 })) : prev.labels,
      light: { ...prev.light, ...delta.light },
    };
    plates.push(next);
    prev = next;
  }

  const transitions = specs.map((s) => ({ ...defaultTransition, ...s.transition }));
  for (const [i, tr] of transitions.entries()) {
    for (const [key, [a, b]] of Object.entries(tr)) {
      if (!(a >= 0 && b <= 1 && a < b)) throw new RangeError(`plate "${ids[i]}": transition window ${key} [${a}, ${b}] is invalid`);
    }
  }
  return { ids, plates, transitions };
}
