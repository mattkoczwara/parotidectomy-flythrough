import type { SceneState } from '@atlas/timeline';

/**
 * The Explore chapter's operation controls as scene state (pure, so it is tested without a browser). One slider,
 * "how far it has gone" (0..1), drives the same scalars the narrative drives, in the order of the narrative:
 * the line is inked, the flap is raised, the outer gland is dissected off the nerve (`peel`), the specimen leaves the
 * field (`out`), and for a total parotidectomy the nerve is lifted (`mobilise`) and the inner gland drawn out (`deep`).
 * A closure layer then appears as the slider reaches its end.
 */
export interface OperationControls {
  /** False until the viewer touches a control: the authored scene is left alone. */
  active: boolean;
  resection: 'none' | 'ecd' | 'partial' | 'superficial' | 'total' | string;
  incision: 'blair' | 'facelift' | string;
  barrier: 'none' | 'smas' | 'scm' | 'graft' | string;
  /** Percent, 0..100. */
  progress: number;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function applyOperation(state: SceneState, ops: OperationControls): SceneState {
  if (!ops.active) return state;
  const p = clamp01(ops.progress / 100);
  const res = ops.resection;
  const s = state;
  s.variants = { ...s.variants, resection: res };
  s.variantMix = { ...s.variantMix, resection: { [res]: 1 } };
  const op = (s.op = { ...s.op });
  const facelift = ops.incision === 'facelift';
  op['ink'] = facelift ? 0 : clamp01(p / 0.05);
  op['ink_facelift'] = facelift ? clamp01(p / 0.05) : 0;
  op['flap'] = clamp01((p - 0.05) / 0.1);
  // Extracapsular dissection has no fold: the tumour and its cuff are lifted straight out of the raised field.
  op['peel'] = res === 'ecd' || res === 'none' ? 0 : clamp01((p - 0.16) / 0.5);
  op['out'] = res === 'none' ? 0 : res === 'ecd' ? clamp01((p - 0.16) / 0.5) : clamp01((p - 0.66) / 0.14);
  op['mobilise'] = res === 'total' ? clamp01((p - 0.8) / 0.06) : 0;
  op['deep'] = res === 'total' ? clamp01((p - 0.84) / 0.12) : 0;
  const b = res === 'none' ? 0 : clamp01((p - 0.9) / 0.1);
  op['smas'] = ops.barrier === 'smas' ? 1 - b : 1;
  op['scm'] = ops.barrier === 'scm' ? b : 0;
  const setPresence = (id: string, v: number) => {
    s.structures = { ...s.structures, [id]: { ...(s.structures[id] ?? { presence: 0, opacity: 1, mode: 'solid', emphasis: 'context' }), presence: v } };
  };
  setPresence('smas_flap', ops.barrier === 'smas' ? b : 0);
  setPresence('barrier_graft', ops.barrier === 'graft' ? b : 0);
  return s;
}
