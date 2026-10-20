import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { buildLandscapeSteps } from '../src/campus/landscape.js';
import { finishBuild } from '../src/campus/loading.js';

test('refined landscape indexes its real terrain and keeps approach vertices and woodland roots grounded', t => {
  const previousDocument=globalThis.document,previousInfo=console.info,originalIntersect=Raycaster.prototype.intersectObject;
  // Geometry verification only: browser Canvas texture appearance is tested on GPU.
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'
    ?(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})
    :key==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  console.info=()=>{};
  let landscape,terrainRaycasts=0;
  Raycaster.prototype.intersectObject=function(object,...args) {
    if(object.name==='continuous-meadow-and-low-rolling-ground')terrainRaycasts++;
    return originalIntersect.call(this,object,...args);
  };
  t.after(()=>{
    globalThis.document=previousDocument;console.info=previousInfo;Raycaster.prototype.intersectObject=originalIntersect;
    const resources=new Set();
    landscape?.traverse(object=>{
      if(!object.isMesh)return;
      resources.add(object.geometry);resources.add(object.material);
      if(object.isInstancedMesh)object.dispose();
      object.customDepthMaterial?.dispose();
    });
    for(const resource of resources) {
      if(resource.isMaterial)for(const value of Object.values(resource))if(value?.isTexture)resources.add(value);
      resource.dispose();
    }
    landscape?.userData.contextDistricts.landuse.texture.dispose();
  });
  landscape=finishBuild(buildLandscapeSteps({refined:true}));
  assert.equal(terrainRaycasts,0,'the optimized generator must use its terrain index');
  Raycaster.prototype.intersectObject=originalIntersect;
  const terrain=landscape.getObjectByName('continuous-meadow-and-low-rolling-ground');
  const ray=new Raycaster(new Vector3(),new Vector3(0,-1,0));
  const referenceHeight=(x,z)=>{
    ray.ray.origin.set(x,200,z);
    const hit=ray.intersectObject(terrain,false)[0];
    assert.ok(hit,`missing rendered terrain at ${x}, ${z}`);
    return hit.point.y;
  };
  const trees=landscape.userData.contextTreePositions;
  assert.ok(trees.length>350);
  for(const tree of trees)assert.ok(Math.abs(tree.ground-(referenceHeight(tree.x,tree.z)-.035))<1e-9);
  let roadVertices=0;
  landscape.getObjectByName('campus-site').traverse(mesh=>{
    if(!mesh.isMesh||mesh.material.name!=='campus-asphalt')return;
    const positions=mesh.geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      const x=positions.getX(i),z=positions.getZ(i);
      if(x<135)continue; // Beyond the parking bays, these are the generated approach ribbon.
      const expected=referenceHeight(x,z)-.035+.055;
      assert.ok(Math.abs(positions.getY(i)-expected)<2e-6,'Float32 road vertices must match the rendered triangles');
      roadVertices++;
    }
  });
  assert.ok(roadVertices>1000,'cover the full approach through the distant road endpoint');
});
