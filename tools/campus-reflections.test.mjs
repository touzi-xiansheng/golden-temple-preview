import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { buildBuildings } from '../src/campus/buildings.js';
import { sampleTour } from '../src/campus/tour.js';
import { createCampusPlanarReflections } from '../src/campus/planar-reflections.js';
import { finishBuild, runBuild } from '../src/campus/loading.js';

test('planar reflection preserves geometry, clipping, rendering state and cache lifetime', () => {
const architecture=buildBuildings(),scene=new THREE.Scene(); scene.add(architecture);
const background=new THREE.CubeTexture(),sunFreeBackground=new THREE.CubeTexture();scene.background=background;
const west=architecture.getObjectByName('Solar control glass / west').material;
const u=west.userData.campusGlass.planarUniforms;
const glassMesh=architecture.getObjectByName('Solar control glass / west'),instance=new THREE.Matrix4();
for(const surface of architecture.userData.arcadePlanarSurfaces){
  let doors=0;
  for(let index=0;index<glassMesh.count;index++){
    glassMesh.getMatrixAt(index,instance);const m=instance.elements;
    if(Math.abs(m[8]-.05)>1e-6||m[13]>3.77||m[14]<surface.min[2]||m[14]>surface.max[2])continue;
    const face=m[12]+m[8]*.5;
    if(Math.abs(face-surface.point[0])>.01)continue;
    doors++;assert.ok(Math.abs(face-surface.point[0])<1e-5,'arcade doors and transom share the actual curtain-wall surface');
  }
  assert.equal(doors,5);assert.ok(Math.abs(surface.min[1]-.16)<1e-5);
}
const originalVisibility=new Map();scene.traverse(object=>originalVisibility.set(object,object.visible));
let currentTarget={name:'original framebuffer'},face=3,mip=2,scissorTest=true,fail=false;
const originalTarget=currentTarget,viewport=new THREE.Vector4(2,3,640,480),scissor=new THREE.Vector4(4,5,630,470);
const drawingSize=new THREE.Vector2(1440,900),captures=[];
let shadowRefreshes=0;
let supportedSamples=[8,4,2],expectedSamples=4;
const renderer={
  toneMapping:THREE.AgXToneMapping,outputColorSpace:THREE.SRGBColorSpace,autoClear:true,
  shadowMap:{autoUpdate:true,needsUpdate:true},xr:{enabled:true},state:{buffers:{depth:{setMask:value=>assert.equal(value,true)}}},
  getDrawingBufferSize:value=>value.copy(drawingSize),getRenderTarget:()=>currentTarget,getActiveCubeFace:()=>face,getActiveMipmapLevel:()=>mip,
  getContext:()=>({RENDERBUFFER:36161,RGBA16F:34842,SAMPLES:32937,getInternalformatParameter:(...args)=>{
    assert.deepEqual(args,[36161,34842,32937]);return new Int32Array(supportedSamples);
  }}),
  getViewport:value=>value.copy(viewport),getScissor:value=>value.copy(scissor),getScissorTest:()=>scissorTest,
  setRenderTarget:(target,nextFace=0,nextMip=0)=>{currentTarget=target;face=nextFace;mip=nextMip;},
  setViewport:value=>viewport.copy(value),setScissor:value=>scissor.copy(value),setScissorTest:value=>scissorTest=value,
  clear:()=>{},render:(renderedScene,camera)=>{
    assert.equal(u.uCampusPlanarEnabled.value,0);
    assert.equal(u.uCampusPlanarMap.value,null,'disabled sampler must be unbound to prevent framebuffer feedback');
    assert.equal(renderedScene.background,sunFreeBackground);
    for(const [object,visible]of originalVisibility)assert.equal(object.visible,visible,'complete scene stays visible');
    assert.equal(renderer.shadowMap.autoUpdate,false);
    const dirty=renderer.shadowMap.needsUpdate;
    if(dirty){shadowRefreshes++;renderer.shadowMap.needsUpdate=false;}
    assert.equal(renderer.toneMapping,THREE.NoToneMapping);assert.equal(renderer.outputColorSpace,THREE.LinearSRGBColorSpace);
    assert.equal(currentTarget.texture.generateMipmaps,true);assert.equal(currentTarget.texture.type,THREE.HalfFloatType);
    assert.equal(currentTarget.depthBuffer,true);assert.equal(currentTarget.samples,expectedSamples);
    captures.push({camera:camera.clone(false),width:currentTarget.width,height:currentTarget.height,target:currentTarget,dirty});
    if(fail)throw new Error('synthetic planar capture failure');
  },
};
function restored(){
  assert.equal(currentTarget,originalTarget);assert.equal(face,3);assert.equal(mip,2);
  assert.deepEqual(viewport.toArray(),[2,3,640,480]);assert.deepEqual(scissor.toArray(),[4,5,630,470]);assert.equal(scissorTest,true);
  assert.equal(renderer.toneMapping,THREE.AgXToneMapping);assert.equal(renderer.outputColorSpace,THREE.SRGBColorSpace);
  assert.equal(renderer.autoClear,true);assert.equal(renderer.shadowMap.autoUpdate,true);assert.equal(renderer.xr.enabled,true);
  assert.equal(scene.background,background);
  for(const [object,visible]of originalVisibility)assert.equal(object.visible,visible);
}
const camera=new THREE.PerspectiveCamera(50,1440/900,.1,1800);
function tour43(){const frame=sampleTour(43);camera.position.copy(frame.position);camera.lookAt(frame.target);camera.fov=frame.fov;camera.updateProjectionMatrix();camera.updateMatrixWorld(true);}
tour43();
const api=createCampusPlanarReflections(scene,renderer,architecture,sunFreeBackground);
assert.equal(api.update(camera,{scale:.5}),true);restored();assert.equal(api.stats.activeSurface,'a');
assert.equal(renderer.shadowMap.needsUpdate,false,'successful full scene capture consumes pending shadow update');
assert.equal(captures.length,1);assert.equal(captures[0].width,720);assert.equal(captures[0].height,450);
const surface=architecture.userData.arcadePlanarSurfaces.find(value=>value.id==='a'),planeX=surface.point[0],reflected=captures[0].camera;
assert.ok(Math.abs(reflected.position.x-(2*planeX-camera.position.x))<1e-10);
assert.equal(reflected.position.y,camera.position.y);assert.equal(reflected.position.z,camera.position.z);
for(const index of [0,1,3,4,5,7,8,9,11,12,13,15])assert.equal(reflected.projectionMatrix.elements[index],camera.projectionMatrix.elements[index]);
const clippingValue=point=>{
  const p=new THREE.Vector4(...point,1).applyMatrix4(reflected.matrixWorldInverse).applyMatrix4(reflected.projectionMatrix);
  return p.z+p.w;
};
assert.ok(clippingValue([planeX+.2,1.5,-16])>0,'front courtyard survives oblique clipping');
assert.ok(clippingValue([planeX-.2,1.5,-16])<0,'geometry behind glass is clipped');
assert.ok(clippingValue([planeX,1.5,-16])<0,'receiver surface itself is clipped');

// The actual mirror hit and its reflected wood hit project to the same texture coordinate.
const glass=new THREE.Vector3(-23.527499236166477,2.425257,-13.814458);
const ray=glass.clone().sub(camera.position).normalize().reflect(new THREE.Vector3(1,0,0));
const wood=glass.clone().addScaledVector(ray,(3.41-glass.y)/ray.y);
const uv=point=>{const p=new THREE.Vector4(point.x,point.y,point.z,1).applyMatrix4(u.uCampusPlanarMatrix.value);return new THREE.Vector2(p.x/p.w,p.y/p.w);};
assert.ok(uv(glass).distanceTo(uv(wood))<1e-8);
const projected=glass.clone().project(reflected);
assert.ok(uv(glass).distanceTo(new THREE.Vector2(projected.x*.5+.5,projected.y*.5+.5))<1e-8);
assert.ok(u.uCampusPlanarGlassMin.value.x>planeX-.004 && u.uCampusPlanarGlassMax.value.x<planeX+.004);
assert.ok(Math.abs(u.uCampusPlanarGlassMin.value.y-.16)<1e-5,'flush entrance glazing extends the domain to its real sill');

assert.equal(api.update(camera,{scale:.5}),false);assert.equal(captures.length,1);assert.equal(api.stats.reuses,1);
renderer.shadowMap.needsUpdate=true;
assert.equal(api.update(camera,{scale:.5}),true);assert.equal(shadowRefreshes,2);assert.equal(renderer.shadowMap.needsUpdate,false);restored();
camera.fov=48;camera.updateProjectionMatrix();assert.equal(api.update(camera,{scale:.5}),true);
assert.equal(api.update(camera,{scale:.35}),true);assert.equal(api.stats.width,504);assert.equal(api.stats.height,315);
drawingSize.set(1600,1000);assert.equal(api.update(camera,{scale:.35}),true);assert.equal(api.stats.width,560);
camera.layers.enable(2);assert.equal(api.update(camera,{scale:.35}),true);assert.equal(captures.at(-1).camera.layers.mask,camera.layers.mask);

camera.position.set(-24.1,1.7,38);camera.lookAt(-24.1,2.1,15);camera.updateMatrixWorld(true);
assert.equal(api.update(camera,{scale:.5}),true);assert.equal(api.stats.activeSurface,'c');
camera.position.set(-24.5,1.7,-11);camera.lookAt(-25,2,-30);camera.updateMatrixWorld(true);
assert.equal(api.update(camera,{scale:.5}),false);assert.equal(u.uCampusPlanarEnabled.value,0,'back-facing glass falls back');
tour43();camera.lookAt(10,1.7,camera.position.z);camera.updateMatrixWorld(true);
assert.equal(api.update(camera,{scale:.5}),false);assert.equal(api.stats.activeSurface,null,'outside frustum falls back');
camera.position.set(30,20,30);camera.lookAt(-24,2,15);camera.updateMatrixWorld(true);
assert.equal(api.update(camera,{scale:.5}),false);assert.equal(u.uCampusPlanarEnabled.value,0,'distant glass falls back');

for(const [distance,expected] of [[7.9,1],[10,.5],[12.001,0]]){
  camera.position.set(planeX+distance,1.7,-24);camera.lookAt(planeX,1.7,-24);camera.updateMatrixWorld(true);
  api.update(camera,{scale:.5});
  assert.ok(Math.abs(u.uCampusPlanarEnabled.value-expected)<1e-6,'near reflection blends continuously into the probe');
}
tour43();const beforePerformance=captures.length;
assert.equal(api.update(camera,{scale:0}),false);assert.equal(captures.length,beforePerformance);
assert.equal(u.uCampusPlanarEnabled.value,0,'performance mode avoids the reflection pass');

drawingSize.set(4096,2160);assert.equal(api.update(camera),true);
assert.equal(api.stats.width,2048);assert.equal(api.stats.height,1080,'full-resolution capture retains its long-edge cap');
drawingSize.set(1440,900);

tour43();api.setEnabled(false);const beforeDisabled=captures.length;
assert.equal(api.update(camera,{scale:.5}),false);assert.equal(captures.length,beforeDisabled);
api.setEnabled(true);assert.equal(api.update(camera,{scale:.5}),true);
fail=true;renderer.shadowMap.needsUpdate=true;
assert.equal(api.update(camera,{scale:.5}),false);restored();
assert.equal(u.uCampusPlanarEnabled.value,0);assert.match(api.stats.error,/synthetic/);
assert.equal(renderer.shadowMap.needsUpdate,true,'failed pass preserves dirty shadow for primary scene');
fail=false;assert.equal(api.update(camera,{scale:.5}),true);assert.equal(api.stats.error,null);restored();
let disposals=0;captures.at(-1).target.addEventListener('dispose',()=>disposals++);
api.dispose();api.dispose();assert.equal(disposals,1);assert.equal(u.uCampusPlanarMap.value,null);assert.equal(u.uCampusPlanarEnabled.value,0);
assert.equal(api.update(camera,{scale:.5}),false);restored();
for(const [supported,expected] of [[[2],2],[[],0]]) {
  supportedSamples=supported;expectedSamples=expected;
  const fallback=createCampusPlanarReflections(scene,renderer,architecture,sunFreeBackground);
  assert.equal(fallback.update(camera),true);assert.equal(captures.at(-1).target.samples,expected);
  fallback.dispose();restored();
}
});


