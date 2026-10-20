import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Group, InstancedMesh, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three/webgpu';
import { createContactOcclusion } from '../src/campus-webgpu/contact-occlusion.js';
import { buildBuildings } from '../src/campus/buildings.js';

function sample(contacts, x, z) {
  const [x0, z0, x1, z1] = contacts.bounds, size = contacts.stats.size;
  return contacts.map.image.data[Math.floor((z - z0) / (z1 - z0) * size) * size + Math.floor((x - x0) / (x1 - x0) * size)];
}

test('ground contacts follow transformed feet and tree roots, excluding raised geometry', () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const posts = new InstancedMesh(geometry, material, 2), matrix = new Matrix4();
  posts.setMatrixAt(0, matrix.makeScale(.5, 3, .5).setPosition(4, 1.5, -5));
  posts.setMatrixAt(1, matrix.makeScale(4, 1, 4).setPosition(-10, 5, -5));
  root.position.x = 2; root.add(posts);
  const contacts = createContactOcclusion(root, [{ x: 12, z: 15, height: 12 }], { size: 1024 });
  const sample = (x, z) => {
    const [x0, z0, x1, z1] = contacts.bounds, size = contacts.stats.size;
    return contacts.map.image.data[Math.floor((z - z0) / (z1 - z0) * size) * size + Math.floor((x - x0) / (x1 - x0) * size)];
  };
  try {
    assert.equal(contacts.stats.stamps, 2);
    assert.ok(sample(6, -5) < 170, 'transformed column foot is grounded');
    assert.ok(sample(12, 15) < 150, 'tree root is grounded');
    assert.ok(sample(6.5, -5) > sample(6, -5) && sample(6.5, -5) < 255, 'contact fades out softly');
    assert.equal(sample(-8, -5), 255, 'raised roof must not stamp a ground shadow');
    assert.equal(sample(0, 0), 255, 'open paving is unchanged');
    assert.equal(contacts.stats.bytes, 1024 * 1024);
  } finally { contacts.dispose(); posts.dispose(); geometry.dispose(); material.dispose(); }
});

test('merged contacts use each transformed component and exclude raised, thin and glazed parts', () => {
  const root = new Group(), geometry = new BoxGeometry(), material = new MeshStandardMaterial(), glass = new MeshStandardMaterial();
  glass.name = 'Curtain wall glazing';
  const bounds = (x, y, height = 3) => new Box3(new Vector3(x - .25, y, -.25), new Vector3(x + .25, y + height, .25));
  const posts = new Mesh(geometry, material), panes = new Mesh(geometry, glass);
  posts.userData.componentBounds = [bounds(-6, 0), bounds(6, 0), bounds(12, 4), bounds(18, 0, .16)];
  panes.userData.componentBounds = [bounds(24, 0)];
  root.position.set(3, 0, 4); root.rotation.y = Math.PI / 2; root.add(posts, panes);
  const contacts = createContactOcclusion(root, [], { size: 1024 });
  try {
    assert.equal(contacts.stats.stamps, 2);
    assert.ok(sample(contacts, 3, 10) < 170);
    assert.ok(sample(contacts, 3, -2) < 170);
    assert.equal(sample(contacts, 3, 4), 255, 'empty space between merged components is not a solid occluder');
    for (const z of [-8, -14, -20]) assert.equal(sample(contacts, 3, z), 255, 'raised, thin and transparent parts do not stamp');
  } finally { contacts.dispose(); geometry.dispose(); material.dispose(); glass.dispose(); }
});

test('production beveled arcade columns receive local ground contact without darkening open courts', () => {
  const architecture = buildBuildings(), contacts = createContactOcclusion(architecture, []);
  try {
    for (const z of [-2.6, -7.95, -13.3, -18.65, -29.35, -34.7, -40.05]) {
      assert.ok(sample(contacts, -21.28, z) < 170, `missing real arcade column contact at z=${z}`);
      assert.ok(sample(contacts, -20.7, z) < 255, 'contact extends softly onto the adjacent paving');
    }
    for (const [x, z] of [[0, 0], [0, 29], [-10, -18.65]]) assert.equal(sample(contacts, x, z), 255, 'merged batch must not darken the courtyard');
    assert.equal(contacts.stats.bytes, 2048 * 2048, 'component contacts reuse the existing atlas');
  } finally {
    contacts.dispose();
    const resources = new Set();
    architecture.traverse(o => { if (o.isMesh) { resources.add(o.geometry); resources.add(o.material); if (o.isInstancedMesh) o.dispose(); } });
    for (const resource of resources) resource.dispose();
  }
});
