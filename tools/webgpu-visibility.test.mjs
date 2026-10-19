import test from 'node:test';
import assert from 'node:assert/strict';
import { Frustum, Matrix4, OrthographicCamera, PerspectiveCamera, Sphere, Vector3, WebGPUCoordinateSystem } from 'three/webgpu';
import { validateVisibilityInput, getFrustumPlanes, cpuVisibleInstances } from '../src/campus-webgpu/visibility.js';

const data = () => ({
  bounds: new Float32Array([0, 0, 0, 1, 30, 0, 0, 2, 0, 0, 12, 1]),
  ranges: new Uint32Array([0, 2, 2, 1, 3, 1]),
  instanceIds: new Uint32Array([900, 0, 700000, 0xffffffff]),
  indexCount: 6,
});

function cameraAt(x = 0) {
  const camera = new PerspectiveCamera(50, 1.7, .25, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(x, 0, 5); camera.lookAt(x, 0, 0);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  return camera;
}

test('sphere oracle agrees with Three frustum across views and retains original stable IDs', () => {
  const input = data();
  for (const x of [0, 30, -50]) {
    const camera = cameraAt(x);
    const planes = getFrustumPlanes(camera);
    const reference = new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse), WebGPUCoordinateSystem);
    const expected = [];
    for (let i = 0; i < input.bounds.length / 4; i++) {
      const offset = i * 4;
      if (reference.intersectsSphere(new Sphere(new Vector3(...input.bounds.subarray(offset, offset + 3)), input.bounds[offset + 3]))) {
        const start = input.ranges[i * 2], count = input.ranges[i * 2 + 1];
        for (let j = 0; j < count; j++) expected.push(start + j);
      }
    }
    const actual = cpuVisibleInstances(input, planes);
    assert.deepEqual(actual.indices, expected);
    assert.deepEqual(actual.ids, expected.map(i => input.instanceIds[i]));
  }
});

test('a sphere tangent to the frustum remains visible; padding conservatively includes nearby clusters', () => {
  const camera = new OrthographicCamera(-1, 1, 1, -1, 1, 10);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.z = 5; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  const input = {
    bounds: new Float32Array([-2, 0, 0, 1, -2.125, 0, 0, 1]),
    ranges: new Uint32Array([0, 1, 1, 1]), instanceIds: new Uint32Array([88, 44]), indexCount: 3,
  };
  assert.deepEqual(cpuVisibleInstances(input, getFrustumPlanes(camera)).ids, [88]);
  assert.deepEqual(cpuVisibleInstances(input, getFrustumPlanes(camera, { padding: .125 })).ids, [88, 44]);
  assert.throws(() => getFrustumPlanes(camera, { padding: -1 }), /padding/);
});

test('empty and fully visible bins stay within exact capacity, including zero-member clusters', () => {
  const empty = { bounds: new Float32Array(), ranges: new Uint32Array(), instanceIds: new Uint32Array(), indexCount: 3 };
  assert.equal(validateVisibilityInput(empty).capacity, 0);
  assert.deepEqual(cpuVisibleInstances(empty, getFrustumPlanes(cameraAt())).indices, []);
  const input = {
    bounds: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]),
    ranges: new Uint32Array([0, 0, 0, 4]), instanceIds: new Uint32Array([77, 88, 99, 100]), indexCount: 3,
  };
  assert.deepEqual(cpuVisibleInstances(input, getFrustumPlanes(cameraAt())).ids, [77, 88, 99, 100]);
  assert.throws(() => validateVisibilityInput({ ...input, capacity: 3 }), /capacity/);
});

test('invalid topology cannot overflow output buffers or silently omit source instances', () => {
  const input = data();
  assert.throws(() => validateVisibilityInput({ ...input, ranges: new Uint32Array([0, 3, 2, 1, 3, 1]) }), /overlap/);
  assert.throws(() => validateVisibilityInput({ ...input, ranges: new Uint32Array([0, 1, 2, 1, 3, 1]) }), /gaps/);
  assert.throws(() => validateVisibilityInput({ ...input, ranges: new Uint32Array([0, 2, 2, 1, 3, 2]) }), /exceeds/);
  assert.throws(() => validateVisibilityInput({ ...input, instanceIds: new Uint32Array([2, 2, 4, 5]) }), /unique/);
  assert.throws(() => validateVisibilityInput({ ...input, bounds: new Float32Array([NaN, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]) }), /finite/);
  assert.throws(() => validateVisibilityInput({ ...input, indexCount: 5 }), /triangles/);
});

test('explicit unjittered projection preserves the visible set after camera jitter', () => {
  const camera = cameraAt(), projectionMatrix = camera.projectionMatrix.clone();
  const original = getFrustumPlanes(camera).map(p => p.toArray());
  camera.setViewOffset(1920, 1080, .4, -.3, 1920, 1080);
  assert.deepEqual(getFrustumPlanes(camera, { projectionMatrix }).map(p => p.toArray()), original);
});
