import * as THREE from 'three/webgpu';
import { fractal, noise, worley } from './noise.ts';
import { Fn, abs, atan, attribute, materialOpacity, output, cos, exp, cross, dFdx, dFdy, dot, float, fract, frontFacing, length, max, mix, normalLocal, normalView, positionLocal, positionView, positionWorld, sign, sin, smoothstep, transformNormalToView, uniform, vec2, vec3, vec4, vertexStage } from 'three/tsl';

/**
 * Tissue materials. The techniques were proven in the M0 renderer spike (ADR-0001): back faces seen through a
 * cut render as the cut surface, clipping uses a mask node, ghosting uses a single-layer blend with a depth-only
 * twin, and the peel is a vertex-stage fold about a hinge on the lobe's lateral surface.
 */

export type TissueFamily = 'skin' | 'fat' | 'fascia' | 'gland' | 'duct' | 'muscle' | 'bone' | 'cartilage' | 'nerve' | 'artery' | 'vein' | 'lymph-node' | 'tumour' | 'instrument';

interface Preset {
  base: number;
  cut: number;
  roughness: number;
  clearcoat?: number;
  sheen?: number;
  sss?: number;
  /** Strength of the thickness (wrap-SSS) term; skin kept low so it reads as skin, not a red glow. */
  sssScale?: number;
  metalness?: number;
}

/** Naturalistic tissue colours (sRGB) with restrained illustrator conventions: artery red, vein blue-grey, nerve ivory.
 *  Values were recalibrated in the final presentation pass under the neutral studio rig (ADR-0005). */
const PRESETS: Record<TissueFamily, Preset> = {
  skin: { base: 0xc8a796, cut: 0xe2c6b3, roughness: 0.5, sheen: 0.1, clearcoat: 0.06, sss: 0x8a5e50, sssScale: 0.5 },
  fat: { base: 0xe7bb8e, cut: 0xedcfa3, roughness: 0.34, clearcoat: 0.45 },
  fascia: { base: 0xd8cdbd, cut: 0xe3d8c8, roughness: 0.48, sheen: 0.45 },
  gland: { base: 0xcc9a7d, cut: 0xe0b59a, roughness: 0.5, clearcoat: 0.2, sss: 0x9a4a32, sssScale: 2.0 },
  duct: { base: 0xe6d7c4, cut: 0xe6d7c4, roughness: 0.42, clearcoat: 0.32 },
  muscle: { base: 0x9e4b41, cut: 0xb3655a, roughness: 0.56, sheen: 0.22, clearcoat: 0.1 },
  bone: { base: 0xdbcfb5, cut: 0xe9dfc8, roughness: 0.8 },
  cartilage: { base: 0xdadfd3, cut: 0xe8eadf, roughness: 0.4, clearcoat: 0.3 },
  nerve: { base: 0xecdfbb, cut: 0xecdfbb, roughness: 0.42, clearcoat: 0.2, sheen: 0.5 },
  // (vessels: a moderate clearcoat; at 0.4+ the walls read as wet plastic. The vein is a desaturated slate-violet,
  // the colour of blood seen through a thin wall, not a textbook navy.)
  artery: { base: 0xa04a46, cut: 0xa04a46, roughness: 0.42, clearcoat: 0.24 },
  vein: { base: 0x58566e, cut: 0x58566e, roughness: 0.38, clearcoat: 0.3 },
  'lymph-node': { base: 0xcdb7a4, cut: 0xd8c6b5, roughness: 0.5 },
  tumour: { base: 0xd9d3c6, cut: 0xcdc8ba, roughness: 0.36, clearcoat: 0.4 },
  // Manufactured objects: cool grey, not a tissue colour, so a probe or drain is never mistaken for anatomy.
  instrument: { base: 0x9ea8b6, cut: 0x9ea8b6, roughness: 0.32, clearcoat: 0.4, metalness: 0.12 },
};

export interface PeelFrame {
  hinge_x: number;
  front_z0: number;
  front_z1: number;
}

/** Incision and flap (pipeline/anatomy/flap.py): fold axis on the skin in front of the incision (glTF frame). */
export interface FlapFrame {
  axis_point: [number, number, number];
  axis_dir: [number, number, number];
  max_angle: number;
  cut_scale_mm: number;
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
  /** Incision ink drawn along the path, 0..1. */
  ink: uniform(0),
  /** Facelift-type incision ink drawn along its path, 0..1 (dashed: the alternative to the modified Blair line). */
  ink2: uniform(0),
  /** Closing the wound (0..1): suture ticks drawn along the incision, and the scar's maturity (0 fresh .. 1 pale). */
  suture: uniform(0),
  scar: uniform(0),
  /** Contour change after a superficial resection (0..1): the skin over the former gland sinks (illustrative amplitude). */
  hollow: uniform(0),
  hollowCentre: uniform(new THREE.Vector2(0, 0)),
  hollowRadius: uniform(0.026),
  hollowDepth: uniform(0.0055),
  /** SMAS flap raised (0..1; 0 = lying over the gland) and its hinge on the anterior edge (glTF x, z in metres). */
  smas: uniform(0),
  smasHinge: uniform(new THREE.Vector2(0, 0)),
  /** Sternocleidomastoid strip turned up about its upper end (0..1), the pivot (glTF metres) and the full turn (radians). */
  scmTurn: uniform(0),
  scmPivot: uniform(new THREE.Vector3()),
  scmMax: uniform(1.6),
  /** Height (glTF Y, metres) above which every tissue is clipped away: the head cut at the CT slice's level. 10 = no clip. */
  clipY: uniform(10),
  /** Flap raised, 0..1 (0 = skin closed; any value above FLAP_OPEN cuts along the incision). */
  flap: uniform(0),
  flapPivot: uniform(new THREE.Vector3()),
  flapAxis: uniform(new THREE.Vector3(0, 1, 0)),
  flapMax: uniform(1.9),
  cutScale: uniform(64),
  /** ESGS ink on the gland pieces (0..1 each): the nerve-plane trace, the cranial/caudal trace, the cuff outline. */
  inkPlane: uniform(0),
  inkCranial: uniform(0),
  inkCuff: uniform(0),
  /** Section plane for the specimen (world: xyz = unit normal, w = offset); the side where dot(p, n) > w is cut away. */
  sectionPlane: uniform(new THREE.Vector4(0, 1, 0, 1000)),
  /** Localisation on the intact skin (0..1): the lateral outline of the superficial lobe as a fine contour, with a
   *  slight warm shift inside it (the opening; `_foot` is the signed distance in mm, exterior.py). */
  locate: uniform(0),
  /** The scene cut (glTF Y, m) and the field colour (linear): anatomy fades into the field just above the cut, so
   *  the model ends softly instead of being sawn off. */
  cutY: uniform(-10),
  /** The lowest point of the exterior body (glTF Y, m): it falls into the field toward its lower edge. */
  bodyBottom: uniform(-10),
  /** Centre of the head (glTF metres): a rest normal pointing toward it marks the skin shell's inner surface. */
  headCentre: uniform(new THREE.Vector3()),
  field: uniform(new THREE.Color(0, 0, 0)),
  /** Nerve mobilisation (total parotidectomy), 0..1: the facial-nerve branches are lifted off the deep lobe. */
  mobilise: uniform(0),
  /** Displacement of a fully mobilised branch (glTF metres): lateral, a little up and forward. */
  mobiliseBy: uniform(new THREE.Vector3(-0.011, 0.007, 0.009)),
  /** The opening's portrait (portrait.py, presentation only), 0..1: the exterior morphs from the fitted shape (0) to
   *  the idealised portrait (1) along its baked `_pdisp`/`_pnrm`, and the portrait's skin detail fades in with it. */
  portrait: uniform(0),
  /** The fitted surfaces' share of that portrait morph (`_pdisp`, the portrait skin field and haircut): the portrait
   *  weight when the opening has no hero asset, 0 when it has (the hero is drawn instead, and the fitted exterior keeps
   *  its own shape for the handoff). */
  morph: uniform(0),
  /** Clock of the directional cue (seconds; the stage advances it only while a cue is shown). */
  flowTime: uniform(0),
};

/** Risk territories drawn on the skin (complications chapter): up to six ellipsoids, each tied to a weight 0..1. */
export const ZONE_SLOTS = 6;
export const zoneCentre = Array.from({ length: ZONE_SLOTS }, () => uniform(new THREE.Vector3(0, 0, 0)));
export const zoneRadii = Array.from({ length: ZONE_SLOTS }, () => uniform(new THREE.Vector3(1, 1, 1)));
export const zoneWeight = Array.from({ length: ZONE_SLOTS }, () => uniform(0));
/** The single desaturated ochre of complications (plan §5); shown only in the Complications chapter. */
export const OCHRE = 0xc9a55a;

/** Flap progress above which the incision is open (the flap copy shows and the resting layer is cut). */
export const FLAP_OPEN = 0.0005;
/** Underside of the raised skin flap (its subcutaneous fat): between the fat's cut colour and fascia, less saturated. */
const FLAP_FAT = 0xeac7a0;
/** Flap weight below which tissue counts as attached (stays with the resting layer). */
export const FLAP_ATTACHED = 0.01;
/** Marker ink: gentian violet, matte, the only violet in the atlas (plan §5). Half-width of the line in mm. */
const INK = 0x4b2c6f;
const INK_HALF_MM = [0.5, 0.8] as const;
/** Ink on the gland pieces is drawn a little bolder than the incision line: it must read at the distance of the exploded views. */
const PIECE_INK_MM = [0.9, 1.4] as const;

