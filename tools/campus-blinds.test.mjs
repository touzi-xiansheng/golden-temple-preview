import test from 'node:test';
import assert from 'node:assert/strict';
import {Scene, Mesh, PlaneGeometry, DirectionalLight, Vector3, CubeTexture, Data3DTexture, ShaderLib, ShaderChunk} from 'three';
import {LightProbeGridWebGL} from 'three/addons/lighting/LightProbeGridWebGL.js';
import {buildBuildings} from '../src/campus/buildings.js';
import {buildingMaterials} from '../src/campus/building-materials.js';
import {createCampusShadows} from '../src/campus/soft-shadows.js';
import {createCourtyardIndirect} from '../src/campus/indirect-light.js';
import {QUALITY} from '../src/campus/quality.js';
import {DAYLIGHT} from '../src/campus/rendering.js';

function compile(material) {
  const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
  material.onBeforeCompile(shader);return shader;
}

// Inspect scope as well as presence: an assignment outside its hit guard would light all glass.
function block(source,marker) {
  const start=source.indexOf(marker);assert.ok(start>=0,`Missing shader connection: ${marker}`);
  const open=source.indexOf('{',start);let depth=1;
  for(let i=open+1;i<source.length;i++) {
    if(source[i]==='{')depth++;else if(source[i]==='}'&&--depth===0)return source.slice(open+1,i);
  }
  assert.fail(`Unclosed shader scope: ${marker}`);
}

test('daylit blinds remain inside existing room hits and exclude backed spandrels',t=>{
  const architecture=buildBuildings(),materials=new Set(),geometries=new Set();
  let vision=0,spandrels=0;
  architecture.traverse(mesh=>{
    if(mesh.geometry)geometries.add(mesh.geometry);if(mesh.material)materials.add(mesh.material);
    if(!mesh.material?.userData.campusGlass)return;
    const types=mesh.geometry.getAttribute('paneType');assert.equal(types.count,mesh.count);
    for(let i=0;i<types.count;i++){const value=types.getX(i);assert.ok(value===0||value===1);value?spandrels++:vision++;}
  });
  t.after(()=>{for(const g of geometries)g.dispose();for(const m of materials)m.dispose();});
  assert.ok(vision>0&&spandrels>0);
  for(const material of materials) {
    if(!material.userData.campusGlass)continue;
    const shader=compile(material),source=shader.fragmentShader;
    assert.ok(!Object.keys(shader.uniforms).some(key=>key.startsWith('uCampusBlind')),'experimental switches or building selection leaked into production');
    const room=block(source,'vec3 campusRoom(');
    assert.match(room,/^\s*blindAlbedo\s*=\s*vec3\(0\.0\)/);
    const hit=block(room,'if (blindDistance');
    assert.equal([...room.matchAll(/blindAlbedo\s*=/g)].length,2,'only initialization and the existing blind hit may set its albedo');
    assert.match(hit,/blindAlbedo\s*=\s*room\s*\*/);
    const visionOnly=block(source,'if (vPaneType < 0.5)');
    assert.match(visionOnly,/campusRoom\([^;]+blindAlbedo\)/);
    assert.equal([...source.matchAll(/roomColor\s*=\s*campusRoom/g)].length,1);
    assert.match(source,/roomColor = vec3\(0\.0\), blindAlbedo = vec3\(0\.0\)/,'spandrels must keep zero room and blind emission');
    assert.match(source,/totalEmissiveRadiance = roomColor[^;]+\* 0\.12;/,'ordinary rooms retain their existing display term');
    const daylight=block(source,'if (max(max(blindAlbedo.r');
    assert.match(daylight,/totalEmissiveRadiance\s*=\s*blindAlbedo/,'replace the old blind output; do not add it twice');
    assert.ok(!daylight.includes('getIBLIrradiance('),'existing irradiance already includes the PMREM/GI mixture');
  }
});

