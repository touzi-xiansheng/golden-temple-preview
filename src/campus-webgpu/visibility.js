import { Frustum, Matrix4, StorageBufferAttribute, IndirectStorageBufferAttribute, Vector4 } from 'three/webgpu';
import {
  Fn, If, Loop, atomicAdd, atomicLoad, atomicStore, bool, dot, instanceIndex,
  materialColor, normalLocal, positionGeometry, positionPrevious, storage, transformNormal, uint, uniformArray, vec4,
} from 'three/tsl';

// One bin shares indexed geometry/material. Each cluster owns contiguous source instances.
export function validateVisibilityInput({ bounds, ranges, instanceIds, indexCount, capacity = instanceIds?.length }) {
  if (!(bounds instanceof Float32Array) || bounds.length % 4 !== 0) throw new TypeError('bounds must contain Float32 world spheres [x,y,z,r]');
  if (!(ranges instanceof Uint32Array) || ranges.length !== bounds.length / 2) throw new TypeError('ranges must contain one Uint32 [start,count] per sphere');
  if (!(instanceIds instanceof Uint32Array)) throw new TypeError('instanceIds must be a Uint32Array');
  if (!Number.isSafeInteger(indexCount) || indexCount <= 0 || indexCount > 0xffffffff || indexCount % 3 !== 0) throw new RangeError('indexCount must describe indexed triangles');
  if (capacity !== instanceIds.length) throw new RangeError('capacity must equal the full source instance count; overflow may not drop geometry');
  if (new Set(instanceIds).size !== instanceIds.length) throw new RangeError('stable instance IDs must be unique');
  const intervals = [];
  for (let cluster = 0; cluster < bounds.length / 4; cluster++) {
    const sphere = bounds.subarray(cluster * 4, cluster * 4 + 4);
    if (!sphere.every(Number.isFinite) || sphere[3] < 0) throw new RangeError('cluster bounds must be finite with a nonnegative radius');
    const start = ranges[cluster * 2], count = ranges[cluster * 2 + 1];
    if (start + count > capacity) throw new RangeError('cluster range exceeds capacity');
    if (count) intervals.push([start, start + count]);
  }
  intervals.sort((a, b) => a[0] - b[0]);
  let next = 0;
  for (const [start, end] of intervals) {
    if (start !== next) throw new RangeError('cluster ranges must partition source instances without gaps or overlap');
    next = end;
  }
  if (next !== capacity) throw new RangeError('every source instance must belong to a cluster');
  return { bounds, ranges, instanceIds, indexCount, capacity, clusterCount: bounds.length / 4 };
}

export function getFrustumPlanes(camera, { padding = 0, projectionMatrix = camera.projectionMatrix } = {}) {
  if (!Number.isFinite(padding) || padding < 0) throw new RangeError('padding must be finite and nonnegative');
  camera.updateWorldMatrix(true, false);
  const matrix = new Matrix4().multiplyMatrices(projectionMatrix, camera.matrixWorldInverse);
  const frustum = new Frustum().setFromProjectionMatrix(matrix, camera.coordinateSystem, camera.reversedDepth);
  return frustum.planes.map(plane => new Vector4(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant + padding));
}

// Diagnostic oracle only. Normal rendering never calls this or reads visibility back.
export function cpuVisibleInstances(input, planes) {
  const data = validateVisibilityInput(input);
  if (planes.length !== 6 || planes.some(p => ![p.x, p.y, p.z, p.w].every(Number.isFinite))) throw new TypeError('six finite normalized frustum planes are required');
  const indices = [];
  for (let cluster = 0; cluster < data.clusterCount; cluster++) {
    const [x, y, z, radius] = data.bounds.subarray(cluster * 4, cluster * 4 + 4);
    if (planes.some(p => p.x * x + p.y * y + p.z * z + p.w < -radius)) continue;
    const start = data.ranges[cluster * 2], count = data.ranges[cluster * 2 + 1];
    for (let member = 0; member < count; member++) indices.push(start + member);
  }
  return { indices, ids: indices.map(index => data.instanceIds[index]) };
}

