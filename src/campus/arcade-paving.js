import * as THREE from 'three';

// Join rectangular cuts back into one stone: internal partition edges are not joints.
export function cutPavingStone(rectangles, top, thickness, bevel) {
  const xs=[...new Set(rectangles.flatMap(r=>[r[0],r[1]]))].sort((a,b)=>a-b);
  const zs=[...new Set(rectangles.flatMap(r=>[r[2],r[3]]))].sort((a,b)=>a-b);
  const nx=xs.length-1,nz=zs.length-1,filled=new Set(),edges=new Map();
  for(let x=0;x<nx;x++)for(let z=0;z<nz;z++) {
    const cx=(xs[x]+xs[x+1])/2,cz=(zs[z]+zs[z+1])/2;
    if(rectangles.some(r=>cx>r[0] && cx<r[1] && cz>r[2] && cz<r[3]))filled.add(`${x},${z}`);
  }
  const edge=(x,z,xx,zz)=>{
    const key=`${x},${z}`;
    if(!edges.has(key))edges.set(key,[]);
    edges.get(key).push([xx,zz]);
  };
  for(const cell of filled) {
    const [x,z]=cell.split(',').map(Number);
    if(!filled.has(`${x},${z-1}`))edge(x,z,x+1,z);
    if(!filled.has(`${x+1},${z}`))edge(x+1,z,x+1,z+1);
    if(!filled.has(`${x},${z+1}`))edge(x+1,z+1,x,z+1);
    if(!filled.has(`${x-1},${z}`))edge(x,z+1,x,z);
  }
  const rings=[];
  while(edges.size) {
    const first=edges.keys().next().value,ring=[];
    let key=first;
    do {
      const [x,z]=key.split(',').map(Number);ring.push(new THREE.Vector2(xs[x],zs[z]));
      const options=edges.get(key),next=options.pop();
      if(!options.length)edges.delete(key);
      key=next.join(',');
    } while(key!==first);
    const corners=ring.filter((p,i)=>{
      const a=ring[(i+ring.length-1)%ring.length],b=ring[(i+1)%ring.length];
      return Math.abs((p.x-a.x)*(b.y-p.y)-(p.y-a.y)*(b.x-p.x))>1e-12;
    });
    rings.push(corners);
  }
  const inset=ring=>ring.map((point,i)=>{
    const before=point.clone().sub(ring[(i+ring.length-1)%ring.length]).normalize();
    const after=ring[(i+1)%ring.length].clone().sub(point).normalize();
    return point.clone().addScaledVector(new THREE.Vector2(-before.y-after.y,before.x+after.x),bevel);
  });
  const inner=rings.map(inset),positions=[];
  const triangle=(a,b,c,normal)=>{
    const cross=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a));
    if(cross.dot(normal)<0)[b,c]=[c,b];
    positions.push(...a,...b,...c);
  };
  const quad=(a,b,c,d,normal)=>{triangle(a,b,c,normal);triangle(a,c,d,normal);};
  const at=(p,y)=>new THREE.Vector3(p.x,y,p.y),up=new THREE.Vector3(0,1,0),down=new THREE.Vector3(0,-1,0);
  const contains=(ring,p)=>{
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
      const a=ring[i],b=ring[j];
      if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;
    }
    return inside;
  };
  for(let i=0;i<rings.length;i++) {
    const ring=rings[i],inside=inner[i];
    if(THREE.ShapeUtils.area(ring)>0) {
      const holes=inner.filter((_,j)=>THREE.ShapeUtils.area(rings[j])<0 && contains(ring,rings[j][0]));
      // triangulateShape mutates input winding, so give it copies for the edge rings below.
      const contour=inside.map(p=>p.clone()),holeCopies=holes.map(h=>h.map(p=>p.clone()));
      const indices=THREE.ShapeUtils.triangulateShape(contour,holeCopies),points=contour.concat(...holeCopies);
      for(const [a,b,c] of indices) {
        triangle(at(points[a],top),at(points[b],top),at(points[c],top),up);
        triangle(at(points[a],top-thickness),at(points[b],top-thickness),at(points[c],top-thickness),down);
      }
    }
    for(let j=0;j<ring.length;j++) {
      const k=(j+1)%ring.length,a=ring[j],b=ring[k],side=new THREE.Vector3(b.y-a.y,0,a.x-b.x).normalize();
      quad(at(a,top-bevel),at(b,top-bevel),at(inside[k],top),at(inside[j],top),side.clone().add(up));
      quad(at(a,top-thickness+bevel),at(b,top-thickness+bevel),at(b,top-bevel),at(a,top-bevel),side);
      quad(at(a,top-thickness+bevel),at(b,top-thickness+bevel),at(inside[k],top-thickness),at(inside[j],top-thickness),side.clone().add(down));
    }
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();geometry.computeBoundingBox();
  geometry.userData.footprint=rings.map(r=>r.map(p=>p.toArray()));
  return geometry;
}
