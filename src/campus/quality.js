export const QUALITY = {
  performance: { label: '流畅', scale: 0.72, maxPixels: 1280 * 720, shadow: 1024, shadowSearch: 0, shadowSamples: 8, indirect: false, ao: false, bloom: false, samples: 0, planarScale: 0 },
  balanced: { label: '平衡', scale: 1, maxPixels: 1920 * 1080, shadow: 4096, shadowSearch: 4, shadowSamples: 8, indirect: true, ao: true, bloom: false, samples: 2, planarScale: 1 },
  quality: { label: '画质', scale: 1.25, maxPixels: 2560 * 1440, shadow: 4096, shadowSearch: 12, shadowSamples: 20, indirect: true, ao: true, bloom: true, samples: 4, planarScale: 1 },
};

export function renderSize(width, height, quality) {
  const preset = QUALITY[quality] || QUALITY.balanced;
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(height));
  const scale = Math.min(preset.scale, Math.sqrt(preset.maxPixels / (w * h)));
  return { width: Math.max(1, Math.floor(w * scale)), height: Math.max(1, Math.floor(h * scale)) };
}
