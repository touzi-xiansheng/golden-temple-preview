import {
  BufferAttribute, Color, FloatType, LinearSRGBColorSpace, Mesh,
  NoToneMapping, OrthographicCamera, PlaneGeometry, PMREMGenerator, RenderTarget, Scene,
} from 'three/webgpu';
import { getGeometryRoughness, roughness, vec4 } from 'three/tsl';
import { buildingMaterials } from '../campus/building-materials.js';
import { foliageMaterial } from '../campus/foliage-material.js';
import { createCampusMaterials } from './materials.js';
import { applyCampusLighting, createIrradianceNode } from './lighting.js';

const maximumError = (actual, expected) => Math.max(...actual.map((value, index) => Math.abs(value - expected[index])));

// Uses the production materials and GPU fragment outputs, with no sun or tone mapping.
// The caller owns the initialized renderer and decides when this check may run.
export async function runMaterialCalibration(renderer) {
  if (renderer?.backend?.isWebGPUBackend !== true) throw new Error('Material calibration requires an initialized WebGPU renderer');
  const previous = {
    target: renderer.getRenderTarget(), toneMapping: renderer.toneMapping,
    outputColorSpace: renderer.outputColorSpace, mrt: renderer.getMRT(), autoClear: renderer.autoClear,
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
  const draw = async (material, strength = 1) => {
    mesh.material = material; scene.environmentIntensity = strength;
    renderer.setRenderTarget(target); renderer.render(scene, camera);
    const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, size, size);
    const result = [0, 0, 0];
    for (let y = 30; y < 34; y++) for (let x = 30; x < 34; x++) {
      for (let channel = 0; channel < 3; channel++) result[channel] += pixels[(y * size + x) * 4 + channel] / 16;
    }
    return result;
  };
  try {
    renderer.setMRT(null); renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = LinearSRGBColorSpace; renderer.autoClear = true;
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

    const glassSources = buildingMaterials();
    for (const value of new Set(Object.values(glassSources).flat().filter(value => value?.isMaterial))) resources.push(value);
    const setAttribute = (name, values) => geometry.setAttribute(name, new BufferAttribute(new Float32Array(Array.from({ length: 4 }, () => values).flat()), values.length));
    setAttribute('paneDetail', [0, .5, .5, .5]); setAttribute('paneSize', [2, 2]);
    setAttribute('paneRoom', [0, 3, 1, 2]); setAttribute('paneType', [0]);
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
    for (const factory of factories) factory.dispose();
    for (const resource of resources.reverse()) resource.dispose();
    pmrem.dispose();
  }
}
