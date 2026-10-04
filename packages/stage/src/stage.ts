import * as THREE from 'three/webgpu';
import { builtinAOContext, float, mix, mrt, normalView, packNormalToRGB, pass, renderOutput, sample, screenUV, uniform, unpackRGBToNormal, vec3, vec4, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import type { SceneState } from '@atlas/timeline';
import { ZONE_SLOTS, cpuFold, cpuInFlap, cpuPeel, cpuWindowCut, FLAP_OPEN, hatch, setOpacity, tissue, U, zoneCentre, zoneRadii, zoneWeight, type FlapFrame, type HatchMaterial, type PeelFrame, type TissueFamily, type TissueMaterial } from './materials.ts';
import { REMOVABLE, RESECTIONS, memberWeight, poseMatrix, resectionWeights, type Mechanic } from './resection.ts';

export type Tier = 'high' | 'mid';

export interface StructureInfo {
  id: string;
  tissue: TissueFamily;
  /** Drawn in the line/hatch grammar whatever the plate says (schematic content). */
  schematic?: boolean;
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  tier: Tier;
  forceWebGL?: boolean;
  /** Field (background) colour as CSS, shared with the page (ADR-0003). */
  field: string;
  /** Structures present in the asset with their tissue families (from the content collection). */
  structures: readonly StructureInfo[];
  /** Group structures and their members (the superficial lobe is several pieces). */
  groups?: Readonly<Record<string, readonly string[]>>;
}

export interface AnchorProjection {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

interface Box {
  min: [number, number, number];
  max: [number, number, number];
}

interface Frame {
  peel: PeelFrame;
  flap: FlapFrame;
  bounds: Record<string, Box>;
  /** Risk territories on the skin: ellipsoids in glTF metres, each tied to an op weight `zone_<weight>`. */
  zones?: { key: string; weight: string; centre: [number, number, number]; radii: [number, number, number] }[];
  /** Closure barriers: the SMAS flap's hinge (x, z) and the sternocleidomastoid strip's pivot, glTF metres. */
  barriers?: { smas_hinge: [number, number]; scm_pivot: [number, number, number] };
  /** The registered axial CT slice (pipeline/anatomy/props.py): RAS extents in mm, the image, and the volume origin the glTF frame is centred on. */
  imaging?: { z_mm: number; x_mm: [number, number]; y_mm: [number, number]; image: string; origin_ras_mm: [number, number, number] };
}

/** Layers opened by the cutaway, outermost first, each inset a little further (terraced dissection). */
const WINDOW_LAYERS: Record<string, { key: string; inset: number }> = {
  skin: { key: 'cut_skin', inset: 0 },
  subcutaneous_fat: { key: 'cut_fat', inset: 0.003 },
  smas: { key: 'cut_smas', inset: 0.006 },
  parotid_fascia: { key: 'cut_fascia', inset: 0.009 },
};
/** How far an exploded view pulls the pieces apart, as a multiple of each piece's offset from the gland's centre. */
const EXPLODE_GAIN = 0.5;
const EXPLODE_OUTER = 0.016;
const EXPLODE_DEEP = 0.006;
/** Facial-nerve branches that carry the baked mobilisation weight (author.py). */
const MOBILISED = /^facial_nerve_(temporofacial|cervicofacial|temporal|zygomatic|buccal|marginal_mandibular|cervical)$/;
/** Meshes that exist only under some variants of a choice: key → variant → mesh ids. Their presence follows the variant weights. */
const VARIANT_PARTS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  // Katz-Catalano branching patterns (claim fn-branching-variation); 'typical' draws none of the interconnecting twigs.
  nervePattern: {
    'type-ii': ['facial_nerve_ic_buccal_b'],
    'type-iii': ['facial_nerve_ic_buccal_a'],
    'type-iv': ['facial_nerve_ic_buccal_a', 'facial_nerve_ic_buccal_b', 'facial_nerve_ic_divisions'],
  },
};
const VARIANT_PART_IDS: ReadonlySet<string> = new Set(Object.values(VARIANT_PARTS).flatMap((v) => Object.values(v).flat()));
/** Schematic planes that lie inside tissue and are drawn on top of it. */
const OVERLAY: ReadonlySet<string> = new Set(['us_plane']);
/** Layers that sink with the contour change after resection. */
const HOLLOWED = new Set(['skin', 'subcutaneous_fat', 'smas']);
/** Layers cut by the incision and raised as the flap (skin and subcutaneous fat; plan §8). */
const FLAPPED = new Set(['skin', 'subcutaneous_fat']);

type Part = { mesh: THREE.Mesh; twin: THREE.Mesh; mat: TissueMaterial; hatch?: HatchMaterial; tissue: TissueFamily; schematic: boolean };

/** The state of a removable piece as last applied: its dissection progress and specimen pose (CPU mirror of the shader). */
interface PieceState {
  peel: number;
  pose: THREE.Matrix4;
  moved: boolean;
}

/** Pale line colour of the schematic (hatch) grammar. */
const LINE_COLOUR = 0xd8d0c2;

/**
 * Meshopt quantisation stores positions/normals as 16-bit vec3 and custom scalars as 16-bit, which WebGPU has no
 * vertex formats for, and moves a dequantising scale/offset into the node transform. Convert attributes to float
 * and bake the node transform so shader-space coordinates are the glTF frame the peel and cutaway expect.
 */
function normaliseGeometry(mesh: THREE.Mesh) {
  const g = mesh.geometry;
  for (const [name, attr] of Object.entries(g.attributes)) {
    if (attr instanceof THREE.BufferAttribute && !(attr.array instanceof Float32Array)) {
      const out = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    } else if (attr instanceof THREE.InterleavedBufferAttribute) {
      const out = new Float32Array(attr.count * attr.itemSize);
      for (let i = 0; i < attr.count; i++) for (let c = 0; c < attr.itemSize; c++) out[i * attr.itemSize + c] = attr.getComponent(i, c);
      g.setAttribute(name, new THREE.BufferAttribute(out, attr.itemSize));
    }
  }
  mesh.updateMatrix();
  g.applyMatrix4(mesh.matrix);
  mesh.position.set(0, 0, 0);
  mesh.quaternion.identity();
  mesh.scale.set(1, 1, 1);
  mesh.updateMatrix();
  g.computeBoundingSphere();
}

/** The page's field colour (CSS), pre-compensated for the Neutral tone-mapping toe (ADR-0001 gotcha) so the
 *  canvas background matches the page around it. */
function field(css: string): THREE.Color {
  const target = new THREE.Color().setStyle(css, THREE.SRGBColorSpace);
  const m = Math.min(target.r, target.g, target.b);
  const x = Math.sqrt(m / 6.25);
  return new THREE.Color(target.r + x - m, target.g + x - m, target.b + x - m);
}

/** 0..1 presence factor for meshes that exist only under some variants (1 for every other mesh). */
function variantFactor(id: string, mix: SceneState['variantMix']): number {
  if (!VARIANT_PART_IDS.has(id)) return 1;
  let f = 0;
  for (const [key, variants] of Object.entries(VARIANT_PARTS)) for (const [name, ids] of Object.entries(variants)) if (ids.includes(id)) f += mix[key]?.[name] ?? 0;
  return Math.min(f, 1);
}

const isTransparent = (m: THREE.Mesh) => (m.material as THREE.Material).transparent;

export class Stage {
  readonly renderer: THREE.WebGPURenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(28, 1, 0.01, 5);
  private pipeline!: THREE.RenderPipeline;
  private traaNode: { _jitterIndex: number; _historyRenderTarget: THREE.RenderTarget } | null = null;
  private focus = uniform(0);
  private outlineObjects: THREE.Object3D[] = [];
  private meshes = new Map<string, Part>();
  /** The raised flap of each FLAPPED layer: same geometry, folded; shown once the incision opens. */
  private flaps = new Map<string, Part>();
  private anchors = new Map<string, THREE.Vector3>();
  /** The mesh whose motion carries a group's or piece's anchor (a label on the superficial lobe follows its level). */
  private anchorOwner = new Map<string, string>();
  private windowOpen: Record<string, THREE.UniformNode<'float', number>> = {};
  private frame!: Frame;
  private raycaster = new THREE.Raycaster();
  private key = new THREE.DirectionalLight(0xfff4e8, 2.1);
  private rim = new THREE.DirectionalLight(0xdfe8ff, 1.0);
  private pieceState = new Map<string, PieceState>();
  /** The donor's CT slice drawn on the clip plane (imaging plates), and where the clip sweep starts and ends (glTF Y). */
  private ctPlane: { mesh: THREE.Mesh; top: number; plane: number } | null = null;
  /** Per resection and mechanic: the centroid the specimen turns about (the member pieces, folded). */
  private pivots: Record<string, Partial<Record<Mechanic, THREE.Vector3>>> = {};
  private lastWeights: Record<string, number> = {};
  /** Exploded-view offsets (glTF metres) of each piece: away from the gland's centre, in proportion to its distance. */
  private explodeVec = new Map<string, THREE.Vector3>();
  /** Orbit override from instrument mode, applied on top of the authored camera (degrees). */
  override = { azimuth: 0, elevation: 0, zoom: 1 };
  /**
   * The depth dial of instrument mode: per tissue family, 1 = as authored, below 1 the family is ghosted, 0 hides it.
   * An override layer on top of the authored state (plan §4).
   */
  readonly dial: Partial<Record<TissueFamily, number>> = {};
  /** Horizontal framing offset as a fraction of the half-width (positive moves the anatomy right), so the
   *  subject sits in the space the text column leaves free. Pans the camera; TRAA owns setViewOffset. */
  frameOffsetX = 0;

  constructor(private readonly opts: StageOptions) {
    this.renderer = new THREE.WebGPURenderer({ canvas: opts.canvas, antialias: false, forceWebGL: opts.forceWebGL ?? false });
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.scene.background = field(opts.field);
    for (const [, l] of Object.entries(WINDOW_LAYERS)) this.windowOpen[l.key] = uniform(0);
  }

  get backend(): 'webgpu' | 'webgl2' {
    return (this.renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2';
  }

  async load(glbUrl: string, frameUrl: string): Promise<void> {
    await this.renderer.init();
    this.frame = (await (await fetch(frameUrl)).json()) as Frame;
    U.hingeX.value = this.frame.peel.hinge_x;
    U.frontZ0.value = this.frame.peel.front_z0;
    U.frontZ1.value = this.frame.peel.front_z1;
    const b = this.frame.bounds['parotid_superficial_lobe']!;
    U.windowCenter.value.set((b.min[2] + b.max[2]) / 2 + 0.004, (b.min[1] + b.max[1]) / 2 - 0.002);
    U.windowHalf.value.set(0.036, 0.034);
    U.windowSideX.value = 0.03;
    (U.flapPivot.value as THREE.Vector3).fromArray(this.frame.flap.axis_point);
    (U.flapAxis.value as THREE.Vector3).fromArray(this.frame.flap.axis_dir).normalize();
    U.flapMax.value = this.frame.flap.max_angle;
    U.cutScale.value = this.frame.flap.cut_scale_mm;

    for (const [k, z] of (this.frame.zones ?? []).entries()) {
      if (k >= ZONE_SLOTS) break;
      (zoneCentre[k]!.value as THREE.Vector3).fromArray(z.centre);
      (zoneRadii[k]!.value as THREE.Vector3).fromArray(z.radii);
    }
    U.hollowCentre.value.set((b.min[2] + b.max[2]) / 2 + 0.002, (b.min[1] + b.max[1]) / 2 - 0.004);
    if (this.frame.barriers) {
      U.smasHinge.value.set(this.frame.barriers.smas_hinge[0], this.frame.barriers.smas_hinge[1]);
      (U.scmPivot.value as THREE.Vector3).fromArray(this.frame.barriers.scm_pivot);
    }

    const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    const gltf = await loader.loadAsync(glbUrl);
    const info = new Map(this.opts.structures.map((s) => [s.id, s]));
    const order = gltf.scene.children.map((c) => c.name);
    gltf.scene.updateMatrixWorld(true);
    for (const node of [...gltf.scene.children]) {
      if (node.name.startsWith('anchor__')) {
        this.anchors.set(node.name.slice('anchor__'.length), node.getWorldPosition(new THREE.Vector3()));
        continue;
      }
      if (!(node instanceof THREE.Mesh)) continue;
      normaliseGeometry(node);
      const s = info.get(node.name);
      if (!s) continue; // assets may carry structures the content does not yet describe
      const w = WINDOW_LAYERS[node.name];
      const window = w ? { window: { open: this.windowOpen[w.key]!, inset: w.inset } } : {};
      const flapped = FLAPPED.has(node.name);
      const mat = tissue({ family: s.tissue, ...window, piece: REMOVABLE.has(node.name), mobilise: MOBILISED.test(node.name), hollow: HOLLOWED.has(node.name), zones: node.name === 'skin', ...(node.name === 'smas_flap' ? { turn: 'smas' as const } : node.name === 'scm_flap' ? { turn: 'scm' as const } : {}), ...(flapped ? { flap: 'rest' as const, ink: node.name === 'skin' } : {}) });
      node.material = mat.material;
      node.renderOrder = order.length - order.indexOf(node.name);
      this.meshes.set(node.name, { mesh: node, twin: this.twinOf(node, mat), mat, tissue: s.tissue, schematic: !!s.schematic });
      if (flapped) {
        const fmat = tissue({ family: s.tissue, ...window, flap: 'flap', ink: node.name === 'skin' });
        const copy = new THREE.Mesh(node.geometry, fmat.material);
        copy.name = `${node.name}__flap`;
        copy.renderOrder = node.renderOrder;
        copy.visible = false;
        node.parent!.add(copy);
        this.flaps.set(node.name, { mesh: copy, twin: this.twinOf(copy, fmat), mat: fmat, tissue: s.tissue, schematic: false });
      }
    }
    this.scene.add(gltf.scene);
    this.prepareResections();
    this.buildCtPlane();

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.key.position.set(-1, 1.2, 0.8);
    this.rim.position.set(0.8, 0.4, -1);
    this.scene.add(this.key, this.rim, new THREE.HemisphereLight(0xf3efe9, 0x322c28, 0.4));
    this.tierNow = this.opts.tier;
    this.buildPipeline();
  }

  /** The registered CT slice as a textured quad in the axial plane at the tumour level (glTF: X = -(x - ox), Y = z - oz, Z = y - oy). */
  private buildCtPlane() {
    const im = this.frame.imaging;
    if (!im) return;
    const [ox, oy, oz] = im.origin_ras_mm;
    const xl = -(im.x_mm[1] - ox) / 1000;
    const xm = -(im.x_mm[0] - ox) / 1000;
    const zp = (im.y_mm[0] - oy) / 1000;
    const za = (im.y_mm[1] - oy) / 1000;
    const y = (im.z_mm - oz) / 1000;
    // Image: lateral at the top, posterior at the left (uv v = 1 at the top row).
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([xl, y, zp, xl, y, za, xm, y, za, xm, y, zp]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const tex = new THREE.TextureLoader().load(im.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.MeshBasicNodeMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false });
    const mesh = new THREE.Mesh(g, m);
    mesh.name = 'ct_slice';
    mesh.renderOrder = -1; // drawn first among the transparent layers so the tumour outline and instruments lie over the picture
    mesh.visible = false;
    this.scene.add(mesh);
    this.ctPlane = { mesh, top: (this.frame.bounds['skin']?.max[1] ?? 0.12) + 0.001, plane: y };
  }

  /** Pivots of each resection's specimens (folded member centroids) and the owner mesh of every group anchor. */
  private prepareResections() {
    const v = new THREE.Vector3();
    const centroids = new Map<string, THREE.Vector3>();
    const glandCentre = new THREE.Vector3();
    let glandWeight = 0;
    for (const id of REMOVABLE) {
      const pos = this.meshes.get(id)?.mesh.geometry.getAttribute('position');
      if (!pos || id === 'pleomorphic_adenoma') continue;
      const c = new THREE.Vector3();
      for (let i = 0; i < pos.count; i += 3) c.add(v.fromBufferAttribute(pos, i));
      c.divideScalar(Math.ceil(pos.count / 3));
      centroids.set(id, c);
      if (id !== 'parotid_ecd_cuff') (glandCentre.addScaledVector(c, pos.count), (glandWeight += pos.count));
    }
    glandCentre.divideScalar(Math.max(glandWeight, 1));
    for (const [id, c] of centroids) {
      // Apart in the plane of the face by their offsets, and lifted off one another across the nerve plane: the outer
      // levels toward the viewer (glTF -X is lateral), the inner levels away.
      const v = c.clone().sub(glandCentre).multiplyScalar(EXPLODE_GAIN);
      v.x += id === 'parotid_level_3' || id === 'parotid_level_4' ? EXPLODE_DEEP : -EXPLODE_OUTER;
      this.explodeVec.set(id, v);
    }
    // The cuff is part of level II, and the tumour travels with it.
    const l2 = this.explodeVec.get('parotid_level_2');
    if (l2) for (const id of ['parotid_ecd_cuff', 'pleomorphic_adenoma']) this.explodeVec.set(id, l2.clone());
    for (const [name, r] of Object.entries(RESECTIONS)) {
      this.pivots[name] = {};
      for (const mech of ['out', 'deep'] as const) {
        const ids = r[mech].filter((id) => this.meshes.has(id));
        if (!ids.length) continue;
        const sum = new THREE.Vector3();
        let n = 0;
        for (const id of ids) {
          const g = this.meshes.get(id)!.mesh.geometry;
          const pos = g.getAttribute('position');
          const d = g.getAttribute('_peel');
          const folded = r.peel.includes(id);
          for (let i = 0; i < pos.count; i += 4) {
            v.fromBufferAttribute(pos, i);
            if (folded) cpuPeel(v, d.getX(i), 1);
            sum.add(v);
            n++;
          }
        }
        this.pivots[name]![mech] = sum.divideScalar(n);
      }
    }
    // A label anchored on a group sits on the member nearest it; that member's motion carries the label.
    for (const [gid, members] of Object.entries(this.opts.groups ?? {})) {
      const a = this.anchors.get(gid);
      if (!a) continue;
      let best = Infinity;
      for (const id of members) {
        const pos = this.meshes.get(id)?.mesh.geometry.getAttribute('position');
        if (!pos) continue;
        for (let i = 0; i < pos.count; i += 3) {
          const d = v.fromBufferAttribute(pos, i).distanceToSquared(a);
          if (d < best) {
            best = d;
            this.anchorOwner.set(gid, id);
          }
        }
      }
    }
    for (const id of this.anchors.keys()) if (!this.anchorOwner.has(id) && REMOVABLE.has(id)) this.anchorOwner.set(id, id);
  }

  /** Depth-only twin for the single-layer ghost (drawn just before its mesh). */
  private twinOf(mesh: THREE.Mesh, mat: TissueMaterial): THREE.Mesh {
    const twin = new THREE.Mesh(mesh.geometry, mat.twin);
    twin.matrix.copy(mesh.matrix);
    twin.matrixAutoUpdate = false;
    twin.matrixWorld.copy(mesh.matrixWorld);
    twin.renderOrder = mesh.renderOrder - 0.5;
    twin.visible = false;
    mesh.parent!.add(twin);
    return twin;
  }

  /** Current quality tier (plan §9); the tier manager may step it down at run time. */
  get tier(): Tier {
    return this.tierNow;
  }
  private tierNow: Tier = 'high';

  /** Switch quality tier: rebuilds the post-processing pipeline (materials and geometry are shared). */
  setTier(tier: Tier) {
    if (tier === this.tierNow && this.pipeline) return;
    this.tierNow = tier;
    (this.pipeline as unknown as { dispose?: () => void } | undefined)?.dispose?.();
    this.traaNode = null;
    this.tierNow = this.opts.tier;
    this.buildPipeline();
  }

  private buildPipeline() {
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    const contour = vec3(0.93, 0.9, 0.78); // near nerve luminance: a line, not a glow
    const outlinePass = outline(this.scene, this.camera, { selectedObjects: this.outlineObjects, edgeThickness: float(1.0), edgeGlow: float(0) });
    const edge = outlinePass.visibleEdge.mul(this.focus).clamp(0, 1).mul(0.85); // hidden edges off (no x-ray)
    if (this.tierNow === 'high') {
      const prePass = pass(this.scene, this.camera);
      prePass.transparent = false;
      prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
      prePass.getTexture('output').type = THREE.UnsignedByteType;
      const normals = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
      const depth = prePass.getTextureNode('depth');
      const aoPass = ao(depth, normals, this.camera);
      aoPass.resolutionScale = 0.5;
      const scenePass = pass(this.scene, this.camera);
      scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
      const node = traa(vec4(mix(scenePass.rgb, contour, edge), 1), depth, prePass.getTextureNode('velocity'), this.camera);
      node.useSubpixelCorrection = false;
      this.traaNode = node as unknown as NonNullable<Stage['traaNode']>;
      this.pipeline.outputNode = node;
    } else {
      const scenePass = pass(this.scene, this.camera);
      this.pipeline.outputColorTransform = false;
      // r186: renderOutput() leaves alpha at 0 before FXAA, so force opaque (ADR-0001 gotcha).
      this.pipeline.outputNode = fxaa(vec4(renderOutput(vec4(mix(scenePass.rgb, contour, edge), 1)).rgb, 1));
    }
  }

  /** The pose of `mechanic` for a piece under the resection weights, blending the variants that include it. */
  private poseFor(weights: Readonly<Record<string, number>>, id: string, mechanic: 'out' | 'deep', amount: number, out: THREE.Matrix4): THREE.Matrix4 {
    const pivot = new THREE.Vector3();
    const delta = [0, 0, 0];
    let rot = 0;
    let total = 0;
    for (const [name, w] of Object.entries(weights)) {
      const r = RESECTIONS[name]!;
      const pv = this.pivots[name]?.[mechanic];
      if (!r[mechanic].includes(id) || !pv) continue;
      const pose = mechanic === 'out' ? r.outPose : r.deepPose;
      pivot.addScaledVector(pv, w);
      for (let k = 0; k < 3; k++) delta[k]! += pose.delta[k]! * w;
      rot += pose.rotYDeg * w;
      total += w;
    }
    if (!total) return out.identity();
    pivot.divideScalar(total);
    return poseMatrix(pivot, { delta: [delta[0]! / total, delta[1]! / total, delta[2]! / total], rotYDeg: rot / total }, amount, out);
  }

  /** Apply a resolved scene state (pure function of t upstream) to materials, visibility and camera. */
  apply(state: SceneState): void {
    const focus: THREE.Object3D[] = [];
    const weights = resectionWeights(state.variantMix['resection']);
    this.lastWeights = weights;
    const peelP = state.op['peel'] ?? 0;
    const outP = state.op['out'] ?? 0;
    const deepP = state.op['deep'] ?? 0;
    for (const [id, part] of this.meshes) {
      const { mesh, twin, mat } = part;
      const s = state.structures[id];
      const dial = this.dial[part.tissue] ?? 1;
      const presence = (s?.presence ?? 0) * (dial > 0 ? 1 : 0) * variantFactor(id, state.variantMix);
      mesh.visible = presence > 0.01;
      const wantsHatch = part.schematic || s?.mode === 'hatch';
      const ghostOpacity = s?.mode === 'ghost' || s?.mode === 'hatch' ? (s.opacity ?? 1) : 1;
      const opacity = presence * Math.min(ghostOpacity, dial);
      if (wantsHatch) {
        if (!part.hatch) {
          part.hatch = hatch(LINE_COLOUR);
          // An imaging plane is drawn over the tissue it passes through (it lies inside the head), not hidden by it.
          if (OVERLAY.has(id)) {
            part.hatch.material.depthTest = false;
            mesh.renderOrder = 900;
          }
        }
        mesh.material = part.hatch.material;
        part.hatch.strength.value = Math.min(opacity, 1);
        twin.visible = false;
      } else {
        mesh.material = mat.material;
        setOpacity(mesh, twin, Math.min(opacity, 1));
      }
      mat.dim.value = s?.emphasis === 'dim' ? 0.75 : s?.emphasis === 'context' ? 0.18 : 0;
      if (mesh.visible && s?.emphasis === 'focus') focus.push(mesh);
      if (mat.piece) this.applyPiece(id, part, state, weights, peelP, outP, deepP);
      const flap = this.flaps.get(id);
      if (flap) {
        flap.mesh.visible = mesh.visible && (state.op['flap'] ?? 0) > FLAP_OPEN;
        setOpacity(flap.mesh, flap.twin, Math.min(opacity, 1));
        flap.mat.dim.value = mat.dim.value;
        if (flap.mesh.visible && s?.emphasis === 'focus') focus.push(flap.mesh);
      }
    }
    this.outlineObjects.length = 0;
    this.outlineObjects.push(...focus);
    this.focus.value = focus.length ? 1 : 0;
    for (const { key } of Object.values(WINDOW_LAYERS)) this.windowOpen[key]!.value = state.op[key] ?? 0;
    U.ink.value = state.op['ink'] ?? 0;
    U.ink2.value = state.op['ink_facelift'] ?? 0;
    U.flap.value = state.op['flap'] ?? 0;
    U.inkPlane.value = state.op['ink_plane'] ?? 0;
    U.inkCranial.value = state.op['ink_cranial'] ?? 0;
    U.inkCuff.value = state.op['ink_cuff'] ?? 0;
    U.mobilise.value = state.op['mobilise'] ?? 0;
    U.suture.value = state.op['suture'] ?? 0;
    if (this.ctPlane) {
      // The head is cut at the slice's level as ct_clip rises 0 → 1 (the clip descends from the top of the head to the plane).
      const clip = state.op['ct_clip'] ?? 0;
      U.clipY.value = clip > 0 ? this.ctPlane.top + (this.ctPlane.plane + 0.0004 - this.ctPlane.top) * Math.min(clip, 1) : 10;
      const shown = state.structures['ct_slice']?.presence ?? 0;
      this.ctPlane.mesh.visible = shown > 0.01;
      (this.ctPlane.mesh.material as THREE.MeshBasicNodeMaterial).opacity = Math.min(shown, 1);
    }
    U.smas.value = state.op['smas'] ?? 0;
    U.scmTurn.value = state.op['scm'] ?? 0;
    U.scar.value = state.op['scar'] ?? 0;
    U.hollow.value = state.op['hollow'] ?? 0;
    for (const [k, z] of (this.frame.zones ?? []).entries()) if (k < ZONE_SLOTS) zoneWeight[k]!.value = state.op[`zone_${z.weight}`] ?? 0;
    // Light presets: studio (anatomy), operative (a cooler key with tighter falloff), specimen (even).
    const preset = state.light.preset;
    this.key.color.set(preset === 'operative' ? 0xf1f4ff : 0xfff4e8);
    this.key.intensity = preset === 'operative' ? 2.5 : preset === 'specimen' ? 1.6 : 2.1;
    this.rim.intensity = preset === 'operative' ? 0.6 : 1.0;
    this.renderer.toneMappingExposure = state.light.exposure;
    this.placeCamera(state.camera);
    this.placeSection(state);
  }

  private applyPiece(id: string, part: Part, state: SceneState, weights: Record<string, number>, peelP: number, outP: number, deepP: number) {
    const u = part.mat.piece!;
    const peel = peelP * memberWeight(weights, id, 'peel');
    const out = outP * memberWeight(weights, id, 'out');
    const deep = deepP * memberWeight(weights, id, 'deep');
    const pose = (this.pieceState.get(id)?.pose ?? new THREE.Matrix4()).identity();
    if (out > 0) this.poseFor(weights, id, 'out', out, pose);
    else if (deep > 0) this.poseFor(weights, id, 'deep', deep, pose);
    const explode = state.op['explode'] ?? 0;
    const ev = this.explodeVec.get(id);
    if (explode > 0 && ev) pose.premultiply(new THREE.Matrix4().makeTranslation(ev.x * explode, ev.y * explode, ev.z * explode));
    u.peel.value = peel;
    u.pose.value.copy(pose);
    u.section.value = (out > 0.5 || deep > 0.5) && (state.op['section'] ?? 0) > 0.5 ? 1 : 0;
    this.pieceState.set(id, { peel, pose, moved: peel > 0 || out > 0 || deep > 0 || explode > 0 });
  }

  /** The section plane for an opened specimen: through its centre, facing the camera, so the near half is cut away. */
  private placeSection(state: SceneState) {
    if ((state.op['section'] ?? 0) <= 0.5) {
      U.sectionPlane.value.set(0, 1, 0, 1000);
      return;
    }
    const box = this.specimenBounds();
    if (!box) return;
    const c = box.getCenter(new THREE.Vector3());
    const n = this.camera.position.clone().sub(c).normalize();
    U.sectionPlane.value.set(n.x, n.y, n.z, n.dot(c));
  }

  /** Bounds of the pieces a resection lifts out, `amount` of the way through their move (for framing the specimen). */
  specimenBounds(amount = 1): THREE.Box3 | null {
    const box = new THREE.Box3();
    const pose = new THREE.Matrix4();
    const v = new THREE.Vector3();
    for (const id of REMOVABLE) {
      const part = this.meshes.get(id);
      if (!part || memberWeight(this.lastWeights, id, 'out') < 0.5) continue;
      this.poseFor(this.lastWeights, id, 'out', amount, pose);
      const folded = memberWeight(this.lastWeights, id, 'peel') > 0.5;
      const pos = part.mesh.geometry.getAttribute('position');
      const d = part.mesh.geometry.getAttribute('_peel');
      for (let i = 0; i < pos.count; i += 6) {
        v.fromBufferAttribute(pos, i);
        if (folded) cpuPeel(v, d.getX(i), 1);
        box.expandByPoint(v.applyMatrix4(pose));
      }
    }
    return box.isEmpty() ? null : box;
  }

  private boundsOf(id: string): THREE.Box3 | null {
    // `specimen` frames the lifted pieces at the end of their move; `specimen@0.45` part-way (an exploded view).
    if (id === 'specimen' || id.startsWith('specimen@')) return this.specimenBounds(id.includes('@') ? Number(id.split('@')[1]) : 1);
    const b = this.frame.bounds[id];
    return b ? new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)) : null;
  }

  private placeCamera(cam: SceneState['camera']) {
    this.lastCamera = { azimuth: cam.azimuth, elevation: cam.elevation };
    const center = new THREE.Vector3();
    let radius = 0;
    let total = 0;
    for (const { ids, weight } of cam.frames) {
      const box = new THREE.Box3();
      for (const id of ids) {
        const b = this.boundsOf(id);
        if (b) box.union(b);
      }
      if (box.isEmpty()) continue;
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      center.addScaledVector(sphere.center, weight);
      radius += sphere.radius * weight;
      total += weight;
    }
    if (total > 0) {
      center.divideScalar(total);
      radius /= total;
    } else radius = 0.08;
    const az = THREE.MathUtils.degToRad(cam.azimuth + this.override.azimuth);
    const el = THREE.MathUtils.degToRad(cam.elevation + this.override.elevation);
    // azimuth 0 = straight lateral view of the patient's right side (camera on -X), positive toward anterior (+Z)
    const dir = new THREE.Vector3(-Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
    const fov = THREE.MathUtils.degToRad(this.camera.fov);
    const fit = Math.min(fov, 2 * Math.atan(Math.tan(fov / 2) * this.camera.aspect));
    const dist = (radius / Math.sin(fit / 2)) * cam.zoom * this.override.zoom;
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(center);
    if (this.frameOffsetX) {
      // lookAt() updates the quaternion but not matrixWorld; derive the pan axis from this pose, not the last frame's.
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(this.camera.quaternion);
      const halfWidth = Math.tan(fov / 2) * dist * this.camera.aspect;
      const pan = right.multiplyScalar(-this.frameOffsetX * halfWidth);
      this.camera.position.add(pan);
      this.camera.lookAt(center.clone().add(pan));
    }
    this.camera.near = Math.max(0.005, dist - radius * 3);
    this.camera.far = dist + radius * 6;
    this.camera.updateProjectionMatrix();
  }

  resize(width: number, height: number, pixelRatio = Math.min(devicePixelRatio, 2)) {
    this.renderer.setPixelRatio(pixelRatio);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  render() {
    this.pipeline.render();
  }

  /** Render until the TRAA jitter returns to phase 0, then two full cycles: a deterministic settled frame. */
  async settle() {
    // Every visible material's pipeline must exist before the history is reseeded: on a cold load a variant still
    // compiling would be missing from the seed frame and a trace of its absence would survive accumulation.
    await (this.renderer as unknown as { compileAsync?: (s: THREE.Object3D, c: THREE.Camera) => Promise<void> }).compileAsync?.(this.scene, this.camera);
    for (let i = 0; i < 4; i++) this.render();
    let guard = 0;
    do this.render();
    while ((this.traaNode?._jitterIndex ?? 0) !== 0 && ++guard < 64);
    // Reseed the history from this state: transparent layers are not in the depth prepass, so disocclusion alone
    // does not reject the previous plate's ghosts and a settled frame would depend on the path to it.
    // A size mismatch makes TRAANode restart its history from the current beauty buffer (three r186).
    this.traaNode?._historyRenderTarget.setSize(1, 1);
    for (let i = 0; i < 64; i++) this.render();
  }

  /** Where an anchor is now: label anchors on a removable piece follow its fold and specimen pose. */
  private anchorWorld(id: string): THREE.Vector3 | null {
    const p = this.anchors.get(id);
    if (!p) return null;
    const owner = this.anchorOwner.get(id);
    const st = owner ? this.pieceState.get(owner) : undefined;
    if (!st?.moved) return p;
    const q = p.clone();
    if (st.peel > 0) cpuPeel(q, (q.z - this.frame.peel.front_z0) / (this.frame.peel.front_z1 - this.frame.peel.front_z0), st.peel);
    return q.applyMatrix4(st.pose);
  }

  /**
   * Screen positions (CSS px) of label anchors, with occlusion by visible opaque tissue other than the target.
   * Raycasts see rest geometry, so occluders are tested as the shaders show them: surfaces moved in the vertex
   * stage (peel, flap, specimen pose) are raycast as CPU-deformed proxies, and hits the fragment masks discard
   * (cutaway windows, the opened incision) are skipped (materials.ts CPU mirrors).
   */
  projectAnchors(ids: readonly string[], width: number, height: number): AnchorProjection[] {
    const out: AnchorProjection[] = [];
    const occluders: { mesh: THREE.Mesh; id: string; role: 'rest' | 'flap' }[] = [];
    for (const [id, m] of this.meshes) {
      if (!m.mesh.visible || isTransparent(m.mesh)) continue;
      // The turned barriers move in the vertex stage and have no CPU mirror: a raised flap does not occlude labels.
      if ((id === 'smas_flap' && (U.smas.value as number) > 0.01) || (id === 'scm_flap' && (U.scmTurn.value as number) > 0.01)) continue;
      const st = this.pieceState.get(id);
      occluders.push({ mesh: st?.moved ? this.deformed(m.mesh, id) : m.mesh, id, role: 'rest' });
      const f = this.flaps.get(id);
      if (f?.mesh.visible) occluders.push({ mesh: this.deformedFlap(f.mesh), id, role: 'flap' });
    }
    const tri = new THREE.Triangle();
    const bary = new THREE.Vector3();
    const owns = (target: string, occluder: string) => target === occluder || occluder.startsWith(target) || target.startsWith(occluder) || (this.opts.groups?.[target]?.includes(occluder) ?? false);
    const discarded = (o: (typeof occluders)[number], hit: THREE.Intersection) => {
      const w = WINDOW_LAYERS[o.id];
      if (w && cpuWindowCut(hit.point, this.windowOpen[w.key]!.value as number, w.inset)) return true;
      if (!FLAPPED.has(o.id) || !hit.face) return false;
      const g = o.mesh.geometry;
      const pos = g.getAttribute('position');
      tri.setFromAttributeAndIndices(pos, hit.face.a, hit.face.b, hit.face.c).getBarycoord(hit.point, bary);
      const at = (name: string) => {
        const a = g.getAttribute(name);
        return a.getX(hit.face!.a) * bary.x + a.getX(hit.face!.b) * bary.y + a.getX(hit.face!.c) * bary.z;
      };
      const inFlap = cpuInFlap(at('_cut'), at('_flapw'));
      return o.role === 'flap' ? !inFlap : (U.flap.value as number) > FLAP_OPEN && inFlap;
    };
    for (const id of ids) {
      const p = this.anchorWorld(id);
      if (!p) continue;
      const ndc = p.clone().project(this.camera);
      const dir = p.clone().sub(this.camera.position);
      const dist = dir.length();
      this.raycaster.set(this.camera.position, dir.normalize());
      this.raycaster.far = dist - 0.004; // hits within 4 mm of the anchor are the structure's own surface
      let blocked = false;
      for (const o of occluders) {
        if (owns(id, o.id)) continue;
        if (this.raycaster.intersectObject(o.mesh, false).some((hit) => !discarded(o, hit))) {
          blocked = true;
          break;
        }
      }
      out.push({ id, x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, visible: !blocked && ndc.z < 1 });
    }
    return out;
  }

  /** Screen-space box (CSS px) of the given structures' bounds, for keeping labels clear of the focus. */
  screenBox(ids: readonly string[], width: number, height: number): { left: number; right: number; top: number; bottom: number } | null {
    let box: { left: number; right: number; top: number; bottom: number } | null = null;
    const v = new THREE.Vector3();
    for (const id of ids) {
      const b = this.frame.bounds[id];
      if (!b) continue;
      const st = this.pieceState.get(id);
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]);
        if (st?.moved) {
          if (st.peel > 0) cpuPeel(v, (v.z - this.frame.peel.front_z0) / (this.frame.peel.front_z1 - this.frame.peel.front_z0), st.peel);
          v.applyMatrix4(st.pose);
        }
        v.project(this.camera);
        const x = ((v.x + 1) / 2) * width;
        const y = ((1 - v.y) / 2) * height;
        box = box ? { left: Math.min(box.left, x), right: Math.max(box.right, x), top: Math.min(box.top, y), bottom: Math.max(box.bottom, y) } : { left: x, right: x, top: y, bottom: y };
      }
    }
    return box;
  }

  /** The structure under a screen position (CSS px), or null: picking for the structure card (instrument mode). */
  pick(x: number, y: number, width: number, height: number): string | null {
    this.raycaster.setFromCamera(new THREE.Vector2((x / width) * 2 - 1, -(y / height) * 2 + 1), this.camera);
    this.raycaster.far = Infinity;
    let best: { id: string; distance: number } | null = null;
    for (const [id, part] of this.meshes) {
      if (!part.mesh.visible || isTransparent(part.mesh)) continue;
      const st = this.pieceState.get(id);
      const target = st?.moved ? this.deformed(part.mesh, id) : part.mesh;
      const hit = this.raycaster.intersectObject(target, false)[0];
      if (hit && (!best || hit.distance < best.distance)) best = { id, distance: hit.distance };
    }
    return best?.id ?? null;
  }

  /** Current view direction in the anatomical frame (degrees), including any instrument-mode override. */
  get view(): { azimuth: number; elevation: number } {
    return { azimuth: this.lastCamera.azimuth + this.override.azimuth, elevation: this.lastCamera.elevation + this.override.elevation };
  }
  private lastCamera = { azimuth: 0, elevation: 0 };

  /** A raycast proxy of a mesh with its vertex-stage deformation applied on the CPU, cached per parameter value. */
  private proxies = new Map<THREE.Mesh, { key: string; mesh: THREE.Mesh }>();
  private proxy(mesh: THREE.Mesh, key: string, move: (v: THREE.Vector3, i: number, g: THREE.BufferGeometry) => THREE.Vector3): THREE.Mesh {
    const cached = this.proxies.get(mesh);
    if (cached && cached.key === key) return cached.mesh;
    const g = mesh.geometry.clone();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      move(v, i, g).toArray(pos.array, i * 3);
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const proxy = new THREE.Mesh(g, mesh.material);
    cached?.mesh.geometry.dispose();
    this.proxies.set(mesh, { key, mesh: proxy });
    return proxy;
  }
  /** A removable piece as the shader shows it: folded by its own progress, then carried by its specimen pose. */
  private deformed(mesh: THREE.Mesh, id: string): THREE.Mesh {
    const st = this.pieceState.get(id)!;
    return this.proxy(mesh, `${st.peel}|${st.pose.elements.join(',')}`, (v, i, g) => {
      if (st.peel > 0) cpuPeel(v, g.getAttribute('_peel').getX(i), st.peel);
      return v.applyMatrix4(st.pose);
    });
  }
  private deformedFlap(mesh: THREE.Mesh): THREE.Mesh {
    return this.proxy(mesh, String(U.flap.value), (v, i, g) => cpuFold(v, g.getAttribute('_flapw').getX(i)));
  }
}
