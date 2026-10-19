import {
  Color, FloatType, LinearSRGBColorSpace, Mesh, MeshStandardNodeMaterial,
  NodeMaterial, NoToneMapping, OrthographicCamera, PlaneGeometry,
  QuadMesh, RenderTarget, Scene, Vector3,
} from 'three/webgpu';
import { vec3, vec4 } from 'three/tsl';
import { createIrradianceNode, DAYLIGHT } from './lighting.js';

const luma = rgb => rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;

// Diagnostic only: inspect linear HDR before the application's tone mapping or display transform.
export async function diagnoseCampusLighting(campus = window.__campus) {
  const { renderer, lighting } = campus || {};
  if (!lighting?.stats.ready || renderer?.backend.isWebGPUBackend !== true) {
    throw new Error('The campus must be ready on a real WebGPU backend');
  }
  const target = new RenderTarget(8, 8, { type: FloatType });
  target.texture.colorSpace = LinearSRGBColorSpace;
  const shader = new NodeMaterial(); shader.toneMapped = false;
  const quad = new QuadMesh(shader);
  const geometry = new PlaneGeometry(2, 2);
  const material = new MeshStandardNodeMaterial({ color: new Color(0.18, 0.18, 0.18), roughness: 1, metalness: 0 });
  material.toneMapped = false;
  const mesh = new Mesh(geometry, material);
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  const sun = lighting.sun.clone(); sun.castShadow = false;
  sun.position.copy(lighting.sun.getWorldPosition(new Vector3()));
  if (sun.target) sun.target.position.copy(lighting.sun.target.getWorldPosition(new Vector3()));
  const normalAxis = new Vector3(0, 0, 1);
  const sunDirection = sun.position.clone();
  if (sun.target) sunDirection.sub(sun.target.position);
  sunDirection.normalize();
  const report = {
    backend: 'WebGPU', pipelineToneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    sun: { intensity: lighting.sun.intensity, color: lighting.sun.color.toArray(), direction: sunDirection.toArray() },
    environmentIntensity: campus.scene.environmentIntensity,
    groundBounce: lighting.stats.groundBounce,
    groundAlbedo: lighting.stats.groundAlbedo,
    hasFogNode: !!campus.scene.fogNode,
    fogFactor: Object.fromEntries([10, 30, 100, 300, 1000].map(distance => [distance, 1 - Math.exp(-Math.pow(DAYLIGHT.fogDensity * Math.max(0, distance - DAYLIGHT.fogStart), 2))])),
    samples: [],
  };

  async function measure(draw) {
    const previousTarget = renderer.getRenderTarget(), previousMapping = renderer.toneMapping;
    let readback;
    try {
      renderer.toneMapping = NoToneMapping;
      renderer.setRenderTarget(target);
      draw();
      readback = renderer.readRenderTargetPixelsAsync(target, 4, 4, 1, 1);
    } finally {
      // The main requestAnimationFrame loop may run while readback is awaited.
      renderer.setRenderTarget(previousTarget);
      renderer.toneMapping = previousMapping;
    }
    return Array.from((await readback).slice(0, 3));
  }
  async function grayCard(normal, direct, environment) {
    const scene = new Scene(); scene.environment = environment ? lighting.environment.texture : null;
    scene.environmentIntensity = campus.scene.environmentIntensity;
    if (direct) { scene.add(sun); if (sun.target) scene.add(sun.target); }
    mesh.quaternion.setFromUnitVectors(normalAxis, normal);
    scene.add(mesh);
    camera.up.set(0, 1, 0);
    if (Math.abs(normal.y) > 0.99) camera.up.set(0, 0, -1);
    camera.position.copy(normal).multiplyScalar(3);
    camera.lookAt(0, 0, 0); camera.updateMatrixWorld();
    try { return await measure(() => renderer.render(scene, camera)); }
    finally { scene.remove(mesh, sun); sun.target?.removeFromParent(); }
  }

  try {
    const normals = [
      ['up', [0, 1, 0]], ['down', [0, -1, 0]], ['south', [0, 0, 1]], ['north', [0, 0, -1]],
      ['east', [1, 0, 0]], ['west', [-1, 0, 0]], ['toward-sun', sunDirection.toArray()],
    ];
    for (const [name, components] of normals) {
      const normal = new Vector3(...components);
      shader.fragmentNode = vec4(createIrradianceNode({
        skyTexture: lighting.environment.texture, probes: [], normal: vec3(...components), position: vec3(0),
      }), 1);
      shader.needsUpdate = true;
      const skyIrradiance = await measure(() => quad.render(renderer));
      const effectiveEnvironmentIrradiance = skyIrradiance.map(value => value * campus.scene.environmentIntensity);
      const cosTheta = Math.max(0, normal.dot(sunDirection));
      const directIrradiance = lighting.sun.color.clone().multiplyScalar(lighting.sun.intensity * cosTheta).toArray();
      const direct = await grayCard(normal, true, false);
      const indirect = await grayCard(normal, false, true);
      const combined = await grayCard(normal, true, true);
      const sum = direct.map((value, index) => value + indirect[index]);
      const linearityError = Math.max(...combined.map((value, index) => Math.abs(value - sum[index]) / Math.max(sum[index], 0.001)));
      report.samples.push({ name, skyIrradiance, effectiveEnvironmentIrradiance, directIrradiance,
        directToSky: luma(directIrradiance) / Math.max(luma(effectiveEnvironmentIrradiance), 1e-6),
        gray18: { direct, indirect, combined, linearityError },
      });
    }
    const up = report.samples.find(sample => sample.name === 'up');
    report.checks = {
      linearLightSuperposition: report.samples.every(sample => sample.gray18.linearityError < 0.01),
      sunnyHorizontalDirectExceedsSky: up.directToSky > 1,
      finiteReadback: report.samples.every(sample => [...sample.skyIrradiance, ...sample.gray18.combined].every(Number.isFinite)),
    };
    report.note = 'sunnyHorizontalDirectExceedsSky is a diagnostic for the intended clear-sun scene, not a universal physical law; no exposure or light setting was changed.';
    return report;
  } finally {
    target.dispose(); shader.dispose(); geometry.dispose(); material.dispose(); sun.dispose();
  }
}
