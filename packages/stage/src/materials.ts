import * as THREE from 'three/webgpu';
import { Fn, abs, attribute, cos, exp, cross, dot, float, fract, frontFacing, length, max, mix, normalLocal, normalView, positionLocal, positionWorld, sin, smoothstep, transformNormalToView, uniform, vec2, vec3, vec4 } from 'three/tsl';

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

/** Naturalistic tissue colours (sRGB) with restrained illustrator conventions: artery red, vein blue-grey, nerve ivory. */
const PRESETS: Record<TissueFamily, Preset> = {
  skin: { base: 0xc99c86, cut: 0xe2c6b3, roughness: 0.58, sheen: 0.22, sss: 0xa4503c, sssScale: 1.4 },
  fat: { base: 0xf2d27a, cut: 0xf4dc98, roughness: 0.42, clearcoat: 0.5 },
  fascia: { base: 0xd9ccb9, cut: 0xe3d8c8, roughness: 0.5, sheen: 0.6 },
  gland: { base: 0xd2926f, cut: 0xe6b89c, roughness: 0.55, clearcoat: 0.28, sss: 0x9c3a22, sssScale: 3.0 },
  duct: { base: 0xe8d6c2, cut: 0xe8d6c2, roughness: 0.45, clearcoat: 0.4 },
  muscle: { base: 0xae4a41, cut: 0xbd6157, roughness: 0.6, sheen: 0.3, clearcoat: 0.25 },
  bone: { base: 0xe6ddc8, cut: 0xefe7d4, roughness: 0.72 },
  cartilage: { base: 0xdfe2d6, cut: 0xe8eadf, roughness: 0.45, clearcoat: 0.4 },
  nerve: { base: 0xf1e3b2, cut: 0xf1e3b2, roughness: 0.45, clearcoat: 0.3, sheen: 0.6 },
  artery: { base: 0xb3363c, cut: 0xb3363c, roughness: 0.35, clearcoat: 0.6 },
  vein: { base: 0x55648a, cut: 0x55648a, roughness: 0.35, clearcoat: 0.6 },
  'lymph-node': { base: 0xcdb7a4, cut: 0xd8c6b5, roughness: 0.5 },
  tumour: { base: 0xdcd6c8, cut: 0xcdc8ba, roughness: 0.42, clearcoat: 0.45 },
  // Manufactured objects: cool grey, not a tissue colour, so a probe or drain is never mistaken for anatomy.
  instrument: { base: 0x8e98a6, cut: 0x8e98a6, roughness: 0.34, clearcoat: 0.35, metalness: 0.4 },
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
  /** Nerve mobilisation (total parotidectomy), 0..1: the facial-nerve branches are lifted off the deep lobe. */
  mobilise: uniform(0),
  /** Displacement of a fully mobilised branch (glTF metres): lateral, a little up and forward. */
  mobiliseBy: uniform(new THREE.Vector3(-0.011, 0.007, 0.009)),
};

/** Risk territories drawn on the skin (complications chapter): up to six ellipsoids, each tied to a weight 0..1. */
export const ZONE_SLOTS = 6;
export const zoneCentre = Array.from({ length: ZONE_SLOTS }, () => uniform(new THREE.Vector3(0, 0, 0)));
export const zoneRadii = Array.from({ length: ZONE_SLOTS }, () => uniform(new THREE.Vector3(1, 1, 1)));
export const zoneWeight = Array.from({ length: ZONE_SLOTS }, () => uniform(0));
/** The single desaturated ochre of complications (plan §5); shown only in the Complications chapter. */
const OCHRE = 0xc9a55a;

/** Flap progress above which the incision is open (the flap copy shows and the resting layer is cut). */
export const FLAP_OPEN = 0.0005;
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
const cutMM = () => attribute('_cut', 'float').mul(U.cutScale);
const flapW = () => attribute('_flapw', 'float');
const inFlap = () => cutMM().greaterThan(0).and(flapW().greaterThan(FLAP_ATTACHED));

