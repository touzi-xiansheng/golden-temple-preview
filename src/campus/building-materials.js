import * as THREE from 'three';
import { BUILDINGS } from './layout.js';

// Opaque glazing keeps thousands of panes in one draw while the surface reflects the sky.
export function buildingMaterials() {
  const standard = (name, color, roughness = 0.72, metalness = 0) => {
    const m = new THREE.MeshStandardMaterial({ color, roughness, metalness });
    m.name = name;
    return m;
  };
  const materials = {
    stone: standard('Warm limestone', '#c2b49a', 0.82),
    pale: standard('Honed mineral facade', '#deded5', 0.69),
    concrete: standard('Architectural concrete', '#a9ada7', 0.84),
    darkStone: standard('Basalt cladding', '#555c5b', 0.8),
    arcadePaving: standard('Flamed warm grey arcade stone', '#8d8b80', 0.82),
    pavingJoint: standard('Arcade stone joint mortar', '#77776d', 0.95),
    aluminum: standard('Anodized champagne aluminum', '#8b7b61', 0.34, 0.65),
    darkMetal: standard('Charcoal powder coated metal', '#353f40', 0.46, 0.5),
    silver: standard('Zinc coping and equipment', '#a7b1af', 0.4, 0.62),
    spandrel: standard('Insulated spandrel backing', '#50646b', 0.26, 0.3),
    roof: standard('Roof aggregate', '#8f9390', 0.96),
    soil: standard('Roof planter soil', '#343a28', 0.98),
    foliage: standard('Roof sedum', '#687344', 0.94),
    wood: standard('Thermally treated ash', '#805b3d', 0.73),
    soffit: standard('Jointed thermally treated ash soffit', '#805b3d', 0.72),
    soffitBacking: standard('Recessed soffit backing', '#4b4238', 0.94),
    recess: standard('Recessed entrance interior', '#283236', 0.86),
  };
  materials.arcadePaving.vertexColors = true;
  materials.soffit.vertexColors = true;
  for (const name of ['stone', 'pale', 'concrete', 'darkStone', 'roof', 'wood', 'arcadePaving', 'soffit']) {
    const mat = materials[name], wood = name === 'wood' || name === 'soffit';
    // Frequency is per metre; relief is metres, not an arbitrary normal-map strength.
    const surface = {
      stone: [45, 0.00055, 0.14], pale: [85, 0.0002, 0.09], concrete: [34, 0.00085, 0.17],
      darkStone: [65, 0.0003, 0.12], roof: [48, 0.002, 0.12], wood: [52, 0.00065, 0.18],
      arcadePaving: [68, 0.00045, 0.14],
      soffit: [52, 0.0002, 0.12],
    }[name];
    const grain = { value: new THREE.Vector3(...surface) };
    mat.onBeforeCompile = shader => {
      shader.uniforms.uMaterialGrain = grain;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
        varying vec3 vBuildingPosition;
        ${name === 'soffit' ? '#ifdef USE_INSTANCING\nattribute vec2 soffitPhase;\n#endif' : ''}`);
      shader.vertexShader = shader.vertexShader.replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
        vec4 surfacePosition = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          surfacePosition = instanceMatrix * surfacePosition;
        #endif
        vBuildingPosition = (modelMatrix * surfacePosition).xyz;
        ${name === 'wood' ? `
          #ifdef USE_INSTANCING
            vec3 timberSize = vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));
            vec3 timberLocal = transformed * timberSize;
            if (timberSize.x >= max(timberSize.y,timberSize.z)) vBuildingPosition = timberLocal.yzx;
            else if (timberSize.y >= timberSize.z) vBuildingPosition = timberLocal.xzy;
            else vBuildingPosition = timberLocal;
            vBuildingPosition += instanceMatrix[3].xzy * vec3(0.41,0.37,0.29);
          #endif` : ''}
        ${name === 'soffit' ? `
          vec2 timberUv = uv;
          #ifdef USE_INSTANCING
            timberUv += soffitPhase;
          #endif
          vBuildingPosition = vec3(timberUv.y, 0.0, timberUv.x);` : ''}`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
        varying vec3 vBuildingPosition;
        uniform vec3 uMaterialGrain;
        float mineralHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
        float mineralNoise(vec3 p) {
          vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
          return mix(mix(mix(mineralHash(i),mineralHash(i+vec3(1,0,0)),f.x),mix(mineralHash(i+vec3(0,1,0)),mineralHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(mineralHash(i+vec3(0,0,1)),mineralHash(i+vec3(1,0,1)),f.x),mix(mineralHash(i+vec3(0,1,1)),mineralHash(i+vec3(1,1,1)),f.x),f.y),f.z);
        }
        vec3 mineralBump(vec3 p, vec3 n, float heightMetres) {
          vec3 dx = dFdx(p), dy = dFdy(p);
          vec3 r1 = cross(dy,n), r2 = cross(n,dx);
          float determinant = dot(dx,r1);
          vec3 gradient = sign(determinant) * (dFdx(heightMetres)*r1 + dFdy(heightMetres)*r2);
          return normalize(n - gradient / max(abs(determinant),1e-12));
        }`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        vec3 grainScale = ${wood ? 'vec3(uMaterialGrain.x,uMaterialGrain.x,0.45)' : 'vec3(uMaterialGrain.x)'};
        float materialFootprint = max(length(dFdx(vBuildingPosition * grainScale)),length(dFdy(vBuildingPosition * grainScale)));
        float resolvedGrain = 1.0 - smoothstep(0.35,0.95,materialFootprint);
        float resolvedPore = 1.0 - smoothstep(0.35,0.95,materialFootprint*3.7);
        float mineral = mineralNoise(vBuildingPosition * ${wood ? 'vec3(1.5,1.5,0.20)' : '2.8'});
        float aggregate = mineralNoise(vBuildingPosition * grainScale);
        float pores = mineralNoise(vBuildingPosition * grainScale * 3.7 + 14.1);
        float relief = (aggregate-0.5)*resolvedGrain - max(0.0,0.43-pores)*resolvedPore*1.5;
        float heightMetres = relief * uMaterialGrain.y;
        diffuseColor.rgb *= 0.96 + mineral*0.08 + (aggregate-0.5)*resolvedGrain*${name === 'soffit' ? '0.16' : name === 'wood' ? '0.20' : '0.055'};
      `);
      shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (mineral-0.5)*0.10 + relief*uMaterialGrain.z,0.18,0.98);`);
      shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        normal = mineralBump(-vViewPosition,normal,heightMetres);`);
    };
    mat.customProgramCacheKey = () => `campus-mineral-relief-v2-${name === 'soffit' ? 'soffit-uv' : name === 'wood' ? 'wood' : 'stone'}`;
  }
  materials.glassZones = CAMPUS_GLASS_PROBES.map(glazing);
  materials.glass = materials.glassZones[0];
  return materials;
}

// shortcut: one upper probe approximates facade parallax; closer moving views need view-dependent reflections.
const cUpperProbeBuilding = BUILDINGS.find(b => b.id === 'c');
export const CAMPUS_GLASS_PROBES = [
  { id: 'headquarters', position: [0, 6.5, -44] },
  { id: 'west', position: [-17, 3.2, 4] },
  { id: 'east', position: [17, 3.2, 4] },
  { id: 'c-upper-east', position: [cUpperProbeBuilding.x+cUpperProbeBuilding.w/2+1.2,
    .16+(1+cUpperProbeBuilding.floors)*cUpperProbeBuilding.floorHeight/2,cUpperProbeBuilding.z] },
];

// The proxy encloses every elevation (including outward-facing glass), but not
// the distant site perimeter. Near reflections should not be projected 130m away.
const REFLECTION_VOLUME = {
  min: [Math.min(...BUILDINGS.map(b=>b.x-b.w/2))-1.5,-.15,Math.min(...BUILDINGS.map(b=>b.z-b.d/2))-1.5],
  max: [Math.max(...BUILDINGS.map(b=>b.x+b.w/2))+1.5,Math.max(...BUILDINGS.map(b=>.16+b.floors*b.floorHeight))+2,Math.max(...BUILDINGS.map(b=>b.z+b.d/2))+1.5],
};

const PLANAR_REFLECTION_SHADER = /* glsl */ `
  uniform float uCampusPlanarEnabled;
  uniform sampler2D uCampusPlanarMap;
  uniform mat4 uCampusPlanarMatrix;
  uniform vec3 uCampusPlanarGlassMin, uCampusPlanarGlassMax;

  float campusPlanarRadiance(float roughness, out vec3 radiance) {
    radiance = vec3(0.0);
    vec4 projected = uCampusPlanarMatrix * vec4(vGlassWorldPosition,1.0);
    vec2 uv = projected.xy / max(projected.w,0.00001);
    vec2 dx = dFdx(uv), dy = dFdy(uv);
    if (uCampusPlanarEnabled <= 0.0 || projected.w <= 0.0) return 0.0;
    if (any(lessThan(vGlassWorldPosition,uCampusPlanarGlassMin)) ||
        any(greaterThan(vGlassWorldPosition,uCampusPlanarGlassMax))) return 0.0;
    if (any(lessThan(uv,vec2(0.0))) || any(greaterThan(uv,vec2(1.0)))) return 0.0;
    vec2 dimensions = vec2(textureSize(uCampusPlanarMap,0));
    float footprint = max(length(dx*dimensions),length(dy*dimensions));
    footprint = max(footprint,roughness*roughness*max(dimensions.x,dimensions.y));
    float lod = max(0.0,log2(max(1.0,footprint)));
    vec2 halfTexel = 0.5/max(vec2(1.0),dimensions/exp2(lod));
    // shortcut: the near reflection uses the facade plane; curved panes need depth-aware reprojection.
    radiance = textureLod(uCampusPlanarMap,clamp(uv,halfTexel,1.0-halfTexel),lod).rgb;
    return uCampusPlanarEnabled;
  }
