import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, BoxGeometry, Frustum, InstancedMesh, Matrix4, MeshBasicMaterial, PerspectiveCamera, Plane, Scene, Vector3, Vector4, WebGPUCoordinateSystem } from 'three/webgpu';
import { configureReflectionCamera, projectReflectionPortal } from '../src/campus-webgpu/reflection-camera.js';
import { createReflections } from '../src/campus-webgpu/reflections.js';

const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-8,`${a} != ${b}`);
function cameraAt(position=[0,0,8],look=[0,0,0],reversed=false) {
  const camera=new PerspectiveCamera(60,16/9,.1,100);
  camera.coordinateSystem=WebGPUCoordinateSystem;camera._reversedDepth=reversed;camera.updateProjectionMatrix();
  camera.position.fromArray(position);camera.lookAt(new Vector3(...look));camera.updateMatrixWorld();return camera;
}
function facade(min=[-2,-1,0],max=[2,1,0],normal=[0,0,1]) {
  const n=new Vector3(...normal),point=new Vector3(...min);
  return {id:'facade',normal:n,point,plane:new Plane().setFromNormalAndCoplanarPoint(n,point),bounds:new Box3(point.clone(),new Vector3(...max))};
}
function clipPoint(camera,point) {return new Vector4(...point,1).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);}

test('portal keeps reference pixel density and world correspondence while narrowing the real frustum',()=>{
  const camera=cameraAt(),plane=facade(),portal=projectReflectionPortal(plane,camera,1920,1080);
  const reference=new PerspectiveCamera(),cropped=new PerspectiveCamera();
  const a=configureReflectionCamera(reference,camera,plane,portal,{width:1152,height:648,mode:'reference'});
  const b=configureReflectionCamera(cropped,camera,plane,portal,{width:1152,height:648});
  assert.ok(b.width<a.width/2 && b.height<a.height/2);
  const [x0,,x1,y1]=b.crop;
  for(const point of [...portal.polygon,new Vector3(1,0,2)]) {
    const uvA=new Vector4(...point.toArray(),1).applyMatrix4(a.textureMatrix),uvB=new Vector4(...point.toArray(),1).applyMatrix4(b.textureMatrix);
    close(uvB.x/uvB.w,(uvA.x/uvA.w*a.width-x0)/(x1-x0));
    close(uvB.y/uvB.w,(uvA.y/uvA.w*a.height-(a.height-y1))/b.height);
  }
  const frustum=c=>new Frustum().setFromProjectionMatrix(new Matrix4().multiplyMatrices(c.projectionMatrix,c.matrixWorldInverse),c.coordinateSystem,c.reversedDepth);
  assert.ok(frustum(reference).containsPoint(new Vector3(7,0,1)));
  assert.equal(frustum(cropped).containsPoint(new Vector3(7,0,1)),false);
  assert.ok(frustum(cropped).containsPoint(new Vector3(0,0,1)));
});

test('oblique clipping keeps the reflected side and rejects geometry behind glass for both WebGPU depth directions',()=>{
  for(const reversed of [false,true]) {
    const camera=cameraAt([0,0,8],[0,0,0],reversed),plane=facade(),portal=projectReflectionPortal(plane,camera,1920,1080),mirror=new PerspectiveCamera();
    assert.ok(configureReflectionCamera(mirror,camera,plane,portal,{width:1152,height:648}));
    const on=clipPoint(mirror,[0,0,0]),front=clipPoint(mirror,[0,0,1]),behind=clipPoint(mirror,[0,0,-1]);
    close(on.z/on.w,reversed?1:0);
    assert.ok(reversed?front.z<front.w:front.z>0);
    assert.ok(reversed?behind.z>behind.w:behind.z<0);
  }
});

