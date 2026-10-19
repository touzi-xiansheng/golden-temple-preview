import * as THREE from 'three';

export function shrubLeafGeometry() {
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-.35,.24,.012,-.5,.64,.04,0,1,.075,.5,.64,.055,.35,.24,.02],3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute([.5,0,.15,.24,0,.64,.5,1,1,.64,.85,.24],2));
  geometry.setIndex([0,2,1,0,3,2,0,4,3,0,5,4]);geometry.computeVertexNormals();
  return geometry;
}

// Near leaves retain the same root, tip, size and UV convention as the four-triangle leaf.
export function curvedShrubLeafGeometry() {
  const positions=[0,0,0],uv=[.5,0],indices=[0,2,1,0,3,2];
  // A longitudinal midrib and shallow cup replace the fan of triangles at the root.
  // y, half width, midrib z, left-edge z, right-edge z; the leaf opens towards +Z.
  for(const [y,width,mid,left,right] of [
    [.22,.32,.012,.035,.040],
    [.55,.50,.055,.080,.087],
    [.80,.30,.084,.106,.101],
  ]) {
    positions.push(-width,y,left,0,y,mid,width,y,right);
    uv.push(.5-width,y,.5,y,.5+width,y);
  }
  positions.push(0,1,.075);uv.push(.5,1);
  for(let row=0;row<2;row++)for(let side=0;side<2;side++) {
    const a=1+row*3+side,b=a+1,c=a+3,d=a+4;
    indices.push(a,b,c,b,d,c);
  }
  indices.push(7,8,10,8,9,10);
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
  geometry.setIndex(indices);geometry.computeVertexNormals();
  geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}
