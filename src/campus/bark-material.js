import * as THREE from 'three';
import { rng } from '../core/rng.js';
import { finishBuild } from './loading.js';

// One seamless tile covers metres, not a fixed fraction of every branch circumference.
export const BARK_TILE = { width: 0.6, height: 1.3 };

function periodicNoise(random, width, height) {
  const values = Float32Array.from({ length: width * height }, () => random.next());
  const at = (x, y) => values[((y % height + height) % height) * width + (x % width + width) % width];
  return (u, v) => {
    const x = u * width, y = v * height, ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(ix, iy), b = at(ix + 1, iy), c = at(ix, iy + 1), d = at(ix + 1, iy + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function barkCells(random, width, height) {
  const points = Float32Array.from({ length: width * height * 3 }, () => random.float(0.15, 0.85));
  return (u, v, result) => {
    const x = u * width, y = v * height, ix = Math.floor(x), iy = Math.floor(y);
    let first = Infinity, second = Infinity, id = 0, ax = 0, ay = 0, bx = 0, by = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy;
      const index = (((cy % height + height) % height) * width + (cx % width + width) % width) * 3;
      const px = cx + points[index] - x, py = cy + points[index + 1] - y, distance = px * px + py * py;
      if (distance < first) { second = first; bx = ax; by = ay; first = distance; ax = px; ay = py; id = points[index + 2]; }
      else if (distance < second) { second = distance; bx = px; by = py; }
    }
    result[0] = Math.sqrt(first); result[1] = Math.sqrt(second) - result[0]; result[2] = id;
    result[3] = Math.abs(ax - bx) / Math.hypot(ax - bx, ay - by);
  };
}

export function createBarkMaterial() {
  return finishBuild(createBarkMaterialSteps());
}

export function* createBarkMaterialSteps() {
  const random = rng('campus-fissured-bark'), size = 1024, smooth = THREE.MathUtils.smoothstep;
  const broad = periodicNoise(random, 4, 4), mottled = periodicNoise(random, 13, 17);
  const warp = periodicNoise(random, 9, 13), grain = periodicNoise(random, 175, 53), fine = periodicNoise(random, 341, 313);
  const plates = barkCells(random, 23, 7), flakes = barkCells(random, 58, 19);
  const main = new Float32Array(4), sub = new Float32Array(4), heights = new Float32Array(size * size);
  const albedo = new Uint8Array(size * size * 4), normals = new Uint8Array(albedo.length), roughness = new Uint8Array(albedo.length);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size, large = broad(u, v), patch = mottled(u, v);
      // Warped elongated cells meet in irregular branching fissures; the second scale flakes inside them.
      const wu = u + (warp(u, v) - 0.5) * 0.018 + (grain(u, v) - 0.5) * 0.003;
      const wv = v + (broad(u + 0.31, v + 0.19) - 0.5) * 0.036;
      plates(wu, wv, main); flakes(wu, wv, sub);
      // Crosswise edges stay shallow: broadleaf bark splits chiefly along its grain, unlike cracked mud.
      const crack = (1 - smooth(main[1], 0.012, 0.075 + patch * 0.035)) * (0.16 + 0.84 * smooth(main[3], 0.25, 0.85));
      const hairline = (1 - smooth(sub[1], 0.012, 0.065)) * smooth(patch, 0.28, 0.75) * (1 - crack) * (0.2 + sub[3] * 0.8);
      const fibers = grain(u, v), pores = fine(u, v), dome = 1 - smooth(main[0], 0.12, 0.72);
      const lichen = smooth(mottled(u + 0.23, v + 0.41) * 0.7 + pores * 0.3, 0.68, 0.83) * (1 - crack);
      const index = y * size + x, offset = index * 4;
      heights[index] = (1 - crack) * (0.0016 + main[2] * 0.0012 + dome * 0.0007)
        - hairline * 0.0008 + (fibers - 0.5) * 0.00035 + (pores - 0.5) * 0.00015;
      // Albedo is sRGB; height and roughness remain linear data, never inferred from bark colour.
      const plate = 0.81 + large * 0.20 + main[2] * 0.21 + (fibers - 0.5) * 0.16 + (pores - 0.5) * 0.07;
      const shade = 1 - crack * 0.38 - hairline * 0.11;
      albedo[offset] = THREE.MathUtils.lerp(101 * plate * shade, 127, lichen * 0.43);
      albedo[offset + 1] = THREE.MathUtils.lerp(91 * plate * shade, 129, lichen * 0.43);
      albedo[offset + 2] = THREE.MathUtils.lerp(76 * plate * shade, 106, lichen * 0.43);
      albedo[offset + 3] = 255;
      roughness[offset] = roughness[offset + 1] = roughness[offset + 2] = Math.round(255 * (0.83 + crack * 0.13 + pores * 0.035));
      roughness[offset + 3] = 255;
    }
    if ((y + 1) % 16 === 0) yield '正在生成树皮纹理…';
  }
  // Centred, wrapped differences give a tangent-space normal with physical millimetre relief.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const left = heights[y * size + (x + size - 1) % size], right = heights[y * size + (x + 1) % size];
      const below = heights[((y + size - 1) % size) * size + x], above = heights[((y + 1) % size) * size + x];
      const nx = -(right - left) * size / (2 * BARK_TILE.width), ny = -(above - below) * size / (2 * BARK_TILE.height);
      const length = Math.hypot(nx, ny, 1), offset = (y * size + x) * 4;
      normals[offset] = Math.round((nx / length * 0.5 + 0.5) * 255);
      normals[offset + 1] = Math.round((ny / length * 0.5 + 0.5) * 255);
      normals[offset + 2] = Math.round((1 / length * 0.5 + 0.5) * 255); normals[offset + 3] = 255;
    }
    if ((y + 1) % 16 === 0) yield '正在生成树皮纹理…';
  }
  function texture(data, srgb = false) {
    const map = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    map.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    map.wrapS = map.wrapT = THREE.RepeatWrapping;
    map.magFilter = THREE.LinearFilter; map.minFilter = THREE.LinearMipmapLinearFilter;
    map.generateMipmaps = true; map.anisotropy = 4; map.needsUpdate = true;
    return map;
  }
  const material = new THREE.MeshStandardMaterial({
    map: texture(albedo, true), normalMap: texture(normals), normalScale: new THREE.Vector2(0.8, 0.8),
    roughnessMap: texture(roughness), roughness: 1, envMapIntensity: 0.35,
  });
  material.name = 'campus-fissured-bark';
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float barkMaturity; varying float vBarkMaturity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBarkMaturity = barkMaturity;')
      .replace('#include <uv_vertex>', `#include <uv_vertex>
        #ifdef USE_INSTANCING
          vec2 barkRepeats = vec2(max(1.0, floor(6.283185 * length(instanceMatrix[0].xyz) / ${BARK_TILE.width} + 0.5)), length(instanceMatrix[1].xyz) / ${BARK_TILE.height});
          vMapUv *= barkRepeats; vNormalMapUv *= barkRepeats; vRoughnessMapUv *= barkRepeats;
        #endif`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vBarkMaturity;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = mix(vec3(0.075, 0.055, 0.034), diffuseColor.rgb, 0.35 + 0.65 * vBarkMaturity);`)
      .replace('#include <normal_fragment_maps>', `vec3 barkSmoothNormal = normal;
        #include <normal_fragment_maps>
        normal = normalize(mix(barkSmoothNormal, normal, 0.12 + 0.88 * vBarkMaturity));`);
  };
  material.customProgramCacheKey = () => 'campus-fissured-bark-v1';
  return material;
}
