import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Matrix4, Mesh, MeshBasicMaterial, Raycaster, Triangle, Vector3 } from 'three';
import { buildBuildings } from '../src/campus/buildings.js';
import { buildLandscape } from '../src/campus/landscape.js';
import { cafeProbePlan } from '../src/campus/indirect-light.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-5,`${a} != ${b}`);
let architecture,local;
function dispose(root) {
  const geometries=new Set(),materials=new Set();
  root?.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);materials.add(o.material);}});
  for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
}
// Copy only actual triangles near the cafe, keeping both faces ray-testable.
function cafeGeometry(root) {
  const domain=new Box3(new Vector3(-30,-.01,52),new Vector3(-6,4.5,76)),group=new Group();
  root.traverse(mesh=>{
    if(!mesh.isMesh)return;
    const g=mesh.geometry,p=g.attributes.position,index=g.index,positions=[];
    const bounds=new Box3().setFromBufferAttribute(p);
    for(let instance=0;instance<(mesh.isInstancedMesh?mesh.count:1);instance++) {
      const matrix=new Matrix4();
      if(mesh.isInstancedMesh)mesh.getMatrixAt(instance,matrix);
      matrix.premultiply(mesh.matrixWorld);
      if(!bounds.clone().applyMatrix4(matrix).intersectsBox(domain))continue;
      for(let i=0;i<(index?.count??p.count);i+=3) {
        const triangle=[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,index?index.getX(i+j):i+j).applyMatrix4(matrix));
        if(new Box3().setFromPoints(triangle).intersectsBox(domain))positions.push(...triangle.flatMap(v=>v.toArray()));
      }
    }
    if(!positions.length)return;
    const geometry=new BufferGeometry();geometry.setAttribute('position',new Float32BufferAttribute(positions,3));
    const copy=new Mesh(geometry,new MeshBasicMaterial({side:DoubleSide}));copy.name=mesh.material.name;group.add(copy);
  });
  group.updateMatrixWorld(true);return group;
}
function hits(origin,direction,far=30,object=local) {
  return new Raycaster(new Vector3(...origin),new Vector3(...direction),0,far).intersectObject(object,true);
}
before(()=>{architecture=buildBuildings();architecture.updateMatrixWorld(true);local=cafeGeometry(architecture);});
after(()=>{dispose(local);dispose(architecture);});

test('commons cafe is a real recessed cavity with a closed rear wall and supported roof',()=>{
  assert.ok(architecture.userData.commonsCafe,'commons cafe has not been built');
  for(const z of [59.1,61.6,64.5,67,69.7,72.4]) {
    const facade=hits([-6.7,2,z],[-1,0,0],6)[0];assert.ok(facade);
    assert.ok(facade.point.x< -12.08&&facade.point.x> -12.3,'old exterior glass/frame/core blocks the five-metre recess');
    const core=hits([-11.9,2,z],[-1,0,0],1).find(h=>h.object.name==='Recessed entrance interior');
    assert.ok(core,'rear glazing has no closed backing');near(core.point.x,-12.23);
  }
  for(const z of [59,65,72]) {
    near(hits([-9,1,z],[0,1,0],4)[0].point.y,3.92);
    near(hits([-9,1,z],[0,-1,0],2)[0].point.y,.16);
  }
  const columns=[];
  architecture.traverse(mesh=>{
    if(!mesh.isInstancedMesh||mesh.material.name!=='Charcoal powder coated metal')return;
    const bounds=new Box3().setFromBufferAttribute(mesh.geometry.attributes.position),matrix=new Matrix4();
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);
      const box=bounds.clone().applyMatrix4(matrix),center=box.getCenter(new Vector3());
      if(Math.abs(center.x+7.35)<1e-5&&box.max.y-box.min.y>3&&[57.8,63.2,68.6,74].some(z=>Math.abs(z-center.z)<1e-5))columns.push(box);
    }
  });
  assert.equal(columns.length,4);
  for(const column of columns){near(column.min.y,.16);near(column.max.y,3.92);near(column.max.x-column.min.x,.24);}
});

test('three cafe table groups leave the north connection and east 1.8m passage clear',()=>{
  const furniture=architecture.getObjectByName('Commons cafe tables and chairs');assert.ok(furniture);
  const bounds=new Box3().setFromObject(furniture);
  assert.ok(bounds.max.x<= -10.46999,'chairs intrude toward the east passage');
  assert.ok(bounds.min.y<=.16&&bounds.min.y>=.158,'sloping leg caps must touch, not float above, the floor');
  for(const z of [60.5,65.7,70.9]) {
    near(hits([-10.9,.95,z],[0,-1,0],.2)[0].point.y,.9);
    for(const offset of [-.82,.82])near(hits([-10.9,.8,z+offset],[0,-1,0],.3)[0].point.y,.61);
  }
  for(const [x0,x1,z0,z1]of [[-22,-7.9,54.65,56.45],[-9.7,-7.9,54.65,74.6]]) {
    for(let x=x0+.02;x<x1;x+=.45)for(let z=z0+.02;z<z1;z+=.45)near(hits([x,.25,z],[0,-1,0],.3)[0].point.y,.16);
  }
  for(const y of [.3,1.1,1.9])for(const across of [.02,.9,1.78]) {
    assert.equal(hits([-21.99,y,54.65+across],[1,0,0],14.08).length,0,'north route blocked by a portal post');
    assert.equal(hits([-9.7+across,y,54.67],[0,0,1],19.9).length,0,'east route blocked by a chair or support');
  }
  let triangles=0;
  architecture.traverse(o=>{if(o.isMesh)triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*(o.isInstancedMesh?o.count:1);});
  assert.equal(triangles,architecture.userData.triangles,'reported cost omits furniture or closed ramp faces');
});

