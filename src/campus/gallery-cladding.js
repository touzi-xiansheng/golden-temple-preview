import * as THREE from 'three';
import { Builder, mat4 } from '../core/geom.js';
import { rng } from '../core/rng.js';

// Retain the existing pier envelope and window reveals; only its flat front is panelled.
export function buildGalleryCladding(piers, stone, chamferedBox) {
  const builder = new Builder(), randoms = new Map();
  const material = stone.clone();
  material.name = 'Jointed gallery limestone';
  material.vertexColors = true;
  // Three material cloning does not preserve custom shader hooks.
  material.onBeforeCompile = stone.onBeforeCompile;
  material.customProgramCacheKey = stone.customProgramCacheKey;
  const tint = (geometry, value) => {
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    colors.fill(value); // Linear reflectance multiplier.
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geometry;
  };
  let panels = 0;
  for (const { x, y, z, w, h, d, side } of piers) {
    if (!randoms.has(side)) randoms.set(side, rng(`gallery-${['south','east','north','west'][side]}-cladding-v1`));
    const random = randoms.get(side), transform = mat4([x,y,z], [0,side*Math.PI/2,0]);
    const radius = .008, joint = .006, front = d/2;
    const original = chamferedBox(w,h,d,radius), source = original.attributes.position;
    const positions = [];
    for (let i=0; i<source.count; i+=3) {
      if ([0,1,2].every(j => Math.abs(source.getZ(i+j)-front)<1e-6)) continue;
      for (let j=0; j<3; j++) positions.push(source.getX(i+j),source.getY(i+j),source.getZ(i+j));
    }
    const rim = new THREE.BufferGeometry();
    rim.setAttribute('position', new THREE.Float32BufferAttribute(positions,3));
    rim.computeVertexNormals();
    builder.add(tint(rim,1), material, transform);
    const innerW = w-2*radius, innerH = h-2*radius;
    const backing = new THREE.PlaneGeometry(innerW,innerH);
    backing.translate(0,0,front-.01);
    builder.add(tint(backing,.52), material, transform);
    const columns = Math.ceil(innerW/.95), rows = 3;
    for (let row=0; row<rows; row++) for (let col=0; col<columns; col++) {
      const minX=-innerW/2+col*innerW/columns+(col?joint/2:0);
      const maxX=-innerW/2+(col+1)*innerW/columns-(col<columns-1?joint/2:0);
      const minY=-innerH/2+row*innerH/rows+(row?joint/2:0);
      const maxY=-innerH/2+(row+1)*innerH/rows-(row<rows-1?joint/2:0);
      const tile = chamferedBox(maxX-minX,maxY-minY,.05,.001);
      tile.translate((minX+maxX)/2,(minY+maxY)/2,front-.025);
      builder.add(tint(tile,random.float(.97,1.03)), material, transform);
      tile.dispose(); panels++;
    }
    original.dispose(); rim.dispose(); backing.dispose();
  }
  const group = builder.build({ name:'Gallery limestone cladding' });
  const triangles = group.children.reduce((sum,mesh) => sum+mesh.geometry.attributes.position.count/3,0);
  group.userData = { piers:piers.length, panels, triangles, meshes:group.children.length };
  return group;
}
