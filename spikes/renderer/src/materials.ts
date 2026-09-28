import * as THREE from 'three/webgpu';
import {
  Fn,
  abs,
  attribute,
  cos,
  dot,
  float,
  frontFacing,
  length,
  max,
  mix,
  normalLocal,
  positionLocal,
  positionWorld,
  sin,
  smoothstep,
  transformNormalToView,
  uniform,
  vec2,
  vec3,
} from 'three/tsl';
import { peelRange } from './proxy.ts';

/** Shared, state-driven uniforms. Every material reads these; the director writes them once per state change. */
export const u = {
  window: uniform(0),
  sectionOn: uniform(0),
  peel: uniform(0),
  contextDim: uniform(0),
};

const windowCenter = vec2(-0.2, -0.2);
const windowHalf = vec2(3.6, 3.0);
const sectionNormal = vec3(0.35, 0.25, 0.9).normalize();
const sectionOffset = float(0.95);

/** Rounded-rectangle cutaway window through skin and fat (xy), scaled by u.window. */
const insideWindow = Fn(() => {
  const q = abs(positionWorld.xy.sub(windowCenter)).sub(windowHalf.mul(u.window));
  const sd = length(max(q, 0.0)).sub(0.6);
  return sd.lessThan(0).and(u.window.greaterThan(0.001));
});

/** Oblique section plane through the superficial lobe and tumour (proves capped cut surfaces). */
const beyondSection = Fn(() => dot(positionWorld, sectionNormal).greaterThan(sectionOffset).and(u.sectionOn.greaterThan(0.5)));

/**
 * Peel: tissue behind the dissection front folds anteriorly over itself about a hinge line on the
 * lobe's lateral surface at the front, so the deep face turns up (reflection of the superficial
 * lobe off the nerve). The angle ramps smoothly from 0 at the front; with the hinge on the lateral
 * surface the fold never self-intersects (checked on a cross-section grid; a deep-face hinge
 * folded the lateral surface through itself). A pure function of u.peel, so scrub-safe.
 */
const peelAngle = Fn(() => {
  const d = attribute('peelOrder', 'float');
  return smoothstep(0.0, 0.45, u.peel.sub(d)).mul(2.3);
});
const pivotX = u.peel.min(1).mul(peelRange.xMax - peelRange.xMin).add(peelRange.xMin);
const pivot = vec3(pivotX, 0, peelRange.hingeZ);

const rotateY = (v: THREE.Node<'vec3'>, a: THREE.Node<'float'>) =>
  vec3(v.x.mul(cos(a)).add(v.z.mul(sin(a))), v.y, v.x.negate().mul(sin(a)).add(v.z.mul(cos(a))));

/** Linear-space vec3 from any colour representation (colour literals are authored in sRGB). */
const rgb = (c: THREE.ColorRepresentation) => {
  const k = new THREE.Color(c);
  return vec3(k.r, k.g, k.b);
};

export interface TissueOptions {
  base: THREE.ColorRepresentation;
  cut: THREE.ColorRepresentation;
  roughness: number;
  clearcoat?: number;
  sheen?: number;
  sss?: THREE.ColorRepresentation;
  clip?: 'window' | 'section';
  peel?: boolean;
  /** Tissue dims with u.contextDim when it is context rather than focus. */
  context?: boolean;
}

export function tissue(o: TissueOptions) {
  const m = o.sss ? new THREE.MeshSSSNodeMaterial() : new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  m.roughness = o.roughness;
  m.clearcoat = o.clearcoat ?? 0;
  m.clearcoatRoughness = 0.35;
  if (o.sheen) {
    m.sheen = o.sheen;
    m.sheenRoughness = 0.6;
    m.sheenColor = new THREE.Color(o.base).lerp(new THREE.Color(1, 1, 1), 0.5);
  }
  if (o.sss && m instanceof THREE.MeshSSSNodeMaterial) {
    m.thicknessColorNode = rgb(o.sss);
    m.thicknessDistortionNode = uniform(0.15);
    m.thicknessAmbientNode = uniform(0.25);
    m.thicknessAttenuationNode = uniform(0.6);
    m.thicknessPowerNode = uniform(3.0);
    m.thicknessScaleNode = uniform(4.0);
  }

  const base = rgb(o.base);
  const cut = rgb(o.cut);
  // Context dimming lowers value and saturation instead of recolouring.
  const dimmed = o.context ? mix(base, vec3(dot(base, vec3(0.299, 0.587, 0.114))), u.contextDim.mul(0.7)).mul(float(1).sub(u.contextDim.mul(0.55))) : base;
  // Back faces seen through a cut read as the cut surface (the cap).
  m.colorNode = frontFacing.select(dimmed, cut);

  if (o.clip === 'window') m.maskNode = insideWindow().not();
  if (o.clip === 'section') m.maskNode = beyondSection().not();

  if (o.peel) {
    const a = peelAngle();
    m.positionNode = rotateY(positionLocal.sub(pivot), a).add(pivot);
    const n = transformNormalToView(rotateY(normalLocal, a));
    m.normalNode = frontFacing.select(n, vec3(0, 0, 1));
  } else {
    m.normalNode = frontFacing.select(transformNormalToView(normalLocal), vec3(0, 0, 1));
  }
  return m;
}

export type GhostMode = 'hash' | 'layer';

/**
 * Ghosting a tissue so what lies beneath shows through.
 * - `hash`: alpha-hash (order-independent, relies on TRAA to resolve the stipple).
 * - `layer`: single-layer blend. A depth-only twin draws first, so only the ghost's nearest
 *   surface blends over the already-drawn opaque interior (no self-overlap, no sorting within the mesh).
 * The shader variant changes only when a tissue enters or leaves the ghosted state.
 */
export function setGhost(main: THREE.Mesh, twin: THREE.Mesh, opacity: number, mode: GhostMode) {
  const m = main.material as THREE.MeshPhysicalNodeMaterial;
  const ghost = opacity < 0.999;
  m.opacity = opacity;
  const hash = ghost && mode === 'hash';
  const layer = ghost && mode === 'layer';
  if (m.alphaHash !== hash || m.transparent !== layer) {
    m.alphaHash = hash;
    m.transparent = layer;
    m.depthWrite = !layer;
    m.needsUpdate = true;
  }
  twin.visible = layer;
}

/** Depth-only twin for `layer` ghosting; shares geometry, deformation and clipping with its tissue. */
export function depthTwin(o: TissueOptions) {
  const m = tissue(o);
  m.colorWrite = false;
  m.transparent = true;
  m.depthWrite = true;
  return m;
}