const rgb = (hex: number) => {
  const c = new THREE.Color(hex);
  return vec3(c.r, c.g, c.b);
};

/**
 * Tissue mesostructure (final presentation pass, ADR-0005). Every pattern is a function of the rest position in mm,
 * so it stays fixed to the tissue through folds, peels and specimen poses, and is identical on every frame
 * (determinism). A family returns an albedo change, a roughness and a height field (metres) for the bump.
 */
interface Detail {
  tone: (c: THREE.Node<'vec3'>) => THREE.Node<'vec3'>;
  roughness: THREE.Node<'float'>;
  height: THREE.Node<'float'>;
}

/** The skin shell's inner surface: its rest normal points toward the head's centre (geometry, no baked label). */
const innerShell = () => dot(attribute('normal', 'vec3'), attribute('position', 'vec3').sub(U.headCentre)).lessThan(0);

/** Rest position in mm (the glTF frame is in metres and baked into the geometry). */
const restMM = () => attribute('position', 'vec3').mul(1000);
/** Signed noise in about -1..1. */
const n3 = (p: THREE.Node<'vec3'>) => noise(p);

/** Coordinates across a fibre direction: noise of them is constant along the fibres, so it draws striations. */
function across(p: THREE.Node<'vec3'>, axis: THREE.Node<'vec3'>) {
  return p.sub(axis.mul(dot(p, axis)));
}

function detail(family: TissueFamily, p: Preset, axis: boolean, arc: boolean, thread: boolean): Detail | null {
  const P = restMM();
  const ax = axis ? attribute('_axis', 'vec3').normalize() : vec3(0, 1, 0);
  const R = float(p.roughness);
  /** Distance along the course (mm): the baked tree arc where present (author.py), else the local projection. */
  const s = arc ? attribute('_arc', 'float') : dot(P, ax);
  switch (family) {
    case 'skin': {
      // Pigment mottling (two scales), faint vascular reddening, and a restrained pore and micro-relief field.
      const mottle = fractal(P.mul(1 / 22));
      const fine = n3(P.mul(1 / 3.4));
      const flush = n3(P.mul(1 / 9).add(vec3(7.1, 3.3, 1.7)));
      const micro = n3(P.mul(1 / 1.6));
      return {
        tone: (c) => mix(c, c.mul(vec3(1.05, 0.9, 0.88)), flush.mul(0.5).add(0.5).mul(0.35)).mul(float(1).add(mottle.mul(0.06)).add(fine.mul(0.025))),
        roughness: R.add(fine.mul(0.05)).add(micro.mul(0.04)),
        height: micro.mul(0.000012).add(fine.mul(0.00002)),
      };
    }
    case 'gland': {
      // Lobes (about 11 mm) divided into lobules (about 3 mm) by pale fibro-fatty septa: the glandular hierarchy.
      const lob = worley(P.mul(1 / 2.4));
      const lobe = worley(P.mul(1 / 10).add(vec3(3.7, 1.1, 5.3)));
      const septum = smoothstep(0.0, 0.3, lob.y.sub(lob.x)).oneMinus();
      const cleft = smoothstep(0.0, 0.16, lobe.y.sub(lobe.x)).oneMinus();
      const dome = smoothstep(0.0, 0.85, lob.x.oneMinus());
      const tint = n3(P.mul(1 / 2.1));
      return {
        tone: (c) => mix(c.mul(float(0.95).add(tint.mul(0.06)).add(dome.mul(0.04))), rgb(0xe6cfa8), max(septum.mul(0.15), cleft.mul(0.26))),
        roughness: R.sub(0.04).add(septum.mul(0.1)),
        height: dome.mul(0.00011).sub(cleft.mul(0.00012)),
      };
    }
    case 'tumour': {
      // A smooth capsule over a bosselated (knobbly) surface, with bluish-grey chondromyxoid patches showing through.
      const boss = fractal(P.mul(1 / 5.5));
      const myx = smoothstep(-0.15, 0.6, fractal(P.mul(1 / 3.6).add(vec3(11, 2, 5))));
      return {
        tone: (c) => mix(c, rgb(0xc4ccd0), myx.mul(0.28)).mul(float(1).add(n3(P.mul(1 / 1.3)).mul(0.025))),
        roughness: R.add(myx.mul(0.08)),
        height: boss.mul(0.00032).add(n3(P.mul(1 / 0.7)).mul(0.000008)),
      };
    }
    case 'nerve': {
      // Fascicles along the nerve under a thin epineurium, the faint transverse banding of a relaxed nerve, and a slow
      // warm/cool drift along the course (an exposed nerve is never one flat ivory).
      const q = across(P, ax);
      const fasc = n3(q.mul(1 / 0.32));
      const coarse = n3(q.mul(1 / 0.9).add(vec3(4.1, 0.6, 2.2)));
      const band = sin(dot(P, ax).mul(Math.PI * 2 / 0.55)).mul(0.5).add(0.5);
      const drift = n3(vec3(s.mul(1 / 9), 1.7, 5.3));
      // Larger exposed nerves only: a fine epineurial vessel (vasa nervorum) wandering along the surface, low contrast.
      // One line along the nerve at an angle about its axis that wanders slowly with the course (angle from the rest
      // normal in a frame built from the axis and the lateral direction, which no nerve here runs along).
      let vessel: THREE.Node<'float'> | null = null;
      if (thread) {
        const nrm = attribute('normal', 'vec3');
        const t1 = cross(ax, vec3(1, 0, 0)).normalize();
        const t2 = cross(ax, t1);
        const ang = atan(dot(nrm, t2), dot(nrm, t1));
        const target = n3(vec3(s.mul(1 / 11), 3.1, 7.4)).mul(1.4).add(0.6);
        const off = abs(fract(ang.sub(target).div(Math.PI * 2).add(0.5)).sub(0.5)).mul(Math.PI * 2);
        vessel = float(1).sub(smoothstep(0.03, 0.2, off));
      }
      return {
        tone: (c) => {
          const t = mix(c, c.mul(vec3(1.02, 0.97, 0.9)), drift.mul(0.5).add(0.5).mul(0.5)).mul(float(0.96).add(fasc.mul(0.06)).add(coarse.mul(0.03)).add(band.mul(0.02)));
          return vessel ? mix(t, rgb(0xc08a78), vessel.mul(0.16)) : t;
        },
        roughness: R.add(fasc.mul(0.05)),
        height: fasc.mul(0.00002).add(coarse.mul(0.00001)).add(band.mul(0.000004)),
      };
    }
    case 'muscle': {
      // Fascicles (about 1 mm) in the fibre direction, finer fibres within them, pale perimysium between.
      const q = across(P, ax);
      const fasc = n3(q.mul(1 / 0.95).add(ax.mul(dot(P, ax).mul(0.02))));
      const fibre = n3(q.mul(1 / 0.22));
      const peri = smoothstep(0.55, 0.8, abs(fasc));
      return {
        tone: (c) => mix(c.mul(float(0.9).add(fasc.mul(0.08)).add(fibre.mul(0.03))), rgb(0xc89a88), peri.mul(0.12)),
        roughness: R.add(fibre.mul(0.05)),
        height: fasc.mul(0.00006).add(fibre.mul(0.00001)),
      };
    }
    case 'artery': {
      // The adventitia: a paler, pinkish fibrous coat over the red wall, in soft patches; a little rougher where it is thicker.
      const q = across(P, ax);
      const wall = n3(q.mul(1 / 0.7));
      const advent = smoothstep(-0.1, 0.7, fractal(P.mul(1 / 3.2).add(vec3(5.5, 1.2, 8.8))));
      const along = n3(vec3(s.mul(1 / 6), 2.3, 9.1));
      return {
        tone: (c) => mix(c, rgb(0xc08a7e), advent.mul(0.2)).mul(float(1).add(along.mul(0.05)).add(wall.mul(0.025))),
        roughness: R.add(advent.mul(0.06)).add(wall.mul(0.03)),
        height: wall.mul(0.000012).add(advent.mul(0.000008)),
      };
    }
    case 'vein': {
      // A thin wall over dark blood: deeper where the wall is thinnest, paler and greyer where it is thicker.
      const q = across(P, ax);
      const wall = n3(q.mul(1 / 0.8));
      const thin = smoothstep(-0.2, 0.6, fractal(P.mul(1 / 4.5).add(vec3(1.4, 7.2, 3.3))));
      const along = n3(vec3(s.mul(1 / 7), 4.4, 0.8));
      return {
        tone: (c) => mix(c.mul(vec3(1.06, 1.04, 1.0)), c.mul(vec3(0.8, 0.74, 0.86)), thin.mul(0.55)).mul(float(1).add(along.mul(0.05)).add(wall.mul(0.02))),
        roughness: R.add(wall.mul(0.03)).sub(thin.mul(0.03)),
        height: wall.mul(0.00001),
      };
    }
    case 'duct': {
      // Vessel and duct walls: faint longitudinal structure and slow variation along the course.
      const q = across(P, ax);
      const wall = n3(q.mul(1 / 0.7));
      const along = n3(ax.mul(dot(P, ax).mul(1 / 5)).add(vec3(2.3, 9.1, 4.4)));
      return {
        tone: (c) => c.mul(float(1).add(along.mul(0.06)).add(wall.mul(0.025))),
        roughness: R.add(wall.mul(0.04)),
        height: wall.mul(0.000012),
      };
    }
    case 'fat': {
      // Adipose lobules (about 2 mm) bulging between fine pale septa.
      const lob = worley(P.mul(1 / 3.4));
      const septum = smoothstep(0.0, 0.16, lob.y.sub(lob.x)).oneMinus();
      const dome = smoothstep(0.0, 1.0, lob.x.oneMinus()).pow(1.6);
      return {
        tone: (c) => mix(c.mul(float(0.94).add(n3(P.mul(1 / 2.3)).mul(0.06)).add(dome.mul(0.05))), rgb(0xf3e3c8), septum.mul(0.18)),
        roughness: R.add(septum.mul(0.08)),
        height: dome.mul(0.00012),
      };
    }
    case 'fascia': {
      // A thin fibrous sheet: fine, mostly vertical fibres.
      const fib = n3(P.mul(vec3(1 / 0.28, 1 / 3.5, 1 / 0.28)));
      return {
        tone: (c) => c.mul(float(1).add(fib.mul(0.035))),
        roughness: R.add(fib.mul(0.04)),
        height: fib.mul(0.000008),
      };
    }
    case 'bone': {
      // Chalky cortical surface: fine pitting and warm, uneven staining.
      const pit = smoothstep(0.0, 0.28, worley(P.mul(1 / 0.5)).x);
      const stain = fractal(P.mul(1 / 9));
      return {
        tone: (c) => mix(c, rgb(0xc9b28a), smoothstep(0.1, 0.8, stain).mul(0.28)).mul(float(0.95).add(stain.mul(0.05)).sub(pit.oneMinus().mul(0.05))),
        roughness: R,
        height: pit.sub(1).mul(0.00003).add(stain.mul(0.00004)),
      };
    }
    case 'cartilage':
    case 'lymph-node': {
      const m = n3(P.mul(1 / 2.5));
      return { tone: (c) => c.mul(float(1).add(m.mul(0.03))), roughness: R, height: m.mul(0.00001) };
    }
    default:
      return null;
  }
}

