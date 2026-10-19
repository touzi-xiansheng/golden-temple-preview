import { InstancedBufferAttribute } from 'three/webgpu';
import {
  Fn, attribute, cameraViewMatrix, diffuseColor, float, fract, max, min, mix,
  normalMap, normalView, normalWorld, positionGeometry, positionView, positionWorld,
  materialColor, materialEnvIntensity, materialRoughness, smoothstep, texture, uv, vec2, vec3, vec4,
} from 'three/tsl';

const hash = Fn(([p]) => p.dot(vec3(127.1, 311.7, 74.7)).sin().mul(43758.5453).fract());
export const noise = Fn(([p]) => {
  const i = p.floor(), f = p.fract(), w = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = mix(hash(i), hash(i.add(vec3(1, 0, 0))), w.x);
  const b = mix(hash(i.add(vec3(0, 1, 0))), hash(i.add(vec3(1, 1, 0))), w.x);
  const c = mix(hash(i.add(vec3(0, 0, 1))), hash(i.add(vec3(1, 0, 1))), w.x);
  const d = mix(hash(i.add(vec3(0, 1, 1))), hash(i.add(vec3(1, 1, 1))), w.x);
  return mix(mix(a, b, w.y), mix(c, d, w.y), w.z);
});
const resolved = p => smoothstep(.35, .95, max(p.dFdx().length(), p.dFdy().length())).oneMinus();
const filteredNoise = p => mix(.5, noise(p), resolved(p));

// Heights and view-space derivatives are both in metres, including instanced surfaces.
export const heightNormal = (height, normal = normalView) => Fn(() => {
  const dx = positionView.dFdx(), dy = positionView.dFdy();
  const r1 = dy.cross(normal), r2 = normal.cross(dx), det = dx.dot(r1);
  const gradient = r1.mul(height.dFdx()).add(r2.mul(height.dFdy())).mul(det.sign());
  return normal.sub(gradient.div(max(det.abs(), 1e-12))).normalize();
})();

export const MINERAL_SURFACES = {
  'Warm limestone': [45, .00055, .14], 'Jointed gallery limestone': [45, .00055, .14], 'Honed mineral facade': [85, .0002, .09],
  'Architectural concrete': [34, .00085, .17], 'Basalt cladding': [65, .0003, .12],
  'Roof aggregate': [48, .002, .12], 'Thermally treated ash': [52, .00065, .18],
  'Flamed warm grey arcade stone': [68, .00045, .14],
  'Jointed thermally treated ash soffit': [52, .0002, .12],
};

export function addMaterialScale(object, bark = false) {
  if (!object?.isInstancedMesh) return;
  const name = bark ? 'campusBarkRepeat' : 'campusTimberSize';
  if (object.geometry.hasAttribute(name)) return;
  const matrix = object.instanceMatrix.array, size = bark ? 2 : 3, values = new Float32Array(object.count * size);
  const phase = bark ? null : new Float32Array(object.count * 3);
  for (let i = 0; i < object.count; i++) {
    const o = i * 16, x = Math.hypot(matrix[o], matrix[o + 1], matrix[o + 2]);
    const y = Math.hypot(matrix[o + 4], matrix[o + 5], matrix[o + 6]);
    if (bark) { values[i * 2] = Math.max(1, Math.floor(2 * Math.PI * x / .6 + .5)); values[i * 2 + 1] = y / 1.3; }
    else {
      values.set([x, y, Math.hypot(matrix[o + 8], matrix[o + 9], matrix[o + 10])], i * 3);
      phase.set([matrix[o + 12] * .41, matrix[o + 14] * .37, matrix[o + 13] * .29], i * 3);
    }
  }
  object.geometry.setAttribute(name, new InstancedBufferAttribute(values, size));
  if (phase) object.geometry.setAttribute('campusTimberPhase', new InstancedBufferAttribute(phase, 3));
}

