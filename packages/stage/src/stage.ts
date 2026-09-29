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
import { cpuFold, cpuInFlap, cpuPeel, cpuWindowCut, FLAP_OPEN, setOpacity, tissue, U, type FlapFrame, type PeelFrame, type TissueFamily, type TissueMaterial } from './materials.ts';

export type Tier = 'high' | 'mid';

export interface StructureInfo {
  id: string;
  tissue: TissueFamily;
}

export interface StageOptions {
  canvas: HTMLCanvasElement;
  tier: Tier;
  forceWebGL?: boolean;
  /** Field (background) colour as CSS, shared with the page (ADR-0003). */
  field: string;
  /** Structures present in the asset with their tissue families (from the content collection). */
  structures: readonly StructureInfo[];
}

export interface AnchorProjection {
  id: string;
  x: number;
  y: number;
  visible: boolean;
}

interface Frame {
  peel: PeelFrame;
  flap: FlapFrame;
  bounds: Record<string, { min: [number, number, number]; max: [number, number, number] }>;
}

/** Layers opened by the cutaway, outermost first, each inset a little further (terraced dissection). */
const WINDOW_LAYERS: Record<string, { key: string; inset: number }> = {
  skin: { key: 'cut_skin', inset: 0 },
  subcutaneous_fat: { key: 'cut_fat', inset: 0.003 },
  smas: { key: 'cut_smas', inset: 0.006 },
  parotid_fascia: { key: 'cut_fascia', inset: 0.009 },
};
const PEELED = new Set(['parotid_superficial_lobe', 'pleomorphic_adenoma']);
/** Layers cut by the incision and raised as the flap (skin and subcutaneous fat; plan §8). */
const FLAPPED = new Set(['skin', 'subcutaneous_fat']);

