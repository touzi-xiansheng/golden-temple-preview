import {
  Color, CubeCamera, CubeRenderTarget, DirectionalLight, EnvironmentNode, HalfFloatType,
  PMREMGenerator, Scene, Vector3,
} from 'three/webgpu';
import {
  array, cameraPosition, cubeTexture, float, Fn, fog, getShIrradianceAt,
  If, isolate, max, min, mix, normalWorld, pmremTexture,
  positionWorld, positionView, texture3D, uniform, vec3, vec4,
} from 'three/tsl';
import { SkyMesh } from 'three/addons/objects/SkyMesh.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SunLightNode } from 'three/addons/lights/SunLightNode.js';
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
import { createStaticShadows } from './static-shadows.js';

const SUN_DIRECTION = new Vector3(0.35, 0.72, 0.66843).normalize();
const SHADOW_SIZES = { performance: 1024, balanced: 4096, quality: 4096 };
// One daylight scale is captured by the sky, diffuse probes and local reflections.
export const DAYLIGHT = Object.freeze({ sunIntensity: 5.6, skyIntensity: .4, skySaturation: .65, fogDensity: .00048, fogStart: 95 });
// A captured material reflection must not change the scale of diffuse sky/probe light.
export const campusDiffuseIntensity = uniform(1).onRenderUpdate(({ scene }) => scene.environmentIntensity);
// Same representative soil/grass reflectance as the probe capture ground.
export const GROUND_ALBEDO = new Color('#54643b');
const bindings = new WeakMap();

function validateProbe(bounds, resolution, blendDistance) {
  if (!bounds?.isBox3 || bounds.isEmpty() ||
      ![...bounds.min, ...bounds.max].every(Number.isFinite) ||
      bounds.getSize(new Vector3()).toArray().some(size => size <= 0)) {
    throw new TypeError('Probe bounds must be a finite, non-empty Box3 with positive dimensions');
  }
  if (!Array.isArray(resolution) || resolution.length !== 3 ||
      resolution.some(value => !Number.isInteger(value) || value < 2 || value > 64)) {
    throw new RangeError('Probe resolution must contain three integers in [2, 64]');
  }
  const fade = blendDistance?.isVector3 ? blendDistance.toArray() : Array.isArray(blendDistance) ? blendDistance : [blendDistance];
  if (![1, 3].includes(fade.length) || fade.some(value => !Number.isFinite(value) || value <= 0)) {
    throw new RangeError('Probe blendDistance must be positive');
  }
}

// r186's seven RGBA sub-volumes contain nine RGB SH coefficients, with Z padding.
function sampleProbe(probe, position, normal) {
  const { grid } = probe;
  const low = uniform(grid.boundingBox.min), high = uniform(grid.boundingBox.max);
  const resolution = uniform(grid.resolution), range = high.sub(low);
  const spacing = range.div(resolution.sub(1));
  const offset = spacing.mul(0.1).min(vec3(0.2));
  const uvw = position.add(normal.mul(offset)).sub(low).div(range).clamp(0, 1)
    .mul(resolution.sub(1)).add(0.5).div(resolution);
  const paddedDepth = resolution.z.add(2);
  const z = uvw.z.mul(resolution.z).add(1);
  const atlas = texture3D(grid.texture);
  const slices = Array.from({ length: 7 }, (_, index) =>
    atlas.sample(vec3(uvw.xy, z.add(paddedDepth.mul(index)).div(paddedDepth.mul(7)))).level(0));
  const [a, b, c, d, e, f, g] = slices;
  const sh = array([
    a.xyz, vec3(a.w, b.xy), vec3(b.zw, c.x), c.yzw, d.xyz,
    vec3(d.w, e.xy), vec3(e.zw, f.x), f.yzw, g.xyz,
  ]);
  return getShIrradianceAt(normal, sh).max(vec3(0));
}