test('commons ramp meets actual entry paving and the clear turning square without open sides',()=>{
  assert.ok(architecture.userData.commonsCafe,'commons cafe has not been built');
  for(const x of [-20.39,-19.8,-19.21])for(const z of [52.58,53.61,54.64]) {
    near(hits([x,.3,z],[0,-1,0],.3)[0].point.y,.075+(z-52.57)*.085/2.08);
  }
  for(const [origin,direction,axis,value]of [
    [[-20.5,.1,54],[1,0,0],'x',-20.4],[[-19.1,.1,54],[-1,0,0],'x',-19.2],
    [[-19.8,0,53.5],[0,1,0],'y',.055],[[-19.8,.3,52.57],[0,-1,0],'y',.075],
    [[-19.8,.3,54.65],[0,-1,0],'y',.16],
  ])near(hits(origin,direction,.6)[0].point[axis],value);
  for(const x of [-20.69,-19.8,-18.91])for(const z of [54.66,55.55,56.44])near(hits([x,.3,z],[0,-1,0],.3)[0].point.y,.16);
  for(const y of [.3,1.1,1.9])for(const x of [-20.39,-19.8,-19.21])assert.equal(hits([x,y,52.58],[0,0,1],3.86).length,0);
  const previousDocument=globalThis.document;
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'?(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):String(key).includes('Gradient')?()=>({addColorStop(){}}):key==='measureText'?()=>({width:100}):()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  let landscape;
  try {
    landscape=buildLandscape();landscape.updateMatrixWorld(true);
    const site=landscape.getObjectByName('campus-site');assert.ok(site);
    for(const x of [-20.4,-19.8,-19.2])for(const z of [52.57,53.61,54.65]) {
      const pavement=hits([x,.3,z],[0,-1,0],.3,site)[0];assert.ok(pavement,'ramp leaves the paved entrance approach');near(pavement.point.y,.075);
    }
  } finally {globalThis.document=previousDocument;dispose(landscape);}
});

test('cafe irradiance probes clear real surfaces and sample the correct side of the recess',()=>{
  const plan=cafeProbePlan(),{grid}=plan,triangles=[],point=new Vector3(),closest=new Vector3();
  const domain=new Box3(plan.min.clone(),plan.max.clone()).expandByScalar(1e-5);
  const directions=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const offset=grid.boundingBox.getSize(new Vector3()).divide(grid.resolution.clone().subScalar(1)).multiplyScalar(.1).min(new Vector3(.35,.35,.35));
  local.traverse(mesh=>{if(mesh.isMesh){const p=mesh.geometry.attributes.position;
    for(let i=0;i<p.count;i+=3)triangles.push(new Triangle(...[0,1,2].map(j=>new Vector3().fromBufferAttribute(p,i+j))));
  }});
  try {
    let count=0;
    for(let y=0;y<grid.resolution.y;y++)for(let z=0;z<grid.resolution.z;z++)for(let x=0;x<grid.resolution.x;x++) {
      grid.getProbePosition(x,y,z,point);count++;
      for(const triangle of triangles)assert.ok(triangle.closestPointToPoint(point,closest).distanceTo(point)>=.1,
        'probe touches actual roof, wall, post, floor or furniture: '+point.toArray());
      assert.ok(directions.some(direction=>{
        const first=hits(point.toArray(),direction,8)[0];
        return !first||first.face.normal.dot(new Vector3(...direction))<=0;
      }),'probe is enclosed inside actual geometry');
    }
    assert.equal(count,160);assert.equal(count,plan.count);
    const receivers=[];
    for(const z of [59,65,72])receivers.push(
      [[-9,1,z],[0,-1,0]], [[-9,1,z],[0,1,0]], [[-11.7,2,z],[-1,0,0]]);
    for(const z of architecture.userData.commonsCafe.columns) {
      const x=plan.front-.35;
      receivers.push([[x-.5,1.7,z],[1,0,0]],[[x+.5,1.7,z],[-1,0,0]],
        [[x,1.7,z-.5],[0,0,1]],[[x,1.7,z+.5],[0,0,-1]]);
    }
    receivers.push([[-6.7,.08,65],[-1,0,0]],[[-10.9,1.2,65.7],[0,-1,0]]);
    for(const [origin,direction]of receivers) {
      const hit=hits(origin,direction,6)[0];assert.ok(hit,'missing real receiving face');
      assert.ok(domain.containsPoint(hit.point),'receiver outside local GI domain: '+hit.point.toArray());
      const normal=new Vector3(...direction).negate();
      const sample=hit.point.clone().add(offset.clone().multiply(normal)).clamp(grid.boundingBox.min,grid.boundingBox.max);
      assert.ok(sample.clone().sub(hit.point).dot(normal)>0,'grid clamping crosses to the solid side');
      const start=hit.point.clone().addScaledVector(normal,.0001),ray=sample.clone().sub(start),length=ray.length();
      assert.equal(hits(start.toArray(),ray.normalize().toArray(),length-.0001).length,0,'normal-biased sample crosses an actual surface');
    }
    const cafe=architecture.userData.commonsCafe;
    assert.ok(!domain.containsPoint(new Vector3(cafe.coreEastX-.01,2,66)),'GI crosses the rear solid wall');
    assert.ok(!domain.containsPoint(new Vector3(-9,cafe.ceiling+.1,66)),'GI crosses into the roof');
    const approach=hits([-9,1,55.5],[0,-1,0],2)[0];assert.ok(approach);
    assert.ok(!domain.containsPoint(approach.point),'uncovered north approach should retain its existing lighting');
  } finally {grid.dispose();}
});