test('blind daylight consumes the composed GI and shadow pipeline and retains fallback in every quality mode',async t=>{
  const all=buildingMaterials(),materials=all.glassZones,geometry=new PlaneGeometry(),sky=new CubeTexture(),scene=new Scene();
  for(const material of materials)scene.add(new Mesh(geometry,material));
  const sun=new DirectionalLight(DAYLIGHT.color,DAYLIGHT.intensity);
  sun.userData.direction=new Vector3(...DAYLIGHT.direction).normalize();
  const renderer={extensions:{has:()=>true},shadowMap:{},getContext:()=>({isContextLost:()=>false})};
  const originals=materials.map(m=>m.onBeforeCompile),atlases=new Set();let shadows,gi;
  t.after(()=>{
    gi?.dispose();shadows?.dispose();geometry.dispose();sky.dispose();
    for(const m of new Set([...Object.values(all).filter(v=>v?.isMaterial),...materials]))m.dispose();
  });
  for(const material of materials)assert.ok(!compile(material).fragmentShader.includes('campusLocalIrradiance'));
  shadows=createCampusShadows(scene,renderer,sun);
  const shadowHooks=materials.map(m=>m.onBeforeCompile);
  t.mock.method(LightProbeGridWebGL.prototype,'bake',function(){
    if(!atlases.has(this)){atlases.add(this);this.texture=new Data3DTexture(new Float32Array(4),1,1,1);}
  });
  gi=createCourtyardIndirect(scene,renderer,{sun,skyTarget:{texture:sky},probeBackground:{texture:sky}});
  const shaders=materials.map(compile);
  const expand=source=>source.replace(/#include <(\w+)>/g,(_,name)=>{assert.ok(ShaderChunk[name],name);return expand(ShaderChunk[name]);});
  for(const shader of shaders) {
    const source=expand(shader.fragmentShader);
    const shadow=source.indexOf('directLight.color *= ( directLight.visible && receiveShadow ) ? getShadow');
    const giReplacement=source.indexOf('irradiance = mix(irradiance, campusLocalIrradiance');
    const blind=source.indexOf('blindIncident = max(irradiance + iblIrradiance');
    const exitCoat=source.indexOf('outgoingLight = outgoingLight * ( 1.0 - material.clearcoat * Fcc )');
    assert.ok(shadow>=0&&shadow<giReplacement&&giReplacement<blind&&blind<exitCoat,'blind illumination must follow shadow/GI evaluation and precede final clearcoat');
    assert.ok(source.includes('float campusShadowDepth('),'soft shadow hook was lost');
    assert.ok(source.includes('reflectVec = campusProjectedReflection(reflectVec)'),'specular reflection hook was lost');
    assert.equal(shader.uniforms.uCampusGIEnabled.value,0,'unbaked GI uses fallback');
  }
  await gi.bake();assert.equal(atlases.size,4);
  for(const shader of shaders)assert.equal(shader.uniforms.uCampusArcadeAtlas2.value,[...atlases][3].texture);
  for(const preset of Object.values(QUALITY)) {
    gi.setEnabled(preset.indirect);shadows.setQuality(preset);
    for(const shader of shaders) {
      assert.equal(shader.uniforms.uCampusGIEnabled.value,+preset.indirect);
      assert.equal(shader.uniforms.uCampusShadowSamples.value,preset.shadowSamples);
    }
  }
  gi.dispose();gi=null;
  for(let i=0;i<materials.length;i++) {
    assert.equal(materials[i].onBeforeCompile,shadowHooks[i]);
    const fallback=compile(materials[i]).fragmentShader;
    assert.ok(!fallback.includes('campusLocalIrradiance'));
    assert.ok(fallback.includes('blindIncident = max(irradiance + iblIrradiance'),'GI disposal must retain daylit blinds using PMREM');
  }
  shadows.dispose();shadows=null;
  materials.forEach((material,i)=>assert.equal(material.onBeforeCompile,originals[i]));
});
