import { defaultStructure, type PlateSpec, type SceneState, type StructureState, type TransitionSpec } from './state.ts';

export interface Track {
  readonly ids: readonly string[];
  /** Absolute state at each plate's plateau. */
  readonly plates: readonly SceneState[];
  /** transitions[i] shapes the move from plate i-1 into plate i (transitions[0] is unused). */
  readonly transitions: readonly TransitionWindows[];
}

type Window = readonly [number, number];

/** Resolved transition windows (every group present; opKeys override `op` for the keys they name). */
export interface TransitionWindows {
  readonly camera: Window;
  readonly structures: Window;
  readonly op: Window;
  readonly labels: Window;
  readonly opKeys: Readonly<Record<string, Window>>;
}

const defaultTransition: TransitionWindows = {
  camera: [0, 1],
  structures: [0, 1],
  op: [0, 1],
  labels: [0.6, 1],
  opKeys: {},
};

/** Drops keys whose value is undefined so they do not overwrite inherited values when spread. */
function defined<T extends object>(o: T): { [K in keyof T]-?: Exclude<T[K], undefined> } {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as { [K in keyof T]-?: Exclude<T[K], undefined> };
}

const emptyState: SceneState = {
  camera: { azimuth: 0, elevation: 0, zoom: 1, frames: [] },
  structures: {},
  gauge: 0,
  op: {},
  variants: {},
  variantMix: {},
  labels: [],
  light: { preset: 'studio', exposure: 1, mix: { studio: 1 } },
};

export interface CompileOptions {
  /**
   * Structures that stand for several meshes (e.g. the superficial lobe, built from ESGS levels). A plate patch for
   * a group applies to every member; a patch naming a member in the same plate wins over the group's.
   */
  groups?: Readonly<Record<string, readonly string[]>>;
}

/** One-hot weights for the variants in force. */
function mixOf(variants: Readonly<Record<string, string>>): Record<string, Record<string, number>> {
  return Object.fromEntries(Object.entries(variants).map(([key, name]) => [key, { [name]: 1 }]));
}

/** Mesh-level members of `id` (itself when it is not a group); groups may nest. */
function leaves(id: string, groups: Readonly<Record<string, readonly string[]>>, seen = new Set<string>()): string[] {
  const members = groups[id];
  if (!members) return [id];
  if (seen.has(id)) throw new Error(`group "${id}" contains itself`);
  seen.add(id);
  return members.flatMap((m) => leaves(m, groups, new Set(seen)));
}

/**
 * Accumulates per-plate deltas into absolute plateau states. Because every plateau is absolute, a deep link
 * or a cold load evaluates a plate directly, with no replay of earlier plates.
 */
export function compile(specs: readonly PlateSpec[], initial: SceneState = emptyState, options: CompileOptions = {}): Track {
  if (specs.length === 0) throw new RangeError('a track needs at least one plate');
  const ids = specs.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`duplicate plate id "${dup}"`);
  const groups = options.groups ?? {};

  const plates: SceneState[] = [];
  let prev = initial;
  for (const { delta } of specs) {
    const structures: Record<string, StructureState> = { ...prev.structures };
    const patches = Object.entries(delta.structures ?? {});
    const apply = (id: string, patch: (typeof patches)[number][1]) => {
      structures[id] = { ...(structures[id] ?? defaultStructure), ...defined(patch) };
    };
    // Group patches first, then patches that name a mesh, so a member named in the plate wins over its group.
    for (const [id, patch] of patches) if (groups[id]) for (const member of leaves(id, groups)) apply(member, patch);
    for (const [id, patch] of patches) if (!groups[id]) apply(id, patch);
    const { frame, ...cameraRest } = delta.camera ?? {};
    const variants = { ...prev.variants, ...delta.variants };
    const next: SceneState = {
      camera: {
        ...prev.camera,
        ...defined(cameraRest),
        frames: frame ? [{ ids: [...frame], weight: 1 }] : prev.camera.frames,
      },
      structures,
      gauge: delta.gauge ?? prev.gauge,
      op: { ...prev.op, ...delta.op },
      variants,
      variantMix: mixOf(variants),
      labels: delta.labels ? delta.labels.map((l, i) => ({ structureId: l.structureId, priority: l.priority ?? i, weight: 1 })) : prev.labels,
      light: (() => {
        const l = { ...prev.light, ...defined(delta.light ?? {}) };
        return { ...l, mix: { [l.preset]: 1 } };
      })(),
    };
    plates.push(next);
    prev = next;
  }

  const transitions: TransitionWindows[] = specs.map((s) => ({ ...defaultTransition, ...defined(s.transition ?? {}) }));
  for (const [i, tr] of transitions.entries()) {
    const { opKeys, ...windows } = tr;
    for (const [key, [a, b]] of [...Object.entries(windows), ...Object.entries(opKeys).map(([k, w]) => [`opKeys.${k}`, w] as const)]) {
      if (!(a >= 0 && b <= 1 && a < b)) throw new RangeError(`plate "${ids[i]}": transition window ${key} [${a}, ${b}] is invalid`);
    }
  }
  return { ids, plates, transitions };
}
