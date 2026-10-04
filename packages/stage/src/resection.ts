import * as THREE from 'three/webgpu';
import { RESECTION_EXTENT } from '@atlas/timeline';

/*
 * Resections: which gland pieces each operation removes, and where the specimen goes. The pieces are the ESGS levels
 * and the extracapsular cuff cut in the pipeline (pipeline/anatomy/pieces.py); the tumour travels inside the cuff.
 *
 * Three mechanics, each a progress 0..1 on the scene state (`op.peel`, `op.out`, `op.deep`):
 *   peel  the fold of the outer gland off the nerve (dissection, antegrade);
 *   out   the specimen leaves the field (a rigid move of the same pieces);
 *   deep  the deep pieces of a total parotidectomy leave the field (schematic: the nerve is first mobilised).
 * A variant only chooses which pieces respond. Variants are cross-faded as weights by the timeline, so scrubbing
 * between variant plates moves pieces continuously.
 */

export type Mechanic = 'peel' | 'out' | 'deep';

/** A specimen's resting-to-final pose: a translation (glTF metres: -X lateral, +Y up, +Z anterior) and a turn about the vertical. */
export interface Pose {
  delta: readonly [number, number, number];
  rotYDeg: number;
}

export interface Resection {
  peel: readonly string[];
  out: readonly string[];
  deep: readonly string[];
  outPose: Pose;
  deepPose: Pose;
}

const L = (n: number) => `parotid_level_${n}`;
export const TUMOUR = 'pleomorphic_adenoma';
export const CUFF = 'parotid_ecd_cuff';

/** Pieces that can move; everything else in the gland stays put. */
export const REMOVABLE: ReadonlySet<string> = new Set([L(1), L(2), L(3), L(4), CUFF, TUMOUR]);

const lift: Pose = { delta: [-0.052, 0.085, 0.006], rotYDeg: 38 };
const deepOut: Pose = { delta: [-0.07, 0.07, 0.01], rotYDeg: 30 };

export const RESECTIONS: Readonly<Record<string, Resection>> = {
  none: { peel: [], out: [], deep: [], outPose: lift, deepPose: deepOut },
  // Extracapsular dissection: no fold and no nerve dissection; the tumour and its cuff are lifted out of the bed.
  ecd: { peel: [], out: RESECTION_EXTENT.ecd.out, deep: RESECTION_EXTENT.ecd.deep, outPose: { delta: [-0.05, 0.075, 0.0], rotYDeg: 0 }, deepPose: deepOut },
  // Partial superficial parotidectomy: the lower outer level (II), which holds the tumour, with the nerve dissected around it.
  partial: { peel: RESECTION_EXTENT.partial.out, out: RESECTION_EXTENT.partial.out, deep: RESECTION_EXTENT.partial.deep, outPose: lift, deepPose: deepOut },
  // Superficial parotidectomy: both outer levels (I and II).
  superficial: { peel: RESECTION_EXTENT.superficial.out, out: RESECTION_EXTENT.superficial.out, deep: RESECTION_EXTENT.superficial.deep, outPose: lift, deepPose: deepOut },
  // Total parotidectomy with the nerve preserved: the outer levels, then the deep levels (III and IV) from beneath the nerve.
  total: { peel: RESECTION_EXTENT.total.out, out: RESECTION_EXTENT.total.out, deep: RESECTION_EXTENT.total.deep, outPose: lift, deepPose: deepOut },
};

/** The representative operation of the atlas; used when a plate names no resection (the M1 slice). */
export const DEFAULT_RESECTION = 'superficial';

/** Resection weights from the cross-faded variant mix; whatever weight is unassigned goes to the default. */
export function resectionWeights(mix: Readonly<Record<string, number>> | undefined): Record<string, number> {
  const w: Record<string, number> = {};
  let total = 0;
  for (const [name, v] of Object.entries(mix ?? {})) {
    if (RESECTIONS[name] && v > 0) {
      w[name] = v;
      total += v;
    }
  }
  if (total < 1) w[DEFAULT_RESECTION] = (w[DEFAULT_RESECTION] ?? 0) + (1 - total);
  return w;
}

/** How strongly a piece responds to a mechanic under the given weights (0..1). */
export function memberWeight(weights: Readonly<Record<string, number>>, piece: string, mechanic: Mechanic): number {
  let w = 0;
  for (const [name, v] of Object.entries(weights)) if (RESECTIONS[name]![mechanic].includes(piece)) w += v;
  return Math.min(w, 1);
}

/** Rigid pose carrying a specimen about `pivot`: turn about the vertical there, then translate. */
export function poseMatrix(pivot: THREE.Vector3, pose: Pose, amount: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const a = Math.min(Math.max(amount, 0), 1);
  const turn = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(pose.rotYDeg) * a);
  const toPivot = new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z);
  const back = new THREE.Matrix4().makeTranslation(pivot.x + pose.delta[0] * a, pivot.y + pose.delta[1] * a, pivot.z + pose.delta[2] * a);
  return out.copy(back).multiply(turn).multiply(toPivot);
}
