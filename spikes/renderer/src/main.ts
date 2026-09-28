import * as THREE from 'three/webgpu';
import { float, mix, mrt, normalView, pass, renderOutput, screenUV, builtinAOContext, packNormalToRGB, sample, unpackRGBToNormal, uniform, vec3, vec4, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { outline } from 'three/addons/tsl/display/OutlineNode.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { evaluate, plates, type SpikeState } from './state.ts';
import { deepLobe, facialNerve, retromandibularVein, superficialLobe, tissueSlab, tumour } from './proxy.ts';
import { depthTwin, setGhost, tissue, u, type GhostMode, type TissueOptions } from './materials.ts';

const params = new URLSearchParams(location.search);
const backend = params.get('backend') === 'webgl' ? 'webgl' : 'webgpu';
const tier = params.get('tier') === 'mid' ? 'mid' : 'high';
const initialT = Number(params.get('t') ?? 0);
const ghostMode: GhostMode = params.get('ghost') === 'hash' ? 'hash' : 'layer';

const renderer = new THREE.WebGPURenderer({ antialias: false, forceWebGL: backend === 'webgl', trackTimestamp: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
renderer.domElement.setAttribute('role', 'img');
renderer.domElement.setAttribute('aria-label', 'Renderer spike: proxy parotid gland, facial nerve and tumour');

// ── Scene ─────────────────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();
/**
 * Khronos PBR Neutral tone mapping has a toe that darkens values below ~0.08, which crushed the
 * field toward black. Invert the toe so the field displays at its authored sRGB value.
 */
function preToneNeutral(target: THREE.Color) {
  const m = Math.min(target.r, target.g, target.b);
  if (m >= 0.04) return target.clone();
  const x = Math.sqrt(m / 6.25);
  return new THREE.Color(target.r + x - m, target.g + x - m, target.b + x - m);
}
const field = new THREE.Color().setRGB(0.176, 0.2, 0.19, THREE.SRGBColorSpace); // near-neutral drape field (ADR pending)
scene.background = preToneNeutral(field);

const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 200);
const target = new THREE.Vector3(0, 0, 0.3);
function placeCamera(azimuthDeg: number, elevationDeg: number) {
  const r = 30;
  const az = THREE.MathUtils.degToRad(azimuthDeg);
  const el = THREE.MathUtils.degToRad(elevationDeg);
  camera.position.set(target.x + r * Math.sin(az) * Math.cos(el), target.y + r * Math.sin(el), target.z + r * Math.cos(az) * Math.cos(el));
  camera.lookAt(target);
}
placeCamera(-12, 6);

const pmrem = new THREE.PMREMGenerator(renderer);
const key = new THREE.DirectionalLight(0xfff4e8, 2.2);
key.position.set(-6, 10, 14);
const rim = new THREE.DirectionalLight(0xdfe8ff, 1.1);
rim.position.set(12, 4, -6);
scene.add(key, rim, new THREE.HemisphereLight(0xf3efe9, 0x2a2f2c, 0.35));

const lobeOptions: TissueOptions = { base: 0xd0906e, cut: 0xe6b89c, roughness: 0.5, clearcoat: 0.55, sss: 0x9c3a22, clip: 'section', peel: true };
const mats = {
  skin: tissue({ base: 0xd9a58c, cut: 0xe8c9b4, roughness: 0.55, sheen: 0.25, sss: 0xc2412a, clip: 'window', context: true }),
  fat: tissue({ base: 0xe6c16a, cut: 0xf0d88f, roughness: 0.45, clearcoat: 0.5, clip: 'window', context: true }),
  lobe: tissue(lobeOptions),
  deep: tissue({ base: 0xc18163, cut: 0xe0b093, roughness: 0.5, clearcoat: 0.5, sss: 0x9c3a22, context: true }),
  tumour: tissue({ base: 0xd8d2c4, cut: 0xc9c6b8, roughness: 0.42, clearcoat: 0.45, clip: 'section', peel: true }),
  nerve: tissue({ base: 0xefe2b0, cut: 0xefe2b0, roughness: 0.45, clearcoat: 0.3, sheen: 0.6 }),
  vein: tissue({ base: 0x5a6a8a, cut: 0x5a6a8a, roughness: 0.35, clearcoat: 0.6, context: true }),
};

const add = (g: THREE.BufferGeometry, m: THREE.Material, order = 0) => {
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = order;
  scene.add(mesh);
  return mesh;
};
add(tissueSlab(2.3, 2.12, 3), mats.skin, 4);
add(tissueSlab(2.12, 1.55, 5), mats.fat, 3);
const lobeGeometry = superficialLobe();
const lobeMesh = add(lobeGeometry, mats.lobe, 2);
const lobeTwin = add(lobeGeometry, depthTwin(lobeOptions), 1.5);
lobeTwin.visible = false;
add(deepLobe(), mats.deep, 0);
add(tumour(), mats.tumour, 1);
add(retromandibularVein(), mats.vein, 0);
const nerveMeshes = facialNerve().map((g) => add(g, mats.nerve, 0));

let tris = 0;
scene.traverse((o) => {
  if (o instanceof THREE.Mesh) tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
});

// ── Pipeline ──────────────────────────────────────────────────────────────────────────────
const pipeline = new THREE.RenderPipeline(renderer);
const focus = uniform(0);
const contourColor = vec3(0.93, 0.9, 0.78); // near nerve luminance: a line, not a glow
const outlinePass = outline(scene, camera, { selectedObjects: nerveMeshes, edgeThickness: float(1.0), edgeGlow: float(0) });
// Hidden (occluded) edges stay off: drawing the nerve through opaque tissue reads as an unexplained x-ray.
const edge = outlinePass.visibleEdge.mul(focus).clamp(0, 1);

let traaNode: ReturnType<typeof traa> | null = null;
if (tier === 'high') {
  const prePass = pass(scene, camera);
  prePass.transparent = false;
  prePass.setMRT(mrt({ output: packNormalToRGB(normalView), velocity }));
  prePass.getTexture('output').type = THREE.UnsignedByteType;
  const prePassNormal = sample((uv) => unpackRGBToNormal(prePass.getTextureNode().sample(uv)));
  const prePassDepth = prePass.getTextureNode('depth');
  const aoPass = ao(prePassDepth, prePassNormal, camera);
  aoPass.resolutionScale = 0.5;
  const scenePass = pass(scene, camera);
  scenePass.contextNode = builtinAOContext(aoPass.getTextureNode().sample(screenUV).r);
  const composite = vec4(mix(scenePass.rgb, contourColor, edge.mul(0.85)), 1);
  traaNode = traa(composite, prePassDepth, prePass.getTextureNode('velocity'), camera);
  traaNode.useSubpixelCorrection = false;
  pipeline.outputNode = traaNode;
} else {
  const scenePass = pass(scene, camera);
  // FXAA works on display-referred colour, so tone mapping and sRGB conversion happen before it.
  pipeline.outputColorTransform = false;
  const composite = vec4(mix(scenePass.rgb, contourColor, edge.mul(0.85)), 1);
  // r186: renderOutput() leaves alpha at 0 here, so force an opaque result.
  pipeline.outputNode = fxaa(vec4(renderOutput(composite).rgb, 1));
}

// ── State application ────────────────────────────────────────────────────────────────────
let current: SpikeState | null = null;
function apply(s: SpikeState) {
  u.window.value = s.window;
  u.peel.value = s.peel;
  u.contextDim.value = s.contextDim;
  u.sectionOn.value = s.window > 0.5 && s.glandOpacity > 0.99 && s.peel < 0.01 && s.nerveFocus < 0.01 ? 1 : 0;
  focus.value = s.nerveFocus;
  setGhost(lobeMesh, lobeTwin, s.glandOpacity, tier === 'high' ? ghostMode : 'layer');
  current = s;
}

let t = initialT;
let orbit = { az: -12, el: 6 };
apply(evaluate(t));

// ── Frame loop & harness ─────────────────────────────────────────────────────────────────
const frameTimes: number[] = [];
let gpuTimes: number[] = [];
let last = performance.now();
let animateOrbit = false;
let orbitPhase = 0;

async function frame() {
  if (animateOrbit) {
    orbitPhase += 1 / 60;
    orbit = { az: -12 + 28 * Math.sin(orbitPhase * 0.9), el: 6 + 10 * Math.sin(orbitPhase * 0.6) };
  }
  placeCamera(orbit.az, orbit.el);
  pipeline.render();
  if (gpuTiming) {
    const ms = await renderer.resolveTimestampsAsync(THREE.TimestampQuery.RENDER);
    if (typeof ms === 'number' && ms > 0) gpuTimes.push(ms);
  }
}

let looping = params.get('capture') !== '1';
async function loop() {
  if (!looping) return;
  const now = performance.now();
  frameTimes.push(now - last);
  last = now;
  await frame();
  requestAnimationFrame(loop);
}

const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? NaN;
  return { n: s.length, median: q(0.5), p95: q(0.95) };
};

declare global {
  interface Window {
    spike: {
      ready: Promise<void>;
      info: () => Record<string, unknown>;
      setT: (t: number) => void;
      setOrbit: (az: number, el: number) => void;
      /** Renders frames until the TRAA jitter sequence returns to phase 0, then two full cycles. */
      settle: () => Promise<void>;
      /** Renders `frames` frames while stepping t linearly (a scrub). */
      scrub: (from: number, to: number, frames: number) => Promise<void>;
      /** Renders `n` frames at the current state. */
      frames: (n: number) => Promise<void>;
      measure: (seconds: number, orbit: boolean) => Promise<Record<string, unknown>>;
      plates: number;
    };
  }
}

let gpuTiming = false;
const ready = (async () => {
  await renderer.init();
  gpuTiming = renderer.hasFeature('timestamp-query') && params.get('timing') !== '0';
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  await frame();
  document.body.dataset.ready = '1';
})();

window.spike = {
  ready,
  plates: plates.length,
  info: () => ({
    backend: (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend ? 'webgpu' : 'webgl2',
    tier,
    ghost: tier === 'high' ? ghostMode : 'layer',
    triangles: Math.round(tris),
    size: [renderer.domElement.width, renderer.domElement.height],
    t,
    state: current,
    gpuTiming,
  }),
  setT: (v) => {
    t = v;
    apply(evaluate(t));
  },
  setOrbit: (az, el) => {
    orbit = { az, el };
  },
  settle: async () => {
    const jitter = () => (traaNode as unknown as { _jitterIndex: number } | null)?._jitterIndex ?? 0;
    let guard = 0;
    do await frame();
    while (jitter() !== 0 && ++guard < 64);
    for (let i = 0; i < 64; i++) await frame();
  },
  scrub: async (from, to, frames) => {
    for (let i = 0; i <= frames; i++) {
      if (frames === 0) break;
      window.spike.setT(from + ((to - from) * i) / frames);
      await frame();
    }
  },
  frames: async (n) => {
    for (let i = 0; i < n; i++) await frame();
  },
  measure: async (seconds, withOrbit) => {
    looping = true;
    animateOrbit = withOrbit;
    frameTimes.length = 0;
    gpuTimes = [];
    last = performance.now();
    requestAnimationFrame(loop);
    await new Promise((r) => setTimeout(r, seconds * 1000));
    looping = false;
    animateOrbit = false;
    await new Promise((r) => setTimeout(r, 100));
    return { frame: stats(frameTimes.slice(10)), gpu: stats(gpuTimes.slice(10)) };
  },
};

Object.assign(window, { __debug: { THREE, renderer, pipeline, scene, camera, pass, vec4, mix } });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Minimal manual controls for visual review (hidden in capture mode).
if (params.get('capture') !== '1') {
  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.innerHTML = `<label>t <input type="range" min="0" max="${plates.length - 1}" step="0.01" value="${t}"></label> <label><input type="checkbox"> orbit</label> <span>${backend} · ${tier}</span>`;
  document.body.appendChild(bar);
  const [range, box] = bar.querySelectorAll('input') as unknown as [HTMLInputElement, HTMLInputElement];
  range.addEventListener('input', () => window.spike.setT(Number(range.value)));
  box.addEventListener('change', () => (animateOrbit = box.checked));
  ready.then(() => requestAnimationFrame(loop));
}
