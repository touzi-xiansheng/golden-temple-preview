import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, Color, DirectionalLight, Group, InstancedMesh, Matrix4, Mesh, MeshStandardNodeMaterial, RenderTarget, Scene, Vector3 } from 'three/webgpu';
import { vec3 } from 'three/tsl';
import { buildBuildings } from '../src/campus/buildings.js';
import { bakeCampusProbes, createProbeCaptureScene, probeRegions } from '../src/campus-webgpu/probes.js';
import { createProbeEnvironmentHandle, soffitCaptureRegions } from '../src/campus-webgpu/probe-environment.js';

// CPU reference of the bounded, per-axis smoothstep used by the GPU shader.
function weight(region,point) {
  const blend=typeof region.blendDistance==='number'?new Vector3().setScalar(region.blendDistance):region.blendDistance;
  const inside=point.clone().sub(region.coverageBounds.min).min(region.coverageBounds.max.clone().sub(point)).divide(blend);
  const t=Math.max(0,Math.min(1,inside.x,inside.y,inside.z));
  return t*t*(3-2*t);
}

test('907 samples remain fixed while inner facades receive base GI',()=>{
  const regions=probeRegions(),base=regions[0];
  assert.equal(regions.reduce((n,r)=>n+r.resolution.reduce((a,b)=>a*b,1),0),907);
  assert.deepEqual(base.bounds.min.toArray(),[-20,.4,-50]);
  assert.deepEqual(base.bounds.max.toArray(),[20,14,54]);
  for(const point of [[0,6,-53],[23,6,31],[21,6,-22],[-23,6,29],[23,4,59],[-22.1,.18,29]]) {
    assert.equal(weight(base,new Vector3(...point)),1,`receiver ${point}`);
  }
  assert.equal(weight(base,new Vector3(27,2,31)),0,'extension remains bounded');
});

test('local feathers preserve floor, glass and soffit receivers without the C facade sky gap',()=>{
  const regions=probeRegions(),c=regions.find(r=>r.id==='arcade-c');
  for(const point of [[-25.5275,1,29],[-24,.18,29],[-24,3.41,29],[-24,1,10],[-24,1,48]]) {
    assert.ok(weight(c,new Vector3(...point))>1-1e-12,`receiver ${point}`);
  }
  let previous=1;
  for(let x=-22.8;x<=-21.8;x+=.01) {
    const point=new Vector3(x,.18,29),local=weight(c,point),base=weight(regions[0],point);
    assert.equal(base,1,'the entire local transition has a fully covered fallback');
    assert.ok(local<=previous+1e-12,'monotone fade towards courtyard');
    assert.ok(previous-local<.04,'no two-centimetre brightness cliff');
    previous=local;
  }
});

function pavingFixture(instanced=false) {
  const landscape=new Group(),parent=new Group(),geometry=new BoxGeometry(4,.08,6);
  const material=new MeshStandardNodeMaterial({color:'#c5c2b4',roughness:.95});
  material.name='campus-paving / WebGPU';material.colorNode=vec3(.01,.02,.03);
  const mesh=instanced?new InstancedMesh(geometry,material,2):new Mesh(geometry,material);
  if(instanced) {
    mesh.setMatrixAt(0,new Matrix4().makeTranslation(1,0,2));
    mesh.setMatrixAt(1,new Matrix4().makeTranslation(-3,0,5));
    mesh.setColorAt(0,new Color(.7,.8,.9));mesh.setColorAt(1,new Color(1,1,1));
  }
  mesh.position.set(2,.075,3);parent.position.set(7,0,-11);parent.rotation.y=.31;
  parent.add(mesh);landscape.add(parent);landscape.position.set(-4,0,5);
  return {landscape,mesh,geometry,material};
}

for(const instanced of [false,true])test(`paving capture borrows geometry, preserves world placement and isolates materials (${instanced?'instances':'mesh'})`,()=>{
  const f=pavingFixture(instanced),scene=new Scene();let geometryDisposed=0,materialDisposed=0;
  f.geometry.addEventListener('dispose',()=>geometryDisposed++);
  const capture=createProbeCaptureScene({createBakeScene:()=>scene},f.landscape);
  const proxy=scene.getObjectByName('GI actual paving');
  assert.ok(proxy);scene.updateMatrixWorld(true);
  assert.equal(proxy.geometry,f.geometry);
  assert.notEqual(proxy.material,f.material);
  assert.equal(proxy.material.colorNode,null,'no main-scene shader/probe hooks enter capture');
  assert.deepEqual(proxy.matrixWorld.elements,f.mesh.matrixWorld.elements);
  assert.deepEqual(proxy.material.color.toArray(),f.material.color.toArray());
  assert.equal(capture.stats.paving.meshes,1);
  if(instanced) {
    assert.notEqual(proxy.instanceMatrix,f.mesh.instanceMatrix);
    assert.deepEqual(proxy.instanceMatrix.array,f.mesh.instanceMatrix.array);
    assert.notEqual(proxy.instanceColor,f.mesh.instanceColor);
    assert.deepEqual(proxy.instanceColor.array,f.mesh.instanceColor.array);
  }
  proxy.material.addEventListener('dispose',()=>materialDisposed++);
  capture.dispose();capture.dispose();
  assert.equal(geometryDisposed,0,'visible shared geometry must survive capture disposal');
  assert.equal(materialDisposed,1);assert.equal(scene.children.length,0);
  f.geometry.dispose();f.material.dispose();if(instanced)f.mesh.dispose();
});

