import test from 'node:test';
import assert from 'node:assert/strict';
import {DirectionalLight, Mesh, MeshStandardNodeMaterial, PlaneGeometry, Vector3} from 'three/webgpu';
import {uniform, vec3} from 'three/tsl';
import {createContextVisibility} from '../src/campus-webgpu/context-visibility.js';

test('district atlas shades the fixed-sun footprint, wraps only sun direct light and releases its hook', () => {
  const material = new MeshStandardNodeMaterial(), plane = new PlaneGeometry(12, 12);
  plane.rotateX(-Math.PI / 2);
  const mesh = new Mesh(plane, material), sun = new DirectionalLight();
  let received;
  const indirect = () => {};
  const original = material.setupLightingModel = () => ({
    direct(input) { received = input; }, indirect,
  });
  const context = {
    receivers: [mesh],
    casters: [{district: 'test', min: [0, 0, 0], max: [2, 4, 2]}],
    regions: [{id: 'test', bounds: [-5, 5, -5, 5]}],
  };
  const atlas = createContextVisibility({userData: {contextDistricts: context}},
    {sun, sunDirectionNode: uniform(new Vector3(1, 2, 1).normalize())});
  try {
    const sample = (x, z) => {
      const [ox, oy, sx, sy] = atlas.regions[0].atlas, size = atlas.stats.size;
      return atlas.texture.image.data[Math.floor((oy + (z + 5) / 10 * sy) * size) * size
        + Math.floor((ox + (x + 5) / 10 * sx) * size)];
    };
    assert.equal(sample(-1, -1), 0, 'shadow extends away from the sun');
    assert.equal(sample(-4, -4), 255, 'beyond the projected height remains lit');
    assert.equal(sample(4, 4), 255, 'sunward open ground remains lit');
    assert.ok(atlas.stats.shadowTexels > 0 && atlas.stats.bytesWithMips < 1.4 * 1024 * 1024);
    const model = material.setupLightingModel(), lightColor = vec3(1);
    assert.equal(model.indirect, indirect, 'ambient/probe lighting must remain unchanged');
    model.direct({lightNode: {light: sun}, lightColor}, {});
    assert.notEqual(received.lightColor, lightColor);
    const other = {lightNode: {light: new DirectionalLight()}, lightColor};
    model.direct(other, {});
    assert.equal(received, other, 'other light sources must not inherit the sun atlas');
    let disposed = 0; atlas.texture.addEventListener('dispose', () => disposed++);
    atlas.dispose(); atlas.dispose();
    assert.equal(disposed, 1);
    assert.equal(material.setupLightingModel, original);
  } finally { atlas.dispose(); material.dispose(); plane.dispose(); }
});
