import { BufferGeometry, InstancedMesh, Matrix4, StorageBufferAttribute, StorageInstancedBufferAttribute, Vector2, Vector3 } from 'three/webgpu';
import { Fn, If, instanceIndex, positionLocal, positionPrevious, storage, uint } from 'three/tsl';
import { cpuVisibleInstances, createVisibility, getFrustumPlanes } from './visibility.js';

const PLANTS = /^(woodland-stems|shrub-interiors|shrub-branches|mature-shrub-branches|shrub-foliage(?:-detailed)?|canopy-interior|woodland-canopy|district-stems|district-canopy|individual-foliage|broadleaf-groundcover|perennial-flowers|perennial-stems|clonal-petioles|ornamental-grass|lawn-edge|mown-turf):/;
const CLUSTER_SIZE = 64, MIN_INSTANCES = 1024;

// Existing cell batches preserve plant/leaf insertion order. Keep contiguous source ranges
// and overestimate their bounds; no instance is discarded or replaced with simpler geometry.
export function campusClusterData(mesh) {
  mesh.geometry.computeBoundingSphere();
  const local = mesh.geometry.boundingSphere, matrix = new Matrix4(), center = new Vector3();
  const count = mesh.count, clusters = Math.ceil(count / CLUSTER_SIZE);
  const bounds = new Float32Array(clusters * 4), ranges = new Uint32Array(clusters * 2);
  for (let c = 0; c < clusters; c++) {
    const start = c * CLUSTER_SIZE, end = Math.min(count, start + CLUSTER_SIZE);
    const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
    for (let i = start; i < end; i++) {
      matrix.fromArray(mesh.instanceMatrix.array, i * 16).premultiply(mesh.matrixWorld);
      center.copy(local.center).applyMatrix4(matrix);
      const e = matrix.elements;
      // Frobenius norm also bounds scale under shear, unlike max column length.
      const radius = local.radius * Math.hypot(e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]);
      for (let axis = 0; axis < 3; axis++) {
        const value = center.getComponent(axis);
        min[axis] = Math.min(min[axis], value - radius); max[axis] = Math.max(max[axis], value + radius);
      }
    }
    const xyz = min.map((value, axis) => (value + max[axis]) / 2);
    const rounding = Math.max(.001, ...xyz.map(value => Math.abs(value) * 1e-6));
    bounds.set([...xyz, Math.hypot(...max.map((value, axis) => value - xyz[axis])) + rounding], c * 4);
    ranges.set([start, end - start], c * 2);
  }
  return { bounds, ranges, instanceIds: Uint32Array.from({ length: count }, (_, i) => i), indexCount: mesh.geometry.index.count };
}

function instanceStreams(mesh) {
  const streams = [{ name: 'instanceMatrix', attribute: mesh.instanceMatrix }];
  if (mesh.instanceColor) streams.push({ name: 'instanceColor', attribute: mesh.instanceColor });
  for (const [name, attribute] of Object.entries(mesh.geometry.attributes)) {
    if (attribute.data?.isInstancedInterleavedBuffer) throw new Error(`interleaved instance attribute: ${name}`);
    if (attribute.isInstancedBufferAttribute) streams.push({ name, attribute });
  }
  let stride = 0;
  for (const stream of streams) {
    const a = stream.attribute;
    if (!(a.array instanceof Float32Array) || a.normalized || a.meshPerAttribute !== 1 || a.count < mesh.count ||
      (stream.name !== 'instanceMatrix' && (a.itemSize < 1 || a.itemSize > 4))) throw new Error(`unsupported instance attribute: ${stream.name}`);
    Object.assign(stream, { offset: stride, width: a.itemSize, outputWidth: a.itemSize === 3 ? 4 : a.itemSize, version: a.version });
    stride += a.itemSize;
  }
  return { streams, stride };
}