test('a failed SH bake releases capture proxies while leaving visible paving usable',async()=>{
  const f=pavingFixture(),scene=new Scene();let geometryDisposed=0,calls=0;
  f.geometry.addEventListener('dispose',()=>geometryDisposed++);
  await assert.rejects(bakeCampusProbes({createBakeScene:()=>scene,bakeProbe:async()=>{calls++;throw new Error('capture failed');}},f.landscape),/capture failed/);
  assert.equal(calls,1);assert.equal(scene.children.length,0);assert.equal(geometryDisposed,0);
  f.geometry.dispose();f.material.dispose();
});

test('GI result separates serializable statistics from owned rendering handles',async()=>{
  const f=pavingFixture(),scene=new Scene(),captured=[];
  const result=await bakeCampusProbes({createBakeScene:()=>scene,bakeProbe:async options=>{
    assert.ok(options.scene.getObjectByName('GI actual paving'));
    captured.push(options);
    return {grid:{resolution:new Vector3(...options.resolution)}};
  }},f.landscape,{roughSpecular:false});
  assert.equal(captured.length,4);assert.equal(result.stats.probes,907);
  assert.equal(result.stats.paving.meshes,1);assert.equal(result.stats.roughEnvironment.captures,0);
  assert.equal(JSON.parse(JSON.stringify(result.stats)).probes,907);
  assert.equal(scene.children.length,0);
  result.bindRoughEnvironment();result.dispose();result.dispose();
  f.geometry.dispose();f.material.dispose();
});

test('temporary capture sunlight is released after all SH work, including late environment failure',async()=>{
  for(const mode of ['success','probe-failure','environment-failure']) {
    const f=pavingFixture(),scene=new Scene(),sun=new DirectionalLight(),events=[];
    sun.shadow.map=new RenderTarget(4,4);scene.add(sun,sun.target);
    let releases=0,shadowDisposals=0;
    sun.shadow.map.addEventListener('dispose',()=>shadowDisposals++);
    const lighting={createBakeScene:()=>scene,bakeProbe:async options=>{
      assert.equal(shadowDisposals,0,'capture shadow survives every SH batch');
      events.push('probe');
      if(mode==='probe-failure')throw new Error('probe interrupted');
      return {grid:{resolution:new Vector3(...options.resolution)}};
    },releaseBakeScene:captureScene=>{
      assert.equal(captureScene,scene);events.push('release');releases++;
      sun.target.removeFromParent();sun.removeFromParent();sun.dispose();
    }};
    // This reaches the real PMREM setup after all four SH regions, then fails
    // without a GPU renderer. Cleanup must also cover this later failure stage.
    const architecture=mode==='environment-failure'?new Group():null;
    if(architecture)architecture.userData.arcadeSoffit={surfaces:[{
      id:'a',origin:[-21,-24],tangent:[0,-1],normal:[1,0],bottom:3.41,bounds:[-21.7,21.7,-2.225,-.175],
    }]};
    const bake=bakeCampusProbes(lighting,f.landscape,{architecture});
    if(mode==='success') {
      const gi=await bake;assert.equal(releases,1,'release happens before returning the completed GI handle');
      gi.dispose();gi.dispose();
    } else await assert.rejects(bake,mode==='probe-failure'?/probe interrupted/:/initialized WebGPU renderer/);
    assert.deepEqual(events,[...Array(mode==='probe-failure'?1:4).fill('probe'),'release']);
    assert.equal(releases,1);assert.equal(shadowDisposals,1);assert.equal(scene.children.length,0);
    f.geometry.dispose();f.material.dispose();
  }
});

test('actual architecture defines exactly two free-space rough-environment captures',()=>{
  const architecture=buildBuildings(),regions=probeRegions(),captures=soffitCaptureRegions(architecture,regions);
  assert.deepEqual(captures.map(c=>c.id),['arcade-a','arcade-c']);
  for(const capture of captures) {
    const region=regions.find(r=>r.id===capture.id);
    assert.ok(region.bounds.containsPoint(capture.position),'capture stays inside the measured free-space volume');
    assert.ok(Math.abs(capture.position.y-3.06)<1e-10);
  }
  const geometries=new Set(),materials=new Set();
  architecture.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);if(object.isInstancedMesh)object.dispose();});
  for(const geometry of geometries)geometry.dispose();for(const material of materials)material.dispose();
});

test('rough environment binds only soffits and restores owned nodes without overriding newer edits',()=>{
  const regions=probeRegions(),root=new Group(),geometry=new BoxGeometry(),original=vec3(.1,.2,.3);
  const wood=new MeshStandardNodeMaterial(),glass=new MeshStandardNodeMaterial();
  wood.name='Jointed thermally treated ash soffit / WebGPU';wood.envNode=original;
  glass.name='Campus glazing / WebGPU';
  root.add(new Mesh(geometry,wood),new Mesh(geometry,wood),new Mesh(geometry,glass));
  const target=new RenderTarget(336,128),region=regions[1];let disposals=0;
  target.addEventListener('dispose',()=>disposals++);
  const owner=createProbeEnvironmentHandle([{target,bounds:region.coverageBounds,blendDistance:region.blendDistance}],root);
  owner.bind();owner.bind();
  assert.equal(owner.stats.boundMaterials,1);assert.notEqual(wood.envNode,original);assert.equal(glass.envNode,null);
  assert.doesNotThrow(()=>JSON.stringify(owner.stats));
  owner.dispose();owner.dispose();assert.equal(wood.envNode,original);assert.equal(disposals,1);
  const next=createProbeEnvironmentHandle([{target:new RenderTarget(336,128),bounds:region.coverageBounds,blendDistance:region.blendDistance}],root);
  next.bind();const replacement=vec3(.4,.5,.6);wood.envNode=replacement;next.dispose();
  assert.equal(wood.envNode,replacement,'do not revert another material owner');
  assert.throws(()=>next.bind(),/disposed/);
  geometry.dispose();wood.dispose();glass.dispose();
});
