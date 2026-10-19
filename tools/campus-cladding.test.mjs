import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Box3, Matrix4, Raycaster, ShaderLib, Vector3 } from 'three';
import { buildBuildings } from '../src/campus/buildings.js';
import { BUILDINGS } from '../src/campus/layout.js';

test('gallery cladding preserves openings and has real, closed joints on all four elevations', () => {
  const architecture=buildBuildings(); architecture.updateMatrixWorld(true);
  const cladding=architecture.getObjectByName('Gallery limestone cladding');
  const gallery=BUILDINGS.find(b=>b.id==='gallery'), piers=[];
  // The original four elevations: regular full-width piers between half-width corner returns.
  for(let side=0;side<4;side++) {
    const angle=side*Math.PI/2, span=side%2?gallery.d:gallery.w;
    const distance=(side%2?gallery.w:gallery.d)/2, count=Math.round(span/4.25), bay=span/count;
    const pier=(u,w,h)=>{
      const x=gallery.x+Math.cos(angle)*u+Math.sin(angle)*(distance+.025);
      const z=gallery.z-Math.sin(angle)*u+Math.cos(angle)*(distance+.025);
      const transform=new Matrix4().makeRotationY(angle).setPosition(x,.16+gallery.floorHeight*1.5,z);
      const bounds=new Box3(new Vector3(-w/2,-h/2,-.375),new Vector3(w/2,h/2,.375)).applyMatrix4(transform);
      piers.push({w,h,transform,bounds});
    };
    for(let i=0;i<count;i++)pier(-span/2+i*bay+(i===0?bay*.17:0),bay*(i===0?.34:.68),gallery.floorHeight-.035);
    pier(span/2-bay*.17,bay*.34,gallery.floorHeight);
  }
  assert.equal(cladding.children.length,1);
  const mesh=cladding.children[0], positions=mesh.geometry.attributes.position;
  const a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(let i=0;i<positions.count;i+=3) {
    a.fromBufferAttribute(positions,i);b.fromBufferAttribute(positions,i+1);c.fromBufferAttribute(positions,i+2);
    assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).lengthSq()>1e-14,'collapsed cladding face');
    for(const point of [a,b,c])assert.ok(piers.some(p=>p.bounds.distanceToPoint(point)<2e-6),'panel expands an old pier or enters a window');
  }
  const colors=mesh.geometry.attributes.color;
  for(let i=0;i<colors.count;i++) {
    const value=colors.getX(i);
    assert.ok((value>=.9699&&value<=1.0301)||Math.abs(value-.52)<1e-6,'invalid linear panel/backing reflectance');
    assert.equal(colors.getY(i),value);assert.equal(colors.getZ(i),value);
  }
  const ray=new Raycaster();let faces=0,joints=0;
  for(const {w,h,transform} of piers) {
    const innerW=w-.016,innerH=h-.016,columns=Math.ceil(innerW/.95);
    const normal=new Vector3(0,0,1).transformDirection(transform);
    const hit=(x,y,depth)=>{
      const target=new Vector3(x,y,depth).applyMatrix4(transform);
      ray.set(new Vector3(x,y,.425).applyMatrix4(transform),normal.clone().negate());
      const first=ray.intersectObject(architecture,true)[0];
      assert.equal(first?.object,mesh,'front/joint must hit the actual cladding, not an old wall or floating strip');
      assert.ok(first.point.distanceTo(target)<3e-6,'incorrect plate or joint depth');
    };
    for(let row=0;row<3;row++)for(let col=0;col<columns;col++) {
      const x=-innerW/2+(col+.5)*innerW/columns,y=-innerH/2+(row+.5)*innerH/3;
      hit(x,y,.375);faces++;
      if(col<columns-1) {
        const jointX=-innerW/2+(col+1)*innerW/columns;
        // Probe both sides of the 6mm opening, beyond its 1mm edge bevels.
        for(const offset of [-.002,0,.002])hit(jointX+offset,y,.365);
        hit(jointX-.006,y,.375);hit(jointX+.006,y,.375);joints++;
      }
      if(row<2) {
        const jointY=-innerH/2+(row+1)*innerH/3;
        for(const offset of [-.002,0,.002])hit(x,jointY+offset,.365);
        hit(x,jointY-.006,.375);hit(x,jointY+.006,.375);joints++;
      }
    }
  }
  assert.equal(faces,228);assert.equal(joints,296);
  assert.deepEqual(architecture.userData.galleryCladding,{piers:28,panels:faces,triangles:positions.count/3,meshes:1});
  assert.equal(positions.count/3,11264);
  let triangles=0,panes=0;const records=[],hash=createHash('sha256');
  architecture.traverse(object=>{
    if(object.isMesh)triangles+=(object.geometry.index?.count??object.geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);
    if(!object.material?.userData.campusGlass)return;
    panes+=object.count;
    const attributes=[object.instanceMatrix,...['paneDetail','paneSize','paneRoom','paneType'].map(name=>object.geometry.getAttribute(name))];
    for(let i=0;i<object.count;i++)records.push(Buffer.concat(attributes.map(attribute=>{
      const a=attribute.array,bytes=a.BYTES_PER_ELEMENT;
      return Buffer.from(a.buffer,a.byteOffset+i*attribute.itemSize*bytes,attribute.itemSize*bytes);
    })));
  });
  // The accepted commons-recess fixture, sorted by complete pane records, ignores only material batching order.
  records.sort(Buffer.compare);for(const record of records)hash.update(record);
  assert.equal(hash.digest('hex'),'1221f58f2e493721f71a7b1659c99ed0e0f0316a8ee3695a5673a5fc850e2a46');
  assert.equal(panes,3444);assert.equal(triangles,architecture.userData.triangles);
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  mesh.material.onBeforeCompile(shader);
  assert.ok(shader.uniforms.uMaterialGrain,'cloned limestone lost its metre-scale material hook');
  const geometries=new Set(),materials=new Set();
  architecture.traverse(object=>{if(object.isMesh){geometries.add(object.geometry);materials.add(object.material);}});
  for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
});
