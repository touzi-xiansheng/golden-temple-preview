import {
  Box3, BoxGeometry, Color, FloatType, LinearSRGBColorSpace, Mesh,
  MeshStandardNodeMaterial, NodeMaterial, NoToneMapping, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, QuadMesh, RenderTarget,
  Scene, Vector3, WebGPURenderer,
} from 'three/webgpu';
import { vec3, vec4, uniform } from 'three/tsl';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { applyCampusLighting, createIrradianceNode, createLighting } from './lighting.js';

const relativeError = (actual, expected) => Math.max(...expected.map((value, index) => Math.abs(actual[index] - value) / Math.max(value, 0.01)));

// P0 only: known-radiance scenes make double counting observable without an art judgement.
export async function runLightingCalibration(renderer = null) {
  const ownedRenderer = !renderer;
  renderer ||= new WebGPURenderer({ antialias: false });
  await renderer.init();
  if (renderer.backend.isWebGPUBackend !== true) throw new Error('Calibration did not obtain a WebGPU backend');
  const previous = { target: renderer.getRenderTarget(), toneMapping: renderer.toneMapping };
  renderer.toneMapping = NoToneMapping;
  const size = 96;
  const target = new RenderTarget(size, size, { type: FloatType });
  target.texture.colorSpace = LinearSRGBColorSpace;
  const quadMaterial = new NodeMaterial(), quad = new QuadMesh(quadMaterial);
  quadMaterial.toneMapped = false;
  const pmrem = new PMREMGenerator(renderer), resources = [target, quadMaterial];
  let sunlight;
  const skyColor = [0.25, 0.4, 0.6], shadedColor = [0.06, 0.09, 0.14];
  const report = { backend: 'WebGPU', tests: [], passed: false };
  const check = (name, condition, details) => {
    report.tests.push({ name, passed: !!condition, ...details });
  };
  const read = async () => {
    const data = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
    const offset = ((size / 2) * size + size / 2) * 4;
    return { pixel: Array.from(data.slice(offset, offset + 3)), data };
  };
  const drawNode = async node => {
    quadMaterial.fragmentNode = vec4(node, 1); quadMaterial.needsUpdate = true;
    renderer.setRenderTarget(target); quad.render(renderer);
    return (await read()).pixel;
  };
  try {
    const skyScene = new Scene(); skyScene.background = new Color(...skyColor);
    const environment = pmrem.fromScene(skyScene, 0, 0.1, 10, { size: 32 });
    resources.push(environment);
    const bounds = new Box3(new Vector3(-2, -2, -2), new Vector3(2, 2, 2));
    const capture = async color => {
      const scene = new Scene(); scene.background = new Color(...color);
      const grid = new LightProbeGrid(4, 4, 4, 2, 2, 2);
      grid.bake(renderer, scene, { cubemapSize: 8, sampleCount: 512, far: 10 });
      resources.push(grid);
      return { grid, bounds, kind: 'base', blendDistance: 1, strength: uniform(1), ready: true };
    };
    const openProbe = await capture(skyColor), darkProbe = await capture(shadedColor);
    const irradiance = (probes, x = 0) => createIrradianceNode({
      skyTexture: environment.texture, probes, position: vec3(x, 0, 0), normal: vec3(0, 0, 1),
    }).div(Math.PI);
    const sky = await drawNode(irradiance([]));
    check('constant sky radiance', relativeError(sky, skyColor) < 0.03, { actual: sky, expected: skyColor });
    const open = await drawNode(irradiance([openProbe]));
    check('sky and unobstructed SH probe agree', relativeError(open, sky) < 0.03, { actual: open, expected: sky });
    const dark = await drawNode(irradiance([darkProbe]));
    check('probe replaces sky rather than adds to it', relativeError(dark, shadedColor) < 0.03, { actual: dark, expected: shadedColor });
    for (const x of [0, 1.75]) {
      const single = await drawNode(irradiance([darkProbe], x));
      const duplicate = await drawNode(irradiance([darkProbe, darkProbe], x));
      check(`duplicate atlas invariant at x=${x}`, relativeError(duplicate, single) < 0.002, { single, duplicate });
    }
    const outside = await drawNode(irradiance([darkProbe], 3));
    check('outside volume returns to sky', relativeError(outside, sky) < 0.002, { actual: outside, expected: sky });

    const scene = new Scene(); scene.environment = environment.texture;
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10); camera.position.z = 3;
    const material = new MeshStandardNodeMaterial({ color: 0xffffff, metalness: 1, roughness: 0.02 });
    const geometry = new PlaneGeometry(2, 2); scene.add(new Mesh(geometry, material));
    resources.push(material, geometry);
    const owner = { environment, probes: [darkProbe], materials: new Set() };
    applyCampusLighting(material, owner);
    const drawMaterial = async strength => {
      darkProbe.strength.value = strength;
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      return (await read()).pixel;
    };
    const metalBefore = await drawMaterial(0), metalAfter = await drawMaterial(1);
    check('sharp metallic environment reflection remains', relativeError(metalAfter, metalBefore) < 0.03 && metalAfter.every(value => value > 0.02), { before: metalBefore, after: metalAfter });
    material.metalness = 0; material.roughness = 1; material.needsUpdate = true;
    const diffuseBefore = await drawMaterial(0), diffuseAfter = await drawMaterial(1);
    check('physical diffuse path receives replacement', diffuseAfter.every((value, i) => value < diffuseBefore[i] * 0.5), { before: diffuseBefore, after: diffuseAfter });

    const shadowScene = new Scene(), shadowCamera = new PerspectiveCamera(45, 1, 0.1, 80);
    shadowCamera.position.set(-8, 7, -8); shadowCamera.lookAt(0, 0, 0);
    sunlight = createLighting({ renderer, scene: shadowScene, camera: shadowCamera, quality: 'performance' });
    await sunlight.ready;
    const floorMaterial = new MeshStandardNodeMaterial({ color: 0x999999, roughness: 1 });
    const floorGeometry = new PlaneGeometry(14, 14), boxGeometry = new BoxGeometry(2, 2, 2);
    const floor = new Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    const box = new Mesh(boxGeometry, floorMaterial); box.position.y = 1; box.castShadow = true;
    shadowScene.add(floor, box); resources.push(floorMaterial, floorGeometry, boxGeometry);
    const renderShadow = async enabled => {
      box.castShadow = enabled; sunlight.sun.shadow.needsUpdate = true;
      renderer.setRenderTarget(target); renderer.render(shadowScene, shadowCamera);
      return (await read()).data;
    };
    const shadowOn = await renderShadow(true), shadowOff = await renderShadow(false);
    let darkerPixels = 0;
    for (let i = 0; i < shadowOn.length; i += 4) {
      if (shadowOff[i] - shadowOn[i] > 0.025) darkerPixels++;
    }
    check('SunLight cascades cast an actual shadow', darkerPixels > 32, { darkerPixels, size: [size, size], camera: shadowCamera.position.toArray() });
    report.passed = report.tests.every(test => test.passed);
    return report;
  } finally {
    sunlight?.dispose();
    renderer.setRenderTarget(previous.target); renderer.toneMapping = previous.toneMapping;
    for (const resource of resources.reverse()) resource.dispose();
    pmrem.dispose();
    if (ownedRenderer) renderer.dispose();
  }
}
