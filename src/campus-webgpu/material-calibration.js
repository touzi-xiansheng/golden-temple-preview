import {
  BufferAttribute, BufferGeometry, Color, DirectionalLight, DoubleSide, FloatType, InstancedMesh, LinearSRGBColorSpace, Matrix4, Mesh, MeshBasicNodeMaterial,
  NoToneMapping, OrthographicCamera, PlaneGeometry, PMREMGenerator, RenderTarget, Scene,
} from 'three/webgpu';
import { diffuseColor, getGeometryRoughness, roughness, vec3, vec4 } from 'three/tsl';
import { buildingMaterials } from '../campus/building-materials.js';
import { foliageMaterial } from '../campus/foliage-material.js';
import { createCampusMaterials } from './materials.js';
import { applyCampusLighting, createIrradianceNode } from './lighting.js';

const maximumError = (actual, expected) => Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));

// Uses production materials and GPU fragment outputs without tone mapping.
// The caller owns the initialized renderer and decides when this check may run.
export async function runMaterialCalibration(renderer) {
  if (renderer?.backend?.isWebGPUBackend !== true) throw new Error('Material calibration requires an initialized WebGPU renderer');
  const previous = {
    target: renderer.getRenderTarget(), toneMapping: renderer.toneMapping,
    outputColorSpace: renderer.outputColorSpace, mrt: renderer.getMRT(), autoClear: renderer.autoClear,
    shadows: renderer.shadowMap.enabled,
  };
  const resources = [], factories = [], report = { backend: 'WebGPU', tests: [], passed: false };
  const check = (name, passed, details) => report.tests.push({ name, passed: !!passed, ...details });
  const size = 64, target = new RenderTarget(size, size, { type: FloatType });
  target.texture.colorSpace = LinearSRGBColorSpace; resources.push(target);
  const pmrem = new PMREMGenerator(renderer);
  const scene = new Scene(), camera = new OrthographicCamera(-1, 1, 1, -1, .1, 10);
  camera.position.z = 3; scene.background = new Color(0, 0, 0);
  const geometry = new PlaneGeometry(2, 2), mesh = new Mesh(geometry);
  resources.push(geometry, mesh.material); scene.add(mesh);
  let pixels;
  const draw = async (material, strength = 1) => {
    mesh.material = material; scene.environmentIntensity = strength;
    // Light nodes update once per Animation frame, independently of Info.reset().
    await new Promise(requestAnimationFrame);
    renderer.info.reset();
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
    const result = [0, 0, 0];
    for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) {
      for (let channel = 0; channel < 3; channel++) result[channel] += pixels[(y * size + x) * 4 + channel] / 16;
    }
    return result;
  };
  try {
    renderer.setMRT(null); renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace; renderer.autoClear = true;
    renderer.shadowMap.enabled = true;
    await new Promise(requestAnimationFrame);
    const skyColor = [.25, .4, .6], sky = new Scene(); sky.background = new Color(...skyColor);
    const environment = pmrem.fromScene(sky, 0, .1, 10, { size: 32 }); resources.push(environment);
    scene.environment = environment.texture;
    const owner = {
      environment, probes: [], materials: new Set(),
      sampleIrradiance: ({ normal, position }) => createIrradianceNode({ skyTexture: environment.texture, normal, position }),
    };
    const leafSource = foliageMaterial({ bend: 0 }); leafSource.color.setRGB(.2, .3, .1); resources.push(leafSource);
    const full = createCampusMaterials({ lighting: owner }), control = createCampusMaterials(); factories.push(full, control);
    const leaf = full.convert(leafSource, mesh), frontOnly = control.convert(leafSource, mesh);
    // Identical front lighting/SSS/normal nodes; only the leaf-back addition is absent.
    applyCampusLighting(frontOnly, owner);
    const samples = [];
    for (const strength of [1, .45, 0]) {
      const actual = await draw(leaf, strength), baseline = await draw(frontOnly, strength);
      samples.push({ strength, actual, baseline, added: actual.map((value, index) => value - baseline[index]) });
    }
    const expected = skyColor.map((value, index) => value * leafSource.color.toArray()[index] * [1.05, 1.12, .7][index] * .25);
    const relativeTintError = Math.max(...expected.map((value, index) => Math.abs(samples[0].added[index] - value) / value));
    check('leaf-back radiance retains the calibrated transmission tint', relativeTintError < .05, { actual: samples[0].added, expected, relativeError: relativeTintError });
    const scaledExpected = samples[0].added.map(value => value * .45);
    check('leaf-back energy scales with environment 1 to .45', samples[0].added.every(value => value > .005)
      && maximumError(samples[1].added, scaledExpected) < .0001, { full: samples[0], reduced: samples[1], expected: scaledExpected });
    check('zero environment produces zero leaf-back energy and no residual glow', samples[2].added.every(value => Math.abs(value) < .000002)
      && samples[2].actual.every(value => Math.abs(value) < .000002), { actual: samples[2] });

    const sun = new DirectionalLight(0xffffff, 1); sun.castShadow = true;
    Object.assign(sun.shadow.camera, { left: -2, right: 2, top: 2, bottom: -2, near: .1, far: 10 });
    sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.mapSize.set(256, 256); sun.shadow.bias = -.0001;
    scene.add(sun, sun.target); resources.push(sun); mesh.receiveShadow = true;
    const directSource = foliageMaterial({ bend: 0 }); directSource.color.copy(leafSource.color); resources.push(directSource);
    const directControl = full.convert(directSource, mesh); directControl.thicknessColorNode = null;
    const directSamples = {};
    for (const [name, direction, intensity] of [
      ['front', [0, 0, 3], 1], ['back', [0, 0, -3], 1],
      ['grazing', [3, 0, 0], 1], ['zero', [0, 0, -3], 0],
    ]) {
      sun.position.set(...direction); sun.intensity = intensity; sun.shadow.needsUpdate = true;
      const actual = await draw(leaf, 0), baseline = await draw(directControl, 0);
      directSamples[name] = actual.map((value, index) => value - baseline[index]);
    }
    check('thin leaves transmit back light but add no front-lit scattering',
      directSamples.back.every(value => value > .001) && directSamples.front.every(value => Math.abs(value) < .00001), { actual: directSamples });
    check('thin-leaf direct transmission vanishes at grazing incidence and zero sunlight',
      [...directSamples.grazing, ...directSamples.zero].every(value => Math.abs(value) < .00001), { actual: directSamples });
    const blockerGeometry = new PlaneGeometry(3, 3), blockerMaterial = new MeshBasicNodeMaterial({ color: 0, side: DoubleSide });
    const blocker = new Mesh(blockerGeometry, blockerMaterial); blocker.position.z = -.6; blocker.castShadow = true;
    resources.push(blockerGeometry, blockerMaterial); scene.add(blocker); sun.intensity = 1; sun.shadow.needsUpdate = true;
    const shadowed = await draw(leaf, 0), shadowControl = await draw(directControl, 0);
    const shadowAddition = shadowed.map((value, index) => value - shadowControl[index]);
    check('an opaque blocker removes thin-leaf transmitted sunlight', shadowAddition.every(value => Math.abs(value) < .00001), { actual: shadowAddition });
    scene.remove(blocker); sun.intensity = 0;

    const glassSources = buildingMaterials();
    for (const value of new Set(Object.values(glassSources).flat().filter(value => value?.isMaterial))) resources.push(value);
    const setAttribute = (name, values) => {
      const data = new Float32Array(Array.from({ length: 4 }, () => values).flat()), existing = geometry.getAttribute(name);
      if (existing) { existing.array.set(data); existing.needsUpdate = true; }
      else geometry.setAttribute(name, new BufferAttribute(data, values.length));
    };
    setAttribute('paneDetail', [0, .5, .5, .5]); setAttribute('paneSize', [2, 2]);
    setAttribute('paneRoom', [0, 3, 1, 2]); setAttribute('paneType', [0]);
    const litGlassFactory = createCampusMaterials({ lighting: owner }); factories.push(litGlassFactory);
    const roomGlass = litGlassFactory.convert(glassSources.glass, mesh);
    // Suppress specular radiance while retaining the production diffuse/room model.
    // Binding envMap below still exercises Three's environment-ownership intensity path.
    roomGlass.envNode = vec3(0);
    const roomSamples = [];
    for (const strength of [1, .45, 0]) roomSamples.push({ strength, pixel: await draw(roomGlass, strength) });
    check('ordinary room daylight follows the scene environment and goes dark at zero',
      roomSamples[0].pixel.every(value => value > .0001)
      && maximumError(roomSamples[1].pixel, roomSamples[0].pixel.map(value => value * .45)) < .0001
      && roomSamples[2].pixel.every(value => Math.abs(value) < .000002), { actual: roomSamples });
    const ownershipSamples = [];
    for (const [name, detail] of [['room', 0], ['blind', 1]]) {
      const paneDetail = geometry.getAttribute('paneDetail');
      for (let index = 0; index < paneDetail.count; index++) paneDetail.setX(index, detail);
      paneDetail.needsUpdate = true;
      roomGlass.envMap = null; roomGlass.needsUpdate = true;
      const sceneEnvironment = await draw(roomGlass, .45);
      roomGlass.envMap = environment.texture; roomGlass.needsUpdate = true;
      const ownEnvironment = await draw(roomGlass, .45);
      ownershipSamples.push({ name, sceneEnvironment, ownEnvironment });
    }
    check('binding a glass reflection probe does not change blind or room diffuse lighting',
      ownershipSamples.every(sample => sample.sceneEnvironment.every(value => value > .0001)
        && maximumError(sample.sceneEnvironment, sample.ownEnvironment) < .0001), { actual: ownershipSamples });
    setAttribute('paneDetail', [0, .5, .5, .5]);
    roomGlass.envMap = null; roomGlass.needsUpdate = true; sun.position.set(0, 0, 3); sun.intensity = 1;
    const sunRoom = await draw(roomGlass, 0);
    setAttribute('paneType', [1]);
    const sunBacking = await draw(roomGlass, 0);
    const roomAddition = sunRoom.map((value, index) => value - sunBacking[index]);
    sun.intensity = 0;
    const darkBacking = await draw(roomGlass, 0);
    setAttribute('paneType', [0]);
    const darkRoom = await draw(roomGlass, 0);
    check('ordinary rooms receive actual window-facing sunlight without a constant glow',
      roomAddition.every(value => value > .0001) && maximumError(darkRoom, darkBacking) < .000002,
      { sunRoom, sunBacking, roomAddition, darkRoom, darkBacking });

    const patternFactory = createCampusMaterials(); factories.push(patternFactory);
    const pattern = patternFactory.convert(glassSources.glass, mesh);
    pattern.outputNode = pattern.campusRoomNode;
    const rgb = values => Array.from(values).filter((_, index) => index % 4 !== 3);
    const arrangements = [], responses = [];
    for (const [name, seed, curtain] of [['workstations', .25, .5], ['meeting', .5, .5], ['lounge', .75, .9]]) {
      setAttribute('paneDetail', [0, .5, seed, curtain]);
      await draw(pattern, 0); arrangements.push({ name, values: rgb(pixels) });
      const daylight = await draw(roomGlass, .45);
      await draw(roomGlass, 0);
      responses.push({ name, daylight, darkMaximum: Math.max(...rgb(pixels).map(Math.abs)) });
    }
    const differences = arrangements.slice(1).map((entry, index) =>
      entry.values.reduce((sum, value, channel) => sum + Math.abs(value - arrangements[index].values[channel]), 0) / entry.values.length);
    check('three shared room layouts produce distinct bounded surface patterns',
      differences.every(value => value > .002) && arrangements.every(entry => entry.values.every(value => Number.isFinite(value) && value >= 0 && value <= .65)),
      { meanAbsoluteDifferences: differences, ranges: arrangements.map(entry => ({ name: entry.name, min: Math.min(...entry.values), max: Math.max(...entry.values) })) });
    check('every room arrangement receives daylight and remains dark without incident light',
      responses.every(entry => entry.daylight.every(value => value > .0001) && entry.darkMaximum < .000002), { actual: responses });

    // A physical 2m opening and two adjacent 1m panes must see the same room.
    setAttribute('paneDetail', [0, .5, .75, .9]); setAttribute('paneRoom', [0, 2, 1, 2]);
    await draw(pattern, 0); const continuous = pixels.slice();
    const split = new BufferGeometry(), splitData = { position: [], normal: [], uv: [], paneDetail: [], paneRoom: [], paneSize: [], paneType: [] };
    for (const offset of [-.5, .5]) for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      splitData.position.push(u - .5 + offset, v * 2 - 1, 0); splitData.normal.push(0, 0, 1); splitData.uv.push(u, v);
      splitData.paneDetail.push(0, .5, .75, .9); splitData.paneRoom.push(offset, 2, 1, 2); splitData.paneSize.push(1, 2); splitData.paneType.push(0);
    }
    for (const [name, values] of Object.entries(splitData)) split.setAttribute(name, new BufferAttribute(new Float32Array(values), values.length / 12));
    resources.push(split); mesh.geometry = split; pattern.needsUpdate = true;
    await draw(pattern, 0);
    let continuityError = 0;
    for (let y = 2; y < size - 2; y++) for (let x = 2; x < size - 2; x++) {
      if (x === 31 || x === 32) continue;
      for (let channel = 0; channel < 3; channel++) {
        const index = (y * size + x) * 4 + channel;
        continuityError = Math.max(continuityError, Math.abs(pixels[index] - continuous[index]));
      }
    }
    check('adjacent panes preserve the same room furniture and curtain coordinates', continuityError < .0001, { maximumError: continuityError });
    mesh.geometry = geometry;
    setAttribute('paneDetail', [1, .5, .5, .5]); setAttribute('paneRoom', [0, 3, 1, 2]);
    Object.assign(camera, { left: -.1, right: .1, top: .1, bottom: -.1 }); camera.updateProjectionMatrix();
    await draw(pattern, 0);
    const slatBase = .25 * .74, resolvedSlats = [];
    for (let y = 10; y < 54; y++) for (let x = 20; x < 44; x++) resolvedSlats.push(pixels[(y * size + x) * 4] / slatBase);
    Object.assign(camera, { left: -1, right: 1, top: 1, bottom: -1 }); camera.updateProjectionMatrix();
    await draw(pattern, 0);
    // WebGPU rows run downward; the old 34..51 region crossed the blind's lower edge.
    // This symmetric inset stays inside its coverage in either readback orientation.
    const minifiedSlats = [], minifiedCoverage = [];
    for (let y = 24; y < 40; y++) for (let x = 20; x < 44; x++) {
      const index = (y * size + x) * 4;
      minifiedSlats.push(pixels[index] / slatBase); minifiedCoverage.push(pixels[index + 3]);
    }
    const slatRange = [Math.min(...resolvedSlats), Math.max(...resolvedSlats)];
    const slatMeanError = Math.max(...minifiedSlats.map(value => Math.abs(value - .86)));
    check('resolved blinds retain subtle slats while minified repeats converge to their mean',
      slatRange[0] >= .825 - .0001 && slatRange[1] <= .895 + .0001 && slatRange[1] - slatRange[0] > .02 && slatMeanError < .0001
        && minifiedCoverage.every(value => Math.abs(value - 1) < .0001),
      { resolvedRange: slatRange, minifiedMeanError: slatMeanError, minifiedCoverage: [Math.min(...minifiedCoverage), Math.max(...minifiedCoverage)] });
    setAttribute('paneDetail', [0, .5, .5, .5]); setAttribute('paneRoom', [0, 3, 1, 2]);

    const finishes = [];
    for (const key of ['stone', 'wood', 'arcadePaving', 'soffit']) {
      const source = glassSources[key], finish = patternFactory.convert(source, mesh);
      finish.outputNode = vec4(diffuseColor.rgb, roughness);
      await draw(finish, 0);
      const reflectance = source.color.toArray(), ratios = rgb(pixels).map((value, index) => value / reflectance[index % 3]);
      const roughnessValues = Array.from(pixels).filter((_, index) => index % 4 === 3);
      finishes.push({ name: source.name, minRatio: Math.min(...ratios), maxRatio: Math.max(...ratios),
        minRoughness: Math.min(...roughnessValues), maxRoughness: Math.max(...roughnessValues) });
    }
    check('construction-aligned mineral and timber finishes retain bounded reflectance and roughness',
      finishes.every(entry => entry.minRatio > .84 && entry.maxRatio < 1.16 && entry.maxRatio - entry.minRatio > .002
        && entry.minRoughness >= .18 && entry.maxRoughness <= .98), { actual: finishes });

    const paletteSource = foliageMaterial({ bend: 0 }), paletteGeometry = new PlaneGeometry(.7, .7);
    const paletteMesh = new InstancedMesh(paletteGeometry, paletteSource, 4);
    const colors = [[.04, .12, .025], [.12, .28, .065], [.08, .2, .045], [.2, .36, .085]];
    colors.forEach((rgb, index) => {
      paletteMesh.setColorAt(index, new Color(...rgb));
      paletteMesh.setMatrixAt(index, new Matrix4().makeTranslation(index % 2 ? .5 : -.5, index < 2 ? -.5 : .5, 0));
    });
    const colorBytes = paletteMesh.instanceColor.array.slice(), paletteMaterial = full.convert(paletteSource, paletteMesh);
    paletteMaterial.outputNode = vec4(diffuseColor.rgb, 1); paletteMesh.material = paletteMaterial;
    resources.push(paletteSource, paletteGeometry, paletteMesh); scene.remove(mesh); scene.add(paletteMesh);
    await draw(paletteMaterial, 0);
    const colorPixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size), rendered = [];
    for (const y of [16, 48]) for (const x of [16, 48]) rendered.push(Array.from(colorPixels.slice((y * size + x) * 4, (y * size + x) * 4 + 3)));
    const average = values => [0, 1, 2].map(channel => values.reduce((sum, rgb) => sum + rgb[channel], 0) / values.length);
    const variance = values => { const mean = average(values); return average(values.map(rgb => rgb.map((v, c) => (v - mean[c]) ** 2))); };
    const originalVariance = variance(colors), varianceRatio = variance(rendered).map((value, channel) => value / originalVariance[channel]);
    check('rendered leaf palette preserves RGB mean while moderately reducing per-leaf variance',
      maximumError(average(rendered), average(colors)) < .00005 && varianceRatio.every(value => value > .60 && value < .75)
      && colorBytes.every((value, index) => value === paletteMesh.instanceColor.array[index]),
      { actual: rendered, expectedMean: average(colors), actualMean: average(rendered), varianceRatio });
    scene.remove(paletteMesh); scene.add(mesh);
    const glassFactory = createCampusMaterials(); factories.push(glassFactory);
    const glass = glassFactory.convert(glassSources.glass, mesh);
    // outputNode runs after the actual PBR setupVariants; fragmentNode would bypass it.
    glass.outputNode = vec4(roughness, getGeometryRoughness(), glass.roughnessNode, 1);
    const roughnessSamples = [];
    for (const detail of [0, .5, 1]) {
      const attribute = geometry.getAttribute('paneDetail');
      for (let index = 0; index < attribute.count; index++) attribute.setX(index, detail);
      attribute.needsUpdate = true;
      roughnessSamples.push({ detail, pixel: await draw(glass) });
    }
    const expectedRoughness = [.038, .04, .044];
    check('glass uses the .038 floor and preserves variation below .0525', roughnessSamples.every((sample, index) =>
      Math.abs(sample.pixel[0] - expectedRoughness[index]) < .0001 && Math.abs(sample.pixel[1]) < .0001), { actual: roughnessSamples, expected: expectedRoughness });
    const normals = geometry.getAttribute('normal'), positions = geometry.getAttribute('position');
    for (let index = 0; index < normals.count; index++) normals.setXYZ(index, positions.getX(index) * .6, 0, .8);
    normals.needsUpdate = true;
    const filtered = await draw(glass);
    check('glass retains geometric-normal derivative roughness', filtered[1] > .005
      && Math.abs(filtered[0] - (Math.max(.038, filtered[2]) + filtered[1])) < .0001, { actual: filtered, channels: ['roughness', 'geometryRoughness', 'surfaceRoughness'] });
    report.passed = report.tests.every(test => test.passed);
    return report;
  } finally {
    renderer.setRenderTarget(previous.target); renderer.setMRT(previous.mrt);
    renderer.toneMapping = previous.toneMapping; renderer.outputColorSpace = previous.outputColorSpace; renderer.autoClear = previous.autoClear;
    renderer.shadowMap.enabled = previous.shadows;
    for (const factory of factories) factory.dispose();
    for (const resource of resources.reverse()) resource.dispose();
    pmrem.dispose();
  }
}