/** Perturb a view-space normal by a height field (metres) with screen-space derivatives (surface gradient, Mikkelsen 2010). */
function bump(n: THREE.Node<'vec3'>, h: THREE.Node<'float'>) {
  const dpdx = dFdx(positionView);
  const dpdy = dFdy(positionView);
  const r1 = cross(dpdy, n);
  const r2 = cross(n, dpdx);
  const det = dot(dpdx, r1);
  const grad = sign(det).mul(dFdx(h).mul(r1).add(dFdy(h).mul(r2)));
  return abs(det).mul(n).sub(grad).normalize();
}

/** Rounded-rectangle cutaway window on the right side of the head, in the sagittal (Z, Y) plane. */
function windowMask(open: THREE.UniformNode<'float', number>, inset: number) {
  return Fn(() => {
    const q = abs(vec2(positionWorld.z, positionWorld.y).sub(U.windowCenter)).sub(U.windowHalf.mul(open).sub(inset).max(0));
    const inside = length(max(q, 0.0)).lessThan(float(0.008).mul(open)).and(open.greaterThan(0.001));
    return inside.and(positionWorld.x.lessThan(U.windowSideX)).not();
  })();
}

/** How far the dissected lobe is folded forward about its hinge (radians): past a right angle, so it lies clear of the nerve bed. */
export const PEEL_ANGLE = 1.9;

/** Fold about a vertical hinge at the dissection front, on the lobe's lateral surface (see ADR-0001 finding 2).
 *  `amount` is this part's dissection progress (the global peel for the M1 lobe, per piece for resections). */
function peel(amount: THREE.Node<'float'>) {
  const d = attribute('_peel', 'float');
  const front = mix(U.frontZ0, U.frontZ1, amount.min(1));
  const angle = smoothstep(0.0, 0.45, amount.sub(d)).mul(PEEL_ANGLE);
  const pivot = vec3(U.hingeX, 0, front);
  const rot = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(cos(angle)).add(v.z.mul(sin(angle))), v.y, v.z.mul(cos(angle)).sub(v.x.mul(sin(angle))));
  return { position: rot(positionLocal.sub(pivot)).add(pivot), normal: rot(normalLocal) };
}

/** Signed distance to the incision (mm, positive on the flap side) and the flap weight. */
// The skin's fragment stage is at WebGPU's 16 inputs: its scalar fields travel packed, one varying per group (the
// nodes are built once and shared, so every read in a material is the same varying). Read in the vertex stage, a
// packed node is the attributes themselves.
/** Incision and flap weight (skin and fat). */
const INCISION = vertexStage(vec2(attribute('_cut', 'float'), attribute('_flapw', 'float')));
/** The skin's ink and localisation fields: arc parameter, facelift distance and arc, footprint. */
const SKIN_FIELDS = vertexStage(vec4(attribute('_cuts', 'float'), attribute('_cut2', 'float'), attribute('_cuts2', 'float'), attribute('_foot', 'float')));
const cutMM = () => INCISION.x.mul(U.cutScale);
const flapW = () => INCISION.y;
const inFlap = () => cutMM().greaterThan(0).and(flapW().greaterThan(FLAP_ATTACHED));

/**
 * Curl about the fold axis (Rodrigues): the angle grows with the flap weight, so the attached border stays put.
 * Negative about the axis (which runs from the incision's upper end toward its lower end) swings the flap
 * laterally and forward.
 */
function fold(base: THREE.Node<'vec3'> = positionLocal) {
  const angle = U.flap.mul(U.flapMax).mul(attribute('_flapw', 'float')).negate(); // vertex stage: the attribute itself
  const k = U.flapAxis;
  const rot = (v: THREE.Node<'vec3'>) => v.mul(cos(angle)).add(cross(k, v).mul(sin(angle))).add(k.mul(dot(k, v)).mul(float(1).sub(cos(angle))));
  return { position: rot(base.sub(U.flapPivot)).add(U.flapPivot), normal: rot(normalLocal) };
}

/** Uniforms of a piece that can be removed: its own dissection progress and the pose that carries it out of the field. */
export interface PieceUniforms {
  peel: THREE.UniformNode<'float', number>;
  pose: THREE.UniformNode<'mat4', THREE.Matrix4>;
  /** 1 = cut by the section plane (a specimen opened for inspection). */
  section: THREE.UniformNode<'float', number>;
}

export interface TissueMaterial {
  /** Opaque (depth-writing) state. */
  material: THREE.MeshPhysicalNodeMaterial;
  /** The same tissue in its ghost state (transparent, no depth write): a separate material, swapped in by setOpacity, so
   *  crossing between the states never rebuilds a material (each rebuild regenerates every pass's shaders: a hitch). */
  ghost: THREE.MeshPhysicalNodeMaterial;
  twin: THREE.MeshPhysicalNodeMaterial;
  dim: THREE.UniformNode<'float', number>;
  /** Directional cue (arteries, veins, nerves with `_arc`): strength 0..1 and direction (+1 along the arc, -1 against, 0 none). */
  flow: THREE.UniformNode<'float', number>;
  flowDir: THREE.UniformNode<'float', number>;
  piece?: PieceUniforms;
}

export interface TissueOptions {
  family: TissueFamily;
  /** Cutaway window this layer obeys, with its inset (m) so deeper layers open narrower (terraced). */
  window?: { open: THREE.UniformNode<'float', number>; inset: number };
  /** The M1 lobe peel driven by the global `U.peel` (kept for plates that never separate pieces). */
  peel?: boolean;
  /** A removable piece of the gland (or the tumour): own peel progress, specimen pose, cut faces, ink, section. */
  piece?: boolean;
  /** Layers cut by the incision: 'rest' loses the flap region once it opens; 'flap' is only the flap, folded. */
  flap?: 'rest' | 'flap';
  /** Draw the incision ink (skin). */
  ink?: boolean;
  /** Facial-nerve branches that swing with the nerve mobilisation (baked `_mob` weight). */
  mobilise?: boolean;
  /** Layers that sink with the contour change after resection (skin, fat, SMAS). */
  hollow?: boolean;
  /** The skin draws risk territories (hatched ochre) from the zone slots. */
  zones?: boolean;
  /** A sheet that curls about a vertical hinge by its baked `_foldw` weight (the SMAS flap), or a strip that turns rigidly about a horizontal axis (the sternocleidomastoid strip). */
  turn?: 'smas' | 'scm';
  /** Skin and exterior body: the regional pigment map (`_tint`: redness, lip, brow/lash, scalp). */
  tint?: boolean;
  /** The geometry carries a fibre direction (`_axis`) for directional structure (nerve, muscle, vessel, duct). */
  axis?: boolean;
  /** The geometry carries the tree arc (`_arc`, mm; author.py): along-course variation and the directional cue. */
  arc?: boolean;
  /** A larger exposed nerve: draws a fine epineurial vessel on its surface. */
  thread?: boolean;
  /** The underside of a raised flap is subcutaneous fat: back faces take the fat's cut colour. */
  undersideFat?: boolean;
  /** The exterior body: when ghosted it fades out downward from the neck (orientation, not a translucent slab). */
  fadeBelow?: boolean;
  /** Fade into the field just above the scene cut (all anatomy; not the skin, which continues as the exterior body). */
  fadeCut?: boolean;
  /** A gland piece with baked cut-face and ink fields (`_cutface`, `_ink`). */
  pieceFields?: boolean;
  /** The skin carries the gland's footprint (`_foot`) for the localisation contour. */
  locate?: boolean;
  /** The eyes of the generic face (presentation only): centres of the two globes, glTF metres. */
  eyes?: readonly [THREE.Vector3, THREE.Vector3];
  /** The geometry carries the portrait morph (`_pdisp`, `_pnrm`; portrait.py). */
  portrait?: boolean;
  /** The geometry carries the portrait's skin field (`_port`: stubble, ear thinness, T-zone, scalp under the hair). */
  portraitSkin?: boolean;
}

