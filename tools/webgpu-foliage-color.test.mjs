import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, DataTexture, InstancedMesh, Matrix4, PlaneGeometry } from 'three';
import { foliageMaterial } from '../src/campus/foliage-material.js';
import { prepareFoliageColors } from '../src/campus-webgpu/materials-foliage-color.js';

test('WebGPU leaf colour preparation preserves source colours, transforms and geometry while storing the batch mean', () => {
  const source = foliageMaterial(), geometry = new PlaneGeometry(), mesh = new InstancedMesh(geometry, source, 3);
  const colours = [[.02, .12, .04], [.10, .24, .08], [.30, .18, .06]];
  colours.forEach((rgb, i) => { mesh.setColorAt(i, new Color(...rgb)); mesh.setMatrixAt(i, new Matrix4().makeTranslation(i, i * 2, -i)); });
  const colourBytes = mesh.instanceColor.array.slice(), matrices = mesh.instanceMatrix.array.slice();
  const positions = geometry.attributes.position.array.slice(), normals = geometry.attributes.normal.array.slice(), indices = geometry.index.array.slice();
  prepareFoliageColors(mesh, source);
  const mean = geometry.getAttribute('campusFoliageMean'), expected = [0, 1, 2].map(c => colours.reduce((sum, rgb) => sum + rgb[c], 0) / 3);
  assert.equal(mean.isInstancedBufferAttribute, undefined, 'do not add a per-instance GPU gather stream');
  assert.equal(mean.count, geometry.attributes.position.count);
  for (let i = 0; i < mean.count; i++) for (let c = 0; c < 3; c++) assert.ok(Math.abs(mean.array[i * 3 + c] - expected[c]) < 1e-7);
  assert.deepEqual(mesh.instanceColor.array, colourBytes); assert.deepEqual(mesh.instanceMatrix.array, matrices);
  assert.deepEqual(geometry.attributes.position.array, positions); assert.deepEqual(geometry.attributes.normal.array, normals); assert.deepEqual(geometry.index.array, indices);
  prepareFoliageColors(mesh, source); assert.equal(geometry.getAttribute('campusFoliageMean'), mean, 'preparation is idempotent');
  geometry.dispose(); source.dispose();
});

test('the same prepared mean survives the geometry clone used for visible-instance rendering', () => {
  const source = foliageMaterial(), geometry = new PlaneGeometry(), mesh = new InstancedMesh(geometry, source, 2);
  mesh.setColorAt(0, new Color(.1, .2, .3)); mesh.setColorAt(1, new Color(.3, .4, .5)); prepareFoliageColors(mesh, source);
  const copy = geometry.clone(); assert.deepEqual(copy.getAttribute('campusFoliageMean').array, geometry.getAttribute('campusFoliageMean').array);
  assert.ok(Math.abs(copy.getAttribute('campusFoliageMean').getX(0) - .2) < 1e-7);
  copy.dispose(); geometry.dispose(); source.dispose();
});

test('textured crown cards keep their palette and receive no leaf colour correction', () => {
  const map = new DataTexture(new Uint8Array([20, 50, 10, 255]), 1, 1), source = foliageMaterial({ map, canopyVolume: true });
  const geometry = new PlaneGeometry(), mesh = new InstancedMesh(geometry, source, 1); mesh.setColorAt(0, new Color(.7, .8, .6));
  prepareFoliageColors(mesh, source); assert.equal(geometry.hasAttribute('campusFoliageMean'), false);
  geometry.dispose(); source.dispose(); map.dispose();
});
