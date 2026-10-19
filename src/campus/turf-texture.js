import * as THREE from 'three';
import { rng } from '../core/rng.js';

// A 1.6 m tile of overlapping cut blades; mipmaps average unresolved blades into turf color.
export function createTurfTextures() {
  const size = 512, color = document.createElement('canvas'), height = document.createElement('canvas');
  color.width = color.height = height.width = height.height = size;
  const c = color.getContext('2d'), h = height.getContext('2d'), random = rng('campus-cut-turf');
  c.fillStyle = '#2c401c'; c.fillRect(0, 0, size, size);
  h.fillStyle = '#303030'; h.fillRect(0, 0, size, size);
  for (let i = 0; i < 36000; i++) {
    const x = random.float(0, size), y = random.float(0, size), a = random.float(0, Math.PI * 2);
    const length = random.float(3, 16), width = random.float(0.35, 1.2), bend = random.float(-3, 3);
    const dx = Math.cos(a), dy = Math.sin(a), green = random.int(63, 104), dry = random.chance(0.075);
    const tint = `rgb(${Math.round(green * (dry ? 0.90 : 0.64))},${green},${Math.round(green * (dry ? 0.48 : 0.35))})`;
    const elevation = random.int(90, 215);
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const px = x + ox, py = y + oy;
      if (px < -18 || px > size + 18 || py < -18 || py > size + 18) continue;
      for (const [ctx, shade] of [[c, tint], [h, `rgb(${elevation},${elevation},${elevation})`]]) {
        ctx.strokeStyle = shade; ctx.lineWidth = width; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + dx * length * 0.55 - dy * bend, py + dy * length * 0.55 + dx * bend, px + dx * length, py + dy * length);
        ctx.stroke();
      }
    }
  }
  const map = new THREE.CanvasTexture(color), bump = new THREE.CanvasTexture(height);
  map.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [map, bump]) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
  }
  return { map, bump, metres: 1.6 };
}