/** Rest position and normal of a surface with the portrait morph applied by `U.morph` (or plain when it has none). */
function morphed(on: boolean | undefined) {
  if (!on) return { position: positionLocal, normal: normalLocal };
  return {
    position: positionLocal.add(attribute('_pdisp', 'vec3').mul(U.morph)),
    // blended in the vertex stage, so the fragment reads one normal (the skin is at WebGPU's 16 fragment inputs)
    normal: vertexStage(mix(normalLocal, attribute('_pnrm', 'vec3'), U.morph)).normalize(),
    /** The same normal for use in the vertex stage itself. */
    vertexNormal: mix(normalLocal, attribute('_pnrm', 'vec3'), U.morph).normalize(),
  };
}

/**
 * The opening portrait's neck and shoulder relief (portrait.py relief(), frame.json `portrait.relief`): capsules with a
 * height and a width, h(p) = sum height * exp(-d^2 / width^2), in one space: the portrait's object space (the glTF
 * frame, rest position plus the morph). The vertex stage lifts the surface by h along the normal; the fragment stage
 * tilts the normal by h's analytic gradient, so the forms shade smoothly on the coarse shoulder mesh.
 */
/** Muscles, each a polyline of RELIEF_SEGMENTS capsules (padded); the height follows the distance to the polyline. */
export const RELIEF_MUSCLES = 8;
export const RELIEF_SEGMENTS = 4;
export const RELIEF_SLOTS = RELIEF_MUSCLES * RELIEF_SEGMENTS;
export const reliefA = Array.from({ length: RELIEF_SLOTS }, () => uniform(new THREE.Vector4(0, 0, 0, 0)));
export const reliefB = Array.from({ length: RELIEF_SLOTS }, () => uniform(new THREE.Vector4(0, 0, 0, 1)));
/** The portrait's ear canal (glTF metres): the relief fades out around the auricle, which it would otherwise push through. */
export const reliefEar = uniform(new THREE.Vector3(0, 0, 0));
function relief(p: THREE.Node<'vec3'>) {
  let h: THREE.Node<'float'> = float(0);
  let g: THREE.Node<'vec3'> = vec3(0, 0, 0);
  for (let m = 0; m < RELIEF_MUSCLES; m++) {
    // the offset to the nearest point of this muscle's polyline
    let best: THREE.Node<'vec3'> = vec3(1, 1, 1);
    for (let s = 0; s < RELIEF_SEGMENTS; s++) {
      const a = reliefA[m * RELIEF_SEGMENTS + s]!;
      const b = reliefB[m * RELIEF_SEGMENTS + s]!;
      const ab = b.xyz.sub(a.xyz);
      const t = dot(p.sub(a.xyz), ab).div(dot(ab, ab).add(1e-10)).clamp(0, 1);
      const d = p.sub(a.xyz.add(ab.mul(t)));
      best = dot(d, d).lessThan(dot(best, best)).select(d, best);
    }
    const first = reliefA[m * RELIEF_SEGMENTS]!;
    const inv = float(1).div(reliefB[m * RELIEF_SEGMENTS]!.w.pow(2));
    const e = first.w.mul(exp(dot(best, best).mul(inv).negate()));
    h = h.add(e);
    g = g.add(best.mul(e.mul(inv).mul(-2)));
  }
  const ear = smoothstep(0.03, 0.05, length(p.sub(reliefEar)));
  return { h: h.mul(ear), g: g.mul(ear) };
}
/** Surface position and normal of the portrait with its relief (the vertex stage) and the relief-tilted normal (the fragment). */
function withRelief(mo: ReturnType<typeof morphed>, lift = 1) {
  // (the coarse shoulder mesh is only shaded: lifting its few vertices by narrow forms folded its triangles; the skin's
  // lift fades out toward the neck cut, so the skin still meets the unlifted body there)
  const seam = smoothstep(U.cutY.add(0.004), U.cutY.add(0.03), attribute('position', 'vec3').y);
  // the skin shell's inner face has inward normals: it moves with the outer face (a hollow would otherwise cross them)
  const out = innerShell().select(float(-1), float(1));
  const lifted = lift ? mo.position.add(mo.vertexNormal!.mul(relief(mo.position).h.mul(U.morph).mul(seam).mul(out).mul(lift))) : mo.position;
  const at = vertexStage(mo.position);
  // the tilt is capped: where several forms meet near the shoulder their summed gradient read as a crease
  const g0 = relief(at).g.mul(U.morph);
  const g = g0.mul(float(0.38).div(max(length(g0), 0.38)));
  const n = mo.normal;
  return { position: lifted, normal: n.sub(g.sub(n.mul(dot(n, g)))).normalize() };
}