`;

const ROOM_SHADER = /* glsl */ `
  vec3 campusRoom(vec3 ray, vec2 uv, vec2 size, vec4 detail, vec4 roomLayout, out vec3 blindAlbedo) {
    blindAlbedo = vec3(0.0);
    float depth = 3.8 + detail.z * 2.8;
    vec3 low = vec3(-roomLayout.y * 0.5, -roomLayout.z, -depth);
    vec3 high = vec3(roomLayout.y * 0.5, roomLayout.w, 0.0);
    vec3 origin = vec3((uv - 0.5) * size + vec2(roomLayout.x, 0.0), -0.01);
    vec3 safeRay = sign(ray + vec3(1e-7)) * max(abs(ray), vec3(1e-4));
    vec3 exitDistance = max((low - origin) / safeRay, (high - origin) / safeRay);
    float distanceToRoom = min(exitDistance.x, min(exitDistance.y, exitDistance.z));
    vec3 hit = origin + ray * distanceToRoom;
    vec3 wall = mix(vec3(0.17, 0.18, 0.17), vec3(0.23, 0.20, 0.16), detail.y);
    vec3 room = wall * (0.43 + 0.15 * detail.w);
    if (exitDistance.y < min(exitDistance.x, exitDistance.z)) {
      if (ray.y > 0.0) {
        vec2 tile = abs(fract(hit.xz / 0.6) - 0.5);
        float joint = smoothstep(0.47, 0.50, max(tile.x, tile.y));
        room = vec3(0.145, 0.15, 0.142) * (1.0 - joint * 0.12);
        vec2 lightCell = abs(fract(hit.xz / vec2(1.8, 2.4)) - 0.5);
        float panel = (1.0 - smoothstep(0.12, 0.15, lightCell.x)) * (1.0 - smoothstep(0.20, 0.23, lightCell.y));
        room += vec3(0.20, 0.19, 0.16) * panel * step(0.86, detail.w);
      } else {
        room = mix(vec3(0.045,0.052,0.048), vec3(0.085,0.070,0.048), detail.y);
        vec2 floorTile = abs(fract(hit.xz / 0.8) - 0.5);
        room *= 1.0 - 0.08 * smoothstep(0.47, 0.50, max(floorTile.x, floorTile.y));
      }
    } else if (exitDistance.z <= exitDistance.x) {
      float door = step(abs(hit.x - (detail.z - 0.5) * roomLayout.y), 0.38) * step(hit.y, low.y + 2.15);
      room *= 1.0 - door * 0.60;
      float skirting = 1.0 - smoothstep(low.y + 0.10, low.y + 0.16, hit.y);
      room *= 1.0 - skirting * 0.45;
    } else {
      room *= 0.74;
    }
    float deskDistance = (low.y + 0.74 - origin.y) / safeRay.y;
    vec3 desk = origin + ray * deskDistance;
    if (deskDistance > 0.0 && deskDistance < distanceToRoom && abs(desk.x) < roomLayout.y * 0.37 && desk.z < -1.6 && desk.z > -2.5) {
      room = vec3(0.18, 0.145, 0.095);
    }
    // Daylight falls off behind the facade; a room is not an evenly emissive box.
    room *= 0.18 + 0.82 * exp(-max(0.0, -hit.z - 0.4) * 0.18);
    float blindDistance = (-0.18 - origin.z) / safeRay.z;
    vec3 blindHit = origin + ray * blindDistance;
    float blindY = blindHit.y / size.y + 0.5;
    float blindCoverage = detail.x > 0.68 ? (detail.x - 0.68) * 2.5 : 0.0;
    float phase = blindHit.y / 0.035;
    float aa = 1.0 - smoothstep(0.25, 0.8, fwidth(phase));
    if (blindDistance > 0.0 && blindDistance < distanceToRoom && abs(blindHit.x-roomLayout.x) < size.x * 0.5 && blindY > 1.0 - blindCoverage && blindY < 1.0) {
      float slat = 0.86 + 0.14 * sin(phase * 6.283185) * aa;
      room = mix(vec3(0.22,0.23,0.21), vec3(0.28,0.265,0.22), detail.y) * slat;
      blindAlbedo = room * (0.56 + detail.w * 0.36);
    }
    return room * (0.56 + detail.w * 0.36);
  }
