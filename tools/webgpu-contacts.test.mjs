import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Group, InstancedMesh, Matrix4, MeshStandardMaterial } from 'three/webgpu';
import { createContactOcclusion } from '../src/campus-webgpu/contact-occlusion.js';

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