export function tissue(o: TissueOptions): TissueMaterial {
  const p = PRESETS[o.family];
  const dim = uniform(0);
  const flow = uniform(0);
  const flowDir = uniform(0);
  const piece: PieceUniforms | undefined = o.piece ? { peel: uniform(0), pose: uniform(new THREE.Matrix4()), section: uniform(0) } : undefined;
  const flapFat = o.flap === 'flap' && o.family === 'fat';
  const make = () => {
    const m = p.sss && !o.undersideFat ? new THREE.MeshSSSNodeMaterial() : new THREE.MeshPhysicalNodeMaterial();
    m.side = THREE.DoubleSide;
    m.roughness = p.roughness;
    m.metalness = p.metalness ?? 0;
    m.clearcoat = p.clearcoat ?? 0;
    m.clearcoatRoughness = 0.35;
    if (p.sheen) {
      m.sheen = p.sheen;
      m.sheenRoughness = 0.6;
      m.sheenColor = new THREE.Color(p.base).lerp(new THREE.Color(1, 1, 1), 0.5);
    }
    const port = o.portraitSkin ? attribute('_port', 'vec4') : null;
    if (p.sss && m instanceof THREE.MeshSSSNodeMaterial) {
      m.thicknessColorNode = rgb(p.sss);
      m.thicknessDistortionNode = uniform(0.15);
      // (the wrap term's ambient lights every surface alike: under the portrait's strong key and rim it flattened the
      // modelling, so the portrait keeps only a trace of it)
      m.thicknessAmbientNode = port ? mix(float(0.25), float(0.03), U.morph) : uniform(0.25);
      m.thicknessAttenuationNode = uniform(0.6);
      m.thicknessPowerNode = uniform(3.0);
      // the portrait's thin auricle glows warm against the rim light
      // (none under the portrait's hair: the scalp glowed orange between the strands)
      m.thicknessScaleNode = port ? float(p.sssScale ?? 3.0).mul(float(1).sub(U.morph.mul(0.7))).mul(float(1).sub(port.w.mul(U.morph))) : uniform(p.sssScale ?? 3.0);
    }
    // Context dimming lowers value and saturation rather than recolouring.
    // Toward a warm grey and only part of the way: a neutral grey turned dimmed fat khaki.
    const tone = (c: THREE.Node<'vec3'>) => mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))).mul(vec3(1.04, 0.99, 0.93)), dim.mul(0.4)).mul(float(1).sub(dim.mul(0.45)));
    const d = detail(o.family, p, !!o.axis, !!o.arc, !!o.thread);
    let base: THREE.Node<'vec3'> = d ? d.tone(rgb(p.base)) : rgb(p.base);
    let roughness: THREE.Node<'float'> = d ? d.roughness : float(p.roughness);
    if (o.tint) {
      // Regional pigment (exterior.py): flushed ears, nose and cheeks; lips; brow skin and the upper lash line; the
      // scalp under the hair.
      const t = attribute('_tint', 'vec4');
      // (the portrait is less flushed: under its warm rim the fitted flush read orange on the ear)
      const flush = port ? t.x.mul(float(1).sub(U.morph.mul(0.35))) : t.x;
      base = mix(base, base.mul(vec3(1.07, 0.84, 0.82)), flush.mul(0.6));
      base = mix(base, rgb(0xa8645c), t.y.mul(0.7));
      base = base.mul(float(1).sub(t.z.mul(0.5)));
      base = mix(base, rgb(0x6e5a50), t.w.mul(0.6));
      roughness = roughness.sub(t.y.mul(0.14));
    }
    let relief = d?.height;
    if (port) {
      // The opening portrait's skin (portrait.py), fading with the morph: a warmer tone, the beard shadow and the
      // scalp under the short fade as dots well under a millimetre (they resolve to a shadow at portrait distance),
      // an oilier T-zone, and pores in the relief.
      const pw = U.morph;
      const P = restMM();
      const dots = smoothstep(0.34, 0.08, worley(P.mul(1 / 0.55)).x);
      // a coarser grain (about a millimetre) that survives at portrait distance: the stubble's and pores' texture
      const grain2 = n3(P.mul(1 / 1.1).add(vec3(6.6, 0.7, 2.2))).mul(0.5).add(0.5);
      // tone: warmer and a little deeper, with broad uneven tanning (less pink in the ears' and cheeks' flush)
      const tan = fractal(P.mul(1 / 30).add(vec3(3.3, 8.1, 1.2))).mul(0.5).add(0.5);
      base = mix(base, base.mul(vec3(1.0, 0.89, 0.8)).mul(float(0.92).add(tan.mul(0.16))), pw.mul(0.6));
      // visible-scale colour breakup: patches of redness (about a centimetre) and of paler and deeper tone
      const red = smoothstep(0.1, 0.7, fractal(P.mul(1 / 12).add(vec3(4.4, 0.3, 9.9))));
      base = mix(base, base.mul(vec3(1.04, 0.9, 0.88)), red.mul(pw).mul(0.35));
      const st = port.x.mul(pw);
      base = mix(base, base.mul(vec3(0.66, 0.65, 0.71)), st.mul(0.7));
      base = mix(base, rgb(0x2b231f), st.mul(max(dots, grain2.mul(0.6))).mul(0.45));
      // (at portrait distance a pixel is about 0.4 mm: the stubble reads as a speckle of millimetre dots, not a tone)
      const speck = smoothstep(0.42, 0.18, worley(P.mul(1 / 1.3).add(vec3(2.4, 6.1, 0.9))).x);
      base = mix(base, rgb(0x2a221e), st.mul(speck).mul(0.55));
      // creases in their own shade (cavity), and the hero key's baked shadow (portrait.py packs half the cavity or the
      // shadow, whichever is darker): the jaw's shadow on the neck
      const cav = port.y.mul(pw);
      base = base.mul(float(1).sub(cav.mul(0.64)));
      // lips a deeper rose-brown, the upper lash line darker
      base = mix(base, rgb(0x8a5149), attribute('_tint', 'vec4').y.mul(pw).mul(0.45));
      base = base.mul(float(1).sub(attribute('_tint', 'vec4').z.mul(pw).mul(0.3)));
      base = base.mul(float(1).sub(grain2.mul(0.05).mul(pw)));
      // the key's falloff away from the head (a portrait light, not a flood): the shoulder and the back fall into shade
      // below and behind the neck (rest mm from the parotid centroid: +y up, +z anterior)
      // (and a little less saturated: dark warm albedos saturate under the tone curve's toe)
      const away = smoothstep(60, 220, P.y.negate().sub(P.z.mul(0.4))).mul(pw);
      base = mix(base, vec3(dot(base, vec3(0.299, 0.587, 0.114))).mul(vec3(1.06, 0.98, 0.92)), away.mul(0.3)).mul(float(1).sub(away.mul(0.62)));
      const sc = port.w.mul(pw);
      base = mix(base, rgb(0x2c2d33), sc.mul(mix(float(0.9), float(1.0), dots)));
      // broad patches of oilier and drier skin break the specular sheen into the uneven highlights of real skin
      const patch = fractal(P.mul(1 / 7).add(vec3(9.2, 1.4, 3.8)));
      roughness = roughness.sub(pw.mul(0.08)).sub(port.z.mul(pw).mul(0.1)).add(sc.mul(0.25)).add(st.mul(0.1)).add(patch.mul(pw).mul(0.2)).add(cav.mul(0.24)).add(away.mul(0.12));
      // pores, and a finer, irregular relief that breaks up the specular sheen on the neck and shoulders
      const pores = smoothstep(0.0, 0.3, worley(P.mul(1 / 0.6).add(vec3(5.1, 2.7, 8.3))).x).sub(1);
      const grain = n3(P.mul(1 / 0.9).add(vec3(1.9, 4.4, 7.7)));
      if (relief) relief = relief.add(pores.mul(0.000022).add(grain.mul(0.00002)).mul(pw).mul(port.z.mul(0.5).add(0.6)));
    }
    if (o.eyes) {
      // Sclera, iris and pupil from the direction to the globe's centre (the generic eyes look straight ahead, +Z).
      // Restrained: a warm off-white sclera, a brown iris, a moderate corneal gloss, no catchlight of its own.
      const pos = attribute('position', 'vec3');
      const [a, b] = o.eyes;
      const [lo, hi] = a.x < b.x ? [a, b] : [b, a];
      const c = pos.x.lessThan((lo.x + hi.x) / 2).select(vec3(lo.x, lo.y, lo.z), vec3(hi.x, hi.y, hi.z));
      const dirZ = pos.sub(c).normalize().z;
      const iris = smoothstep(0.8, 0.83, dirZ);
      const pupil = smoothstep(0.955, 0.965, dirZ);
      const limbus = smoothstep(0.79, 0.82, dirZ).mul(smoothstep(0.86, 0.82, dirZ));
      const irisCol = mix(rgb(0x5a4030), rgb(0x7a5a3e), n3(restMM().mul(1 / 0.35)).mul(0.5).add(0.5));
      base = mix(mix(rgb(0xd9d1c6), irisCol, iris), rgb(0x141010), pupil).mul(float(1).sub(limbus.mul(0.35)));
      roughness = mix(float(0.32), float(0.18), iris);
      m.clearcoat = 0.6;
      m.clearcoatRoughness = 0.12;
      m.sheen = 0;
    }
    if (flapFat) {
      // The raised flap's fat is its underside, turned away from the key light: the gland-side fat's saturated tone and
      // gloss read there as brown leather. A paler, restrained subcutaneous tone, nearly matte, with the lobules softer.
      base = d ? d.tone(rgb(FLAP_FAT)) : rgb(FLAP_FAT);
      roughness = roughness.add(0.2);
      m.clearcoat = 0.1;
    }
    if (o.undersideFat) {
      // The skin shell's inner surface faces the viewer once the flap is folded over: it is the flap's underside.
      const inner = innerShell();
      base = inner.select(rgb(PRESETS.fat.cut).mul(0.92), base);
    }
    const foot = o.locate ? (o.ink ? SKIN_FIELDS.w : attribute('_foot', 'float')) : null;
    // The inner shell seen through an opening (the ear canal, the lip seam) falls into shadow.
    if (foot) base = mix(base, base.mul(0.12), foot.lessThan(-75).select(attribute('_tint', 'vec4').z, float(0)));
    if (foot) base = mix(base, base.mul(vec3(1.05, 0.9, 0.84)), smoothstep(-1.5, 3, foot).mul(U.locate).mul(0.3));
    if (o.arc && o.axis && (o.family === 'artery' || o.family === 'vein' || o.family === 'nerve')) {
      // The directional cue: a travelling change of the surface itself, never a light source (no emissive). Direction
      // follows the function (anatomy.yaml `flows`); speeds and spacings are deliberately slow and stylised for
      // reading, not physiological (blood moves tens of cm/s, a motor impulse tens of m/s). The temporal AA keeps 95% of
      // its history each frame, so a narrow or fast band is averaged away: the bands are broad and slow (about 10 mm/s).
      const s = attribute('_arc', 'float');
      const w = flow.mul(abs(flowDir));
      if (o.family === 'artery') {
        // pulsatile: one soft crest every 2 s
        const x = fract(s.mul(flowDir).sub(U.flowTime.mul(10)).div(20));
        const crest = cos(x.mul(Math.PI * 2)).mul(0.5).add(0.5).pow(6).mul(w);
        base = base.mul(float(1).add(crest.mul(0.22)));
        roughness = roughness.sub(crest.mul(0.06));
      } else if (o.family === 'vein') {
        // steady, non-pulsatile: a slow, smooth swell of tone (no crest) with a faint streaming texture, drifting along
        // the course at 6 mm/s; slower and softer than the arterial crests
        const q = across(restMM(), attribute('_axis', 'vec3').normalize());
        const phase = s.mul(flowDir).sub(U.flowTime.mul(6));
        const wave = cos(phase.div(24).mul(Math.PI * 2)).mul(0.5).add(0.5);
        const drift = n3(q.mul(1 / 2.2).add(vec3(0, phase.div(8), 0)));
        base = base.mul(float(1).add(wave.mul(0.16).add(drift.mul(0.05)).mul(w)));
        roughness = roughness.sub(wave.mul(0.04).mul(w));
      } else {
        // a nerve impulse, not a fluid: a band travelling in the conducted direction every 2.8 s
        const x = fract(s.mul(flowDir).sub(U.flowTime.mul(10)).div(28));
        const dmm = x.min(float(1).sub(x)).mul(28);
        const imp = exp(dmm.div(2.6).pow(2).negate()).mul(w);
        // (a warmer, deeper cream, not a brightening: ivory sits on the tone curve's shoulder, where lifting it shows
        // almost nothing, while a shift of hue survives)
        base = mix(base, base.mul(vec3(1.02, 0.88, 0.64)), imp.mul(0.75));
        roughness = roughness.sub(imp.mul(0.16));
      }
    }
    m.roughnessNode = roughness;
    if (o.fadeBelow) m.opacityNode = materialOpacity.mul(smoothstep(U.cutY.sub(0.05), U.cutY.add(0.015), positionWorld.y));
    let surface: THREE.Node<'vec3'> = tone(base);
    // The contour: a fine warm-white line in the diagrammatic register, not a glow.
    if (foot) surface = mix(surface, rgb(0xf7f2e9), float(1).sub(smoothstep(0.16, 0.5, abs(foot))).mul(U.locate).mul(0.6));
    let cutColour: THREE.Node<'vec3'> = o.undersideFat ? rgb(PRESETS.fat.cut).mul(0.92) : d ? d.tone(rgb(p.cut)) : rgb(p.cut);
    // Openings into the head (the ear canal, the lip seam): the inner shell seen through them is shadowed.
    if (o.tint && !o.undersideFat) cutColour = mix(cutColour, cutColour.mul(0.22), attribute('_tint', 'vec4').z);
    if (!piece) cutColour = tone(cutColour);
    /** Front faces take the tissue's relief; back faces seen through a cut face the viewer (flat cut surface). */
    // (The raised flap's underside is tissue, not a cut: its back faces are shaded with the reversed normal.)
    const flapInner = o.undersideFat ? innerShell() : null;
    const shade = (n: THREE.Node<'vec3'>) => {
      const front = d && relief ? bump(n.normalize(), flapFat ? relief.mul(0.5) : relief) : n;
      if (!o.undersideFat) return frontFacing.select(front, vec3(0, 0, 1));
      // The inner shell's normals face into the head; on the folded flap they must face out of the underside.
      return flapInner!.select(n.normalize(), frontFacing.select(front, n.normalize().negate()));
    };
    if (piece) cutColour = tone(cutColour);
    // Only gland pieces carry cut-face and ink fields; for the tumour pieces the attributes would be missing and the
    // shader would hold smoothstep() of constants, which Firefox's WGSL validator (Naga) rejects.
    if (piece && o.pieceFields) {
      // Faces made by a cut between pieces (the bed left by a resection) are cut parenchyma, not the gland's outer
      // surface; the baked weight is 0 on the outer surface and 1 inside the gland.
      const cutface = attribute('_cutface', 'float');
      surface = mix(surface, cutColour, cutface.mul(0.92));
      // Marker ink at the ESGS level boundaries and the extracapsular outline, on the outer surface only. Each _ink
      // channel is a signed distance (mm / 8) whose zero crossing is the boundary, so the line is sub-triangle exact.
      const inkv = attribute('_ink', 'vec3');
      const line = (c: THREE.Node<'float'>) => float(1).sub(smoothstep(PIECE_INK_MM[0] / 8, PIECE_INK_MM[1] / 8, abs(c)));
      const drawn = max(max(line(inkv.x).mul(U.inkPlane), line(inkv.y).mul(U.inkCranial)), line(inkv.z).mul(U.inkCuff));
      surface = mix(surface, rgb(INK), drawn.mul(float(1).sub(smoothstep(0.35, 0.9, cutface))).mul(0.92));
    }
    if (o.ink) {
      // drawn from the preauricular start (cut_s 0) toward the neck end (1) as U.ink rises
      // Beyond either end the signed distance changes sign across the end tangent's extension; its interpolated
      // zero there is not the incision, so ink only where the nearest path point is interior (cut_s in (0, 1)).
      const s = SKIN_FIELDS.x;
      const interior = smoothstep(0, 0.003, s).mul(float(1).sub(smoothstep(0.997, 1, s)));
      const drawn = float(1).sub(smoothstep(U.ink.sub(0.004), U.ink, s)).mul(interior);
      const line = float(1).sub(smoothstep(INK_HALF_MM[0], INK_HALF_MM[1], abs(cutMM())));
      surface = mix(surface, rgb(INK), line.mul(drawn).mul(0.88));
      // The facelift-type alternative: a dashed line, drawn from the preauricular start as U.ink2 rises.
      const s2 = SKIN_FIELDS.z;
      const interior2 = smoothstep(0, 0.003, s2).mul(float(1).sub(smoothstep(0.997, 1, s2)));
      const drawn2 = float(1).sub(smoothstep(U.ink2.sub(0.004), U.ink2, s2)).mul(interior2);
      const dash = float(1).sub(smoothstep(0.58, 0.66, fract(s2.mul(40))));
      const line2 = float(1).sub(smoothstep(0.7, 1.05, abs(SKIN_FIELDS.y.mul(U.cutScale))));
      surface = mix(surface, rgb(INK), line2.mul(drawn2).mul(dash).mul(0.88));
      // The closed wound: dark suture ticks across the line, and the scar line beneath them, red when fresh and pale
      // once mature. Both follow the Blair path (the same arc parameter and signed distance as the ink).
      const across = abs(cutMM());
      const sutured = float(1).sub(smoothstep(U.suture.sub(0.004), U.suture, s));
      const ticks = float(1).sub(smoothstep(0.1, 0.2, fract(s.mul(58)))).mul(float(1).sub(smoothstep(1.5, 2.1, across))).mul(sutured);
      const scarLine = float(1).sub(smoothstep(0.35, 0.8, across)).mul(interior);
      const scarColour = mix(vec3(0.62, 0.2, 0.2), vec3(0.86, 0.78, 0.72), U.scar);
      const wound = U.suture.greaterThan(0.001).select(float(1), float(0));
      surface = mix(surface, scarColour, scarLine.mul(wound).mul(0.85));
      surface = mix(surface, vec3(0.1, 0.12, 0.2), ticks.mul(interior).mul(0.9).mul(float(1).sub(U.scar.mul(0.7))));
    }
    if (o.zones) {
      // Hatched ochre territories (the line grammar: a simplification, not a measured boundary): diagonal strokes
      // inside each ellipsoid and a firmer outline at its edge.
      const stripe = fract(positionWorld.y.add(positionWorld.z.mul(0.7)).mul(300));
      const strokes = smoothstep(0.52, 0.66, abs(stripe.sub(0.5)).mul(2).oneMinus());
      for (let k = 0; k < ZONE_SLOTS; k++) {
        const q = positionWorld.sub(zoneCentre[k]!).div(zoneRadii[k]!);
        const r = length(q);
        const inside = float(1).sub(smoothstep(0.93, 1.0, r));
        const ring = smoothstep(0.84, 0.93, r).mul(float(1).sub(smoothstep(0.97, 1.03, r)));
        // Hatched strokes in the ochre, and a darker ochre outline so the territory holds its edge on pale skin.
        surface = mix(surface, rgb(OCHRE), inside.mul(strokes).mul(0.9).mul(zoneWeight[k]!));
        surface = mix(surface, rgb(OCHRE).mul(0.55), ring.mul(0.95).mul(zoneWeight[k]!));
      }
    }
    m.colorNode = frontFacing.select(surface, cutColour);
    const masks = [positionWorld.y.greaterThan(U.clipY).not()];
    if (o.window) masks.push(windowMask(o.window.open, o.window.inset));
    if (o.flap === 'rest') masks.push(U.flap.greaterThan(FLAP_OPEN).and(inFlap()).not());
    if (o.flap === 'flap') masks.push(inFlap());
    if (piece) {
      // The specimen opened by the section plane: back faces seen through the cut render as the cut surface.
      masks.push(piece.section.greaterThan(0.5).and(dot(positionWorld, U.sectionPlane.xyz).greaterThan(U.sectionPlane.w)).not());
    }
    // Anatomy ends at the scene cut (authored tubes may run past it, outside the narrower exterior neck).
    if (o.fadeCut) masks.push(positionWorld.y.greaterThan(U.cutY));
    m.maskNode = masks.reduce((a, b) => a.and(b));
    if (o.fadeCut) {
      const f = float(1).sub(smoothstep(U.cutY.add(0.002), U.cutY.add(0.024), positionWorld.y));
      m.outputNode = vec4(mix(output.rgb, U.field, f), output.a);
    }
    if (o.fadeBelow) {
      // Like a studio bust, the body falls into the field before its lower edge (seen only in tall framings).
      const f = float(1).sub(smoothstep(U.bodyBottom.add(0.004), U.bodyBottom.add(0.075), positionWorld.y));
      m.outputNode = vec4(mix(output.rgb, U.field, f), output.a);
    }
    if (piece) {
      const f = peel(piece.peel);
      m.positionNode = piece.pose.mul(vec4(f.position, 1)).xyz;
      m.normalNode = shade(transformNormalToView(piece.pose.mul(vec4(f.normal, 0)).xyz));
    } else if (o.turn === 'smas') {
      const angle = U.smas.mul(2.5).mul(attribute('_foldw', 'float'));
      const hinge = vec3(U.smasHinge.x, 0, U.smasHinge.y);
      const rot = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(cos(angle)).add(v.z.mul(sin(angle))), v.y, v.z.mul(cos(angle)).sub(v.x.mul(sin(angle))));
      m.positionNode = rot(positionLocal.sub(hinge)).add(hinge);
      m.normalNode = shade(transformNormalToView(rot(normalLocal)));
    } else if (o.turn === 'scm') {
      const angle = U.scmTurn.mul(U.scmMax);
      const rot = (v: THREE.Node<'vec3'>) => vec3(v.x, v.y.mul(cos(angle)).add(v.z.mul(sin(angle))), v.z.mul(cos(angle)).sub(v.y.mul(sin(angle))));
      m.positionNode = rot(positionLocal.sub(U.scmPivot)).add(U.scmPivot);
      m.normalNode = shade(transformNormalToView(rot(normalLocal)));
    } else if (o.hollow) {
      const d = length(vec2(positionLocal.z, positionLocal.y).sub(U.hollowCentre)).div(U.hollowRadius);
      const mo = morphed(o.portrait);
      const r = o.portraitSkin ? withRelief(mo) : mo;
      m.positionNode = r.position.add(vec3(U.hollowDepth.mul(U.hollow).mul(exp(d.mul(d).negate())), 0, 0));
      m.normalNode = shade(transformNormalToView(r.normal));
    } else if (o.mobilise) {
      m.positionNode = positionLocal.add(U.mobiliseBy.mul(attribute('_mob', 'float').mul(U.mobilise)));
      m.normalNode = shade(transformNormalToView(normalLocal));
    } else if (o.peel || o.flap === 'flap') {
      // The skin shell's inner surface lies exactly where the fat band begins (2 mm): on the raised flap the two would
      // fight, so the inner shell is drawn 1 mm back toward the outer skin (its normal points into the head): midway, so
      // it is 1 mm from both (at 1.5 mm it lay 0.5 mm under the outer shell: the two striped, and along the raised
      // flap's cut edge they showed as cream flecks).
      const lift = o.undersideFat ? positionLocal.sub(normalLocal.mul(innerShell().select(float(0.001), float(0)))) : positionLocal;
      const f = o.peel ? peel(U.peel) : fold(lift);
      m.positionNode = f.position;
      m.normalNode = shade(transformNormalToView(f.normal));
    } else if (o.portrait) {
      const mo = morphed(true);
      const r = o.portraitSkin ? withRelief(mo, o.fadeBelow ? 0 : 1) : mo;
      m.positionNode = r.position;
      m.normalNode = shade(transformNormalToView(r.normal));
    } else {
      m.normalNode = shade(transformNormalToView(normalLocal));
    }
    return m;
  };
  const material = make();
  const ghost = make();
  ghost.transparent = true;
  ghost.depthWrite = false;
  const twin = make();
  twin.colorWrite = false;
  twin.transparent = true;
  twin.depthWrite = true;
  return { material, ghost, twin, dim, flow, flowDir, ...(piece ? { piece } : {}) };
}

