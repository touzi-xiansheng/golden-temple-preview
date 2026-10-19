import { Box3, DataTexture, LinearFilter, Matrix4, RedFormat, UnsignedByteType } from 'three/webgpu';
import { mix, positionWorld, smoothstep, texture, vec2 } from 'three/tsl';

// shortcut: static, ground-level contacts only; rebuild after moving architecture or trees.
export function createContactOcclusion(architecture, trees, { size = 2048 } = {}) {
  const bounds = [-60, -85, 60, 95], stamps = [];
  const matrix = new Matrix4(), world = new Matrix4(), box = new Box3();
  architecture.updateMatrixWorld(true);
  architecture.traverse(object => {
    if (!object.isInstancedMesh || /glass|glaz|sedum|foliage/i.test(object.material?.name || '')) return;
    object.geometry.computeBoundingBox();
    for (let index = 0; index < object.count; index++) {
      object.getMatrixAt(index, matrix); world.multiplyMatrices(object.matrixWorld, matrix);
      box.copy(object.geometry.boundingBox).applyMatrix4(world);
      // Raised slabs, steps and broad ground sheets are receivers, not contact occluders.
      if (box.min.y > .25 || box.max.y < .65 || box.max.y - box.min.y < .5) continue;
      const hx = (box.max.x - box.min.x) / 2, hz = (box.max.z - box.min.z) / 2;
      if (hx < .025 || hz < .025) continue;
      stamps.push({ x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2,
        hx, hz, feather: .42, strength: .38, round: false });
    }
  });
  for (const tree of trees) {
    if (Math.abs(tree.ground || 0) > .2) continue;
    const radius = Math.max(.12, tree.height * .021);
    stamps.push({ x: tree.x, z: tree.z, hx: radius, hz: radius, feather: .48, strength: .48, round: true });
  }
  const data = new Uint8Array(size * size).fill(255), dx = (bounds[2] - bounds[0]) / size, dz = (bounds[3] - bounds[1]) / size;
  for (const stamp of stamps) {
    const reach = stamp.feather * 2.5;
    const minX = Math.max(0, Math.floor((stamp.x - stamp.hx - reach - bounds[0]) / dx));
    const maxX = Math.min(size - 1, Math.ceil((stamp.x + stamp.hx + reach - bounds[0]) / dx));
    const minZ = Math.max(0, Math.floor((stamp.z - stamp.hz - reach - bounds[1]) / dz));
    const maxZ = Math.min(size - 1, Math.ceil((stamp.z + stamp.hz + reach - bounds[1]) / dz));
    for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) {
      const px = Math.abs(bounds[0] + (x + .5) * dx - stamp.x), pz = Math.abs(bounds[1] + (z + .5) * dz - stamp.z);
      const distance = stamp.round ? Math.max(0, Math.hypot(px, pz) - stamp.hx)
        : Math.hypot(Math.max(0, px - stamp.hx), Math.max(0, pz - stamp.hz));
      const visibility = Math.round(255 * (1 - stamp.strength * Math.exp(-2 * (distance / stamp.feather) ** 2)));
      data[z * size + x] = Math.min(data[z * size + x], visibility);
    }
  }
  const map = new DataTexture(data, size, size, RedFormat, UnsignedByteType);
  map.name = 'Static campus ground contacts'; map.minFilter = map.magFilter = LinearFilter; map.needsUpdate = true;
  const uv = positionWorld.xz.sub(vec2(bounds[0], bounds[1])).div(vec2(bounds[2] - bounds[0], bounds[3] - bounds[1]));
  const inside = uv.greaterThanEqual(0).all().and(uv.lessThanEqual(1).all());
  const nearGround = smoothstep(.25, 1.1, positionWorld.y.sub(.12).abs()).oneMinus();
  const node = mix(1, texture(map, uv).r, inside.select(nearGround, 0));
  return { node, map, bounds, stats: { stamps: stamps.length, size, bytes: data.byteLength }, dispose: () => map.dispose() };
}
