import * as THREE from 'three';

// One static orthographic depth map. All distances below are metres, including the filter.
export const SUN_ANGULAR_RADIUS = 0.00465;

const BASIC_SHADOW = /* glsl */ `
  #else // SHADOWMAP_TYPE_BASIC
    vec2 campusShadowDisk(int index, float count, float angle) {
      float r = sqrt((float(index) + 0.5) / count);
      float a = float(index) * 2.39996323 + angle;
      return vec2(cos(a), sin(a)) * r;
    }
    float campusShadowDepth(sampler2D map, vec2 uv, vec2 size, vec3 receiver, vec2 gradient) {
      // Account for the receiving plane at the exact sampled texel, instead of a large bias.
      vec2 center = (floor(uv * size) + 0.5) / size;
      float z = receiver.z + dot(gradient, center - receiver.xy);
      return z - texture2D(map, center).r;
    }
    float campusShadowTapVisibility(sampler2D map, vec2 uv, vec2 size, vec3 receiver, vec2 gradient) {
      // Interpolate comparison results at this existing PCSS tap, never depth values.
      vec2 texel = 1.0 / size, pixel = uv * size - 0.5;
      vec2 base = (floor(pixel) + 0.5) / size, f = fract(pixel);
      vec2 lo = texel * 0.5, hi = 1.0 - lo;
      // campusShadowDepth corrects the receiving plane at each clamped texel center.
      float a = step(campusShadowDepth(map, clamp(base,lo,hi),size,receiver,gradient),0.0);
      float b = step(campusShadowDepth(map, clamp(base+vec2(texel.x,0.0),lo,hi),size,receiver,gradient),0.0);
      float c = step(campusShadowDepth(map, clamp(base+vec2(0.0,texel.y),lo,hi),size,receiver,gradient),0.0);
      float d = step(campusShadowDepth(map, clamp(base+texel,lo,hi),size,receiver,gradient),0.0);
      return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
    }
    vec2 campusReceiverGradient(vec3 receiver) {
      vec3 dx = dFdx(receiver), dy = dFdy(receiver);
      float determinant = dx.x * dy.y - dx.y * dy.x;
      vec2 gradient = vec2(0.0);
      if(abs(determinant) > 1e-12) gradient = clamp(vec2(dy.y * dx.z - dx.y * dy.z, dx.x * dy.z - dy.x * dx.z) / determinant, vec2(-4.0), vec2(4.0));
      return gradient;
    }
    float getShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord) {
      vec3 receiver = shadowCoord.xyz / shadowCoord.w;
      vec2 gradient = campusReceiverGradient(receiver);
      receiver.z += shadowBias;
      if(any(lessThan(receiver.xy, vec2(0.0))) || any(greaterThan(receiver.xy, vec2(1.0))) || receiver.z > 1.0) return 1.0;
      vec2 texel = 1.0 / shadowMapSize;
      // A light-space pattern remains attached to the surface when the camera moves.
      vec2 cell = floor(receiver.xy * shadowMapSize);
      float angle = 6.2831853 * fract(sin(dot(cell, vec2(12.9898,78.233))) * 43758.5453);
      float radiusMetres = uCampusShadowFixedRadius;
      if(uCampusShadowSearch > 0) {
        float searchRadius = min(receiver.z * uCampusShadowDepthRange, 64.0) * uCampusSunRadius / uCampusShadowSpan;
        float separation = 0.0, blockers = 0.0;
        for(int i = 0; i < 12; i++) {
          if(i >= uCampusShadowSearch) break;
          vec2 offset = i == 0 ? vec2(0.0) : campusShadowDisk(i - 1, float(uCampusShadowSearch - 1), angle) * searchRadius;
          vec2 uv = clamp(receiver.xy + offset, texel * 0.5, 1.0 - texel * 0.5);
          float gap = campusShadowDepth(shadowMap, uv, shadowMapSize, receiver, gradient);
          if(gap > 0.0) { separation += gap * uCampusShadowDepthRange; blockers += 1.0; }
        }
        // Sparse searches can miss a thin leaf. Keep the small contact filter on lit edges too.
        if(blockers > 0.5) radiusMetres = separation / blockers * uCampusSunRadius;
      }
      float radius = max(radiusMetres / uCampusShadowSpan, texel.x * 0.55);
      float visibility = 0.0;
      for(int i = 0; i < 20; i++) {
        if(i >= uCampusShadowSamples) break;
        vec2 offset = campusShadowDisk(i, float(uCampusShadowSamples), angle + 0.73) * radius;
        vec2 uv = clamp(receiver.xy + offset, texel * 0.5, 1.0 - texel * 0.5);
        visibility += campusShadowTapVisibility(shadowMap, uv, shadowMapSize, receiver, gradient);
      }
      return mix(1.0, visibility / float(uCampusShadowSamples), shadowIntensity);
    }
    // Leaf transmission already shifts the receiver by 0.25m: it needs local visibility,
    // not a second full blocker search and distance-dependent penumbra calculation.
    float campusLeafTransmissionShadow(sampler2D shadowMap, vec2 shadowMapSize, float shadowIntensity, float shadowBias, float shadowRadius, vec4 shadowCoord) {
      vec3 receiver = shadowCoord.xyz / shadowCoord.w;
      vec2 gradient = campusReceiverGradient(receiver);
      receiver.z += shadowBias;
      if(any(lessThan(receiver.xy, vec2(0.0))) || any(greaterThan(receiver.xy, vec2(1.0))) || receiver.z > 1.0) return 1.0;
      vec2 texel = 1.0 / shadowMapSize;
      vec2 radius = max(vec2(uCampusShadowFixedRadius / uCampusShadowSpan), texel * 0.55);
      float visibility = 0.0;
      for(int i = 0; i < 4; i++) {
        vec2 offset = (vec2(float(i - (i / 2) * 2), float(i / 2)) * 2.0 - 1.0) * radius * 0.707107;
        vec2 uv = clamp(receiver.xy + offset, texel * 0.5, 1.0 - texel * 0.5);
        visibility += step(campusShadowDepth(shadowMap, uv, shadowMapSize, receiver, gradient), 0.0);
      }
      return mix(1.0, visibility * 0.25, shadowIntensity);
    }
  #endif

`;