function makeBin(renderer, source) {
  const { geometry: originalGeometry, material: originalMaterial, count } = source;
  if (!originalMaterial?.isNodeMaterial || originalMaterial.transparent || originalMaterial.positionNode || originalMaterial.vertexNode || originalMaterial.displacementMap || source.morphTexture || Object.keys(originalGeometry.morphAttributes).length) throw new Error('requires static opaque/alpha-test node material without vertex deformation');
  if (!originalGeometry.index || originalGeometry.indirect || originalGeometry.drawRange.start || originalGeometry.drawRange.count !== Infinity) throw new Error('requires complete indexed geometry');
  const { streams, stride } = instanceStreams(source), limits = renderer.backend.device.limits;
  // Packed source + visible indices + command + one destination per stream.
  if (streams.length + 3 > limits.maxStorageBuffersPerShaderStage) throw new Error('gather exceeds storage bindings per shader stage');
  const sourceBytes = count * stride * 4;
  if (sourceBytes > limits.maxStorageBufferBindingSize || sourceBytes > limits.maxBufferSize) throw new Error('packed instance data exceeds device buffer limit');
  const packed = new Float32Array(count * stride);
  for (let i = 0; i < count; i++) for (const stream of streams) {
    const values = stream.attribute.array.subarray(i * stream.width, (i + 1) * stream.width);
    if (!values.every(Number.isFinite)) throw new Error(`nonfinite instance data: ${stream.name}`);
    packed.set(values, i * stride + stream.offset);
  }
  const data = campusClusterData(source), visibility = createVisibility({ renderer, ...data }), view = visibility.createView('main');
  const input = new StorageBufferAttribute(packed, 1), inputNode = storage(input, 'float', packed.length).toReadOnly();
  const commands = storage(view.indirect, 'uint', 5).toReadOnly();
  for (const stream of streams) {
    // Pad vec3 before first upload: storage WGSL and vertex attribute strides must agree.
    stream.output = new StorageInstancedBufferAttribute(count, stream.outputWidth);
    stream.node = storage(stream.output, 'float', stream.output.array.length);
  }
  const gather = Fn(() => {
    If(instanceIndex.lessThan(commands.element(1)), () => {
      const src = view.sourceIndexNode.mul(uint(stride)).toVar();
      for (const stream of streams) for (let component = 0; component < stream.outputWidth; component++) {
        stream.node.element(instanceIndex.mul(uint(stream.outputWidth)).add(component)).assign(component < stream.width
          ? inputNode.element(src.add(stream.offset + component)) : 0);
      }
    });
  })().compute(count, [64]).setName(`campus-gather/${source.name}`);
  const geometry = new BufferGeometry();
  geometry.setIndex(originalGeometry.index.clone());
  for (const [name, attribute] of Object.entries(originalGeometry.attributes)) {
    if (!attribute.isInstancedBufferAttribute) geometry.setAttribute(name, attribute.clone());
  }
  for (const stream of streams.slice(source.instanceColor ? 2 : 1)) geometry.setAttribute(stream.name, stream.output);
  geometry.setIndirect(view.indirect);
  const material = originalMaterial.clone();
  // NodeMaterial.copy preserves graphs, but own lighting hooks live outside its fields.
  for (const [name, value] of Object.entries(originalMaterial)) if (typeof value === 'function') material[name] = value;
  // shortcut: sources are static. Dynamic wind needs stable-ID previous transforms before enabling it.
  material.positionNode = Fn(() => { positionPrevious.assign(positionLocal); return positionLocal; })();
  const mesh = new InstancedMesh(geometry, material, 0);
  mesh.count = count; mesh.instanceMatrix = streams[0].output;
  mesh.instanceColor = source.instanceColor ? streams[1].output : null;
  mesh.name = `${source.name}/gpu-visible`; mesh.matrixAutoUpdate = false; mesh.matrix.copy(source.matrix);
  mesh.layers.mask = source.layers.mask; mesh.renderOrder = source.renderOrder;
  mesh.receiveShadow = source.receiveShadow; mesh.castShadow = false; mesh.frustumCulled = false; mesh.visible = false;
  mesh.raycast = () => {}; // The unchanged source retains CPU picking and shadow/reflection geometry.
  const matrixWorld = source.matrixWorld.clone(), materialVersion = originalMaterial.version;
  const callbacks = Object.fromEntries(['onBeforeRender', 'onAfterRender', 'onBeforeShadow', 'onAfterShadow'].map(name => [name, source[name]]));
  let mainCamera = null, active = false, shadow = false;
  source.computeBoundingSphere();
  source.onBeforeRender = function(...args) { callbacks.onBeforeRender.apply(this, args); this.count = active && !shadow && args[2] === mainCamera ? 0 : count; };
  source.onAfterRender = function(...args) { this.count = count; callbacks.onAfterRender.apply(this, args); };
  source.onBeforeShadow = function(...args) { shadow = true; callbacks.onBeforeShadow.apply(this, args); };
  source.onAfterShadow = function(...args) { shadow = false; this.count = count; callbacks.onAfterShadow.apply(this, args); };
  mesh.onBeforeRender = (_r, _s, camera) => { mesh.count = active && camera === mainCamera ? count : 0; };
  mesh.onAfterRender = () => { mesh.count = count; };
  source.parent.add(mesh);
  let planes = null;
  return {
    source, mesh, data, streams,
    extraBufferBytes: sourceBytes + streams.reduce((sum, stream) => sum + stream.output.array.byteLength, 0) + data.bounds.byteLength + data.ranges.byteLength + count * 8 + 24,
    clonedGeometryBytes: geometry.index.array.byteLength + Object.values(geometry.attributes).filter(a => !a.isInstancedBufferAttribute).reduce((sum, a) => sum + a.array.byteLength, 0),
    maxGatherBytes: sourceBytes + streams.reduce((sum, stream) => sum + stream.output.array.byteLength, 0) + count * 8,
    update(camera, padding) {
      if (!source.matrixWorld.equals(matrixWorld) || source.count !== count || source.material !== originalMaterial || source.geometry !== originalGeometry || originalMaterial.version !== materialVersion || streams.some(stream => stream.attribute.version !== stream.version || (source[stream.name] || source.geometry.attributes[stream.name]) !== stream.attribute)) return false;
      active = true; mainCamera = camera; mesh.visible = source.visible;
      view.update(camera, { padding }); renderer.compute(gather);
      planes = getFrustumPlanes(camera, { padding });
      return true;
    },
    disable() { active = false; mesh.visible = false; source.count = count; },
    async validate() {
      if (!planes) throw new Error('update(camera) must precede diagnostic readback');
      const result = await view.readbackForValidation(), expected = new Set(cpuVisibleInstances(data, planes).indices);
      if (result.args[4] !== 0 || result.ids.length !== expected.size || new Set(result.indices).size !== expected.size || result.indices.some(index => !expected.has(index))) throw new Error(`${source.name}: visible set disagrees with CPU oracle`);
      for (const stream of streams) {
        const output = new Float32Array(await renderer.getArrayBufferAsync(stream.output));
        for (let dst = 0; dst < result.indices.length; dst++) for (let c = 0; c < stream.outputWidth; c++) {
          const expectedValue = c < stream.width ? packed[result.indices[dst] * stride + stream.offset + c] : 0;
          if (output[dst * stream.outputWidth + c] !== expectedValue) throw new Error(`${source.name}: ${stream.name} gather mismatch at destination ${dst}, component ${c}`);
        }
      }
      return { name: source.name, source: count, visible: result.indices.length, clusters: visibility.clusterCount, attributes: streams.map(stream => stream.name), args: result.args };
    },
    dispose() {
      active = false; source.count = count; Object.assign(source, callbacks); mesh.removeFromParent();
      mesh.dispose(); geometry.dispose(); material.dispose(); gather.dispose(); input.dispose();
      for (const stream of streams) stream.output.dispose(); visibility.dispose();
    },
  };
}