function blendProbeGroup(base, probes, position, normal) {
  if (!probes.length) return base;
  return Fn(() => {
    const total = float(0).toVar(), coverage = float(0).toVar(), sum = vec3(0).toVar();
    for (const probe of probes) {
      const inside = position.sub(uniform(probe.bounds.min)).min(uniform(probe.bounds.max).sub(position));
      const fade = probe.blendDistance?.isVector3 ? probe.blendDistance
        : Array.isArray(probe.blendDistance) ? new Vector3(...probe.blendDistance) : new Vector3().setScalar(probe.blendDistance);
      const distance = inside.div(uniform(fade));
      const weight = min(distance.x, min(distance.y, distance.z)).smoothstep(0, 1).mul(probe.strength).toVar();
      If(weight.greaterThan(0), () => {
        total.addAssign(weight);
        coverage.assign(max(coverage, weight));
        sum.addAssign(sampleProbe(probe, position, normal).mul(weight));
      });
    }
    // Max coverage makes duplicating an identical volume invariant, including its fade edge.
    return mix(base, sum.div(total.max(1e-6)), coverage.clamp(0, 1));
  })();
}

export function createIrradianceNode({ skyTexture, probes = [], position = positionWorld, normal = normalWorld }) {
  if (!skyTexture?.isTexture) throw new TypeError('A generated sky texture is required');
  const sky = pmremTexture(skyTexture, normal, float(1)).mul(Math.PI);
  const ready = probes.filter(probe => probe.ready && probe.grid.texture);
  const base = blendProbeGroup(sky, ready.filter(probe => probe.kind === 'base'), position, normal);
  return blendProbeGroup(base, ready.filter(probe => probe.kind === 'local'), position, normal);
}

export function createGroundRadianceNode({ skyTexture, sunDirection, sunColor, sunIntensity, groundAlbedo = GROUND_ALBEDO }) {
  const sky = createIrradianceNode({ skyTexture, normal: vec3(0, 1, 0) });
  const direct = sunColor.clone().multiplyScalar(sunIntensity * Math.max(0, sunDirection.y));
  // Reference capture uses unit sky intensity; the existing scene intensity applies once at shading.
  return sky.add(uniform(direct)).mul(uniform(groundAlbedo.clone())).div(Math.PI);
}

class CampusEnvironmentNode extends EnvironmentNode {
  static get type() { return 'CampusEnvironmentNode'; }
  constructor(environmentNode, options) {
    super(environmentNode);
    this.options = options;
  }
  setup(builder) {
    super.setup(builder);
    // Preserve native radiance/clearcoat and its BRDF; replace the ONE diffuse IBL source.
    builder.context.iblIrradiance.assign(isolate(createIrradianceNode(this.options).mul(campusDiffuseIntensity)));
  }
}

export function createCampusEnvironmentNode(environmentNode, options) {
  return new CampusEnvironmentNode(environmentNode, options);
}

export function applyCampusLighting(material, lighting, { probes = null } = {}) {
  if (!material?.isMeshStandardNodeMaterial) {
    throw new TypeError('Campus lighting requires a standard or physical node material');
  }
  const existing = bindings.get(material);
  if (existing?.lighting === lighting) return material;
  if (existing) throw new Error('Material is already attached to another lighting owner');
  const original = material.setupEnvironment, originalCacheKey = material.customProgramCacheKey;
  material.setupEnvironment = function(builder) {
    const environment = original.call(this, builder);
    if (!environment?.envNode) throw new Error('Campus materials require an environment texture');
    return createCampusEnvironmentNode(environment.envNode, {
      skyTexture: lighting.environment.texture,
      probes: probes || lighting.probes,
    });
  };
  material.customProgramCacheKey = function() {
    const selected = (probes || lighting.probes).filter(probe => probe.ready && probe.grid.texture);
    const layout = selected.map(probe => [probe.grid.texture.uuid, probe.kind, probe.blendDistance,
      ...probe.bounds.min, ...probe.bounds.max].join(',')).join('|');
    return `${originalCacheKey.call(this)}:campus-lighting:${lighting.environment?.texture.uuid || 'pending'}:${layout}`;
  };
  bindings.set(material, { original, originalCacheKey, lighting });
  lighting.materials.add(material);
  material.needsUpdate = true;
  return material;
}

