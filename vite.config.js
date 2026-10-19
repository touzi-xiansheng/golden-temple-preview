import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  server: { port: 5173, strictPort: true, hmr: false, watch: { ignored: ['**/out/**', '**/ref/**', '**/tools/**', '**/shots/**'] } },
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] },
  build: { rolldownOptions: { input: {
    temple: fileURLToPath(new URL('./index.html', import.meta.url)),
    campus: fileURLToPath(new URL('./campus.html', import.meta.url)),
    campusWebGPU: fileURLToPath(new URL('./campus-webgpu.html', import.meta.url)),
    webgpuLab: fileURLToPath(new URL('./webgpu-lab.html', import.meta.url)),
  } } },
});
