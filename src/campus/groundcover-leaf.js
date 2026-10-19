import * as THREE from 'three';

// Longitudinal sections keep broad leaves cupped instead of fanning every face from the stem.
export function groundcoverLeafGeometry() {
  const positions = [0, 0, 0], uv = [0.5, 0], indices = [0, 2, 1, 0, 3, 2];
  for (const t of [0.15, 0.32, 0.5, 0.7, 0.86]) {
    const arch = Math.sin(Math.PI * t), width = 0.5 * Math.pow(arch, 0.72);
    const bend = 0.035 * arch - 0.07 * t * t;
    for (const side of [-1, 0, 1]) {
      const x = side * width;
      positions.push(x, t, bend + (side === 0 ? 0.004 : -0.015) * arch);
      uv.push(x + 0.5, t);
    }
  }
  for (let a = 1; a < 13; a += 3) {
    const b = a + 3;
    indices.push(a, a + 1, b, a + 1, b + 1, b, a + 1, a + 2, b + 1, a + 2, b + 2, b + 1);
  }
  positions.push(0, 1, -0.07); uv.push(0.5, 1);
  indices.push(13, 14, 16, 14, 15, 16);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}
