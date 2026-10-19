import {
  BufferGeometry, Color, Float32BufferAttribute, Matrix4, Mesh, MeshBasicNodeMaterial,
  OrthographicCamera, PerspectiveCamera, RenderTarget, Scene, UnsignedByteType, WebGPUCoordinateSystem,
} from 'three/webgpu';
import { createVisibility, cpuVisibleInstances, getFrustumPlanes } from './visibility.js';

const check = (condition, message) => { if (!condition) throw new Error(`Visibility validation: ${message}`); };
const sorted = values => [...values].sort((a, b) => a - b);
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function cameraAt(x, wide = false) {
  const camera = wide ? new OrthographicCamera(-30, 30, 30, -30, .1, 100) : new PerspectiveCamera(50, 1, .1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.position.set(x, 0, wide ? 50 : 5);
  camera.lookAt(x, 0, 0);
  camera.updateProjectionMatrix();
  camera.updateMatrixWorld(true);
  return camera;
}

// Call only while the application loop is paused; this test owns renderer state briefly.
export async function runValidation(renderer) {
  check(renderer.backend?.isWebGPUBackend, 'real WebGPU backend required');
  const input = {
    bounds: new Float32Array([-1, 0, 0, .75, 1, 0, 0, .75, 20, 0, 0, .75, 0, 0, 20, .75]),
    ranges: new Uint32Array([0, 2, 2, 2, 4, 1, 5, 1]),
    instanceIds: new Uint32Array([700, 31, 0, 99999, 45, 4000000000]),
    indexCount: 3,
  };
  const positions = [[-1.2, 0, 0], [-.8, 0, 0], [.8, 0, 0], [1.2, 0, 0], [20, 0, 0], [0, 0, 20]];
  const matrices = new Float32Array(positions.flatMap(position => new Matrix4().makeTranslation(...position).toArray()));
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-.2, -.2, 0, .2, -.2, 0, 0, .2, 0], 3));
  geometry.setIndex([0, 1, 2]);
  geometry.computeVertexNormals();
  const material = new MeshBasicNodeMaterial({ color: 0xffffff });
  const mesh = new Mesh(geometry, material);
  const scene = new Scene();
  scene.background = new Color(0);
  scene.add(mesh);
  // The all-visible camera spans 60 m; 64 px would make every 40 cm triangle subpixel.
  const target = new RenderTarget(256, 256, { type: UnsignedByteType });
  const saved = {
    target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), mip: renderer.getActiveMipmapLevel(),
    mrt: renderer.getMRT(), autoClear: renderer.autoClear,
  };
  const device = renderer.backend.device;
  const controller = createVisibility({ renderer, ...input });
  const main = controller.createView('validation-main');
  const reflection = controller.createView('validation-reflection');
  const attached = main.attach(mesh, { matrices });
  const calls = [];
  const prototype = globalThis.GPURenderPassEncoder?.prototype;
  const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'drawIndexedIndirect');
  let scopeOpen = false;
  let instrumented = false;
  let emptyController;
  let reflectionMesh;
  try {
    check(typeof descriptor?.value === 'function', 'native drawIndexedIndirect tracing unavailable');
    Object.defineProperty(prototype, 'drawIndexedIndirect', {
      ...descriptor,
      value(buffer, offset) {
        calls.push({ buffer, offset });
        return descriptor.value.call(this, buffer, offset);
      },
    });
    instrumented = true;
    device.pushErrorScope('validation');
    scopeOpen = true;
    const cases = [];
    for (const [name, camera] of [['main', cameraAt(0)], ['none', cameraAt(50)], ['full-capacity', cameraAt(0, true)]]) {
      main.update(camera);
      const actual = await main.readbackForValidation();
      const expected = cpuVisibleInstances(input, getFrustumPlanes(camera));
      check(equal(sorted(actual.indices), sorted(expected.indices)), `${name}: GPU source indices differ from CPU sphere oracle`);
      check(equal(sorted(actual.ids), sorted(expected.ids)), `${name}: stable IDs changed`);
      check(new Set(actual.indices).size === actual.indices.length, `${name}: duplicate source indices`);
      check(equal(actual.args, [3, expected.indices.length, 0, 0, 0]), `${name}: invalid indirect command`);
      renderer.setMRT(null);
      renderer.setRenderTarget(target);
      renderer.autoClear = true;
      const before = calls.length;
      renderer.render(scene, camera);
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
      let litPixels = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) litPixels++;
      const gpuBuffer = renderer.backend.get(main.indirect).buffer;
      const nativeDraws = calls.slice(before).filter(call => call.buffer === gpuBuffer && call.offset === 0).length;
      check(nativeDraws === 1, `${name}: expected one actual drawIndexedIndirect call, got ${nativeDraws}`);
      check(name === 'none' ? litPixels === 0 : litPixels > 0,
        `${name}: framebuffer does not agree with indirect visibility ${JSON.stringify({ litPixels, args: actual.args, ids: actual.ids, nativeDraws, width: target.width, height: target.height })}`);
      cases.push({ name, args: actual.args, ids: sorted(actual.ids), nativeDraws, litPixels });
    }
    const mainCamera = cameraAt(0), reflectionCamera = cameraAt(20);
    main.update(mainCamera);
    reflection.update(reflectionCamera);
    const [mainRead, reflectionRead] = await Promise.all([main.readbackForValidation(), reflection.readbackForValidation()]);
    check(equal(sorted(mainRead.ids), [0, 31, 700, 99999]), 'secondary camera overwrote the main list');
    check(equal(reflectionRead.ids, [45]), 'reflection camera did not keep its independent source');
    const reflectionGeometry = geometry.clone();
    reflectionGeometry.setIndirect(null);
    reflectionMesh = new Mesh(reflectionGeometry, new MeshBasicNodeMaterial({ color: 0xffffff }));
    reflection.attach(reflectionMesh, { matrices, colors: new Float32Array(input.instanceIds.length * 4).fill(1) });
    scene.remove(mesh); scene.add(reflectionMesh);
    const beforeReflection = calls.length;
    renderer.render(scene, reflectionCamera);
    const reflectedPixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, target.width, target.height);
    let reflectedLitPixels = 0;
    for (let i = 0; i < reflectedPixels.length; i += 4) if (reflectedPixels[i] + reflectedPixels[i + 1] + reflectedPixels[i + 2] > 30) reflectedLitPixels++;
    const reflectionBuffer = renderer.backend.get(reflection.indirect).buffer;
    const reflectionDraws = calls.slice(beforeReflection).filter(call => call.buffer === reflectionBuffer && call.offset === 0).length;
    check(reflectionDraws === 1 && reflectedLitPixels > 0, 'nonzero source-index transform was not rendered by the independent view');
    cases.push({ name: 'reflection-source-index-4', args: reflectionRead.args, ids: reflectionRead.ids, nativeDraws: reflectionDraws, litPixels: reflectedLitPixels });
    const empty = { bounds: new Float32Array(), ranges: new Uint32Array(), instanceIds: new Uint32Array(), indexCount: 3 };
    emptyController = createVisibility({ renderer, ...empty });
    const emptyView = emptyController.createView('validation-empty');
    emptyView.update(mainCamera);
    const emptyRead = await emptyView.readbackForValidation();
    check(equal(emptyRead.args, [3, 0, 0, 0, 0]) && emptyRead.indices.length === 0, 'zero-source bin is not empty');
    await device.queue.onSubmittedWorkDone();
    const error = await device.popErrorScope();
    scopeOpen = false;
    check(!error, error?.message || 'WebGPU validation error');
    return {
      ok: true, cases, independentViews: { main: sorted(mainRead.ids), reflection: reflectionRead.ids },
      emptyArgs: emptyRead.args, matrixRecords: attached.matrixAttribute.count,
      evidence: 'GPU buffer readback versus CPU oracle + intercepted native drawIndexedIndirect + target pixels',
      limitations: ['Calibration fixture only; full-campus shadow/reflection/TRAA integration and performance remain unverified.'],
    };
  } finally {
    if (scopeOpen) await device.popErrorScope().catch(() => null);
    if (instrumented) Object.defineProperty(prototype, 'drawIndexedIndirect', descriptor);
    renderer.setMRT(saved.mrt);
    renderer.setRenderTarget(saved.target, saved.face, saved.mip);
    renderer.autoClear = saved.autoClear;
    emptyController?.dispose();
    controller.dispose();
    reflectionMesh?.geometry.dispose(); reflectionMesh?.material.dispose();
    geometry.dispose(); material.dispose(); target.dispose();
  }
}