// Call after materials/lighting are bound, and update(mainCamera) BEFORE any render pass.
// Default off: gather bandwidth, extra buffers/submissions and full secondary views are real costs.
export function attachCampusVisibility({ renderer, root }) {
  if (!renderer?.backend?.isWebGPUBackend || !renderer.hasInitialized()) throw new Error('campus visibility requires initialized WebGPU');
  root.updateWorldMatrix(true, true);
  const candidates = [];
  root.traverse(object => { if (object.isInstancedMesh && PLANTS.test(object.name) && object.count >= MIN_INSTANCES) candidates.push(object); });
  const bins = [], stats = { enabled: false, bins: 0, sourceInstances: 0, clusters: 0, extraBufferBytes: 0, clonedGeometryBytes: 0, traaPotentialPreviousMatrixBytes: 0, maxGatherBytesPerUpdate: 0, computeSubmissionsPerUpdate: 0, skipped: [], bufferAccounting: 'estimated full-capacity additions, not measured peak; geometry and TRAA history listed separately', secondaryViews: 'original full instances; no main-view culling', history: 'static instance transforms; stable source data', gpuVisibleCount: null };
  for (const candidate of candidates) {
    try {
      const bin = makeBin(renderer, candidate); bins.push(bin);
      stats.bins++; stats.sourceInstances += candidate.count; stats.clusters += bin.data.ranges.length / 2;
      stats.extraBufferBytes += bin.extraBufferBytes; stats.maxGatherBytesPerUpdate += bin.maxGatherBytes;
      stats.clonedGeometryBytes += bin.clonedGeometryBytes; stats.traaPotentialPreviousMatrixBytes += candidate.count * 64;
      stats.computeSubmissionsPerUpdate += 2;
    } catch (error) { stats.skipped.push({ name: candidate.name, reason: error.message }); }
  }
  const invalid = new Set(), drawingSize = new Vector2();
  let disposed = false;
  return {
    stats,
    setEnabled(value) {
      if (disposed) throw new Error('campus visibility has been disposed');
      stats.enabled = !!value;
      if (!stats.enabled) for (const bin of bins) bin.disable();
    },
    update(camera) {
      if (disposed) throw new Error('campus visibility has been disposed');
      if (!stats.enabled) return;
      root.updateWorldMatrix(true, true);
      renderer.getDrawingBufferSize(drawingSize);
      // One full pixel of conservative coverage at the far plane also covers TRAA jitter.
      const padding = Math.max(.05, camera.isPerspectiveCamera ? 2 * camera.far * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, drawingSize.y) : 0);
      for (const bin of bins) if (!invalid.has(bin)) {
        if (!bin.update(camera, padding)) {
          bin.disable(); invalid.add(bin);
          stats.skipped.push({ name: bin.source.name, reason: 'source changed after static snapshot; using original instances' });
        }
      }
    },
    // Explicit paused diagnostic only: never read back to drive a displayed frame.
    async readbackForValidation({ limit = 8 } = {}) {
      const results = [];
      for (const bin of bins.filter(bin => !invalid.has(bin)).slice(0, limit)) results.push(await bin.validate());
      return results;
    },
    dispose() { if (disposed) return; disposed = true; for (const bin of bins) bin.dispose(); },
  };
}