export function mineralSurface(material, source, object) {
  const [frequency, reliefMetres, roughnessVariation] = MINERAL_SURFACES[source.name];
  const wood = source.name.includes('ash'), soffit = source.name.includes('soffit');
  let p = positionWorld;
  if (soffit) {
    const phase = object?.geometry.hasAttribute('soffitPhase') ? attribute('soffitPhase', 'vec2') : vec2(0);
    const surfaceUV = uv().add(phase);
    p = vec3(surfaceUV.y, 0, surfaceUV.x);
  } else if (wood && object?.isInstancedMesh) {
    const size = attribute('campusTimberSize', 'vec3'), local = positionGeometry.mul(size);
    p = size.x.greaterThanEqual(max(size.y, size.z)).select(local.yzx,
      size.y.greaterThanEqual(size.z).select(local.xzy, local)).add(attribute('campusTimberPhase', 'vec3'));
  }
  const scale = wood ? vec3(frequency, frequency, .45) : vec3(frequency);
  const coarse = noise(p.mul(wood ? vec3(1.5, 1.5, .2) : 2.8));
  const aggregate = noise(p.mul(scale)), pores = noise(p.mul(scale).mul(3.7).add(14.1));
  const relief = aggregate.sub(.5).mul(resolved(p.mul(scale)))
    .sub(max(float(.43).sub(pores), 0).mul(resolved(p.mul(scale).mul(3.7))).mul(1.5));
  const grainContrast = soffit ? .16 : wood ? .20 : .055;
  material.colorNode = materialColor.mul(coarse.mul(.08).add(.96).add(aggregate.sub(.5).mul(resolved(p.mul(scale))).mul(grainContrast)));
  material.roughnessNode = materialRoughness.add(coarse.sub(.5).mul(.1)).add(relief.mul(roughnessVariation)).clamp(.18, .98);
  material.normalNode = heightNormal(relief.mul(reliefMetres));
}

export function barkSurface(material, source, object) {
  const maturity = object?.geometry.hasAttribute('barkMaturity') ? attribute('barkMaturity', 'float').clamp() : float(1);
  const repeat = object?.isInstancedMesh ? attribute('campusBarkRepeat', 'vec2') : vec2(1);
  const coords = uv().mul(repeat), albedo = texture(source.map, coords);
  material.colorNode = vec4(mix(vec3(.075, .055, .034), albedo.rgb, maturity.mul(.65).add(.35)), albedo.a);
  material.roughnessNode = texture(source.roughnessMap, coords).g;
  const detailed = normalMap(texture(source.normalMap, coords), vec2(source.normalScale));
  material.normalNode = mix(normalView, detailed, maturity.mul(.88).add(.12)).normalize();
}

export function foliageSurface(material, source, object, lighting) {
  const match = source.customProgramCacheKey().match(/-v5-([\d.]+)-(true|false)-(true|false)-(true|false)$/);
  const bend = match ? Number(match[1]) : .2, veins = match?.[2] === 'true', volume = match?.[4] === 'true';
  const canopy = object?.geometry.hasAttribute('canopyNormal') ? attribute('canopyNormal', 'vec3') : vec3(0, 1, 0);
  const canopyView = cameraViewMatrix.mul(vec4(canopy, 0)).xyz.normalize();
  const ao = object?.geometry.hasAttribute('canopyAO') ? attribute('canopyAO', 'float').clamp(.32, 1) : float(1);
  const oriented = volume ? canopyView : canopyView.dot(normalView).lessThan(0).select(canopyView.negate(), canopyView);
  let leafNormal = normalView;
  if (veins) {
    const across = uv().x.sub(.5).abs(), footprint = uv().fwidth();
    const rib = across.mul(across).mul(-7500).exp2().mul(smoothstep(.006, .035, footprint.x).oneMinus());
    const phase = fract(uv().y.mul(7).sub(across.mul(2.8))).sub(.5).abs();
    const vein = smoothstep(.025, .09, phase).oneMinus().mul(smoothstep(.015, .1, across)).mul(smoothstep(.37, .5, across).oneMinus());
    const height = rib.mul(.0002).add(vein.mul(.000055)).mul(smoothstep(.025, .11, max(footprint.x, footprint.y)).oneMinus());
    leafNormal = heightNormal(height);
    material.colorNode = materialColor.mul(uv().y.mul(.08).add(.95).mul(rib.mul(.11).add(1)));
  }
  material.normalNode = mix(leafNormal, oriented, bend).normalize();
  material.aoNode = ao;
  // This is thin-leaf forward scattering, driven by shadowed direct light, never emission.
  material.thicknessColorNode = diffuseColor.rgb.mul(vec3(1.05, 1.12, .7)).mul(ao);
  material.thicknessDistortionNode = float(.2);
  material.thicknessAmbientNode = float(.06);
  material.thicknessAttenuationNode = float(volume ? .08 : .18);
  material.thicknessPowerNode = float(6);
  material.thicknessScaleNode = float(2);
  if (lighting && !source.map && !volume) {
    const back = Fn(() => lighting.sampleIrradiance({normal: normalWorld.negate(), position: positionWorld}))();
    const setup = material.setupLightingModel.bind(material);
    material.setupLightingModel = (...args) => {
      const model = setup(...args), indirect = model.indirect.bind(model);
      model.indirect = builder => {
        indirect(builder);
        // Use the same incident-light scale as the front face, including zero fill.
        builder.context.reflectedLight.indirectDiffuse.addAssign(back.mul(materialEnvIntensity)
          .mul(diffuseColor.rgb).mul(vec3(1.05, 1.12, .7)).mul(ao).mul(.25 / Math.PI));
      };
      return model;
    };
  }
}