/**
 * Curl about the fold axis (Rodrigues): the angle grows with the flap weight, so the attached border stays put.
 * Negative about the axis (which runs from the incision's upper end toward its lower end) swings the flap
 * laterally and forward.
 */
function fold() {
  const angle = U.flap.mul(U.flapMax).mul(flapW()).negate();
  const k = U.flapAxis;
  const rot = (v: THREE.Node<'vec3'>) => v.mul(cos(angle)).add(cross(k, v).mul(sin(angle))).add(k.mul(dot(k, v)).mul(float(1).sub(cos(angle))));
  return { position: rot(positionLocal.sub(U.flapPivot)).add(U.flapPivot), normal: rot(normalLocal) };
}

/** Uniforms of a piece that can be removed: its own dissection progress and the pose that carries it out of the field. */
export interface PieceUniforms {
  peel: THREE.UniformNode<'float', number>;
  pose: THREE.UniformNode<'mat4', THREE.Matrix4>;
  /** 1 = cut by the section plane (a specimen opened for inspection). */
  section: THREE.UniformNode<'float', number>;
}

export interface TissueMaterial {
  material: THREE.MeshPhysicalNodeMaterial;
  twin: THREE.MeshPhysicalNodeMaterial;
  dim: THREE.UniformNode<'float', number>;
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
}

