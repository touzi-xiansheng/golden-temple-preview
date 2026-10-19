import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, MeshStandardNodeMaterial, Scene, PerspectiveCamera, RenderTarget, Texture, Vector3 } from 'three/webgpu';
import { applyCampusLighting, createLighting } from '../src/campus-webgpu/lighting.js';

test('lighting rejects a renderer that silently fell back to WebGL', async () => {
  const scene = new Scene();
  const renderer = { isWebGPURenderer: true, init: async () => {}, backend: { isWebGPUBackend: false } };
  const lighting = createLighting({ renderer, scene, camera: new PerspectiveCamera() });
  await assert.rejects(lighting.ready, /real WebGPU backend/);
  assert.equal(scene.children.length, 0);
  assert.equal(scene.environment, null);
  lighting.dispose(); lighting.dispose();
});

test('disposing while initialization is pending does not attach lights', async () => {
  let finish;
  const scene = new Scene();
  const renderer = { isWebGPURenderer: true, init: () => new Promise(resolve => { finish = resolve; }) };
  const lighting = createLighting({ renderer, scene, camera: new PerspectiveCamera() });
  lighting.dispose(); finish();
  await assert.rejects(lighting.ready, /disposed during initialization/);
  assert.equal(scene.children.length, 0);
});

test('quality changes release shadow storage without detaching the node-owned target', async () => {
  let finish;
  const renderer = { isWebGPURenderer: true, init: () => new Promise(resolve => { finish = resolve; }) };
  const lighting = createLighting({ renderer, scene: new Scene(), camera: new PerspectiveCamera(45, 1, 0.1, 200) });
  const target = new RenderTarget(4096, 2048);
  let disposals = 0;
  target.addEventListener('dispose', () => disposals++);
  lighting.sun.shadow.map = target;
  const far = lighting.sun.shadow.camera.far;
  lighting.setQuality('quality');
  assert.equal(lighting.sun.shadow.map, target);
  assert.deepEqual([target.width, target.height], [8192, 4096]);
  assert.equal(disposals, 1);
  assert.equal(lighting.sun.shadow.camera.far, far);
  lighting.setQuality('quality');
  assert.equal(disposals, 1);
  lighting.setQuality('performance');
  assert.deepEqual([target.width, target.height], [2048, 1024]);
  assert.equal(disposals, 2);
  lighting.dispose(); finish();
  await assert.rejects(lighting.ready, /disposed during initialization/);
});

test('publishing a probe atlas invalidates cached shaders and disposal restores material hooks', async () => {
  let finish;
  const renderer = { isWebGPURenderer: true, init: () => new Promise(resolve => { finish = resolve; }) };
  const lighting = createLighting({ renderer, scene: new Scene(), camera: new PerspectiveCamera() });
  const material = new MeshStandardNodeMaterial(), originalSetup = material.setupEnvironment, originalKey = material.customProgramCacheKey;
  applyCampusLighting(material, lighting);
  const before = material.customProgramCacheKey(), texture = new Texture();
  const probe = { ready: true, grid: { texture, dispose: () => texture.dispose() }, kind: 'base', blendDistance: 1,
    bounds: new Box3(new Vector3(-1, -1, -1), new Vector3(1, 1, 1)) };
  lighting.probes.push(probe);
  assert.notEqual(material.customProgramCacheKey(), before);
  const withProbe = material.customProgramCacheKey();
  applyCampusLighting(material, lighting);
  assert.equal(material.customProgramCacheKey(), withProbe, 'binding is idempotent');
  lighting.dispose(); finish();
  await assert.rejects(lighting.ready, /disposed during initialization/);
  assert.equal(material.setupEnvironment, originalSetup);
  assert.equal(material.customProgramCacheKey, originalKey);
  material.dispose();
});

test('real WebGPU lighting energy, atlas overlap and SunLight calibration', {
  skip: !process.env.WEBGPU_LIGHTING_URL,
  timeout: 180000,
}, async t => {
  const [{ default: puppeteer }, { findChrome }] = await Promise.all([
    import('puppeteer-core'), import('./lib/chrome.mjs'),
  ]);
  const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true,
    args: ['--enable-gpu', '--no-proxy-server'], protocolTimeout: 180000 });
  try {
    const page = await browser.newPage(), errors = [];
    page.on('console', message => { if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text()); });
    page.on('pageerror', error => errors.push(error.message));
    const base = new URL(process.env.WEBGPU_LIGHTING_URL);
    await page.goto(new URL('/@vite/client', base).href, { waitUntil: 'domcontentloaded' });
    const report = await page.evaluate(async () => {
      const { runLightingCalibration } = await import('/src/campus-webgpu/lighting-calibration.js');
      return await runLightingCalibration();
    });
    t.diagnostic(JSON.stringify(report));
    assert.deepEqual(errors, [], 'GPU validation or shader errors');
    assert.equal(report.backend, 'WebGPU');
    assert.ok(report.passed, JSON.stringify(report.tests.filter(test => !test.passed)));
  } finally {
    await browser.close();
  }
});
