import * as THREE from 'three/webgpu';
import { Fn, abs, attribute, cos, dot, float, frontFacing, length, max, mix, normalLocal, positionLocal, positionWorld, sin, smoothstep, transformNormalToView, uniform, vec2, vec3 } from 'three/tsl';

/**
 * Tissue materials. The techniques were proven in the M0 renderer spike (ADR-0001): back faces seen through a
 * cut render as the cut surface, clipping uses a mask node, ghosting uses a single-layer blend with a depth-only
 * twin, and the peel is a vertex-stage fold about a hinge on the lobe's lateral surface.
 */

export type TissueFamily = 'skin' | 'fat' | 'fascia' | 'gland' | 'duct' | 'muscle' | 'bone' | 'cartilage' | 'nerve' | 'artery' | 'vein' | 'lymph-node' | 'tumour';

interface Preset {
  base: number;
  cut: number;
  roughness: number;
  clearcoat?: number;
  sheen?: number;
  sss?: number;
}

/** Naturalistic tissue colours (sRGB) with restrained illustrator conventions: artery red, vein blue-grey, nerve ivory. */
const PRESETS: Record<TissueFamily, Preset> = {
  skin: { base: 0xd6a48c, cut: 0xe4c3ae, roughness: 0.55, sheen: 0.25, sss: 0xc2412a },
  fat: { base: 0xe6c46e, cut: 0xf0d58f, roughness: 0.45, clearcoat: 0.45 },
  fascia: { base: 0xd9ccb9, cut: 0xe3d8c8, roughness: 0.5, sheen: 0.6 },
  gland: { base: 0xd2926f, cut: 0xe6b89c, roughness: 0.55, clearcoat: 0.28, sss: 0x9c3a22 },
  duct: { base: 0xe8d6c2, cut: 0xe8d6c2, roughness: 0.45, clearcoat: 0.4 },
  muscle: { base: 0x9c3f38, cut: 0xb45a50, roughness: 0.6, sheen: 0.3, clearcoat: 0.25 },
  bone: { base: 0xe6ddc8, cut: 0xefe7d4, roughness: 0.72 },
  cartilage: { base: 0xdfe2d6, cut: 0xe8eadf, roughness: 0.45, clearcoat: 0.4 },
  nerve: { base: 0xf1e3b2, cut: 0xf1e3b2, roughness: 0.45, clearcoat: 0.3, sheen: 0.6 },
  artery: { base: 0xb3363c, cut: 0xb3363c, roughness: 0.35, clearcoat: 0.6 },
  vein: { base: 0x55648a, cut: 0x55648a, roughness: 0.35, clearcoat: 0.6 },
  'lymph-node': { base: 0xcdb7a4, cut: 0xd8c6b5, roughness: 0.5 },
  tumour: { base: 0xdcd6c8, cut: 0xcdc8ba, roughness: 0.42, clearcoat: 0.45 },
};

export interface PeelFrame {
  hinge_x: number;
  front_z0: number;
  front_z1: number;
}

/** Scene-wide uniforms written by the stage from the resolved state. */
export const U = {
  peel: uniform(0),
  windowCenter: uniform(new THREE.Vector2(0, 0)),
  windowHalf: uniform(new THREE.Vector2(0.03, 0.028)),
  windowSideX: uniform(0.02),
  hingeX: uniform(0),
  frontZ0: uniform(0),
  frontZ1: uniform(0),
};

const rgb = (hex: number) => {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
};

/** Rounded-rectangle cutaway window on the right side of the head, in the sagittal (Z, Y) plane. */
function windowMask(open: THREE.UniformNode<'float', number>, inset: number) {
  return Fn(() => {
    const q = abs(vec2(positionWorld.z, positionWorld.y).sub(U.windowCenter)).sub(U.windowHalf.mul(open).sub(inset).max(0));
    const inside = length(max(q, 0.0)).lessThan(float(0.008).mul(open)).and(open.greaterThan(0.001));
    return inside.and(positionWorld.x.lessThan(U.windowSideX)).not();
  })();
}

