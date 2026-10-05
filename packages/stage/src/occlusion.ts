import * as THREE from 'three/webgpu';

/*
 * Label occlusion raycasts, exact but without testing every triangle: each geometry's triangles are taken in fixed
 * chunks (in index order) with their local bounds, and only the chunks the ray enters are tested. The triangle test,
 * sidedness and near/far limits are those of three's Mesh.raycast (r186), so the hits found are the same; testing every
 * triangle of the head for each label took up to 180 ms at a settled plate.
 */

const CHUNK = 256; // triangles per box
const chunks = new WeakMap<THREE.BufferGeometry, THREE.Box3[]>();

function rangeOf(g: THREE.BufferGeometry): [number, number] {
  const n = g.index ? g.index.count : g.getAttribute('position').count;
  return [Math.max(0, g.drawRange.start), Math.min(n, g.drawRange.start + g.drawRange.count)];
}

function boxesOf(g: THREE.BufferGeometry): THREE.Box3[] {
  let boxes = chunks.get(g);
  if (boxes) return boxes;
  boxes = [];
  const pos = g.getAttribute('position');
  const index = g.index;
  const [start, end] = rangeOf(g);
  const v = new THREE.Vector3();
  for (let i = start; i < end; i += CHUNK * 3) {
    const box = new THREE.Box3();
    for (let k = i, stop = Math.min(i + CHUNK * 3, end); k < stop; k++) box.expandByPoint(v.fromBufferAttribute(pos, index ? index.getX(k) : k));
    boxes.push(box);
  }
  chunks.set(g, boxes);
  return boxes;
}

const inverse = new THREE.Matrix4();
const ray = new THREE.Ray();
const pA = new THREE.Vector3();
const pB = new THREE.Vector3();
const pC = new THREE.Vector3();
const local = new THREE.Vector3();

/**
 * True when the raycaster's ray meets `mesh` within its near/far range at a hit that `keep` accepts: the same as
 * `raycaster.intersectObject(mesh, false).some(keep)` for a single-material mesh, with the hit's `point` and `face`
 * (vertex indices) filled in.
 */
export function anyHit(mesh: THREE.Mesh, raycaster: THREE.Raycaster, keep: (hit: THREE.Intersection) => boolean): boolean {
  const g = mesh.geometry;
  const material = mesh.material as THREE.Material;
  if (!material || Array.isArray(mesh.material)) return raycaster.intersectObject(mesh, false).some(keep);
  inverse.copy(mesh.matrixWorld).invert();
  ray.copy(raycaster.ray).applyMatrix4(inverse);
  if (g.boundingBox && !ray.intersectsBox(g.boundingBox)) return false;
  const pos = g.getAttribute('position');
  const index = g.index;
  const [start, end] = rangeOf(g);
  const boxes = boxesOf(g);
  for (let j = 0; j < boxes.length; j++) {
    if (!ray.intersectsBox(boxes[j]!)) continue;
    for (let i = start + j * CHUNK * 3, stop = Math.min(i + CHUNK * 3, end); i < stop; i += 3) {
      const a = index ? index.getX(i) : i;
      const b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      pA.fromBufferAttribute(pos, a);
      pB.fromBufferAttribute(pos, b);
      pC.fromBufferAttribute(pos, c);
      const hit = material.side === THREE.BackSide ? ray.intersectTriangle(pC, pB, pA, true, local) : ray.intersectTriangle(pA, pB, pC, material.side === THREE.FrontSide, local);
      if (!hit) continue;
      const point = local.clone().applyMatrix4(mesh.matrixWorld);
      const distance = raycaster.ray.origin.distanceTo(point);
      if (distance < raycaster.near || distance > raycaster.far) continue;
      if (keep({ distance, point, object: mesh, face: { a, b, c, normal: new THREE.Vector3(), materialIndex: 0 }, faceIndex: Math.floor(i / 3) })) return true;
    }
  }
  return false;
}