function shadowChunk() {
  const source = THREE.ShaderChunk.shadowmap_pars_fragment;
  // Three's distributed build strips the source chunk's BASIC branch comment.
  const signature = source.lastIndexOf('float getShadow(');
  const start = source.lastIndexOf('#else', signature);
  const end = source.indexOf('#if NUM_SUN_LIGHT_SHADOWS', start);
  if(start < 0 || end < 0 || !source.slice(signature, signature + 90).includes('sampler2D shadowMap')) throw new Error('Campus soft shadows: unsupported Three shadow chunk');
  return source.slice(0, start) + BASIC_SHADOW + source.slice(end);
}

export function createCampusShadows(scene, renderer, sun) {
  renderer.shadowMap.type = THREE.BasicShadowMap;
  const uniforms = {
    uCampusSunRadius: { value: SUN_ANGULAR_RADIUS },
    uCampusShadowSpan: { value: 340 },
    uCampusShadowDepthRange: { value: 600 },
    uCampusShadowFixedRadius: { value: 0.035 },
    uCampusShadowSearch: { value: 4 },
    uCampusShadowSamples: { value: 8 },
  };
  const chunk = shadowChunk(), originals = new Map();
  scene.traverse(object => {
    const material = object.material;
    if(!material?.isMeshStandardMaterial || originals.has(material)) return;
    const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey;
    const key = cacheKey.call(material);
    originals.set(material, { compile, cacheKey });
    material.onBeforeCompile = function(shader, activeRenderer) {
      compile.call(this, shader, activeRenderer);
      Object.assign(shader.uniforms, uniforms);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          #define CAMPUS_SOFT_SHADOWS
          uniform float uCampusSunRadius, uCampusShadowSpan, uCampusShadowDepthRange, uCampusShadowFixedRadius;
          uniform int uCampusShadowSearch, uCampusShadowSamples;`)
        .replace('#include <shadowmap_pars_fragment>', chunk);
    };
    material.customProgramCacheKey = () => `${key}-campus-soft-sun-v3-tap-bilinear`;
    material.needsUpdate = true;
  });
  const api = {
    uniforms,
    setQuality(preset) {
      uniforms.uCampusShadowSearch.value = Math.min(12, Math.max(0, preset.shadowSearch ?? 4));
      uniforms.uCampusShadowSamples.value = Math.min(20, Math.max(1, preset.shadowSamples ?? 8));
    },
    update() {
      const camera = sun.shadow.camera;
      uniforms.uCampusShadowSpan.value = camera.right - camera.left;
      uniforms.uCampusShadowDepthRange.value = camera.far - camera.near;
    },
    dispose() {
      for(const [material, original] of originals) {
        material.onBeforeCompile = original.compile;
        material.customProgramCacheKey = original.cacheKey;
        material.needsUpdate = true;
      }
      originals.clear(); delete sun.userData.campusShadows;
    },
  };
  sun.userData.campusShadows = api;
  api.update();
  return api;
}
