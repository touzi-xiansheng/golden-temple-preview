import { WebGPURenderer, AgXToneMapping, SRGBColorSpace } from 'three/webgpu';

export async function createRenderer(canvas, { onError = () => {}, onLost = () => {} } = {}) {
  if (!globalThis.isSecureContext) throw new Error('WebGPU 需要安全连接。请使用 HTTPS 地址，或在本机通过 localhost 打开。');
  if (!navigator.gpu) throw new Error('此浏览器未提供 WebGPU，请使用支持 WebGPU 的浏览器打开。');
  const renderer = new WebGPURenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance', trackTimestamp: true });
  try {
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) throw new Error('未能初始化真实 WebGPU 后端。可通过下方链接打开原版园区。');
  } catch (error) {
    renderer.dispose();
    throw error;
  }
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = AgXToneMapping;
  renderer.toneMappingExposure = 1;
  renderer.shadowMap.enabled = true;
  renderer.info.autoReset = false;
  const device = renderer.backend.device;
  const info = device.adapterInfo;
  const errors = [];
  const uncaptured = event => { const message = event.error.message; errors.push(message); onError(message); };
  device.addEventListener('uncapturederror', uncaptured);
  renderer.onDeviceLost = info => onLost(info);
  const capabilities = {
    backend: 'webgpu', secureContext: isSecureContext,
    adapter: Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'isFallbackAdapter'].map(key => [key, info?.[key] ?? null])),
    features: [...device.features].sort(), compatibilityMode: renderer.backend.compatibilityMode,
    limits: Object.fromEntries(['maxTextureDimension2D', 'maxTextureDimension3D', 'maxStorageBufferBindingSize', 'maxBufferSize', 'maxStorageBuffersPerShaderStage', 'maxComputeWorkgroupSizeX'].map(key => [key, device.limits[key]])),
  };
  return { renderer, capabilities, errors, dispose() { device.removeEventListener('uncapturederror', uncaptured); renderer.dispose(); } };
}
