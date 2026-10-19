import { Scene } from 'three/webgpu';
import { buildBuildings } from '../campus/buildings.js';
import { buildLandscapeSteps } from '../campus/landscape.js';
import { buildCampusProps } from '../campus/props.js';
import { runBuild } from '../campus/loading.js';
import { createCampusMaterials } from './materials.js';

export async function createCampusScene({ stage, yieldControl }) {
  const scene = new Scene(); scene.name = 'Verdant WebGPU campus';
  const timings = {}, started = performance.now();
  stage('正在生成七栋建筑与立面构造…', 12); await yieldControl();
  const architecture = buildBuildings(); scene.add(architecture);
  timings.architectureMs = performance.now() - started;
  let tick = performance.now();
  const landscape = await runBuild(buildLandscapeSteps(), { yieldControl, onProgress: message => stage(message || '正在生成庭院与外围林地…', 35) });
  scene.add(landscape);
  const props = buildCampusProps(); scene.add(props);
  timings.landscapeMs = performance.now() - tick;
  stage('正在建立程序化节点材质…', 52); await yieldControl();
  tick = performance.now();
  const sourceMaterials = new Set();
  scene.traverse(object => {
    if (!object.material) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) sourceMaterials.add(material);
    // Node shadows use the converted material's alpha and deformation automatically.
    object.customDepthMaterial?.dispose(); object.customDistanceMaterial?.dispose();
    object.customDepthMaterial = undefined; object.customDistanceMaterial = undefined;
  });
  const materials = createCampusMaterials(); materials.apply(scene);
  timings.materialsMs = performance.now() - tick;
  let meshes = 0, triangles = 0, instances = 0;
  scene.traverse(object => {
    if (!object.isMesh) return;
    meshes++; const count = object.isInstancedMesh ? object.count : 1; instances += count;
    triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * count;
  });
  const stats = { buildings: architecture.userData.buildingCount, meshes, triangles, instances, landscape: landscape.userData.stats, timings };
  let disposed = false;
  return { scene, architecture, landscape, props, materials, stats,
    dispose() {
      if (disposed) return; disposed = true;
      const geometries = new Set(), textures = new Set();
      scene.traverse(object => {
        if (object.geometry) geometries.add(object.geometry);
        if (object.isInstancedMesh) object.dispose();
      });
      for (const material of sourceMaterials) { for (const value of Object.values(material)) if (value?.isTexture) textures.add(value); material.dispose(); }
      for (const geometry of geometries) geometry.dispose();
      materials.dispose(); for (const texture of textures) texture.dispose(); scene.clear();
    },
  };
}
