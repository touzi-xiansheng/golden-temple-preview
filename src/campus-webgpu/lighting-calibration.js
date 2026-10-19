import {
  Box3, BoxGeometry, Color, FloatType, LinearSRGBColorSpace, Mesh,
  MeshStandardNodeMaterial, NodeMaterial, NoToneMapping, OrthographicCamera,
  PerspectiveCamera, PlaneGeometry, PMREMGenerator, QuadMesh, RenderTarget,
  Scene, Vector3, WebGPURenderer,
} from 'three/webgpu';
import { vec3, vec4, uniform } from 'three/tsl';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { applyCampusLighting, createGroundRadianceNode, createIrradianceNode, createLighting, GROUND_ALBEDO } from './lighting.js';

const relativeError = (actual, expected) => Math.max(...expected.map((value, index) => Math.abs(actual[index] - value) / Math.max(value, 0.01)));
const luma = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

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
    await new Promise(requestAnimationFrame);
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
      await new Promise(requestAnimationFrame);
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
    sunlight = createLighting({ renderer, scene: shadowScene, camera: shadowCamera, quality: 'performance', cacheShadows: true });
    await sunlight.ready;
    const rawSky = pmrem.fromCubemap(sunlight.captureBackground.texture); resources.push(rawSky);
    const direction = sunlight.sun.getWorldPosition(new Vector3());
    if (sunlight.sun.target) direction.sub(sunlight.sun.target.getWorldPosition(new Vector3()));
    direction.normalize();
    const skyUp = await drawNode(createIrradianceNode({ skyTexture: rawSky.texture, normal: vec3(0, 1, 0) }));
    const ground = await drawNode(createGroundRadianceNode({ skyTexture: rawSky.texture,
      sunDirection: direction, sunColor: sunlight.sun.color, sunIntensity: sunlight.sun.intensity }));
    const direct = sunlight.sun.color.clone().multiplyScalar(sunlight.sun.intensity * direction.y).toArray();
    const expectedGround = skyUp.map((value, index) => (value + direct[index]) * GROUND_ALBEDO.toArray()[index] / Math.PI);
    check('ground bounce matches Lambertian sky plus sun energy', relativeError(ground, expectedGround) < 0.015,
      { actual: ground, expected: expectedGround, albedo: GROUND_ALBEDO.toArray() });
    const hemisphere = {};
    for (const [name, y] of [['up', 1], ['down', -1]]) {
      hemisphere[name] = {
        raw: await drawNode(createIrradianceNode({ skyTexture: rawSky.texture, normal: vec3(0, y, 0) })),
        grounded: await drawNode(createIrradianceNode({ skyTexture: sunlight.environment.texture, normal: vec3(0, y, 0) })),
      };
    }
    check('IBL lower hemisphere is a nonzero ground bounce, below upper sky energy',
      luma(hemisphere.down.grounded) > 0 && luma(hemisphere.down.grounded) < luma(hemisphere.up.grounded)
        && luma(hemisphere.down.grounded) < luma(hemisphere.down.raw) * 0.5,
      { hemisphere });

    const grayMaterial = new MeshStandardNodeMaterial({ color: new Color(.18, .18, .18), roughness: 1 });
    const grayGeometry = new PlaneGeometry(2, 2), grayMesh = new Mesh(grayGeometry, grayMaterial);
    const grayScene = new Scene(); grayScene.environmentIntensity = shadowScene.environmentIntensity;
    grayScene.add(grayMesh); applyCampusLighting(grayMaterial, sunlight);
    const graySun = sunlight.sun.clone(); graySun.castShadow = false;
    resources.push(grayMaterial, grayGeometry, graySun);
    const grayCamera = new OrthographicCamera(-1, 1, 1, -1, .1, 10), gray = {};
    for (const [name, y] of [['up', 1], ['down', -1]]) {
      const normal = new Vector3(0, y, 0);
      grayMesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), normal);
      grayCamera.position.copy(normal).multiplyScalar(3); grayCamera.up.set(0, 0, -1); grayCamera.lookAt(0, 0, 0);
      gray[name] = {};
      for (const [mode, hasSun, hasEnvironment] of [['direct', true, false], ['indirect', false, true], ['combined', true, true]]) {
        if (hasSun) {
          grayScene.add(graySun);
          if (graySun.target) grayScene.add(graySun.target);
        } else {
          graySun.removeFromParent(); graySun.target?.removeFromParent();
        }
        // The lighting binding requires an environment; zero intensity isolates the direct term.
        grayScene.environment = sunlight.environment.texture;
        grayScene.environmentIntensity = hasEnvironment ? shadowScene.environmentIntensity : 0;
        await new Promise(requestAnimationFrame);
        renderer.setRenderTarget(target); renderer.render(grayScene, grayCamera);
        gray[name][mode] = (await read()).pixel;
      }
    }
    check('18 percent gray cards preserve direct plus indirect superposition', Object.values(gray).every(sample =>
      relativeError(sample.combined, sample.direct.map((value, index) => value + sample.indirect[index])) < .015), { gray });
    check('18 percent upward gray card receives more energy than downward card',
      luma(gray.up.combined) > luma(gray.down.combined) * 1.5 && luma(gray.down.indirect) > 0,
      { up: gray.up.combined, down: gray.down.combined });
    // Art-direction bounds for this fixed clear-day preset, not a universal daylight law.
    const sunToSky = luma(gray.up.direct) / luma(gray.up.indirect);
    const blueToRed = gray.up.combined[2] / gray.up.combined[0];
    check('clear-day gray card has a dominant sun and bounded blue cast', sunToSky >= 1.5 && sunToSky <= 4
      && blueToRed >= .9 && blueToRed <= 1.45, { sunToSky, blueToRed, gray: gray.up });
    const floorMaterial = new MeshStandardNodeMaterial({ color: 0x999999, roughness: 1 });
    const floorGeometry = new PlaneGeometry(14, 14), boxGeometry = new BoxGeometry(2, 2, 2);
    const floor = new Mesh(floorGeometry, floorMaterial); floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    const box = new Mesh(boxGeometry, floorMaterial); box.position.y = 1; box.castShadow = true;
    shadowScene.add(floor, box); resources.push(floorMaterial, floorGeometry, boxGeometry);
    sunlight.update(shadowCamera, { shot: 2 });
    const renderShadow = async enabled => {
      box.castShadow = enabled; sunlight.sun.shadow.needsUpdate = true;
      await new Promise(requestAnimationFrame);
      renderer.setRenderTarget(target); renderer.render(shadowScene, shadowCamera);
      return (await read()).data;
    };
    const shadowOn = await renderShadow(true), shadowOff = await renderShadow(false);
    let darkerPixels = 0;
    for (let i = 0; i < shadowOn.length; i += 4) {
      if (shadowOff[i] - shadowOn[i] > 0.025) darkerPixels++;
    }
    check('default cached sunlight casts an actual shadow', darkerPixels > 32, { darkerPixels, mode: sunlight.stats.shadowMode, size: [size, size], camera: shadowCamera.position.toArray() });
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