/** The portrait hair's normals are bent toward the hero key by this much (glTF frame; groomCards, hairShells). */
const HAIR_WRAP = vec3(-0.55, 0.55, 0.63).mul(0.15);

/** Shell layers of the hair (exterior.py root surface): enough for a soft silhouette at portrait distance. */
export const HAIR_LAYERS = 14;

export interface HairMaterial {
  material: THREE.MeshPhysicalNodeMaterial;
  /** 0..1: strands present (dissolves strand by strand, so a fade never shows a semi-transparent shell). */
  fade: THREE.UniformNode<'float', number>;
}

/**
 * Short, combed hair and the eyebrows as alpha-tested shells over the scalp (presentation only). Each copy of the
 * root surface carries `_layer` (0 at the root, 1 at the tips); strands run along the baked comb direction, so the
 * noise is taken across it. Inner layers are darker (self-shadowing), which gives the cut its volume.
 */
export function hairShells(o: { morph?: boolean; portrait?: boolean } = {}): HairMaterial {
  // `morph`: the root surface rides the portrait morph (`_pdisp`); `portrait`: the opening portrait's own cut and colour
  const portrait = !!o.portrait;
  const fade = uniform(1);
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  const t = attribute('_layer', 'float');
  const hmm = portrait ? attribute('_hairh', 'float').mul(64) : attribute('_hairh', 'float'); // (the portrait's is stored as mm / 64)
  const flow = attribute('_flow', 'vec3').normalize();
  const kind = attribute('_hairk', 'float');
  const h = hmm.mul(0.001);
  // Lifted along the scalp normal, leaning along the comb direction (combed hair lies nearly flat).
  const root = o.morph ? positionLocal.add(attribute('_pdisp', 'vec3').mul(U.morph)) : positionLocal;
  m.positionNode = root.add(normalLocal.mul(h.mul(t).mul(0.75).add(0.00025))).add(flow.mul(h.mul(t).mul(t).mul(1.3)));
  if (portrait) m.normalNode = transformNormalToView(normalLocal.add(HAIR_WRAP).normalize());
  const P = restMM();
  const q = across(P, flow);
  const pitch = mix(float(1 / 0.2), float(1 / 0.14), kind);
  const strand = n3(q.mul(pitch).add(flow.mul(dot(P, flow).mul(0.05)))).mul(0.5).add(0.5);
  const clump = n3(q.mul(1 / 1.7).add(vec3(4.2, 1.3, 7.7))).mul(0.5).add(0.5);
  const v = strand.mul(0.72).add(clump.mul(0.28));
  // Strands thin out toward their tips and where the hair is short (the hairline), and dissolve with `fade`.
  // The hairline thins over several millimetres and its edge is broken by noise (never the triangles' polygon).
  const ragged = hmm.mul(float(0.7).add(n3(P.mul(1 / 1.8)).mul(0.5).add(0.5).mul(0.6)));
  // Density follows length: scalp hair thins from about 6 mm down (the short sides show some scalp, the hairline
  // fades over several millimetres); brows use their own short range.
  const edge = mix(smoothstep(0.2, 6.0, ragged), smoothstep(0.1, 1.5, ragged), kind);
  // Brows are sparser than the scalp (skin shows between the hairs).
  const threshold = t.mul(0.5).add(0.22).add(edge.oneMinus().mul(0.55)).add(kind.mul(portrait ? 0.24 : 0.2)).add(fade.oneMinus().mul(1.2));
  // (the portrait's younger cut has no grey, and matches the groom's colour)
  const grey = portrait ? float(0) : smoothstep(0.9, 0.93, n3(q.mul(pitch.mul(0.5)).add(vec3(3, 9, 1))).mul(0.5).add(0.5)).mul(kind.oneMinus());
  const shade = n3(q.mul(pitch.mul(0.35)).add(vec3(1.7, 5.1, 2.9))).mul(0.5).add(0.5);
  const [c0, c1, c2] = portrait ? [0x31333a, 0x3b3b42, 0x504d52] : [0x30251e, 0x56443a, 0x76604f];
  const colour = mix(mix(mix(rgb(c0), rgb(c1), clump), rgb(c2), shade.mul(0.45)), rgb(0x9a928a), grey.mul(0.5));
  const brow = rgb(portrait ? 0x5a514c : 0x6a5442);
  m.colorNode = mix(colour, brow, kind).mul(mix(mix(float(portrait ? 0.6 : 0.28), float(0.62), kind), float(1), t.pow(0.55)));
  // A soft sheen stretched along the strands (the comb direction is the tangent, hairGeometry): the band of light
  // that reads as hair rather than felt.
  m.roughness = 0.5;
  m.anisotropy = 0.75;
  m.specularIntensity = 0.5;
  m.sheen = 0.2;
  m.sheenRoughness = 0.55;
  m.sheenColor = new THREE.Color(portrait ? 0x4d443d : 0x8a7462);
  m.maskNode = v.greaterThan(threshold).and(ragged.greaterThan(0.06)).and(positionWorld.y.greaterThan(U.clipY).not());
  return { material: m, fade };
}

