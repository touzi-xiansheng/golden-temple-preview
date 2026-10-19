import * as THREE from 'three';
import { finishBuild } from './loading.js';

// Capture once after the complete campus is built. Only glazing uses these local probes.
export function captureBuildingReflections(scene, renderer, architecture) {
  return finishBuild(captureBuildingReflectionSteps(scene, renderer, architecture));
}

export function* captureBuildingReflectionSteps(scene, renderer, architecture) {
  const materials = new Set();
  architecture.traverse(object => {
    if (object.material?.userData.campusGlass) materials.add(object.material);
  });
  // Near glazing occupies hundreds of screen pixels; a 256px cube visibly smears
  // the courtyard. This stays a one-off capture, not an extra render per frame.
  const cube = new THREE.WebGLCubeRenderTarget(512, { type: THREE.HalfFloatType });
  const camera = new THREE.CubeCamera(0.5, 1800, cube);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const previousTarget = renderer.getRenderTarget();
  const targets = [], assignments = [];
  const sky = scene.getObjectByName('Daylight sky');
  const sunDisc = sky?.material.uniforms.showSunDisc;
  const previousDisc = sunDisc?.value;
  let committed = false;
  try {
    if (sunDisc) sunDisc.value = 0;
    // Apply all probes only after capture, so the probes do not recursively capture one another.
    for (const material of materials) {
      camera.position.fromArray(material.userData.campusGlass.probe.position);
      camera.update(renderer, scene);
      const target = pmrem.fromCubemap(cube.texture);
      targets.push(target); assignments.push([material, target]);
      renderer.setRenderTarget(previousTarget);
      yield `正在生成玻璃反射（${targets.length}/${materials.size}）…`;
    }
    for (const [material, target] of assignments) {
      material.envMap = target.texture;
      material.userData.campusGlass.uniforms.uCampusProbeEnabled.value = 1;
      material.needsUpdate = true;
    }
    committed = true;
  } finally {
    if (!committed) for (const target of targets) target.dispose();
    if (sunDisc) sunDisc.value = previousDisc;
    renderer.setRenderTarget(previousTarget);
    cube.dispose(); pmrem.dispose();
  }
  return {
    count: targets.length,
    dispose() {
      for (const [material, target] of assignments) {
        if (material.envMap === target.texture) {
          material.envMap = null;
          material.userData.campusGlass.uniforms.uCampusProbeEnabled.value = 0;
          material.needsUpdate = true;
        }
        target.dispose();
      }
    },
  };
}
