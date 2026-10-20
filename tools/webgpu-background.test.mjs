import test from 'node:test';
import assert from 'node:assert/strict';
import { CubeTexture, PerspectiveCamera, Scene } from 'three/webgpu';
import Background from 'three/src/renderers/common/Background.js';
import Color4 from 'three/src/renderers/common/Color4.js';
import NodeFrame from 'three/src/nodes/core/NodeFrame.js';
import { cubeTexture } from 'three/tsl';
import { createCampusBackgroundNode } from '../src/campus-webgpu/lighting.js';

function backgroundManager(getBackgroundNode) {
  const renderer={_clearColor:new Color4(0,0,0,1),autoClear:false,xr:{getEnvironmentBlendMode:()=> 'opaque'}};
  return new Background(renderer,{getBackgroundNode});
}

test('r186 texture-node swapping rebuilds its single background material on every main/reflection alternation',()=>{
  const textures=[new CubeTexture(),new CubeTexture()],nodes=textures.map(value=>cubeTexture(value));
  const scene=new Scene(),manager=backgroundManager(value=>nodes[textures.indexOf(value.background)]);
  let mesh;
  const list={unshift:value=>{mesh=value;}};
  scene.background=textures[0];manager.update(scene,list,{});
  const original=mesh.material.version;
  for(const index of [1,0,1,0]) {scene.background=textures[index];manager.update(scene,list,{});}
  assert.equal(mesh.material.version,original+4,'regression witness: the old changing node identity invalidates the graph each pass');
  nodes[0].dispose();textures.forEach(value=>value.dispose());
});

test('one background node switches cube bindings within a frame without rebuilding the background material',()=>{
  const visible=new CubeTexture(),capture=new CubeTexture(),main=new PerspectiveCamera(),mirror=new PerspectiveCamera();
  const node=createCampusBackgroundNode(visible,capture,main),key=node.getCacheKey(true),scene=new Scene();
  scene.background=visible;scene.backgroundNode=node;
  const manager=backgroundManager(value=>value.backgroundNode),frame=new NodeFrame();
  frame.frameId=1;
  let mesh;
  const list={unshift:value=>{mesh=value;}};
  manager.update(scene,list,{});
  const original=mesh.material.version,originalMesh=mesh;
  for(const camera of [mirror,main,mirror,main]) {
    frame.camera=camera;frame.renderId++;frame.updateNode(node);
    assert.equal(node.value,camera===main?visible:capture,'sun-disc visibility must follow this render, not the preceding pass');
    assert.equal(node.getCacheKey(true),key);
    manager.update(scene,list,{});
    assert.equal(mesh,originalMesh);assert.equal(mesh.material.version,original);
    assert.equal(scene.background,visible,'stable visible-scene metadata survives capture');
  }
  let materialDisposed=0,geometryDisposed=0;
  mesh.material.addEventListener('dispose',()=>materialDisposed++);
  mesh.geometry.addEventListener('dispose',()=>geometryDisposed++);
  node.dispose();
  assert.equal(materialDisposed,1);assert.equal(geometryDisposed,1);
  visible.dispose();capture.dispose();
});
