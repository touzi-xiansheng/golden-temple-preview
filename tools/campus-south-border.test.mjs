import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { Builder, mat4 } from '../src/core/geom.js';
import { COURTYARDS } from '../src/campus/layout.js';
import { buildVegetation } from '../src/campus/vegetation.js';

const source=readFileSync(new URL('../src/campus/landscape.js',import.meta.url),'utf8');
function sourceBetween(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing landscape source seam: ${start}`);
  return source.slice(a,b);
}
// Exercise the private production helpers without exporting a test-only runtime API.
function landscapeHelpers() {
  const helpers=sourceBetween('function southBorderContour(', 'export function buildLandscape()');
  const island=sourceBetween('  function island(', '  const courtPaths=');
  const emit=sourceBetween('  function emitPolygon(', '  function polygon(');
  return new Function('THREE','Builder','mat4',`
    const TAU=Math.PI*2;function polygon(){}
    ${helpers}\n${island}\n${emit}
    return {southBorderContour,southBorderOutline,cutSouthBorderLawn,filterSouthBorderGrass,island,emitPolygon};
  `)(THREE,Builder,mat4);
}

function dispose(group) {
  const geometries=new Set(),materials=new Set();
  group.traverse(object=>{if(object.isMesh){geometries.add(object.geometry);materials.add(object.material);}});
  for(const geometry of geometries)geometry.dispose();
  for(const material of materials){for(const value of Object.values(material))if(value?.isTexture)value.dispose();material.dispose();}
}

test('south border cuts the actual four crossings into two lawns with one top surface and rejects changed topology', () => {
  const {island,southBorderOutline,southBorderContour,cutSouthBorderLawn,emitPolygon}=landscapeHelpers();
  const garden=COURTYARDS.find(c=>c.id==='garden');
  const lawn=island(garden,garden.rx,garden.rz,null,1);
  // Only the two existing bed definitions are needed; no plant-pool or generated-coordinate fixture.
  const beds=[[-10.5,20,3,7.5],[-9,36,4,6]].map(([x,z,rx,rz])=>island({x,z},rx,rz,null,z));
  const soil=southBorderOutline(beds),snapshot=JSON.stringify({lawn,soil});
  const result=cutSouthBorderLawn(lawn,soil);
  assert.equal(JSON.stringify({lawn,soil}),snapshot,'successful cut mutated its inputs');
  assert.equal(result.lawnOutlines.length,2);
  const crossings=result.soilOutline.filter(p=>!soil.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<1e-8));
  assert.equal(crossings.length,4,'each proper crossing must also split the soil edge');
  const edges=crossings.map(p=>lawn.findIndex((a,i)=>{
    const b=lawn[(i+1)%lawn.length],dx=b.x-a.x,dz=b.z-a.z;
    const t=((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz);
    return t>0&&t<1&&Math.hypot(p.x-a.x-t*dx,p.z-a.z-t*dz)<1e-8;
  }));
  assert.ok(edges.every(i=>i>=0));
  assert.deepEqual([...new Set(edges)].map(i=>edges.filter(j=>j===i).length).sort(),[1,1,2],
    'the two crossings on one garden edge must both survive fractional ordering');
  for(const point of crossings)assert.ok(result.lawnOutlines.some(loop=>loop.includes(point)),
    'lawn and soil must reuse the same intersection point, avoiding T-junctions');

  const area=points=>Math.abs(THREE.ShapeUtils.area(points.map(p=>new THREE.Vector2(p.x,p.z))));
  assert.ok(Math.abs(area(soil)-154.35945194836518)<1e-8);
  const grassMaterial=new THREE.MeshStandardMaterial(),soilMaterial=new THREE.MeshStandardMaterial(),builder=new Builder();
  for(const loop of result.lawnOutlines)emitPolygon(loop,grassMaterial,-.007,.035,[],builder);
  emitPolygon(result.soilOutline,soilMaterial,-.007,.035,[],builder);
  const group=builder.build();group.updateMatrixWorld(true);
  try {
    for(const mesh of group.children) {
      const positions=mesh.geometry.attributes.position,normals=mesh.geometry.attributes.normal;let topArea=0;
      for(let i=0;i<positions.count;i+=3) {
        if(normals.getY(i)<.999)continue;
        const [a,b,c]=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,i+j));
        const triangleArea=b.sub(a).cross(c.sub(a)).length()/2;
        assert.ok(triangleArea>1e-14,'collapsed surface triangle');topArea+=triangleArea;
      }
      const expected=mesh.material===grassMaterial?result.lawnOutlines.reduce((sum,p)=>sum+area(p),0):area(soil);
      assert.ok(Math.abs(topArea-expected)<.0001,'actual Float32 top area differs from the contour');
    }
    const ray=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0),0,1);
    let grassHits=0,soilHits=0,emptyHits=0;
    for(let x=-15.777;x<15.9;x+=.827)for(let z=10.123;z<47.9;z+=.833) {
      const a=southBorderContour(x,z,lawn),b=southBorderContour(x,z,soil);
      if(Math.min(a.distance,b.distance)<2e-5)continue;
      const expected=b.inside?soilMaterial:a.inside?grassMaterial:null;
      ray.ray.origin.set(x,.3,z);
      const hits=ray.intersectObject(group,true).filter(hit=>hit.face.normal.y>.999);
      assert.equal(hits.length,expected?1:0,`overlap or gap at ${x},${z}`);
      if(expected){assert.equal(hits[0].object.material,expected);assert.ok(Math.abs(hits[0].point.y+.007)<1e-7);}
      if(expected===grassMaterial)grassHits++;else if(expected===soilMaterial)soilHits++;else emptyHits++;
    }
    assert.ok(grassHits>500&&soilHits>100&&emptyHits>100,'fixture must test grass, soil and exterior');
  }finally{dispose(group);}
  const shifted=soil.map(p=>({x:p.x-100,z:p.z})),failureSnapshot=JSON.stringify({lawn,shifted});
  assert.throws(()=>cutSouthBorderLawn(lawn,shifted),/four proper crossings/);
  assert.equal(JSON.stringify({lawn,shifted}),failureSnapshot,'failed cut changed its inputs');
});

test('south border filters crossing grass triangles without changing retained Float32 instances', () => {
  const {filterSouthBorderGrass}=landscapeHelpers();
  const patch=[{x:-.1,z:-.2},{x:.1,z:-.2},{x:.1,z:.2},{x:-.1,z:.2}];
  const geometry=new THREE.BufferGeometry();
  // Every vertex is outside the patch; the long blade edges still pass through it.
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([-2,0,0,2,0,0,-2,.1,.1],3));geometry.setIndex([0,1,2]);
  const material=new THREE.MeshBasicMaterial(),groups=[];
  const fixture=()=>{
    const group=new THREE.Group(),mesh=new THREE.InstancedMesh(geometry,material,2);mesh.name='lawn-edge:0,0';
    mesh.setMatrixAt(0,new THREE.Matrix4());mesh.setMatrixAt(1,new THREE.Matrix4().makeTranslation(5,0,0));
    group.add(mesh);groups.push(group);return{group,mesh};
  };
  try {
    const {group,mesh}=fixture(),kept=new Float32Array(mesh.instanceMatrix.array.slice(16,32));
    const removed=filterSouthBorderGrass(group,'lawn-edge',patch,[]);
    assert.equal(removed.length,1);assert.equal(removed[0].index,0);assert.equal(mesh.count,1);
    assert.deepEqual(mesh.instanceMatrix.array,kept,'retained instance bytes changed');
    assert.ok(mesh.boundingBox.min.x>2.9&&mesh.boundingSphere.center.x>4.9,'filtered bounds were not refreshed');
    const original=fixture(),matrix=new Float32Array(original.mesh.instanceMatrix.array);
    assert.equal(filterSouthBorderGrass(original.group,'lawn-edge',patch,[patch]).length,0,'old soil is not newly occupied soil');
    assert.deepEqual(original.mesh.instanceMatrix.array,matrix);
    assert.equal(filterSouthBorderGrass(original.group,'mown-turf',patch,[]).length,0,'unrelated mesh prefix was filtered');
    assert.deepEqual(original.mesh.instanceMatrix.array,matrix);
  }finally{geometry.dispose();material.dispose();}
});

test('south border shape replay translates actual cover and flower instances without changing coordinate-dependent growth', () => {
  const previousDocument=globalThis.document;
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'
    ? (x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}) : ()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  const groups=[];
  try {
    const plants=[
      {kind:'groundcover',x:-10.5,z:20,height:.24,radius:.48,ground:-.005},
      {kind:'flower',x:-9,z:36,height:.56,radius:.48,ground:-.005},
    ].map(p=>({...p,shapeSeed:`campus-plant:${p.kind}:${p.x}:${p.z}`}));
    const dx=60,dz=-60;
    const moved=plants.map(p=>({...p,x:p.x+dx,z:p.z+dz,southBorderOrigin:[p.x,p.z]}));
    const before=buildVegetation([],[],plants),after=buildVegetation([],[],moved);groups.push(before,after);
    const records=group=>{
      const result=new Map();
      for(const mesh of group.children) {
        const kind=mesh.name.slice(0,mesh.name.lastIndexOf(':'));
        if(!result.has(kind))result.set(kind,[]);
        for(let i=0;i<mesh.count;i++)result.get(kind).push({mesh,index:i,matrix:Array.from(mesh.instanceMatrix.array.subarray(i*16,i*16+16))});
      }
      return result;
    };
    const a=records(before),b=records(after);
    assert.deepEqual([...a.keys()].sort(),['broadleaf-groundcover','individual-foliage','perennial-flowers','perennial-stems']);
    assert.deepEqual([...b.keys()].sort(),[...a.keys()].sort());
    for(const [kind,old]of a) {
      const next=b.get(kind);assert.equal(next.length,old.length);
      for(let i=0;i<old.length;i++) {
        const x=old[i],y=next[i];
        for(let k=0;k<16;k++) {
          const delta=k===12?dx:k===14?dz:0;
          assert.ok(Math.abs(y.matrix[k]-x.matrix[k]-delta)<6e-6,`${kind}: changed local shape`);
        }
        assert.deepEqual(y.mesh.geometry.index.array,x.mesh.geometry.index.array);
        for(const [name,attribute]of Object.entries(x.mesh.geometry.attributes)) {
          const other=y.mesh.geometry.attributes[name],n=attribute.itemSize;
          if(attribute.isInstancedBufferAttribute)
            assert.deepEqual(other.array.subarray(y.index*n,y.index*n+n),attribute.array.subarray(x.index*n,x.index*n+n),`${kind}/${name}`);
          else assert.deepEqual(other.array,attribute.array,`${kind}/${name}`);
        }
        if(x.mesh.instanceColor)assert.deepEqual(y.mesh.instanceColor.array.subarray(y.index*3,y.index*3+3),x.mesh.instanceColor.array.subarray(x.index*3,x.index*3+3));
      }
    }
  }finally{for(const group of groups)dispose(group);globalThis.document=previousDocument;}
});