/** Fold about a vertical hinge at the dissection front, on the lobe's lateral surface (see ADR-0001 finding 2). */
function peel() {
  const d = attribute('_peel', 'float');
  const front = mix(U.frontZ0, U.frontZ1, U.peel.min(1));
  const angle = smoothstep(0.0, 0.45, U.peel.sub(d)).mul(2.3);
  const pivot = vec3(U.hingeX, 0, front);
  const rot = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(cos(angle)).add(v.z.mul(sin(angle))), v.y, v.z.mul(cos(angle)).sub(v.x.mul(sin(angle))));
  return { position: rot(positionLocal.sub(pivot)).add(pivot), normal: rot(normalLocal) };
}

export interface TissueMaterial {
  material: THREE.MeshPhysicalNodeMaterial;
  twin: THREE.MeshPhysicalNodeMaterial;
  dim: THREE.UniformNode<'float', number>;
}

export interface TissueOptions {
  family: TissueFamily;
  /** Cutaway window this layer obeys, with its inset (m) so deeper layers open narrower (terraced). */
  window?: { open: THREE.UniformNode<'float', number>; inset: number };
  peel?: boolean;
}

export function tissue(o: TissueOptions): TissueMaterial {
  const p = PRESETS[o.family];
  const dim = uniform(0);
  const make = () => {
    const m = p.sss ? new THREE.MeshSSSNodeMaterial() : new THREE.MeshPhysicalNodeMaterial();
    m.side = THREE.DoubleSide;
    m.roughness = p.roughness;
    m.clearcoat = p.clearcoat ?? 0;
    m.clearcoatRoughness = 0.35;
    if (p.sheen) {
      m.sheen = p.sheen;
      m.sheenRoughness = 0.6;
      m.sheenColor = new THREE.Color(p.base).lerp(new THREE.Color(1, 1, 1), 0.5);
    }
    if (p.sss && m instanceof THREE.MeshSSSNodeMaterial) {
      m.thicknessColorNode = rgb(p.sss);
      m.thicknessDistortionNode = uniform(0.15);
      m.thicknessAmbientNode = uniform(0.25);
      m.thicknessAttenuationNode = uniform(0.6);
      m.thicknessPowerNode = uniform(3.0);
      m.thicknessScaleNode = uniform(4.0);
    }
    const base = rgb(p.base);
    // Context dimming lowers value and saturation rather than recolouring.
    const grey = vec3(dot(base, vec3(0.299, 0.587, 0.114)));
    const dimmed = mix(base, grey, dim.mul(0.7)).mul(float(1).sub(dim.mul(0.5)));
    m.colorNode = frontFacing.select(dimmed, rgb(p.cut));
    if (o.window) m.maskNode = windowMask(o.window.open, o.window.inset);
    if (o.peel) {
      const f = peel();
      m.positionNode = f.position;
      m.normalNode = frontFacing.select(transformNormalToView(f.normal), vec3(0, 0, 1));
    } else {
      m.normalNode = frontFacing.select(transformNormalToView(normalLocal), vec3(0, 0, 1));
    }
    return m;
  };
  const material = make();
  const twin = make();
  twin.colorWrite = false;
  twin.transparent = true;
  twin.depthWrite = true;
  return { material, twin, dim };
}

/** Single-layer ghost: the depth-only twin draws first, then the tissue blends over the opaque interior. */
export function setOpacity(mesh: THREE.Mesh, twin: THREE.Mesh, opacity: number) {
  const m = mesh.material as THREE.MeshPhysicalNodeMaterial;
  const ghost = opacity < 0.999;
  m.opacity = opacity;
  if (m.transparent !== ghost) {
    m.transparent = ghost;
    m.depthWrite = !ghost;
    m.needsUpdate = true;
  }
  twin.visible = ghost && mesh.visible;
}
