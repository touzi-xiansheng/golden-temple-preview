import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BufferGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { buildBuildings } from '../src/campus/buildings.js';
import { buildLandscape } from '../src/campus/landscape.js';
import { BUILDINGS, entrancePoint } from '../src/campus/layout.js';

let architecture, ground;
const plans = [['hq', 2.25], ['b', 0], ['d', 0], ['gallery', 3]].map(([id, center]) => {
  const building = BUILDINGS.find(b => b.id === id);
  const entry = entrancePoint(building, id === 'gallery' ? -3 : 0);
  const point = (u, y, v) => new Vector3(entry.x + entry.nz * u + entry.nx * v, y, entry.z - entry.nx * u + entry.nz * v);
  return { id, center, entry, point, top: id === 'gallery' ? 3.08 : 2.155 };
});
const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-5, `${message}: ${a} != ${b}`);
function dispose(root) {
  const resources = new Set();
  root?.traverse(o => {
    if (!o.isMesh) return;
    resources.add(o.geometry);
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
    if (o.isInstancedMesh) o.dispose();
  });
  for (const resource of resources) resource.dispose();
}
// Keep actual winding and triangle coordinates while excluding roofs and distant geometry from ray queries.
function entryGround(root) {
  const group = new Group(), domains = plans.map(plan => new Box3().setFromPoints([
    plan.point(plan.center - 1.5, -.1, plan.top - .25), plan.point(plan.center + 1.5, .22, plan.top + 2.35),
  ]));
  root.updateMatrixWorld(true);
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const g = mesh.geometry, p = g.attributes.position, index = g.index, positions = [];
    const bounds = new Box3().setFromBufferAttribute(p);
    for (let instance = 0; instance < (mesh.isInstancedMesh ? mesh.count : 1); instance++) {
      const matrix = new Matrix4();
      if (mesh.isInstancedMesh) mesh.getMatrixAt(instance, matrix);
      matrix.premultiply(mesh.matrixWorld);
      if (!domains.some(domain => domain.intersectsBox(bounds.clone().applyMatrix4(matrix)))) continue;
      for (let i = 0; i < (index?.count ?? p.count); i += 3) {
        const vertices = [0, 1, 2].map(j => new Vector3().fromBufferAttribute(p, index ? index.getX(i + j) : i + j).applyMatrix4(matrix));
        if (domains.some(domain => domain.intersectsBox(new Box3().setFromPoints(vertices)))) positions.push(...vertices.flatMap(v => v.toArray()));
      }
    }
    if (positions.length) {
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      const copy = new Mesh(geometry, new MeshBasicMaterial()); copy.name = mesh.material.name; group.add(copy);
    }
  });
  group.updateMatrixWorld(true); return group;
}
function hits(origin, direction, object = ground, far = .5) {
  return new Raycaster(origin, direction, 0, far).intersectObject(object, true);
}
const down = new Vector3(0, -1, 0);
before(() => { architecture = buildBuildings(); ground = entryGround(architecture); });
after(() => { dispose(ground); dispose(architecture); });

test('HQ, east offices and gallery have continuous closed entrance ramps from paving to landing', () => {
  for (const { id, center, entry, point, top } of plans) {
    for (const offset of [-.59, 0, .59]) {
      for (let i = 0; i <= 20; i++) {
        // Stay 0.1mm inside uploaded Float32 edges; shared seams are checked on both sides.
        const v = top + .0001 + i * 2.0798 / 20, expected = .16 - (v - top) * .085 / 2.08;
        const hit = hits(point(center + offset, .3, v), down)[0];
        assert.ok(hit, `${id}: ramp has no top at ${offset}, ${v}`);
        near(hit.point.y, expected, `${id}: road-to-landing slope`);
      }
      near(hits(point(center + offset, .3, top - .001), down)[0]?.point.y, .16, `${id}: landing meets ramp top`);
    }
    const tangent = new Vector3(entry.nz, 0, -entry.nx);
    for (const side of [-1, 1]) {
      const origin = point(center + side * .7, .085, top + 1.04);
      const hit = hits(origin, tangent.clone().multiplyScalar(-side), ground, .2)[0];
      assert.ok(hit, `${id}: ramp side is open`);
      near(hit.distance, .1, `${id}: solid side at ramp edge`);
    }
    near(hits(point(center, 0, top + 1.04), new Vector3(0, 1, 0))[0]?.point.y, .055, `${id}: ramp bottom is closed`);
    for (const y of [.3, 1.2, 2]) {
      assert.equal(hits(point(center, y, top + 2.075), new Vector3(-entry.nx, 0, -entry.nz), architecture, 2.3).length, 0,
        `${id}: entrance ramp runs into a post or planting box`);
    }
  }
});

test('all corrected ramp feet and full widths sit on the existing entry paving', () => {
  const previousDocument = globalThis.document;
  const context = new Proxy({}, { get: (_, key) => key === 'getImageData' ? (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }) : String(key).includes('Gradient') ? () => ({ addColorStop() {} }) : key === 'measureText' ? () => ({ width: 100 }) : () => {} });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  let landscape, paving;
  try {
    landscape = buildLandscape(); paving = entryGround(landscape.getObjectByName('campus-site'));
    for (const { id, center, point, top } of plans) {
      for (const offset of [-.6, 0, .6]) for (const v of [top, top + 1.04, top + 2.08, top + 2.081, top + 2.245]) {
        const hit = hits(point(center + offset, .3, v), down, paving)[0];
        assert.ok(hit, `${id}: approach leaves the actual road`);
        near(hit.point.y, .075, `${id}: approach is not on paving`);
      }
    }
  } finally { globalThis.document = previousDocument; dispose(paving); dispose(landscape); }
});
