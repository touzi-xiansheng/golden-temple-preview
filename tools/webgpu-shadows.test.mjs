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

test('static daylight reuses a world-space shadow, refreshing only for cuts or an actual map-size change', async () => {
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
    assert.equal(lighting.sun.shadow.mapSize.x,4096);
    assert.equal(lighting.sun.shadow.needsUpdate,false,'balanced and quality share the same shadow size');
    lighting.setQuality('performance');
    assert.equal(lighting.sun.shadow.mapSize.x,1024);
    assert.equal(lighting.sun.shadow.needsUpdate,true);
    lighting.sun.shadow.needsUpdate=false;
    lighting.setQuality('balanced');
    assert.equal(lighting.sun.shadow.mapSize.x,4096);
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

test('aerial and free views reuse exactly the same shadow coverage without dropping a pending bake', async () => {
  const {lighting,camera,close}=fixture();
  try {
    const shadow=lighting.sun.shadow,stats=lighting.stats.shadowCache;
    const projection=shadow.camera.projectionMatrix.clone(),position=lighting.sun.position.clone();
    const initial=stats.invalidations,texelMetres=stats.texelMetres;
    lighting.update(camera,{shot:0});
    assert.equal(shadow.needsUpdate,true,'the initial pending bake must survive a reused transition');
    shadow.needsUpdate=false;
    for(const shot of [5,0,-1,5]) {
      lighting.update(camera,{shot});
      assert.equal(shadow.needsUpdate,false);
      assert.equal(stats.invalidations,initial);
      assert.equal(stats.texelMetres,texelMetres);
      assert.ok(shadow.camera.projectionMatrix.equals(projection));
      assert.ok(lighting.sun.position.equals(position));
    }
    assert.equal(stats.reusedTransitions,5);
    // Changing resolution still rebakes even though the coverage is identical.
    lighting.setQuality('performance');
    assert.equal(shadow.needsUpdate,true);assert.equal(stats.invalidations,initial+1);
    assert.equal(stats.texelMetres,texelMetres*4);
    shadow.needsUpdate=false;lighting.update(camera,{shot:4});
    assert.equal(shadow.needsUpdate,true);assert.equal(stats.invalidations,initial+2);
    assert.equal(stats.coverage,'shot-4');
    shadow.needsUpdate=false;lighting.update(camera,{shot:0});
    assert.equal(shadow.needsUpdate,true,'returning from a genuinely different map must rebake');
  } finally {await close();}
});