test('four static glass probes commit together and restore resources after failure or cancellation', async () => {
  const architecture=buildBuildings(),scene=new THREE.Scene(),fallback=new THREE.Texture(),materials=[];
  architecture.traverse(object=>{const m=object.material;if(m?.userData.campusGlass&&!materials.includes(m)){materials.push(m);m.envMap=fallback;}});
  assert.equal(materials.length,4);scene.add(architecture);
  const sky=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.ShaderMaterial({uniforms:{showSunDisc:{value:1}}}));
  sky.name='Daylight sky';scene.add(sky);
  const initialTarget={name:'original'},captures=[],targets=[];let currentTarget=initialTarget,failFourth=false,slowCapture=false,cubeDisposals=0,pmremDisposals=0;
  const renderer={getRenderTarget:()=>currentTarget,setRenderTarget:value=>{currentTarget=value;}};
  // Execute the actual function body; replace only GPU resource constructors, not capture/commit/cleanup logic.
  const source=readFileSync(new URL('../src/campus/reflections.js',import.meta.url),'utf8');
  const {capture,steps}=new Function('THREE','finishBuild',source.replace(/^import .*;$/gm,'').replace(/export /g,'')
    +'\nreturn {capture:captureBuildingReflections,steps:captureBuildingReflectionSteps};')({
    ...THREE,
    WebGLCubeRenderTarget:class {
      constructor(size,options){assert.equal(size,512);assert.equal(options.type,THREE.HalfFloatType);this.texture=new THREE.Texture();}
      dispose(){cubeDisposals++;}
    },
    CubeCamera:class {
      constructor(near,far,cube){assert.equal(near,.5);assert.equal(far,1800);this.position=new THREE.Vector3();this.cube=cube;}
      update(renderer,renderedScene){
        if(slowCapture){const deadline=performance.now()+15;while(performance.now()<deadline){}}
        assert.equal(renderedScene,scene);assert.equal(sky.material.uniforms.showSunDisc.value,0);
        for(const m of materials){assert.equal(m.envMap,fallback,'no partially assigned captures');assert.equal(m.userData.campusGlass.uniforms.uCampusProbeEnabled.value,0);}
        captures.push(this.position.toArray());renderer.setRenderTarget(this.cube);
      }
    },
    PMREMGenerator:class {
      fromCubemap(){if(failFourth&&captures.length===4)throw new Error('fourth probe failed');const target={texture:new THREE.Texture(),disposed:0,dispose(){this.disposed++;}};targets.push(target);return target;}
      dispose(){pmremDisposals++;}
    },
  },finishBuild);
  const result=capture(scene,renderer,architecture);
  assert.equal(result.count,4);assert.deepEqual(captures,materials.map(m=>m.userData.campusGlass.probe.position));
  assert.equal(new Set(materials.map(m=>m.envMap)).size,4);
  for(let i=0;i<4;i++){assert.equal(materials[i].envMap,targets[i].texture);assert.equal(materials[i].userData.campusGlass.uniforms.uCampusProbeEnabled.value,1);}
  assert.equal(currentTarget,initialTarget);assert.equal(sky.material.uniforms.showSunDisc.value,1);
  assert.equal(cubeDisposals,1);assert.equal(pmremDisposals,1);result.dispose();
  assert.ok(targets.every(t=>t.disposed===1));for(const m of materials){assert.equal(m.envMap,null);assert.equal(m.userData.campusGlass.uniforms.uCampusProbeEnabled.value,0);m.envMap=fallback;}
  captures.length=0;targets.length=0;failFourth=true;
  assert.throws(()=>capture(scene,renderer,architecture),/fourth probe failed/);
  assert.equal(captures.length,4);assert.equal(targets.length,3);assert.ok(targets.every(t=>t.disposed===1));
  for(const m of materials){assert.equal(m.envMap,fallback);assert.equal(m.userData.campusGlass.uniforms.uCampusProbeEnabled.value,0);}
  assert.equal(currentTarget,initialTarget);assert.equal(sky.material.uniforms.showSunDisc.value,1);
  assert.equal(cubeDisposals,2);assert.equal(pmremDisposals,2);
  captures.length=0;targets.length=0;failFourth=false;
  const interrupted=steps(scene,renderer,architecture);
  assert.equal(interrupted.next().done,false);
  assert.equal(currentTarget,initialTarget,'a partial capture must restore the render target before yielding');
  interrupted.return();
  assert.ok(targets.every(t=>t.disposed===1));
  assert.ok(materials.every(m=>m.envMap===fallback&&m.userData.campusGlass.uniforms.uCampusProbeEnabled.value===0));
  assert.equal(sky.material.uniforms.showSunDisc.value,1);
  assert.equal(cubeDisposals,3);assert.equal(pmremDisposals,3);
  captures.length=0;targets.length=0;
  const beforeCommit=steps(scene,renderer,architecture);
  for(let i=0;i<4;i++)assert.equal(beforeCommit.next().done,false);
  beforeCommit.return();
  assert.equal(targets.length,4);assert.ok(targets.every(t=>t.disposed===1));
  assert.ok(materials.every(m=>m.envMap===fallback&&m.userData.campusGlass.uniforms.uCampusProbeEnabled.value===0));
  captures.length=0;targets.length=0;slowCapture=true;
  await assert.rejects(runBuild(steps(scene,renderer,architecture),{yieldControl:async()=>{throw Error('context lost');}}),/context lost/);
  assert.equal(captures.length,1);assert.equal(targets[0].disposed,1);
  assert.ok(materials.every(m=>m.envMap===fallback&&m.userData.campusGlass.uniforms.uCampusProbeEnabled.value===0));
  assert.equal(currentTarget,initialTarget);assert.equal(sky.material.uniforms.showSunDisc.value,1);
  assert.equal(cubeDisposals,5);assert.equal(pmremDisposals,5);
});