/**
 * The opening portrait's groom (groom.py, presentation only): baked ribbon cards, each a lock of several strands drawn
 * by an alpha test across the card (`_groom` = t root→tip, across 0..1, card random, layer). The cards ride the scalp
 * through the morph (`_pdisp`) and dissolve strand by strand with `fade`. Darker toward the roots and in the inner
 * layers (self-shadowing), lighter and warmer toward the tips; a sheen stretched along the strand tangent.
 */
export function groomCards(): HairMaterial {
  const fade = uniform(1);
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.side = THREE.DoubleSide;
  const g = attribute('_groom', 'vec4');
  const t = g.x;
  const across = g.y;
  const rnd = g.z;
  const layer = g.w;
  m.positionNode = positionLocal.add(attribute('_pdisp', 'vec3').mul(U.morph));
  // The back of the head faces away from both the key and the rim and went black: normals bent toward the hero key
  // (stage.ts LOOKS.hero) keep it in the hair's mid-tones, as a broad soft key would.
  m.normalNode = transformNormalToView(normalLocal.add(HAIR_WRAP).normalize());
  // Strands across the card: each has its own offset, width and length (the lock frays toward its tip).
  const strands = 9;
  const u = across.mul(strands).add(rnd.mul(17.0));
  const id = u.floor();
  const h1 = fract(sin(id.mul(12.9898).add(rnd.mul(78.233))).mul(43758.5453));
  const h2 = fract(sin(id.mul(39.3468).add(rnd.mul(11.135))).mul(24634.6345));
  const local = fract(u).sub(0.5).abs();
  const half = mix(float(0.42), float(0.2), t).mul(float(0.7).add(h1.mul(0.5)));
  // a few cards are flyaways (groom.py): one fine strand down the middle of the card
  const fly = rnd.lessThan(0.03);
  const core = fly.select(across.sub(0.5).abs().lessThan(mix(float(0.14), float(0.07), t)), local.lessThan(half));
  const reach = float(1).sub(h2.mul(0.35)); // strand length as a share of the card
  // Dissolve: whole strands go, in a fixed order.
  const kept = fract(h1.add(h2.mul(0.618))).lessThan(fade);
  m.maskNode = core.and(t.lessThan(reach)).and(kept).and(positionWorld.y.greaterThan(U.clipY).not());
  const P = restMM();
  const clump = n3(P.mul(1 / 5.0).add(vec3(2.1, 7.3, 4.4))).mul(0.5).add(0.5);
  // Lighter, nearly neutral albedos: the Neutral tone mapping's toe subtracts about the smallest channel from dark
  // colours (ADR-0001), so hair rendered dark brown came out a saturated orange; it reaches the reference's dark
  // brown from a mid grey-brown.
  const root = mix(rgb(0x30323a), rgb(0x3a3a41), clump);
  const tip = mix(rgb(0x5a5a62), rgb(0x6a676c), h1);
  const col = mix(root, tip, smoothstep(0.15, 1.0, t).mul(0.75));
  // inner layers and the roots are in the hair's own shadow; each lock is darker at its edges (round, not flat), and
  // locks differ in brightness
  const round = mix(float(0.72), float(1), float(1).sub(across.sub(0.5).abs().mul(2).pow(2)));
  const lock = float(0.5).add(n3(P.mul(1 / 6).add(vec3(8.8, 2.2, 6.1))).mul(0.5).add(0.5).mul(1.0));
  m.colorNode = col.mul(mix(float(0.4), float(1), layer.mul(0.6).add(t.mul(0.4)).pow(0.8))).mul(float(0.9).add(h2.mul(0.2))).mul(round).mul(lock);
  m.roughness = 0.48;
  m.anisotropy = 0.8;
  m.specularIntensity = 0.45;
  m.sheen = 0.22;
  m.sheenRoughness = 0.5;
  m.sheenColor = new THREE.Color(0x4d443d);
  return { material: m, fade };
}