export function tissue(o: TissueOptions): TissueMaterial {
  const p = PRESETS[o.family];
  const dim = uniform(0);
  const piece: PieceUniforms | undefined = o.piece ? { peel: uniform(0), pose: uniform(new THREE.Matrix4()), section: uniform(0) } : undefined;
  const make = () => {
    const m = p.sss ? new THREE.MeshSSSNodeMaterial() : new THREE.MeshPhysicalNodeMaterial();
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
    if (p.sss && m instanceof THREE.MeshSSSNodeMaterial) {
      m.thicknessColorNode = rgb(p.sss);
      m.thicknessDistortionNode = uniform(0.15);
      m.thicknessAmbientNode = uniform(0.25);
      m.thicknessAttenuationNode = uniform(0.6);
      m.thicknessPowerNode = uniform(3.0);
      m.thicknessScaleNode = uniform(p.sssScale ?? 3.0);
    }
    // Context dimming lowers value and saturation rather than recolouring.
    const tone = (c: THREE.Node<'vec3'>) => mix(c, vec3(dot(c, vec3(0.299, 0.587, 0.114))), dim.mul(0.7)).mul(float(1).sub(dim.mul(0.5)));
    let surface: THREE.Node<'vec3'> = tone(rgb(p.base));
    let cutColour: THREE.Node<'vec3'> = rgb(p.cut);
    if (piece) {
      // Faces made by a cut between pieces (the bed left by a resection) are cut parenchyma, not the gland's outer
      // surface; the baked weight is 0 on the outer surface and 1 inside the gland.
      const cutface = attribute('_cutface', 'float');
      cutColour = tone(cutColour);
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
      const s = attribute('_cuts', 'float');
      const interior = smoothstep(0, 0.003, s).mul(float(1).sub(smoothstep(0.997, 1, s)));
      const drawn = float(1).sub(smoothstep(U.ink.sub(0.004), U.ink, s)).mul(interior);
      const line = float(1).sub(smoothstep(INK_HALF_MM[0], INK_HALF_MM[1], abs(cutMM())));
      surface = mix(surface, rgb(INK), line.mul(drawn).mul(0.88));
      // The facelift-type alternative: a dashed line, drawn from the preauricular start as U.ink2 rises.
      const s2 = attribute('_cuts2', 'float');
      const interior2 = smoothstep(0, 0.003, s2).mul(float(1).sub(smoothstep(0.997, 1, s2)));
      const drawn2 = float(1).sub(smoothstep(U.ink2.sub(0.004), U.ink2, s2)).mul(interior2);
      const dash = float(1).sub(smoothstep(0.58, 0.66, fract(s2.mul(40))));
      const line2 = float(1).sub(smoothstep(0.7, 1.05, abs(attribute('_cut2', 'float').mul(U.cutScale))));
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
      const stripe = fract(positionWorld.y.add(positionWorld.z.mul(0.7)).mul(520));
      const strokes = smoothstep(0.58, 0.66, abs(stripe.sub(0.5)).mul(2).oneMinus());
      for (let k = 0; k < ZONE_SLOTS; k++) {
        const q = positionWorld.sub(zoneCentre[k]!).div(zoneRadii[k]!);
        const r = length(q);
        const inside = float(1).sub(smoothstep(0.93, 1.0, r));
        const ring = smoothstep(0.84, 0.93, r).mul(float(1).sub(smoothstep(0.97, 1.03, r)));
        const mark = max(inside.mul(strokes).mul(0.55), ring.mul(0.95)).mul(zoneWeight[k]!);
        surface = mix(surface, rgb(OCHRE), mark.mul(0.9));
      }
    }
    m.colorNode = frontFacing.select(surface, piece ? cutColour : rgb(p.cut));
    const masks = [positionWorld.y.greaterThan(U.clipY).not()];
    if (o.window) masks.push(windowMask(o.window.open, o.window.inset));
    if (o.flap === 'rest') masks.push(U.flap.greaterThan(FLAP_OPEN).and(inFlap()).not());
    if (o.flap === 'flap') masks.push(inFlap());
    if (piece) {
      // The specimen opened by the section plane: back faces seen through the cut render as the cut surface.
      masks.push(piece.section.greaterThan(0.5).and(dot(positionWorld, U.sectionPlane.xyz).greaterThan(U.sectionPlane.w)).not());
    }
    m.maskNode = masks.reduce((a, b) => a.and(b));
    if (piece) {
      const f = peel(piece.peel);
      m.positionNode = piece.pose.mul(vec4(f.position, 1)).xyz;
      m.normalNode = frontFacing.select(transformNormalToView(piece.pose.mul(vec4(f.normal, 0)).xyz), vec3(0, 0, 1));
    } else if (o.turn === 'smas') {
      const angle = U.smas.mul(2.5).mul(attribute('_foldw', 'float'));
      const hinge = vec3(U.smasHinge.x, 0, U.smasHinge.y);
      const rot = (v: THREE.Node<'vec3'>) => vec3(v.x.mul(cos(angle)).add(v.z.mul(sin(angle))), v.y, v.z.mul(cos(angle)).sub(v.x.mul(sin(angle))));
      m.positionNode = rot(positionLocal.sub(hinge)).add(hinge);
      m.normalNode = frontFacing.select(transformNormalToView(rot(normalLocal)), vec3(0, 0, 1));
    } else if (o.turn === 'scm') {
      const angle = U.scmTurn.mul(U.scmMax);
      const rot = (v: THREE.Node<'vec3'>) => vec3(v.x, v.y.mul(cos(angle)).add(v.z.mul(sin(angle))), v.z.mul(cos(angle)).sub(v.y.mul(sin(angle))));
      m.positionNode = rot(positionLocal.sub(U.scmPivot)).add(U.scmPivot);
      m.normalNode = frontFacing.select(transformNormalToView(rot(normalLocal)), vec3(0, 0, 1));
    } else if (o.hollow) {
      const d = length(vec2(positionLocal.z, positionLocal.y).sub(U.hollowCentre)).div(U.hollowRadius);
      m.positionNode = positionLocal.add(vec3(U.hollowDepth.mul(U.hollow).mul(exp(d.mul(d).negate())), 0, 0));
      m.normalNode = frontFacing.select(transformNormalToView(normalLocal), vec3(0, 0, 1));
    } else if (o.mobilise) {
      m.positionNode = positionLocal.add(U.mobiliseBy.mul(attribute('_mob', 'float').mul(U.mobilise)));
      m.normalNode = frontFacing.select(transformNormalToView(normalLocal), vec3(0, 0, 1));
    } else if (o.peel || o.flap === 'flap') {
      const f = o.peel ? peel(U.peel) : fold();
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
  return { material, twin, dim, ...(piece ? { piece } : {}) };
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
