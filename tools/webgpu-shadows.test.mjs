import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three/webgpu';
import { createLighting } from '../src/campus-webgpu/lighting.js';

function fixture() {
  let finish;
  const renderer = { isWebGPURenderer: true, init: () => new Promise(resolve => { finish = resolve; }) };
  const scene = new Scene(), camera = new PerspectiveCamera(46, 1, .2, 9000);
  const lighting = createLighting({renderer, scene, camera, cacheShadows:true});
  return {lighting, camera, async close() { lighting.dispose(); finish(); await assert.rejects(lighting.ready,/disposed/); }};
}

test('static daylight keeps one world-space shadow while the view moves, and refreshes for cuts and quality changes', async () => {
  const {lighting,camera,close}=fixture();
  try {
    assert.equal(lighting.sun.type,'DirectionalLight');
    assert.equal(lighting.sun.shadow.autoUpdate,false);
    lighting.update(camera,{shot:1});
    lighting.sun.shadow.needsUpdate=false;
    const projection=lighting.sun.shadow.camera.projectionMatrix.clone(), position=lighting.sun.position.clone();
    camera.position.set(40,3,-25);camera.lookAt(0,2,0);
    lighting.update(camera,{shot:1});
    assert.equal(lighting.sun.shadow.needsUpdate,false);
    assert.ok(lighting.sun.shadow.camera.projectionMatrix.equals(projection));
    assert.ok(lighting.sun.position.equals(position));
    lighting.update(camera,{shot:2});
    assert.equal(lighting.sun.shadow.needsUpdate,true);
    lighting.sun.shadow.needsUpdate=false;
    lighting.setQuality('quality');
    assert.equal(lighting.sun.shadow.needsUpdate,true);
  } finally {await close();}
});

test('free exploration uses a fixed scene envelope instead of freezing a view-dependent cascade', async () => {
  const {lighting,camera,close}=fixture();
  try {
    lighting.update(camera,{shot:-1});
    const sun=lighting.sun;
    sun.shadow.updateMatrices(sun);
    for(const x of [-120,120])for(const y of [0,35])for(const z of [-100,100]) {
      const projected=new Vector3(x,y,z).applyMatrix4(sun.shadow.matrix);
      assert.ok(projected.x>=0&&projected.x<=1&&projected.y>=0&&projected.y<=1,`outside shadow: ${projected.toArray()}`);
    }
    sun.shadow.needsUpdate=false;camera.position.set(-120,100,120);
    lighting.update(camera,{shot:-1});
    assert.equal(sun.shadow.needsUpdate,false);
  } finally {await close();}
});