export function createLighting({ renderer, scene, camera, quality = 'balanced', cacheShadows = false, groundBounce = true }) {
  if (!renderer?.isWebGPURenderer || !scene?.isScene || !camera?.isCamera) {
    throw new TypeError('createLighting requires a WebGPURenderer, Scene and Camera');
  }
  if (!Object.hasOwn(SHADOW_SIZES, quality)) throw new RangeError('Unknown lighting quality');
  const previous = {
    background: scene.background, environment: scene.environment,
    backgroundIntensity: scene.backgroundIntensity, environmentIntensity: scene.environmentIntensity,
    fogNode: scene.fogNode,
  };
  const sun = cacheShadows ? new DirectionalLight(new Color(1, 0.97, 0.91), DAYLIGHT.sunIntensity) : new SunLight(new Color(1, 0.97, 0.91), DAYLIGHT.sunIntensity);
  sun.name = 'Campus WebGPU sun';
  sun.position.copy(SUN_DIRECTION);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(SHADOW_SIZES[quality]);
  sun.shadow.camera.far = Math.min(camera.far, 350);
  sun.shadow.bias = -0.0001;
  sun.shadow.normalBias = 0.025;
  sun.shadow.autoUpdate = true;
  const staticShadows = cacheShadows ? createStaticShadows(sun,scene,SUN_DIRECTION) : null;
  const materials = new Set(), probes = [], bakeScenes = new Set();
  const stats = { ready: false, skyMs: 0, probeBakeMs: 0, probes: 0, cubeViews: 0, baking: false, quality, groundBounce, groundAlbedo: GROUND_ALBEDO.toArray(), shadowMode:cacheShadows?'cached':'cascades', shadowCache:staticShadows?.stats };
  let disposed = false, environment = null, background = null, captureBackground = null, haze = null;

  const lighting = {
    sun, materials, probes, stats,
    sunDirectionNode: uniform(SUN_DIRECTION.clone()),
    sunColorNode: uniform(sun.color.clone().multiplyScalar(sun.intensity)),
    get environment() { return environment; },
    get background() { return background; },
    get captureBackground() { return captureBackground; },
    update(_camera,{shot=-1}={}) { staticShadows?.update(shot); },
    setQuality(value) {
      if (!Object.hasOwn(SHADOW_SIZES, value)) throw new RangeError('Unknown lighting quality');
      if (disposed) throw new Error('Lighting is disposed');
      const size = SHADOW_SIZES[value], shadow = sun.shadow;
      if (shadow.mapSize.x !== size) {
        shadow.mapSize.setScalar(size);
        const extents = shadow.getFrameExtents();
        // setSize disposes GPU storage while preserving the target retained by SunShadowNode.
        shadow.map?.setSize(size * extents.x, size * extents.y);
        shadow.needsUpdate = true;
        staticShadows?.update(staticShadows.shot,true);
      }
      stats.quality = value;
    },
    sampleIrradiance({ normal = normalWorld, position = positionWorld, probes: selected = probes } = {}) {
      if (!environment || disposed) throw new Error('Await lighting.ready before sampling irradiance');
      return createIrradianceNode({ skyTexture: environment.texture, probes: selected, position, normal });
    },
    createBakeScene() {
      if (!stats.ready || disposed) throw new Error('Await lighting.ready before creating a bake scene');
      const result = new Scene();
      result.background = captureBackground.texture;
      result.environment = environment.texture;
      const captureSun = sun.clone();
      if(cacheShadows){captureSun.shadow.autoUpdate=false;captureSun.shadow.needsUpdate=true;}
      result.add(captureSun);if(captureSun.target)result.add(captureSun.target);
      bakeScenes.add({ scene: result, sun: captureSun });
      return result;
    },
    releaseBakeScene(captureScene) {
      for (const entry of bakeScenes) {
        if (entry.scene !== captureScene) continue;
        bakeScenes.delete(entry);
        entry.sun.target?.removeFromParent();
        entry.sun.removeFromParent();
        entry.sun.dispose();
        return true;
      }
      return false;
    },
    async bakeProbe({ bounds, coverageBounds = bounds, resolution = [3, 3, 3], scene: captureScene, kind = 'base', blendDistance = 1, batchSize = 12, onProgress = () => {} }) {
      validateProbe(bounds, resolution, blendDistance);
      validateProbe(coverageBounds, resolution, blendDistance);
      if (!['base', 'local'].includes(kind)) throw new TypeError('Probe kind must be base or local');
      if (!Number.isInteger(batchSize) || batchSize < 1) throw new RangeError('Probe batchSize must be positive');
      if (!captureScene?.isScene || captureScene === scene) throw new Error('Probe capture requires a separate static scene');
      await lighting.ready;
      if (disposed || stats.baking) throw new Error(disposed ? 'Lighting is disposed' : 'A probe bake is already running');
      let hasFeedback = false;
      captureScene.traverse(object => {
        const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
        if (object.isLightProbeGrid || objectMaterials.some(material => bindings.has(material))) hasFeedback = true;
      });
      if (hasFeedback) throw new Error('Probe capture scene must not contain probe lights or probe-bound materials');
      const size = bounds.getSize(new Vector3());
      const grid = new LightProbeGrid(size.x, size.y, size.z, ...resolution);
      grid.position.copy(bounds.getCenter(new Vector3()));
      grid.updateBoundingBox();
      const probe = { grid, bounds: coverageBounds.clone(), kind, blendDistance, strength: uniform(1), ready: false };
      const count = resolution.reduce((a, b) => a * b, 1), started = performance.now();
      stats.baking = true;
      try {
        for (let start = 0; start < count; start += batchSize) {
          if (disposed) throw new Error('Lighting disposed during probe capture');
          const batch = Math.min(batchSize, count - start);
          grid.bake(renderer, captureScene, { cubemapSize: 8, sampleCount: 256, near: 0.05, far: 650, start, count: batch, bounces: 0 });
          onProgress((start + batch) / count);
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        if (disposed) throw new Error('Lighting disposed during probe capture');
        probe.ready = true;
        probes.push(probe);
        for (const material of materials) material.needsUpdate = true;
        stats.probes += count;
        stats.cubeViews += count * 6;
        stats.probeBakeMs += performance.now() - started;
        return probe;
      } catch (error) {
        grid.dispose();
        throw error;
      } finally {
        stats.baking = false;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const material of materials) {
        const binding = bindings.get(material);
        material.setupEnvironment = binding.original;
        material.customProgramCacheKey = binding.originalCacheKey;
        material.needsUpdate = true;
        bindings.delete(material);
      }
      materials.clear();
      for (const probe of probes) probe.grid.dispose();
      probes.length = 0;
      for (const entry of bakeScenes) { entry.sun.target?.removeFromParent(); entry.sun.removeFromParent(); entry.sun.dispose(); }
      bakeScenes.clear();
      sun.target?.removeFromParent(); sun.removeFromParent(); sun.dispose();
      if (background && scene.background === background.texture) {
        scene.background = previous.background;
        scene.backgroundIntensity = previous.backgroundIntensity;
      }
      if (environment && scene.environment === environment.texture) {
        scene.environment = previous.environment;
        scene.environmentIntensity = previous.environmentIntensity;
      }
      if (haze && scene.fogNode === haze) scene.fogNode = previous.fogNode;
      environment?.dispose(); background?.dispose(); captureBackground?.dispose();
      stats.ready = false;
    },
  };

  lighting.ready = (async () => {
    await renderer.init();
    if (disposed) throw new Error('Lighting disposed during initialization');
    if (renderer.backend?.isWebGPUBackend !== true) throw new Error('Campus lighting requires a real WebGPU backend');
    const started = performance.now();
    if (renderer.library.getLightNodeClass(SunLight) === null) renderer.library.addLight(SunLightNode, SunLight);
    renderer.shadowMap.enabled = true;
    const sky = new SkyMesh();
    sky.scale.setScalar(10000);
    sky.sunPosition.value.copy(SUN_DIRECTION).multiplyScalar(450000);
    sky.turbidity.value = 2.5;
    sky.rayleigh.value = 1.3;
    sky.cloudSpeed.value = 0;
    sky.cloudCoverage.value = 0.2;
    sky.cloudDensity.value = 0.25;
    const skyRadiance = sky.material.colorNode.rgb;
    const skyLuminance = skyRadiance.dot(vec3(.2126, .7152, .0722));
    sky.material.colorNode = vec4(mix(vec3(skyLuminance), skyRadiance, DAYLIGHT.skySaturation).mul(DAYLIGHT.skyIntensity), 1);
    const capture = new Scene(); capture.add(sky);
    const pmrem = new PMREMGenerator(renderer);
    try {
      background = new CubeRenderTarget(quality === 'performance' ? 128 : 256, { type: HalfFloatType });
      captureBackground = new CubeRenderTarget(128, { type: HalfFloatType });
      new CubeCamera(0.1, 20000, background).update(renderer, capture);
      sky.showSunDisc.value = 0;
      new CubeCamera(0.1, 20000, captureBackground).update(renderer, capture);
      environment = pmrem.fromCubemap(captureBackground.texture);
      if (groundBounce) {
        const skyEnvironment = environment;
        const groundedCube = new CubeRenderTarget(128, { type: HalfFloatType });
        try {
          const ground = createGroundRadianceNode({ skyTexture: skyEnvironment.texture,
            sunDirection: SUN_DIRECTION, sunColor: sun.color, sunIntensity: sun.intensity });
          const direction = positionWorld.sub(cameraPosition).normalize();
          // SkyMesh extends its bright horizon below ground. Replace that hemisphere for IBL only.
          // shortcut: one grass/soil bounce represents distant ground; local probes retain actual occlusion.
          sky.material.colorNode = vec4(mix(ground, sky.material.colorNode.rgb, direction.y.smoothstep(-0.01, 0.01)), 1);
          sky.material.needsUpdate = true;
          new CubeCamera(0.1, 20000, groundedCube).update(renderer, capture);
          environment = pmrem.fromCubemap(groundedCube.texture);
        } finally {
          groundedCube.dispose();
          if (environment !== skyEnvironment) skyEnvironment.dispose();
        }
      }
      scene.background = background.texture;
      scene.environment = environment.texture;
      scene.backgroundIntensity = 1;
      scene.environmentIntensity = 1;
      // Match directional sky haze without projecting the solar disc through opaque buildings.
      const hazeDistance = positionView.z.negate().sub(DAYLIGHT.fogStart).max(0);
      const hazeAmount = hazeDistance.mul(DAYLIGHT.fogDensity).pow(2).negate().exp().oneMinus();
      haze = fog(cubeTexture(captureBackground.texture, positionWorld.sub(cameraPosition).normalize()), hazeAmount);
      scene.fogNode = haze;
      scene.add(sun);if(sun.target)scene.add(sun.target);
      stats.skyMs = performance.now() - started;
      stats.ready = true;
      return lighting;
    } catch (error) {
      lighting.dispose();
      throw error;
    } finally {
      pmrem.dispose(); sky.geometry.dispose(); sky.material.dispose();
    }
  })();
  return lighting;
}
