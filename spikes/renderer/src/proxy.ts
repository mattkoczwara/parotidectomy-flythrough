import * as THREE from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/*
 * Crude but representative proxy anatomy, generated deterministically.
 * Frame: +x anterior, +y superior, +z lateral (toward the viewer of the patient's right side).
 * Units: centimetres. The facial nerve plane is z = 0; the superficial lobe lies lateral to it.
 * Dimensions are rough orders of magnitude only (gland ~6.6 × 4.7 cm per Pujol-Olmo 2020;
 * trunk ~2.7 mm diameter per Salame 2002) — this is a rendering proxy, not anatomy.
 */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Sum of random smooth bumps on the unit sphere — deterministic lobulation. */
function lobulation(seed: number, count: number, amplitude: number, sharpness: number) {
  const rand = mulberry32(seed);
  const bumps = Array.from({ length: count }, () => {
    const v = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    return { v, a: amplitude * (0.5 + rand()) };
  });
  return (dir: THREE.Vector3) => {
    let s = 0;
    for (const b of bumps) s += b.a * Math.pow(Math.max(0, dir.dot(b.v)), sharpness);
    return s;
  };
}

/** Lobulated ellipsoid, optionally cut by the half-space f(p) >= 0 (vertices are pushed onto the plane). */
function lobulatedEllipsoid(
  radii: THREE.Vector3,
  center: THREE.Vector3,
  seed: number,
  detail: number,
  flatten?: (p: THREE.Vector3) => void,
) {
  // Icosahedron geometry is non-indexed; weld it so vertex normals are smooth.
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, detail).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const bump = lobulation(seed, 60, 0.07, 18);
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    const r = 1 + bump(v);
    v.multiplyScalar(r).multiply(radii).add(center);
    flatten?.(v);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

/** Superficial-lobe peel field: 0 at the posterior (trunk) edge, 1 at the anterior edge. */
export const peelRange = { xMin: -3.1, xMax: 3.2, hingeZ: 1.6 };

function bakePeel(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const peel = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    peel[i] = (pos.getX(i) - peelRange.xMin) / (peelRange.xMax - peelRange.xMin);
  }
  geo.setAttribute('peelOrder', new THREE.BufferAttribute(peel, 1));
  return geo;
}

export function superficialLobe() {
  const geo = lobulatedEllipsoid(new THREE.Vector3(3.2, 2.4, 1.0), new THREE.Vector3(0, 0, 0.55), 7, 6, (p) => {
    if (p.z < 0.05) p.z = 0.05 + (p.z - 0.05) * 0.08; // flattened deep face resting on the nerve plane
  });
  return bakePeel(geo);
}

export function deepLobe() {
  return lobulatedEllipsoid(new THREE.Vector3(2.2, 2.0, 1.2), new THREE.Vector3(-0.6, -0.2, -1.0), 11, 5, (p) => {
    if (p.z > -0.12) p.z = -0.12 + (p.z + 0.12) * 0.08;
  });
}

export function tumour() {
  // ~1.6 cm lobulated pleomorphic adenoma proxy in the superficial lobe (level II region).
  return bakePeel(lobulatedEllipsoid(new THREE.Vector3(0.8, 0.75, 0.62), new THREE.Vector3(0.6, -0.9, 0.95), 23, 5));
}

/** Skin and subcutaneous fat as closed slabs (outer surface to inner surface) over the region. */
export function tissueSlab(zOuter: number, zInner: number, seed: number) {
  const w = 7.5;
  const h = 6.5;
  const seg = 96;
  const bump = lobulation(seed, 30, 0.03, 6);
  const outer = new THREE.PlaneGeometry(2 * w, 2 * h, seg, seg);
  const inner = new THREE.PlaneGeometry(2 * w, 2 * h, seg, seg);
  const bulge = (x: number, y: number) => 0.9 * Math.exp(-(x * x) / 30 - (y * y) / 26);
  const d = new THREE.Vector3();
  for (const [g, z, flip] of [
    [outer, zOuter, false],
    [inner, zInner, true],
  ] as const) {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      d.set(x, y, 3).normalize();
      p.setZ(i, z + bulge(x, y) + bump(d));
    }
    if (flip) flipWinding(g);
  }
  const merged = mergeClosedSlab(outer, inner, seg);
  merged.computeVertexNormals();
  return merged;
}