`;

function glazing(probe) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#050707', emissive: '#ffffff', metalness: 0, roughness: 0.04,
    ior: 1.52, specularIntensity: 1, clearcoat: 0.35, clearcoatRoughness: 0.04,
    envMapIntensity: 1,
  });
  material.name = `Solar control glass / ${probe.id}`;
  const uniforms = {
    uCampusProbeEnabled: { value: 0 },
    uCampusPaneBowScale: { value: 1 },
    uCampusProbePosition: { value: new THREE.Vector3(...probe.position) },
    uCampusProbeMin: { value: new THREE.Vector3(...REFLECTION_VOLUME.min) },
    uCampusProbeMax: { value: new THREE.Vector3(...REFLECTION_VOLUME.max) },
  };
  material.userData.campusGlass = { probe, uniforms };
  const planarUniforms = probe.id === 'west' ? {
    uCampusPlanarEnabled:{value:0},uCampusPlanarMap:{value:null},uCampusPlanarMatrix:{value:new THREE.Matrix4()},
    uCampusPlanarGlassMin:{value:new THREE.Vector3()},uCampusPlanarGlassMax:{value:new THREE.Vector3()},
  } : null;
  if (planarUniforms) material.userData.campusGlass.planarUniforms = planarUniforms;
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    if (planarUniforms) Object.assign(shader.uniforms, planarUniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 paneDetail;
      attribute vec2 paneSize;
      attribute vec4 paneRoom;
      attribute float paneType;
      varying vec4 vPaneDetail;
      varying vec2 vPaneUv;
      varying vec2 vPaneSize;
      varying vec4 vPaneRoom;
      varying float vPaneType;
      varying vec3 vGlassWorldPosition;`);
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vPaneDetail = paneDetail;
      vPaneUv = uv;
      vPaneSize = paneSize;
      vPaneRoom = paneRoom;
      vPaneType = paneType;
      vec4 paneWorld = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        paneWorld = instanceMatrix * paneWorld;
      #endif
      vGlassWorldPosition = (modelMatrix * paneWorld).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec4 vPaneDetail;
      varying vec2 vPaneUv;
      varying vec2 vPaneSize;
      varying vec4 vPaneRoom;
      varying float vPaneType;
      varying vec3 vGlassWorldPosition;
      uniform float uCampusProbeEnabled, uCampusPaneBowScale;
      uniform vec3 uCampusProbePosition, uCampusProbeMin, uCampusProbeMax;
      vec3 campusProjectedReflection(vec3 direction) {
        vec3 safeDirection = sign(direction + vec3(1e-7)) * max(abs(direction), vec3(1e-4));
        vec3 farDistance = max((uCampusProbeMax - vGlassWorldPosition) / safeDirection, (uCampusProbeMin - vGlassWorldPosition) / safeDirection);
        float distanceToBoundary = max(0.0, min(farDistance.x, min(farDistance.y, farDistance.z)));
        vec3 corrected = normalize(vGlassWorldPosition + direction * distanceToBoundary - uCampusProbePosition);
        // The ground and courtyard have finite extent; the sky remains at infinity.
        float finiteScene = 1.0 - smoothstep(0.10, 0.45, direction.y);
        return normalize(mix(direction, corrected, finiteScene * uCampusProbeEnabled));
      }
      ${planarUniforms ? PLANAR_REFLECTION_SHADER : ''}
      ${ROOM_SHADER}`);
    const ibl = THREE.ShaderChunk.envmap_physical_pars_fragment.replace(
      'vec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );',
      planarUniforms ? `vec3 planarRadiance;
        float planarWeight = campusPlanarRadiance(roughness,planarRadiance);
        vec4 envMapColor;
        if (planarWeight >= 1.0) envMapColor = vec4(planarRadiance,1.0);
        else {
          reflectVec = campusProjectedReflection(reflectVec);
          envMapColor = textureCubeUV(envMap,envMapRotation*reflectVec,roughness);
          envMapColor.rgb = mix(envMapColor.rgb,planarRadiance,planarWeight);
        }` : 'reflectVec = campusProjectedReflection(reflectVec);\nvec4 envMapColor = textureCubeUV( envMap, envMapRotation * reflectVec, roughness );',
    );
    shader.fragmentShader = shader.fragmentShader.replace('#include <envmap_physical_pars_fragment>', ibl);
    // Our 512px probes support a sharper floor than Three's default 256px floor; retain derivative filtering.
    const physical = THREE.ShaderChunk.lights_physical_fragment
      .replace('max( roughnessFactor, 0.0525 )', 'max( roughnessFactor, 0.038 )')
      .replace('max( material.clearcoatRoughness, 0.0525 )', 'max( material.clearcoatRoughness, 0.038 )');
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_physical_fragment>', physical);
    shader.fragmentShader = shader.fragmentShader.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      roughnessFactor *= 0.90 + vPaneDetail.x * 0.20;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 paneDx = dFdx(-vViewPosition), paneDy = dFdy(-vViewPosition);
      vec2 uvDx = dFdx(vPaneUv), uvDy = dFdy(vPaneUv);
      float orientation = sign(uvDx.x * uvDy.y - uvDx.y * uvDy.x);
      vec3 paneTangent = (paneDx * uvDy.y - paneDy * uvDx.y) * orientation;
      vec3 paneVertical = (paneDy * uvDx.x - paneDx * uvDy.x) * orientation;
      paneTangent *= inversesqrt(max(dot(paneTangent, paneTangent), 1e-12));
      paneVertical *= inversesqrt(max(dot(paneVertical, paneVertical), 1e-12));
      vec3 incidentRay = -normalize(vViewPosition);
      vec3 roomColor = vec3(0.0), blindAlbedo = vec3(0.0);
      if (vPaneType < 0.5) {
        vec3 roomRay = normalize(vec3(dot(incidentRay,paneTangent), dot(incidentRay,paneVertical), -max(0.03,abs(dot(incidentRay,nonPerturbedNormal)))));
        roomColor = campusRoom(roomRay, vPaneUv, vPaneSize, vPaneDetail, vPaneRoom, blindAlbedo);
      }
      float paneFresnel = 0.043 + 0.957 * pow(1.0 - clamp(abs(dot(incidentRay,nonPerturbedNormal)),0.0,1.0),5.0);
      vec2 paneBow = sin(vPaneUv * 6.283185 + vPaneDetail.xy * 4.0) * vec2(0.0012,0.0018);
      paneBow += (vPaneDetail.xy - 0.5) * 0.0008;
      float paneVisible = 1.0 - smoothstep(0.15,0.45,max(fwidth(vPaneUv.x),fwidth(vPaneUv.y)));
      normal = normalize(normal + uCampusPaneBowScale * paneVisible * (paneTangent * paneBow.x + paneVertical * paneBow.y));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
      #ifdef USE_CLEARCOAT
        clearcoatNormal = normal;
      #endif`);
    // Interior mapping supplies light transmitted from the room; the PBR surface supplies Fresnel reflections.
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance = roomColor * vec3(0.90,0.97,0.94) * (1.0 - paneFresnel) * 0.12;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      if (max(max(blindAlbedo.r,blindAlbedo.g),blindAlbedo.b) > 0.0) {
        float blindCoat = 0.0;
        #ifdef USE_CLEARCOAT
          blindCoat = material.clearcoat;
        #endif
        // Cosine-weighted entry Fresnel: Schlick q=(1-mu)^5 has <q>=1/21, <q*q>=1/66.
        float blindDiffuseEntry = 0.957 * ((1.0-0.04*blindCoat)*(20.0/21.0)
          - 0.96*blindCoat*(1.0/21.0-1.0/66.0));
        vec3 blindIncident = vec3(0.0);
        #if defined(RE_IndirectDiffuse)
          // GI has already replaced its PMREM fallback; consume their existing mixture once.
          blindIncident = max(irradiance + iblIrradiance,vec3(0.0)) * blindDiffuseEntry;
        #endif
        #if NUM_DIR_LIGHTS > 0
          // shortcut: one directional sun supplies directLight after shadows; accumulate per light if more are added.
          float blindSunCos = max(dot(nonPerturbedNormal,directLight.direction),0.0);
          float blindSunQ = pow(1.0-blindSunCos,5.0);
          float blindSunEntry = (1.0-(0.043+0.957*blindSunQ)) *
            (1.0-blindCoat*(0.04+0.96*blindSunQ));
          blindIncident += directLight.color * blindSunCos * blindSunEntry;
        #endif
        // Assumed bulk transmission .65 each way; tint is round-trip. Replace the old blind term.
        // Exit Fresnel is applied here; Three applies outgoing clearcoat later.
        totalEmissiveRadiance = blindAlbedo * blindIncident * RECIPROCAL_PI * (0.65*0.65) *
          vec3(0.90,0.97,0.94) * (1.0-paneFresnel);
      }`);
  };
  material.customProgramCacheKey = () => planarUniforms ? 'campus-dielectric-room-v10-planar-daylight' : 'campus-dielectric-room-v7-probe-daylight';
  return material;
}
