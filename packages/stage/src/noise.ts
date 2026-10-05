import * as THREE from 'three/webgpu';
import { texture3D, vec2, vec3 } from 'three/tsl';

/**
 * Tissue mesostructure comes from one baked, tileable 3D noise volume instead of procedural noise in the shaders
 * (ADR-0005). Procedural Perlin and worley noise, inlined at every call site, made each tissue shader so large that
 * compiling them blocked the first picture for about 15 s; a texture fetch costs almost nothing to compile or run.
 *
 * Channels (each tiles every PERIOD noise cells; SIZE voxels per period, so 4 voxels per cell):
 *   R  smooth gradient-like noise, 0..1 (0.5 = mean)
 *   G  worley F1 (distance to the nearest feature point, cell units / 1.5)
 *   B  worley F2 (second nearest, cell units / 1.5)
 *   A  a second, independent smooth noise
 * The volume is generated from a fixed seed, so every load and every machine sees the same tissue.
 */
const SIZE = 64;
const PERIOD = 16;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const wrap = (i: number) => ((i % PERIOD) + PERIOD) % PERIOD;
const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/** Tileable 3D gradient noise on a PERIOD^3 lattice. */
function gradientField(seed: number) {
  const r = rng(seed);
  const g = new Float32Array(PERIOD ** 3 * 3);
  for (let i = 0; i < PERIOD ** 3; i++) {
    const z = r() * 2 - 1;
    const a = r() * Math.PI * 2;
    const s = Math.sqrt(1 - z * z);
    g.set([s * Math.cos(a), s * Math.sin(a), z], i * 3);
  }
  return (x: number, y: number, z: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    let v = 0;
    const u = fade(x - x0);
    const w = fade(y - y0);
    const t = fade(z - z0);
    for (let dz = 0; dz < 2; dz++)
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const k = (wrap(x0 + dx) + wrap(y0 + dy) * PERIOD + wrap(z0 + dz) * PERIOD * PERIOD) * 3;
          const d = g[k]! * (x - x0 - dx) + g[k + 1]! * (y - y0 - dy) + g[k + 2]! * (z - z0 - dz);
          v += d * (dx ? u : 1 - u) * (dy ? w : 1 - w) * (dz ? t : 1 - t);
        }
    return v; // about -0.9..0.9
  };
}

export function makeNoiseVolume(): THREE.Data3DTexture {
  const data = new Uint8Array(SIZE ** 3 * 4);
  const n1 = gradientField(11);
  const n2 = gradientField(23);
  const r = rng(37);
  const pts = new Float32Array(PERIOD ** 3 * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = r();
  const step = PERIOD / SIZE;
  for (let k = 0; k < SIZE; k++)
    for (let j = 0; j < SIZE; j++)
      for (let i = 0; i < SIZE; i++) {
        const x = (i + 0.5) * step;
        const y = (j + 0.5) * step;
        const z = (k + 0.5) * step;
        const cx = Math.floor(x);
        const cy = Math.floor(y);
        const cz = Math.floor(z);
        let f1 = 9;
        let f2 = 9;
        for (let dz = -1; dz <= 1; dz++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const q = (wrap(cx + dx) + wrap(cy + dy) * PERIOD + wrap(cz + dz) * PERIOD * PERIOD) * 3;
              const px = cx + dx + pts[q]!;
              const py = cy + dy + pts[q + 1]!;
              const pz = cz + dz + pts[q + 2]!;
              const d = Math.hypot(px - x, py - y, pz - z);
              if (d < f1) (f2 = f1), (f1 = d);
              else if (d < f2) f2 = d;
            }
        const o = (i + j * SIZE + k * SIZE * SIZE) * 4;
        data[o] = Math.round(Math.min(Math.max(n1(x, y, z) * 0.55 + 0.5, 0), 1) * 255);
        data[o + 1] = Math.round(Math.min(f1 / 1.5, 1) * 255);
        data[o + 2] = Math.round(Math.min(f2 / 1.5, 1) * 255);
        data[o + 3] = Math.round(Math.min(Math.max(n2(x, y, z) * 0.55 + 0.5, 0), 1) * 255);
      }
  const tex = new THREE.Data3DTexture(data, SIZE, SIZE, SIZE);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

let volume: THREE.Data3DTexture | null = null;
const vol = () => (volume ??= makeNoiseVolume());

const sample = (p: THREE.Node<'vec3'>) => texture3D(vol(), p.mul(1 / PERIOD));

/** Smooth signed noise, about -1..1, at noise-cell coordinates p (one feature per unit). */
export const noise = (p: THREE.Node<'vec3'>) => sample(p).r.mul(2).sub(1);
/** A second, independent smooth signed noise. */
export const noiseB = (p: THREE.Node<'vec3'>) => sample(p).a.mul(2).sub(1);
/** Three octaves of smooth noise (fractal sum, amplitude 1, 0.5, 0.25), about -1..1. */
export const fractal = (p: THREE.Node<'vec3'>) => {
  const q = p;
  return noise(q).add(noiseB(q.mul(2.03).add(vec3(1.7, 9.2, 3.1))).mul(0.5)).add(noise(q.mul(4.11).add(vec3(5.3, 2.8, 7.6))).mul(0.25)).div(1.4);
};
/** Worley distances (F1, F2) in cell units. */
export const worley = (p: THREE.Node<'vec3'>) => {
  const s = sample(p);
  return vec2(s.g, s.b).mul(1.5);
};