function flipWinding(g: THREE.BufferGeometry) {
  const idx = g.index!;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i);
    idx.setX(i, idx.getX(i + 2));
    idx.setX(i + 2, a);
  }
}

/** Joins two grids of identical topology into one closed slab with side walls. */
function mergeClosedSlab(outer: THREE.BufferGeometry, inner: THREE.BufferGeometry, seg: number) {
  const po = outer.attributes.position as THREE.BufferAttribute;
  const pi = inner.attributes.position as THREE.BufferAttribute;
  const n = po.count;
  const positions = new Float32Array(n * 6);
  positions.set(po.array as Float32Array, 0);
  positions.set(pi.array as Float32Array, n * 3);
  const indices: number[] = Array.from(outer.index!.array);
  for (const i of Array.from(inner.index!.array)) indices.push(i + n);
  const row = seg + 1;
  const edge: number[] = [];
  for (let x = 0; x < seg; x++) edge.push(x);
  for (let y = 0; y < seg; y++) edge.push(y * row + seg);
  for (let x = seg; x > 0; x--) edge.push(seg * row + x);
  for (let y = seg; y > 0; y--) edge.push(y * row);
  for (let k = 0; k < edge.length; k++) {
    const a = edge[k]!;
    const b = edge[(k + 1) % edge.length]!;
    indices.push(a, a + n, b, b, a + n, b + n);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  g.setIndex(indices);
  return g;
}

/** Facial nerve proxy: trunk from the stylomastoid foramen to the pes, two divisions, five branch groups. */
export function facialNerve() {
  const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const foramen = P(-3.3, 0.9, -1.1);
  const pes = P(-1.7, 0.2, 0.0);
  const tf = P(-0.9, 0.9, 0.0);
  const cf = P(-1.0, -0.6, 0.0);
  const paths: Array<{ pts: THREE.Vector3[]; r0: number; r1: number; name: string }> = [
    { name: 'trunk', pts: [foramen, P(-2.6, 0.7, -0.6), pes], r0: 0.135, r1: 0.12 },
    { name: 'temporofacial', pts: [pes, P(-1.3, 0.55, 0), tf], r0: 0.1, r1: 0.085 },
    { name: 'cervicofacial', pts: [pes, P(-1.4, -0.2, 0), cf], r0: 0.09, r1: 0.075 },
    { name: 'temporal', pts: [tf, P(0.2, 2.0, 0.02), P(1.4, 3.3, 0.1)], r0: 0.06, r1: 0.035 },
    { name: 'zygomatic', pts: [tf, P(0.8, 1.3, 0.02), P(3.0, 1.6, 0.1)], r0: 0.06, r1: 0.035 },
    { name: 'buccal', pts: [P(-0.7, 0.2, 0), P(1.2, 0.3, 0.02), P(3.4, 0.2, 0.1)], r0: 0.055, r1: 0.035 },
    { name: 'marginal-mandibular', pts: [cf, P(0.5, -1.7, 0.02), P(2.6, -2.3, 0.1)], r0: 0.05, r1: 0.03 },
    { name: 'cervical', pts: [cf, P(-0.6, -2.2, 0.02), P(-0.2, -3.6, 0.1)], r0: 0.05, r1: 0.03 },
  ];
  const buccalRoot = new THREE.CatmullRomCurve3([pes, P(-1.2, 0.25, 0), P(-0.7, 0.2, 0)]);
  const geos = paths.map(({ pts, r0, r1 }) => taperedTube(new THREE.CatmullRomCurve3(pts), r0, r1));
  geos.push(taperedTube(buccalRoot, 0.075, 0.06));
  return geos;
}

function taperedTube(curve: THREE.Curve<THREE.Vector3>, r0: number, r1: number) {
  const tubular = 64;
  const radial = 14;
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const u = i / tubular;
    curve.getPointAt(u, c);
    const r = r0 + (r1 - r0) * u;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
      pos.setXYZ(k, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

export function retromandibularVein() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-1.2, 3.4, -0.35),
    new THREE.Vector3(-1.4, 1.0, -0.4),
    new THREE.Vector3(-1.6, -1.6, -0.45),
    new THREE.Vector3(-2.0, -3.8, -0.5),
  ]);
  return taperedTube(curve, 0.28, 0.33);
}
