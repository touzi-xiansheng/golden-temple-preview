import { RenderPipeline } from 'three/webgpu';
import { pass, mrt, output, velocity } from 'three/tsl';
import { traa } from 'three/addons/tsl/display/TRAANode.js';

export function createView(renderer, scene, camera, { aa = 'msaa' } = {}) {
  let pipeline, scenePass, temporal, disposed = false;
  const stats = { aa, frames: 0, cpuSubmitMs: 0 };
  function rebuild() {
    temporal?.dispose(); scenePass?.dispose(); pipeline?.dispose();
    pipeline = new RenderPipeline(renderer);
    scenePass = pass(scene, camera, { samples: aa === 'traa' ? 0 : 4 });
    if (aa === 'traa') {
      scenePass.setMRT(mrt({ output, velocity }));
      temporal = traa(scenePass.getTextureNode('output'), scenePass.getTextureNode('depth'), scenePass.getTextureNode('velocity'), camera);
      pipeline.outputNode = temporal;
    } else { temporal = null; pipeline.outputNode = scenePass; }
  }
  rebuild();
  return { stats,
    frame() {
      if (disposed) return;
      const before = performance.now(); pipeline.render();
      stats.cpuSubmitMs = performance.now() - before; stats.frames++;
    },
    resetHistory() { if (aa === 'traa' && !disposed) rebuild(); },
    setAA(value) { if (!['msaa', 'traa'].includes(value)) throw new Error('Unknown antialiasing mode'); if (aa !== value) { aa = value; stats.aa = aa; rebuild(); } },
    dispose() { if (disposed) return; disposed = true; temporal?.dispose(); scenePass.dispose(); pipeline.dispose(); },
  };
}
