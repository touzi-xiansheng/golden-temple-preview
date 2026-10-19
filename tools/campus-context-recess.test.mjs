import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildContextDistricts } from '../src/campus/context-districts.js';
import { DAYLIGHT, daylight } from '../src/campus/rendering.js';
import { createCourtyardIndirect } from '../src/campus/indirect-light.js';

function fixture(t) {
  const terrain=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial());
  const context=buildContextDistricts(terrain);context.object.updateMatrixWorld(true);
  const meshes=['glazing','reveals','mullions'].map(name=>context.object.getObjectByName(`context-recess-${name}`));
  t.after(()=>{
    const geometries=new Set([terrain.geometry]),materials=new Set([terrain.material]);
    context.object.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);materials.add(o.material);}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();context.landuse.texture.dispose();
  });
  assert.ok(meshes.every(Boolean),'recess geometry missing');
  return {context,meshes};
}

test('distant office openings have real depth and sunlit frames without lighting through their reveals',t=>{
  const {context,meshes:[glass,reveals,frames]}=fixture(t),ray=new THREE.Raycaster();
  const openings=context.object.userData.recessOpenings.filter(o=>o.floor===2&&o.bay===0);
  assert.equal(openings.length,16);
  assert.deepEqual(new Set(openings.map(o=>o.building)),new Set(['a1','a2','a3','a4']));
  assert.deepEqual(new Set(openings.map(o=>o.normal.join(','))),new Set(['1,0,0','-1,0,0','0,0,1','0,0,-1']));
  const sun=new THREE.Vector3(...DAYLIGHT.direction).normalize(),occluders=[];
  context.object.traverse(o=>{if(o.isMesh&&(o.material.name==='context-facades'||o===reveals||o===frames))occluders.push(o);});
  let panes=0,litFronts=0,litSides=0,blockedGlass=0,blockedReveals=0;
  for(const opening of openings) {
    const n=new THREE.Vector3(...opening.normal),tangent=new THREE.Vector3(...opening.tangent);
    const world=([x,y,z])=>new THREE.Vector3(...opening.center).addScaledVector(tangent,x).add(new THREE.Vector3(0,y,0)).addScaledVector(n,z);
    // Locate the receiver on actual Float32 triangles, never just its metadata plane.
    const surface=(mesh,local,normal)=>{
      const point=world(local);ray.near=0;ray.far=2;
      ray.set(point.clone().addScaledVector(normal,.1),normal.clone().negate());
      const first=ray.intersectObject(context.object,true)[0];
      assert.equal(first?.object,mesh,`${opening.id}: unexpected front surface`);
      assert.ok(first.point.distanceTo(point)<5e-5,`${opening.id}: incorrect surface depth`);
      assert.ok(first.face.normal.dot(normal)>.999,'actual surface faces away from its receiving side');
      return first.point;
    };
    const visible=point=>{ray.near=.001;ray.far=150;ray.set(point,sun);return ray.intersectObjects(occluders,false).length===0;};
    const paneWidth=(opening.width-.16)/3;
    for(let pane=0;pane<3;pane++) {
      const x=-opening.width/2+paneWidth/2+pane*(paneWidth+.08);
      ray.near=0;ray.far=3;ray.set(world([x,0,2]),n.clone().negate());
      const first=ray.intersectObject(context.object,true)[0];
      assert.equal(first?.object,glass,'a solid wall or frame obstructs the opening');
      assert.ok(Math.abs(first.distance-2.45)<5e-5,'glass must be 0.45m behind the facade');panes++;
    }
    if(n.dot(sun)<=0)continue;
    const bar=(opening.width+.08)/6,sign=Math.sign(tangent.dot(sun)),height=opening.height/2;
    assert.ok(visible(surface(frames,[bar,-height*.2,-.33],n)),'mullion front self-occludes');litFronts++;
    assert.ok(visible(surface(frames,[bar+sign*.04,-height*.2,-.39],tangent.clone().multiplyScalar(sign))),'sun-facing mullion side self-occludes');litSides++;
    assert.equal(visible(surface(glass,[0,height-.08,-.45],n)),false,'head reveal fails to shade the glass');blockedGlass++;
    assert.equal(visible(surface(reveals,[-sign*opening.width/2,height-.08,-.35],tangent.clone().multiplyScalar(sign))),false,'head reveal fails to shade the sun-facing sidewall');blockedReveals++;
  }
  assert.equal(panes,48);
  for(const count of[litFronts,litSides,blockedGlass,blockedReveals])assert.equal(count,8);
});