export function createVisibility({ renderer, ...input }) {
  if (!renderer?.backend?.isWebGPUBackend || !renderer.hasInitialized()) throw new Error('visibility requires an initialized real WebGPU backend');
  const data = validateVisibilityInput(input);
  const limits = renderer.backend.device.limits;
  const largest = Math.max(16, data.bounds.byteLength, data.ranges.byteLength, data.instanceIds.byteLength);
  if (largest > limits.maxStorageBufferBindingSize || largest > limits.maxBufferSize) throw new RangeError('visibility bin exceeds device buffer limits; split the bin');
  const resources = new Set(), views = new Map();
  let disposed = false;
  const attribute = (array, itemSize) => {
    const value = new StorageBufferAttribute(array.length ? array : new array.constructor(itemSize), itemSize);
    resources.add(value);
    return value;
  };
  // Snapshot the immutable topology so callers cannot desynchronize the oracle and GPU.
  const bounds = attribute(data.bounds.slice(), 4), ranges = attribute(data.ranges.slice(), 2);
  const ids = attribute(data.instanceIds.slice(), 1);
  const boundsNode = storage(bounds, 'vec4', bounds.count).toReadOnly();
  const rangesNode = storage(ranges, 'uvec2', ranges.count).toReadOnly();
  const idsNode = storage(ids, 'uint', ids.count).toReadOnly();

  function createView(key) {
    if (disposed) throw new Error('visibility has been disposed');
    if (views.has(key)) throw new Error(`visibility view already exists: ${key}`);
    const visible = new StorageBufferAttribute(Math.max(1, data.capacity), 1, Uint32Array);
    const counter = new StorageBufferAttribute(1, 1, Uint32Array);
    const indirect = new IndirectStorageBufferAttribute(new Uint32Array([data.indexCount, 0, 0, 0, 0]));
    const localResources = new Set([visible, counter, indirect]);
    const visibleWrite = storage(visible, 'uint', visible.count);
    const visibleRead = storage(visible, 'uint', visible.count).toReadOnly();
    const counterNode = storage(counter, 'uint', 1).toAtomic();
    const commandNode = storage(indirect, 'uint', 5);
    const planes = Array.from({ length: 6 }, () => new Vector4());
    const planeNode = uniformArray(planes, 'vec4');
    const reset = Fn(() => { atomicStore(counterNode.element(0), uint(0)); })().compute(1).setName(`visibility/${key}/clear`);
    const compact = Fn(() => {
      const sphere = boundsNode.element(instanceIndex).toVar();
      const accepted = bool(true).toVar();
      for (let p = 0; p < 6; p++) {
        const plane = planeNode.element(p);
        accepted.assign(accepted.and(dot(plane.xyz, sphere.xyz).add(plane.w).greaterThanEqual(sphere.w.negate())));
      }
      If(accepted, () => {
        const range = rangesNode.element(instanceIndex).toVar();
        const offset = atomicAdd(counterNode.element(0), range.y).toVar();
        Loop({ start: uint(0), end: range.y, type: 'uint', condition: '<' }, ({ i }) => {
          visibleWrite.element(offset.add(i)).assign(range.x.add(i));
        });
      });
    })().compute(Math.max(1, data.clusterCount), [64]).setName(`visibility/${key}/compact`);
    const command = Fn(() => {
      commandNode.element(0).assign(uint(data.indexCount));
      commandNode.element(1).assign(atomicLoad(counterNode.element(0)));
      commandNode.element(2).assign(uint(0));
      commandNode.element(3).assign(uint(0));
      commandNode.element(4).assign(uint(0));
    })().compute(1).setName(`visibility/${key}/command`);
    const stages = data.clusterCount ? [reset, compact, command] : [reset, command];
    const sourceIndexNode = visibleRead.element(instanceIndex);
    const stableIdNode = idsNode.element(sourceIndexNode);
    let viewDisposed = false;
    const attachments = [];
    const assertLive = () => { if (disposed || viewDisposed) throw new Error('visibility view has been disposed'); };

    const view = {
      key, sourceIndexNode, stableIdNode, indirect,
      update(camera, options) {
        assertLive();
        const next = getFrustumPlanes(camera, options);
        planes.forEach((plane, i) => plane.copy(next[i]));
        // Separate ordered dispatches establish global visibility between phases.
        renderer.compute(stages);
      },
      attach(mesh, { matrices, previousMatrices = matrices, colors = null } = {}) {
        assertLive();
        if (!mesh?.isMesh || mesh.isInstancedMesh || !mesh.material?.isNodeMaterial) throw new TypeError('attach needs a plain Mesh and an owned NodeMaterial, not InstancedMesh');
        if (mesh.material.positionNode || mesh.material.colorNode || mesh.material.vertexNode) throw new Error('attach cannot overwrite custom position/color/vertex nodes; use sourceIndexNode explicitly');
        if (Object.values(mesh.geometry.attributes).some(a => a.isInstancedBufferAttribute || a.data?.isInstancedInterleavedBuffer)) throw new Error('remap all per-instance attributes through sourceIndexNode before attaching');
        if (mesh.geometry.index?.count !== data.indexCount || mesh.geometry.indirect) throw new Error('attach needs matching indexed geometry without an existing indirect buffer');
        const makeStorage = (array, size, type) => {
          if (!(array instanceof Float32Array) || array.length !== data.capacity * size || !array.every(Number.isFinite)) throw new TypeError(`expected ${data.capacity} finite ${type} records`);
          if (Math.max(size * 4, array.byteLength) > limits.maxStorageBufferBindingSize || Math.max(size * 4, array.byteLength) > limits.maxBufferSize) throw new RangeError('instance data exceeds device limits');
          const buffer = new StorageBufferAttribute(array.length ? array : new Float32Array(size), size);
          localResources.add(buffer);
          return { attribute: buffer, node: storage(buffer, type, buffer.count).toReadOnly() };
        };
        const current = makeStorage(matrices, 16, 'mat4');
        const previous = previousMatrices === matrices ? current : makeStorage(previousMatrices, 16, 'mat4');
        const colorData = colors ? makeStorage(colors, 4, 'vec4') : null;
        mesh.material.positionNode = Fn(() => {
          const transform = current.node.element(sourceIndexNode);
          normalLocal.assign(transformNormal(normalLocal, transform));
          positionPrevious.assign(previous.node.element(sourceIndexNode).mul(vec4(positionGeometry, 1)).xyz);
          return transform.mul(vec4(positionGeometry, 1)).xyz;
        })();
        if (colorData) mesh.material.colorNode = materialColor.mul(colorData.node.element(sourceIndexNode).xyz.toVarying());
        mesh.material.needsUpdate = true;
        const frustumCulled = mesh.frustumCulled;
        mesh.frustumCulled = false;
        mesh.geometry.setIndirect(indirect);
        attachments.push({ mesh, frustumCulled });
        return { matrixAttribute: current.attribute, previousMatrixAttribute: previous.attribute, colorAttribute: colorData?.attribute ?? null };
      },
      async readbackForValidation() {
        assertLive();
        const [commands, list] = await Promise.all([
          renderer.getArrayBufferAsync(indirect),
          data.capacity ? renderer.getArrayBufferAsync(visible) : Promise.resolve(new ArrayBuffer(0)),
        ]);
        const args = Array.from(new Uint32Array(commands));
        if (args[1] > data.capacity) throw new Error('GPU visibility overflow');
        const indices = Array.from(new Uint32Array(list).subarray(0, args[1]));
        return { args, indices, ids: indices.map(index => ids.array[index]) };
      },
      dispose() {
        if (viewDisposed) return;
        viewDisposed = true;
        for (const { mesh, frustumCulled } of attachments) {
          mesh.geometry.setIndirect(null);
          mesh.frustumCulled = frustumCulled;
          mesh.material.positionNode = null;
          if (mesh.material.colorNode) mesh.material.colorNode = null;
          mesh.material.needsUpdate = true;
        }
        for (const node of [reset, compact, command]) node.dispose();
        for (const resource of localResources) resource.dispose();
        views.delete(key);
      },
    };
    views.set(key, view);
    return view;
  }

  return {
    capacity: data.capacity,
    clusterCount: data.clusterCount,
    createView,
    dispose() {
      if (disposed) return;
      for (const view of [...views.values()]) view.dispose();
      for (const resource of resources) resource.dispose();
      disposed = true;
    },
  };
}

export async function runValidation(renderer) {
  return (await import('./visibility-validation.js')).runValidation(renderer);
}