/** The groom's strand tangent as the anisotropy frame (from `_flow`), made orthogonal to the normal: a lifted strand
 *  runs partly along the scalp normal, and a frame with the two nearly parallel lit single pixels white. */
export function groomGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flow = g.getAttribute('_flow');
  const normal = g.getAttribute('normal');
  const tangent = new Float32Array(flow.count * 4);
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < flow.count; i++) {
    t.fromBufferAttribute(flow, i);
    n.fromBufferAttribute(normal, i).normalize();
    t.addScaledVector(n, -t.dot(n));
    if (t.lengthSq() < 0.04) t.set(0, 1, 0).addScaledVector(n, -n.y);
    t.normalize();
    tangent.set([t.x, t.y, t.z, 1], i * 4);
  }
  g.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
  return g;
}

/** The hair root surface repeated once per shell layer, with `_layer` 0..1 (one draw call). */
export function hairGeometry(root: THREE.BufferGeometry, layers = HAIR_LAYERS): THREE.BufferGeometry {
  const n = root.getAttribute('position').count;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(root.attributes)) {
    const a = attr as THREE.BufferAttribute;
    const arr = new Float32Array(n * a.itemSize * layers);
    for (let k = 0; k < layers; k++) arr.set(a.array as Float32Array, k * n * a.itemSize);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  const layer = new Float32Array(n * layers);
  for (let k = 0; k < layers; k++) layer.fill(k / (layers - 1), k * n, (k + 1) * n);
  out.setAttribute('_layer', new THREE.BufferAttribute(layer, 1));
  // The comb direction as the tangent frame of the anisotropic sheen.
  const flow = out.getAttribute('_flow');
  const tangent = new Float32Array(flow.count * 4);
  for (let i = 0; i < flow.count; i++) tangent.set([flow.getX(i), flow.getY(i), flow.getZ(i), 1], i * 4);
  out.setAttribute('tangent', new THREE.BufferAttribute(tangent, 4));
  const idx = root.getIndex()!;
  const ia = new Uint32Array(idx.count * layers);
  for (let k = 0; k < layers; k++) for (let i = 0; i < idx.count; i++) ia[k * idx.count + i] = idx.getX(i) + k * n;
  out.setIndex(new THREE.BufferAttribute(ia, 1));
  out.computeBoundingSphere();
  return out;
}

export interface HatchMaterial {
  material: THREE.MeshBasicNodeMaterial;
  /** 0..1 visibility of the hatch (presence × opacity). */
  strength: THREE.UniformNode<'float', number>;
}

/**
 * The line/hatch grammar for schematic content (plan §2: naturalistic shading is modelled anatomy; hatch means a
 * simplification): a rim line plus diagonal hatching fixed to the object, so it does not swim as the camera moves.
 * `colour` is the line colour (pale ink; the complications chapter passes the ochre).
 */
export function hatch(colour: number, options: { spacingMm?: number; fillWidth?: number } = {}): HatchMaterial {
  const strength = uniform(1);
  const m = new THREE.MeshBasicNodeMaterial();
  m.side = THREE.DoubleSide;
  m.transparent = true;
  m.depthWrite = false;
  const period = 1 / ((options.spacingMm ?? 1.6) * 0.001);
  const stripe = fract(positionWorld.y.add(positionWorld.z.mul(0.6)).add(positionWorld.x.mul(0.3)).mul(period));
  const w = options.fillWidth ?? 0.12;
  const fill = smoothstep(0.5 - w, 0.5 - w * 0.4, abs(stripe.sub(0.5)));
  const rim = float(1).sub(abs(normalView.z)).pow(2.2);
  const a = max(fill.mul(0.62), rim.mul(0.95)).mul(strength);
  m.colorNode = rgb(colour);
  m.opacityNode = a;
  return { material: m, strength };
}

/*
 * CPU mirrors of the shader masks and deformations above, for label occlusion (raycasts see the rest geometry,
 * not what the shaders discard or move). Keep them in step with windowMask(), inFlap(), peel() and fold().
 */

/** True where the cutaway window discards a surface point (glTF frame, metres). */
export function cpuWindowCut(p: THREE.Vector3, open: number, inset: number): boolean {
  if (open <= 0.001) return false;
  const c = U.windowCenter.value as THREE.Vector2;
  const h = U.windowHalf.value as THREE.Vector2;
  const qx = Math.abs(p.z - c.x) - Math.max(h.x * open - inset, 0);
  const qy = Math.abs(p.y - c.y) - Math.max(h.y * open - inset, 0);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) < 0.008 * open && p.x < (U.windowSideX.value as number);
}

/** True where the incision has opened and the point belongs to the flap (discarded from the resting layer). */
export function cpuInFlap(cutStored: number, w: number): boolean {
  return cutStored * (U.cutScale.value as number) > 0 && w > FLAP_ATTACHED;
}

const rotY = (p: THREE.Vector3, pivotX: number, pivotZ: number, a: number) => {
  const x = p.x - pivotX;
  const z = p.z - pivotZ;
  p.x = x * Math.cos(a) + z * Math.sin(a) + pivotX;
  p.z = z * Math.cos(a) - x * Math.sin(a) + pivotZ;
  return p;
};

export function cpuPeel(p: THREE.Vector3, d: number, amount: number = U.peel.value as number): THREE.Vector3 {
  const peelV = amount;
  const t = Math.min(Math.max((peelV - d) / 0.45, 0), 1);
  const front = (U.frontZ0.value as number) + ((U.frontZ1.value as number) - (U.frontZ0.value as number)) * Math.min(peelV, 1);
  return rotY(p, U.hingeX.value as number, front, t * t * (3 - 2 * t) * PEEL_ANGLE);
}

export function cpuFold(p: THREE.Vector3, w: number): THREE.Vector3 {
  const pivot = U.flapPivot.value as THREE.Vector3;
  const angle = -(U.flap.value as number) * (U.flapMax.value as number) * w;
  return p.sub(pivot).applyAxisAngle(U.flapAxis.value as THREE.Vector3, angle).add(pivot);
}

/** Single-layer ghost: the depth-only twin draws first, then the tissue blends over the opaque interior. */
export function setOpacity(mesh: THREE.Mesh, twin: THREE.Mesh, mat: TissueMaterial, opacity: number) {
  const ghost = opacity < 0.999;
  const m = ghost ? mat.ghost : mat.material;
  m.opacity = opacity;
  mesh.material = m;
  twin.visible = ghost && mesh.visible;
}