test('homogeneous portal clipping survives a facade crossing the near plane and rejects offscreen or zero-area panes',()=>{
  const camera=cameraAt([2,0,0],[0,0,-3]);
  const crossing=facade([0,-2,-10],[0,2,6],[1,0,0]);
  const portal=projectReflectionPortal(crossing,camera,1920,1080);
  assert.ok(portal && portal.areaPixels>0 && portal.areaPixels<=1920*1080);
  const result=configureReflectionCamera(new PerspectiveCamera(),camera,crossing,portal,{width:1152,height:648});
  assert.ok(result && result.width<=1152 && result.height<=648);
  assert.ok(result.textureMatrix.elements.every(Number.isFinite));
  assert.equal(projectReflectionPortal(facade([50,-1,0],[52,1,0]),cameraAt(),1920,1080),null);
  assert.equal(projectReflectionPortal(facade([-2,0,0],[2,0,0]),cameraAt(),1920,1080),null);
  assert.equal(projectReflectionPortal(facade(),cameraAt([0,0,-8],[0,0,-10]),1920,1080),null);
});

function reflectionFixture() {
  const object=new InstancedMesh(new BoxGeometry(),new MeshBasicMaterial(),1);
  object.setMatrixAt(0,new Matrix4().makeScale(6,6,.1).setPosition(0,3,-53));
  const scene=new Scene();scene.add(object);
  const originalBackground={id:'background'},captureBackground={id:'capture'};scene.background=originalBackground;
  let target=null,mrt={id:'mrt'},calls=0,fail=false,dimensions=[1920,1080];
  const renderer={toneMapping:3,autoClear:false,info:{render:{drawCalls:0,triangles:0}},
    getDrawingBufferSize:size=>size.set(...dimensions),getRenderTarget:()=>target,setRenderTarget:value=>{target=value;},
    getMRT:()=>mrt,setMRT:value=>{mrt=value;},render(){calls++;if(fail)throw new Error('capture failed');this.info.render.drawCalls+=7;this.info.render.triangles+=70;}};
  const materials={glass:[{object,material:object.material}],setGlassReflection(){}};
  const reflections=createReflections({renderer,scene,materials,lighting:{captureBackground:{texture:captureBackground}}});
  const camera=cameraAt([0,3,-45],[0,3,-53]);
  return {reflections,camera,renderer,scene,originalBackground,get calls(){return calls;},fail(value=true){fail=value;},resize(){dimensions=[1280,720];},dispose(){reflections.dispose();object.geometry.dispose();object.material.dispose();}};
}

test('one capture per movement, stationary reuse, resize invalidation and explicit full reference',()=>{
  const f=reflectionFixture();
  try {
    f.reflections.update(f.camera);
    assert.equal(f.calls,1);assert.equal(f.reflections.stats.capturesThisUpdate,1);assert.equal(f.reflections.stats.captureDrawCalls,7);
    assert.ok(f.reflections.stats.captureSize[0]<f.reflections.stats.allocatedSize[0]);
    f.reflections.update(f.camera);assert.equal(f.calls,1);assert.equal(f.reflections.stats.capturesThisUpdate,0);
    f.camera.position.x+=.1;f.reflections.update(f.camera);assert.equal(f.calls,2);
    f.resize();f.reflections.update(f.camera);assert.equal(f.calls,3);
    f.reflections.setMode('reference');f.reflections.update(f.camera);assert.equal(f.calls,4);
    assert.deepEqual(f.reflections.stats.captureSize,f.reflections.stats.allocatedSize);
    f.reflections.setEnabled(false);f.reflections.update(f.camera);assert.equal(f.calls,4);assert.deepEqual(f.reflections.stats.active,[]);
  } finally {f.dispose();}
});

test('failed capture restores renderer state and disables the old capture instead of mismatching its matrix',()=>{
  const f=reflectionFixture();
  try {
    f.reflections.update(f.camera);f.fail();
    assert.throws(()=>f.reflections.update(f.camera,{force:true}),/capture failed/);
    assert.deepEqual(f.reflections.stats.active,[]);assert.equal(f.reflections.stats.selectedPlane,null);
    assert.equal(f.reflections.stats.capturesThisUpdate,0);assert.equal(f.renderer.getRenderTarget(),null);
    assert.equal(f.renderer.getMRT().id,'mrt');assert.equal(f.renderer.toneMapping,3);assert.equal(f.renderer.autoClear,false);
    assert.equal(f.scene.background,f.originalBackground);
    f.fail(false);f.reflections.update(f.camera);
    assert.equal(f.reflections.stats.capturesThisUpdate,1,'failed forced capture must remain retryable for a stationary viewer');
  } finally {f.dispose();}
});