type Part = { mesh: THREE.Mesh; twin: THREE.Mesh; mat: TissueMaterial };

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
  private windowOpen: Record<string, THREE.UniformNode<'float', number>> = {};
  private frame!: Frame;
  private raycaster = new THREE.Raycaster();
  private key = new THREE.DirectionalLight(0xfff4e8, 2.1);
  private rim = new THREE.DirectionalLight(0xdfe8ff, 1.0);
  /** Orbit override from instrument mode, applied on top of the authored camera (degrees). */
  override = { azimuth: 0, elevation: 0, zoom: 1 };
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
      const mat = tissue({ family: s.tissue, ...window, peel: PEELED.has(node.name), ...(flapped ? { flap: 'rest' as const, ink: node.name === 'skin' } : {}) });
      node.material = mat.material;
      node.renderOrder = order.length - order.indexOf(node.name);
      this.meshes.set(node.name, { mesh: node, twin: this.twinOf(node, mat), mat });
      if (flapped) {
        const fmat = tissue({ family: s.tissue, ...window, flap: 'flap', ink: node.name === 'skin' });
        const copy = new THREE.Mesh(node.geometry, fmat.material);
        copy.name = `${node.name}__flap`;
        copy.renderOrder = node.renderOrder;
        copy.visible = false;
        node.parent!.add(copy);
        this.flaps.set(node.name, { mesh: copy, twin: this.twinOf(copy, fmat), mat: fmat });
      }
    }
    this.scene.add(gltf.scene);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;
    this.key.position.set(-1, 1.2, 0.8);
    this.rim.position.set(0.8, 0.4, -1);
    this.scene.add(this.key, this.rim, new THREE.HemisphereLight(0xf3efe9, 0x322c28, 0.4));
    this.tierNow = this.opts.tier;
    this.buildPipeline();
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

  /** Apply a resolved scene state (pure function of t upstream) to materials, visibility and camera. */
  apply(state: SceneState): void {
    const focus: THREE.Object3D[] = [];
    for (const [id, { mesh, twin, mat }] of this.meshes) {
      const s = state.structures[id];
      const presence = s?.presence ?? 0;
      mesh.visible = presence > 0.01;
      const opacity = presence * (s?.mode === 'ghost' ? (s.opacity ?? 1) : 1);
      setOpacity(mesh, twin, Math.min(opacity, 1));
      mat.dim.value = s?.emphasis === 'dim' ? 0.75 : s?.emphasis === 'context' ? 0.18 : 0;
      if (mesh.visible && s?.emphasis === 'focus') focus.push(mesh);
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
    U.peel.value = state.op['peel'] ?? 0;
    U.ink.value = state.op['ink'] ?? 0;
    U.flap.value = state.op['flap'] ?? 0;
    // Light presets: studio (anatomy), operative (a cooler key with tighter falloff), specimen (even).
    const preset = state.light.preset;
    this.key.color.set(preset === 'operative' ? 0xf1f4ff : 0xfff4e8);
    this.key.intensity = preset === 'operative' ? 2.5 : preset === 'specimen' ? 1.6 : 2.1;
    this.rim.intensity = preset === 'operative' ? 0.6 : 1.0;
    this.renderer.toneMappingExposure = state.light.exposure;
    this.placeCamera(state.camera);
  }

  private placeCamera(cam: SceneState['camera']) {
    this.lastCamera = { azimuth: cam.azimuth, elevation: cam.elevation };
    const center = new THREE.Vector3();
    let radius = 0;
    let total = 0;
    for (const { ids, weight } of cam.frames) {
      const box = new THREE.Box3();
      for (const id of ids) {
        const b = this.frame.bounds[id];
        if (b) box.union(new THREE.Box3(new THREE.Vector3(...b.min), new THREE.Vector3(...b.max)));
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

  /**
   * Screen positions (CSS px) of label anchors, with occlusion by visible opaque tissue other than the target.
   * Raycasts see rest geometry, so occluders are tested as the shaders show them: surfaces moved in the vertex
   * stage (peel, flap) are raycast as CPU-deformed proxies, and hits the fragment masks discard (cutaway
   * windows, the opened incision) are skipped (materials.ts CPU mirrors).
   */
  projectAnchors(ids: readonly string[], width: number, height: number): AnchorProjection[] {
    const out: AnchorProjection[] = [];
    const occluders: { mesh: THREE.Mesh; id: string; role: 'rest' | 'flap' }[] = [];
    for (const [id, m] of this.meshes) {
      if (!m.mesh.visible || (m.mesh.material as THREE.Material).transparent) continue;
      occluders.push({ mesh: PEELED.has(id) && (U.peel.value as number) > 0 ? this.deformed(m.mesh, 'peel') : m.mesh, id, role: 'rest' });
      const f = this.flaps.get(id);
      if (f?.mesh.visible) occluders.push({ mesh: this.deformed(f.mesh, 'flap'), id, role: 'flap' });
    }
    const tri = new THREE.Triangle();
    const bary = new THREE.Vector3();
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
      const p = this.anchors.get(id);
      if (!p) continue;
      const ndc = p.clone().project(this.camera);
      const dir = p.clone().sub(this.camera.position);
      const dist = dir.length();
      this.raycaster.set(this.camera.position, dir.normalize());
      this.raycaster.far = dist - 0.004; // hits within 4 mm of the anchor are the structure's own surface
      let blocked = false;
      for (const o of occluders) {
        if (o.id.startsWith(id) || id.startsWith(o.id)) continue;
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
      for (let k = 0; k < 8; k++) {
        v.set(k & 1 ? b.max[0] : b.min[0], k & 2 ? b.max[1] : b.min[1], k & 4 ? b.max[2] : b.min[2]).project(this.camera);
        const x = ((v.x + 1) / 2) * width;
        const y = ((1 - v.y) / 2) * height;
        box = box ? { left: Math.min(box.left, x), right: Math.max(box.right, x), top: Math.min(box.top, y), bottom: Math.max(box.bottom, y) } : { left: x, right: x, top: y, bottom: y };
      }
    }
    return box;
  }

  /** Current view direction in the anatomical frame (degrees), including any instrument-mode override. */
  get view(): { azimuth: number; elevation: number } {
    return { azimuth: this.lastCamera.azimuth + this.override.azimuth, elevation: this.lastCamera.elevation + this.override.elevation };
  }
  private lastCamera = { azimuth: 0, elevation: 0 };

  /** A raycast proxy of a mesh with its vertex-stage deformation applied on the CPU, cached per parameter value. */
  private proxies = new Map<THREE.Mesh, { key: number; mesh: THREE.Mesh }>();
  private deformed(mesh: THREE.Mesh, kind: 'peel' | 'flap'): THREE.Mesh {
    const key = (kind === 'peel' ? U.peel.value : U.flap.value) as number;
    const cached = this.proxies.get(mesh);
    if (cached && cached.key === key) return cached.mesh;
    const g = mesh.geometry.clone();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    const field = g.getAttribute(kind === 'peel' ? '_peel' : '_flapw');
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      (kind === 'peel' ? cpuPeel(v, field.getX(i)) : cpuFold(v, field.getX(i))).toArray(pos.array, i * 3);
    }
    pos.needsUpdate = true;
    g.computeBoundingSphere();
    g.computeBoundingBox();
    const proxy = new THREE.Mesh(g, mesh.material);
    cached?.mesh.geometry.dispose();
    this.proxies.set(mesh, { key, mesh: proxy });
    return proxy;
  }
}
