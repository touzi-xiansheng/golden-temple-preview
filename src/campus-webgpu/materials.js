import { Material, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, MeshSSSNodeMaterial, MeshStandardNodeMaterial } from 'three/webgpu';
import { materialColor, positionWorld, texture } from 'three/tsl';
import { applyCampusLighting } from './lighting.js';
import { createGlassMaterial, glassEnvironment } from './materials-glass.js';
import { copyMaterialProperties } from './materials-copy.js';
import { applyRecessVisibility } from './materials-context.js';
import { MINERAL_SURFACES, addMaterialScale, mineralSurface, barkSurface, foliageSurface, groundSurface } from './materials-surfaces.js';

// Legacy generators keep some textures in closures. Read their uniform values once;
// none of the generated GLSL or hooks is attached to the new node materials.
function sourceUniforms(source) {
  const capture = { uniforms: {}, vertexShader: '', fragmentShader: '' };
  source.onBeforeCompile(capture);
  return capture.uniforms;
}

export function createCampusMaterials({ lighting = null } = {}) {
  const cache = new WeakMap(), owned = new Set(), captured = new WeakMap(), glass = [], records = [];
  const textures = new Set();
  const stats = { converted: 0, reused: 0, categories: {}, extractedTextureUniforms: 0, pending: [] };
  function uniforms(source) {
    if (!captured.has(source)) {
      const values = sourceUniforms(source);
      captured.set(source, values);
      for (const entry of Object.values(values)) if (entry.value?.isTexture) { textures.add(entry.value); stats.extractedTextureUniforms++; }
    }
    return captured.get(source);
  }
  function convert(source, object = null) {
    if (source.isNodeMaterial) return source;
    const key = source.customProgramCacheKey(), name = source.name;
    let category = source.isMeshPhysicalMaterial ? 'physical' : source.isMeshBasicMaterial ? 'basic' : 'standard';
    if (source.userData.campusGlass) category = 'glass';
    else if (name === 'context-dielectric-backed-glazing') category = 'context-glass';
    else if (MINERAL_SURFACES[name]) category = 'mineral';
    else if (name === 'campus-fissured-bark') category = 'bark';
    else if (key.startsWith('campus-foliage-')) category = 'foliage';
    else if (key.startsWith('campus-surface-')) category = 'ground';
    else if (name === 'campus-mown-turf') category = 'turf';
    else if (name.startsWith('context-recess-')) category = 'context-recess';
    else if (source.onBeforeCompile !== Material.prototype.onBeforeCompile) {
      throw new Error(`Unmigrated material shader: ${name || source.type} (${key})`);
    }
    if (category === 'bark' || (category === 'mineral' && name === 'Thermally treated ash')) addMaterialScale(object, category === 'bark');
    const signature = `${category}:${object?.isInstancedMesh ? 'instances' : 'mesh'}:${Object.keys(object?.geometry?.attributes || {}).sort().join(',')}`;
    let variants = cache.get(source);
    if (!variants) { variants = new Map(); cache.set(source, variants); }
    if (variants.has(signature)) {
      const existing = variants.get(signature);
      const record = glass.find(entry => entry.material === existing);
      if (record && object && !record.objects.includes(object)) record.objects.push(object);
      stats.reused++; return existing;
    }
    let material;
    if (category === 'glass' || category === 'context-glass') material = createGlassMaterial(source, category === 'context-glass');
    else {
      material = category === 'foliage' ? new MeshSSSNodeMaterial()
        : source.isMeshPhysicalMaterial ? new MeshPhysicalNodeMaterial()
          : source.isMeshBasicMaterial ? new MeshBasicNodeMaterial() : new MeshStandardNodeMaterial();
      copyMaterialProperties(material, source);
    }
    material.name = `${name || source.type} / WebGPU`;
    material.userData.webgpuCategory = category;
    if (category === 'mineral') mineralSurface(material, source, object);
    else if (category === 'bark') barkSurface(material, source, object);
    else if (category === 'foliage') foliageSurface(material, source, object, lighting);
    else if (category === 'ground') groundSurface(material, source, uniforms(source));
    else if (category === 'turf') {
      material.colorNode = materialColor.mul(texture(uniforms(source).uMownTurfMap.value, positionWorld.xz.div(1.6)));
    }
    if (category === 'context-recess' || category === 'context-glass') {
      applyRecessVisibility(material, object);
    }
    if (category === 'glass') {
      for (const attribute of ['paneDetail', 'paneSize', 'paneRoom', 'paneType']) {
        if (object && !object.geometry.hasAttribute(attribute)) throw new Error(`Glass mesh is missing ${attribute}`);
      }
      material.envNode = glassEnvironment(material, source);
      glass.push({ material, source, probe: source.userData.campusGlass.probe, objects: object ? [object] : [] });
    }
    if (lighting && material.isMeshStandardNodeMaterial) applyCampusLighting(material, lighting);
    for (const pending of material.userData.webgpuPending || []) if (!stats.pending.includes(pending)) stats.pending.push(pending);
    owned.add(material); variants.set(signature, material); records.push({material, source, object, category});
    stats.converted++; stats.categories[category] = (stats.categories[category] || 0) + 1;
    return material;
  }
  return {
    convert, glass, stats,
    bindLighting(value) {
      if (lighting === value) return;
      if (lighting) throw new Error('Materials are already bound to another lighting owner');
      lighting = value;
      for (const {material, source, object, category} of records) {
        if (category === 'foliage') foliageSurface(material, source, object, lighting);
        if (material.isMeshStandardNodeMaterial) applyCampusLighting(material, lighting);
        material.needsUpdate = true;
      }
    },
    apply(root) {
      root.traverse(object => {
        if (!object.material) return;
        object.material = Array.isArray(object.material) ? object.material.map(source => convert(source, object)) : convert(object.material, object);
      });
      return root;
    },
    setGlassReflection(material, reflection) {
      const record = glass.find(entry => entry.material === material);
      if (!record) throw new TypeError('Reflection target is not a campus glass material');
      if (reflection && !reflection.node?.isNode) throw new TypeError('Glass reflection requires a radiance node');
      material.envNode = glassEnvironment(material, record.source, reflection);
      material.needsUpdate = true;
    },
    dispose() {
      for (const material of owned) material.dispose();
      // These closure-owned textures are absent from the legacy material's public map properties.
      for (const image of textures) image.dispose();
      owned.clear(); textures.clear();
    },
  };
}
