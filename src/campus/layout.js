// Metres, +Y up. The campus entrance faces south (+Z).
export const CAMPUS = { name: '澄境科技园', bounds: { minX: -130, maxX: 130, minZ: -105, maxZ: 116 } };

export const BUILDINGS = [
  { id: 'hq', name: '创新中心', x: 0, z: -64, w: 58, d: 22, floors: 8, floorHeight: 3.8, kind: 'headquarters', entranceSide: 'south' },
  { id: 'a', name: '研发 A 座', x: -31, z: -24, w: 20, d: 44, floors: 5, floorHeight: 3.6, kind: 'office', variant: 0, entranceSide: 'east', arcade: true },
  { id: 'b', name: '研发 B 座', x: 31, z: -22, w: 20, d: 40, floors: 6, floorHeight: 3.6, kind: 'office', variant: 1, entranceSide: 'west' },
  { id: 'c', name: '研发 C 座', x: -34, z: 29, w: 22, d: 38, floors: 4, floorHeight: 3.6, kind: 'office', variant: 1, entranceSide: 'east', arcade: true },
  { id: 'd', name: '研发 D 座', x: 34, z: 31, w: 22, d: 42, floors: 5, floorHeight: 3.6, kind: 'office', variant: 0, entranceSide: 'west' },
  { id: 'commons', name: '园区客厅', x: -22, z: 66, w: 30, d: 18, floors: 2, floorHeight: 4.2, kind: 'commons', entranceSide: 'north' },
  { id: 'gallery', name: '展示中心', x: 23, z: 69, w: 28, d: 20, floors: 2, floorHeight: 4.2, kind: 'gallery', entranceSide: 'north' },
];

export const COURTYARDS = [
  { id: 'grove', x: 0, z: -22, rx: 13, rz: 17, walkRx: 16.5, walkRz: 21, walkWidth: 4 },
  { id: 'garden', x: 0, z: 29, rx: 15, rz: 18, walkRx: 18, walkRz: 22, walkWidth: 4 },
];

export function entrancePoint(b, offset = 0) {
  const [nx, nz] = { south: [0,1], east: [1,0], north: [0,-1], west: [-1,0] }[b.entranceSide || 'south'];
  return { x: b.x + nx * (b.w / 2 + offset), z: b.z + nz * (b.d / 2 + offset), nx, nz };
}

export function footprint(b, margin = 0) {
  return { minX: b.x - b.w / 2 - margin, maxX: b.x + b.w / 2 + margin, minZ: b.z - b.d / 2 - margin, maxZ: b.z + b.d / 2 + margin };
}