test('recess solar visibility composes once with actual daylight fog, shadows and GI',t=>{
  const {context,meshes}=fixture(t),materials=meshes.map(m=>m.material),scene=new THREE.Scene();scene.add(context.object);
  // Exercise daylight itself, mocking only the GPU capture boundary. A new render
  // path must fail here rather than silently turning this CPU test into a GPU test.
  const renderer={shadowMap:{},extensions:{has:()=>true},getRenderTarget:()=>null,setRenderTarget(){},render(){assert.fail('unexpected GPU render');}};
  t.mock.method(THREE.CubeCamera.prototype,'update',()=>{});
  t.mock.method(THREE.PMREMGenerator.prototype,'fromCubemap',()=>new THREE.WebGLRenderTarget(1,1));
  let lighting,gi;
  t.after(()=>{
    gi?.dispose();lighting?.shadows.dispose();
    for(const target of[lighting?.skyTarget,lighting?.backgroundTarget,lighting?.probeBackground])target?.dispose();
  });
  lighting=daylight(scene,renderer);
  const shadowHooks=materials.map(m=>m.onBeforeCompile);
  gi=createCourtyardIndirect(scene,renderer,lighting);
  const compile=material=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(s,renderer);return s;};
  const expand=source=>source.replace(/#include <(\w+)>/g,(_,name)=>{assert.ok(THREE.ShaderChunk[name],name);return expand(THREE.ShaderChunk[name]);});
  for(const material of materials) {
    const shader=compile(material),source=expand(shader.fragmentShader);
    const local='directLight.color*=contextOpeningVisibility(directLight.direction);';
    assert.equal(source.split(local).length,2,'apply local visibility exactly once, before both direct BRDF and backing');
    const sun=source.indexOf('getDirectionalLightInfo( directionalLight, directLight );'),visibility=source.indexOf(local);
    const direct=source.indexOf('RE_Direct(',visibility),giMix=source.indexOf('irradiance = mix(irradiance, campusLocalIrradiance');
    assert.ok(sun>=0&&sun<visibility&&visibility<direct&&direct<giMix);
    assert.ok(source.includes('float campusShadowDepth(')&&source.includes('textureCube(uCampusFogSky'));
    assert.equal(shader.uniforms.uCampusFogSky.value,lighting.backgroundTarget.texture);
    assert.ok(shader.uniforms.uCampusShadowSamples);assert.equal(shader.uniforms.uCampusGIEnabled.value,0,'unbaked GI must retain its fallback');
    const derivative=source.indexOf('fwidth(barA)'),branch=source.indexOf('if(p.z>=');
    assert.ok(derivative>=0&&branch>derivative,'derivatives must precede visibility branches');
    if(material===materials[0]) {
      const backing=source.indexOf('backingIncident=max(irradiance+iblIrradiance');
      assert.ok(backing>giMix,'backing must consume the one existing GI/PMREM mixture');
      assert.equal(source.split('totalEmissiveRadiance=uContextBackingAlbedo').length,2);
      assert.equal(source.split('backingIncident+=directLight.color*windowNL*sunEntry').length,2);
    } else assert.ok(!source.includes('backingIncident'));
  }
  gi.dispose();gi=null;
  materials.forEach((m,i)=>assert.equal(m.onBeforeCompile,shadowHooks[i]));
  lighting.shadows.dispose();
  for(const material of materials) {
    const shader=compile(material);
    assert.ok(!shader.uniforms.uCampusGIEnabled&&!shader.uniforms.uCampusShadowSamples);
    assert.ok(shader.uniforms.uCampusFogSky&&shader.fragmentShader.includes('contextOpeningVisibility(directLight.direction)'));
  }
  // Shader-source composition is not driver compilation or derivative-AA validation;
  // those remain in the browser check and fixed-view visual acceptance.
});
