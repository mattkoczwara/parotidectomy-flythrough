import { describe, expect, it } from 'vitest';
import * as THREE from 'three/webgpu';
import { anyHit } from './occlusion.ts';

/** anyHit must find exactly the hits three's Mesh.raycast finds (label occlusion must not change). */
describe('anyHit', () => {
  const rand = (() => {
    let s = 7;
    return () => ((s = (s * 16807) % 2147483647) / 2147483647);
  })();
  const geometries = { indexed: new THREE.TorusKnotGeometry(0.05, 0.015, 200, 24), soup: new THREE.TorusKnotGeometry(0.05, 0.015, 120, 16).toNonIndexed() };
  for (const [name, geometry] of Object.entries(geometries))
    for (const side of [THREE.DoubleSide, THREE.FrontSide, THREE.BackSide]) {
      it(`agrees with Mesh.raycast (${name}, side ${side}), with a hit filter and near/far`, () => {
        geometry.computeBoundingBox();
        const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ side }));
        mesh.position.set(0.01, -0.02, 0.03);
        mesh.rotation.set(0.3, 1.1, -0.4);
        mesh.scale.set(1.2, 0.9, 1);
        mesh.updateMatrixWorld();
        const raycaster = new THREE.Raycaster();
        let hits = 0;
        for (let k = 0; k < 400; k++) {
          const origin = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.4);
          const target = new THREE.Vector3(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.08);
          raycaster.set(origin, target.clone().sub(origin).normalize());
          raycaster.near = rand() * 0.05;
          raycaster.far = origin.distanceTo(target) * (0.5 + rand());
          const keep = (h: THREE.Intersection) => h.point.y > -0.01 && (h.face!.a + h.face!.b) % 3 !== 0;
          const want = raycaster.intersectObject(mesh, false).some(keep);
          expect(anyHit(mesh, raycaster, keep)).toBe(want);
          if (want) hits++;
        }
        expect(hits).toBeGreaterThan(20);
      });
    }
});