export function groundSurface(material, source, uniforms) {
  const p = positionWorld.xz, p3 = vec3(p.x, 0, p.y), kind = source.name.slice(7);
  const fine = filteredNoise(p3.mul(45)), coarse = filteredNoise(p3.mul(.7));
  let base = materialColor.rgb.mul(fine.sub(.5).mul(.24).add(1));
  let height = float(0);
  if (kind === 'paving') {
    const row = p.y.div(.6).floor(), tile = vec2(p.x.div(1.2).add(row.mod(2).mul(.5)), p.y.div(.6));
    const grid = tile.fract().sub(.5).abs(), aa = tile.fwidth();
    const joint = max(smoothstep(float(.497).sub(aa.x), float(.497).add(aa.x), grid.x), smoothstep(float(.494).sub(aa.y), float(.494).add(aa.y), grid.y));
    const tileShade = hash(vec3(tile.floor(), 0));
    base = base.mul(mix(.94, 1.06, tileShade)).mul(mix(1, .68, joint));
    height = joint.oneMinus().mul(.0035);
    material.roughnessNode = materialRoughness.add(joint.mul(.035)).sub(tileShade.sub(.5).mul(.08)).clamp(.78, 1);
  } else if (kind === 'lawn') {
    const near = smoothstep(35, 95, positionView.length()).oneMinus();
    const a = filteredNoise(p3.mul(.43)), b = filteredNoise(p3.mul(2)), blade = filteredNoise(p3.mul(7));
    const turf = texture(uniforms.uCampusTurf.value, p.div(1.6));
    base = turf.rgb.mul(mix(.77, 1.22, filteredNoise(p3.mul(.08)).mul(.45).add(a.mul(.25)).add(b.mul(.3))));
    const h = texture(uniforms.uCampusTurfHeight.value, p.div(1.6)).r;
    height = a.sub(.5).mul(.008).add(b.sub(.5).mul(.012)).add(blade.sub(.5).mul(.009)).add(h.sub(.5).mul(.006)).mul(near);
    const meadow = filteredNoise(p3.mul(.016)).mul(.65).add(filteredNoise(p3.mul(.055)).mul(.25)).add(filteredNoise(p3.mul(.21)).mul(.1));
    const woodlandColor = mix(vec3(.027, .036, .017), vec3(.059, .064, .028), meadow);
    base = mix(base, mix(vec3(.067, .088, .034), vec3(.145, .128, .064), meadow), smoothstep(150, 225, p.length()).mul(.85));
    if (uniforms.uCampusWoodland?.value) {
      const e = uniforms.uCampusContextExtent.value, coords = p.sub(vec2(e.x, e.y)).div(vec2(e.z, e.w));
      base = mix(base, woodlandColor, texture(uniforms.uCampusWoodland.value, coords).r.mul(.8));
    }
    if (uniforms.uCampusDistrictLanduse?.value) {
      const e = uniforms.uCampusDistrictExtent.value, coords = p.sub(vec2(e.x, e.y)).div(vec2(e.z, e.w));
      const edge = min(min(coords.x, coords.x.oneMinus()).mul(e.z), min(coords.y, coords.y.oneMinus()).mul(e.w));
      const cover = texture(uniforms.uCampusDistrictLanduse.value, coords).rg.mul(smoothstep(0, 12, edge));
      base = mix(base, vec3(.075, .119, .047).mul(meadow.mul(.1).add(.95)), cover.r.mul(.86));
      base = mix(base, woodlandColor, cover.g.mul(.72));
    }
    material.roughnessNode = materialRoughness.add(near.mul(b.oneMinus().mul(.018).sub(blade.mul(.065)))).clamp(.86, 1);
  } else if (kind === 'soil') {
    const coords = p.div(1.6), chip = texture(uniforms.uCampusMulchHeight.value, coords).r;
    base = texture(uniforms.uCampusMulch.value, coords).rgb.mul(coarse.mul(.3).add(.85));
    height = chip.sub(.5).mul(.008).mul(smoothstep(15, 45, positionView.length()).oneMinus());
    material.roughnessNode = float(.98).sub(chip.mul(.07)).clamp(.9, 1);
  } else base = base.mul(coarse.mul(.12).add(.94));
  material.colorNode = base;
  if (kind === 'paving' || kind === 'lawn' || kind === 'soil') material.normalNode = heightNormal(height);
}
