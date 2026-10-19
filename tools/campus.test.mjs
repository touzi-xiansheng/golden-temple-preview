import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Box3, Matrix4, Vector3, Line3, Ray, Scene, Mesh, BoxGeometry, PlaneGeometry, MeshStandardMaterial, MeshPhysicalMaterial, DirectionalLight, Raycaster, Triangle, ShaderLib, ShaderChunk, Texture, CubeTexture, Data3DTexture } from 'three';
import { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';
import { BUILDINGS, COURTYARDS, entrancePoint, footprint } from '../src/campus/layout.js';
import { sampleTour, DURATION } from '../src/campus/tour.js';
import { QUALITY, renderSize } from '../src/campus/quality.js';
import { buildBuildings } from '../src/campus/buildings.js';
import { buildCampusProps } from '../src/campus/props.js';
import { courtyardProbePlan, arcadeProbePlans, createCourtyardIndirect } from '../src/campus/indirect-light.js';
import { foliageMaterial } from '../src/campus/foliage-material.js';
import { createCampusShadows, SUN_ANGULAR_RADIUS } from '../src/campus/soft-shadows.js';
import { createBarkMaterial } from '../src/campus/bark-material.js';
import { DAYLIGHT, fitCampusShadow } from '../src/campus/rendering.js';
import { groundcoverLeafGeometry } from '../src/campus/groundcover-leaf.js';
import { curvedShrubLeafGeometry } from '../src/campus/shrub-leaf.js';
import { mownTurfGeometry, buildMownTurf } from '../src/campus/mown-turf.js';
import { CONTEXT_EXTENT, contextTerrainHeight, planContextWoodland, woodlandDensity, woodlandGroundMask } from '../src/campus/site-context.js';
import { raiseCrown, remappedCrownField, buildVegetation } from '../src/campus/vegetation.js';
import { genMaple, genCherry, BarkAccum, trunkDisp, envRho, envNormal } from '../src/world/vegetation-tree.js';
import { captureTreeJunctions, restoreTreeJunctions, campusBarkDisplacement, closeTrunkTerminal, trunkVolume, extendPrimaryRoot } from '../src/campus/tree-junctions.js';
import { rng } from '../src/core/rng.js';
import { buildCampusBroadleaf } from '../src/campus/whole-tree.js';
import { buildContextDistricts } from '../src/campus/context-districts.js';
import { createGroundSampler, createContextVisibility, bakeContextVisibility, rayHitsContextBox, rayHitsContextEllipsoid } from '../src/campus/context-visibility.js';

test('seven buildings have distinct IDs and non-overlapping footprints', () => {
  assert.equal(BUILDINGS.length, 7);
  assert.equal(new Set(BUILDINGS.map(b => b.id)).size, 7);
  for (let i = 0; i < BUILDINGS.length; i++) for (let j = i + 1; j < BUILDINGS.length; j++) {
    const a = footprint(BUILDINGS[i], 3), b = footprint(BUILDINGS[j], 3);
    assert.ok(a.maxX < b.minX || b.maxX < a.minX || a.maxZ < b.minZ || b.maxZ < a.minZ);
  }
});

test('mown turf keeps centimetre scale, grounded roots and full blade clearance', () => {
  const geometry=mownTurfGeometry(),positions=geometry.attributes.position;
  const a=new Vector3(),b=new Vector3(),c=new Vector3();
  for(let i=0;i<geometry.index.count;i+=3) {
    a.fromBufferAttribute(positions,geometry.index.getX(i));
    b.fromBufferAttribute(positions,geometry.index.getX(i+1));
    c.fromBufferAttribute(positions,geometry.index.getX(i+2));
    assert.ok(b.sub(a).cross(c.sub(a)).length()>1e-7);
  }
  for(let i=0;i<positions.count;i++) {
    assert.ok(positions.getY(i)>=0&&positions.getY(i)<=.045);
    if(i%5<2)assert.equal(positions.getY(i),0);
  }
  const surface=(x,z,margin)=>x>5+margin&&x<12-margin&&z>60+margin&&z<72-margin&&Math.hypot(x-8,z-66)>1+margin?.12:null;
  const map=new Texture(),turf=buildMownTurf(surface,map),repeat=buildMownTurf(surface,map);
  assert.ok(turf.userData.stats.mownTurfTufts>500);
  assert.equal(turf.children.length,repeat.children.length);
  const matrix=new Matrix4();
  for(let n=0;n<turf.children.length;n++) {
    const mesh=turf.children[n];
    assert.deepEqual(mesh.instanceMatrix.array,repeat.children[n].instanceMatrix.array);
    assert.equal(mesh.receiveShadow,true);assert.equal(mesh.castShadow,false);
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,matrix);
      assert.ok(Math.abs(matrix.elements[13]-.119)<1e-6);
      for(let j=0;j<positions.count;j++) {
        a.fromBufferAttribute(positions,j).applyMatrix4(matrix);
        assert.equal(surface(a.x,a.z,0),.12,'whole blade must clear the planting boundary');
      }
    }
  }
  geometry.dispose();map.dispose();
  for(const group of [turf,repeat]){group.children[0].geometry.dispose();group.children[0].material.dispose();}
});
test('the entire tour avoids buildings and remains finite, above ground, and cyclic', () => {
  for (let t = 0; t < DURATION; t += 1 / 30) {
    const frame = sampleTour(t);
    assert.ok([...frame.position.toArray(), ...frame.target.toArray(), frame.fov].every(Number.isFinite));
    assert.ok(frame.position.y >= 1.5 && frame.position.distanceTo(frame.target) > 1);
    for (const b of BUILDINGS) {
      const f = footprint(b, 0.8), p = frame.position;
      // The west-side offices have a walkable, recessed ground-floor arcade.
      if (b.arcade && p.y < b.floorHeight - 0.4) f.maxX -= 2.4;
      assert.ok(!(p.x > f.minX && p.x < f.maxX && p.z > f.minZ && p.z < f.maxZ && p.y < b.floors * b.floorHeight + 2), `camera entered ${b.id} at ${t}`);
    }
  }
  assert.deepEqual(sampleTour(DURATION).position, sampleTour(0).position);
  assert.ok(sampleTour(DURATION - .001).position.distanceTo(sampleTour(0).position) < .05);
});
test('every entrance faces its courtyard rather than the outside service road', () => {
  for (const b of BUILDINGS) {
    const door = entrancePoint(b), court = COURTYARDS[b.z > 0 ? 1 : 0];
    assert.ok((court.x-door.x)*door.nx+(court.z-door.z)*door.nz > 0, b.id);
  }
});
test('woodland is reproducible, clears road crowns, and keeps the campus and arrival open', () => {
  const road = (_, z) => Math.abs(z + 210), plan = planContextWoodland(road);
  assert.deepEqual(plan, planContextWoodland(road));
  assert.ok(plan.trees.length > 350 && plan.trees.length < 520);
  for (const tree of plan.trees) {
    assert.ok(road(tree.x, tree.z) >= 5 + tree.crownRadius);
    assert.ok([tree.x, tree.z, tree.ground, tree.height].every(Number.isFinite));
    assert.equal(tree.crownRadius, tree.height * .4 + 2.8);
    assert.equal(tree.crownTop, tree.ground + tree.height + 2.8);
  }
  // Height shaping must not resample roots or change the shared vegetation RNG.
  const placement = { trees: plan.trees.map(({x,z,ground,near,spacing}) => [x,z,ground,near,spacing]), shrubs: plan.shrubs };
  assert.equal(createHash('sha256').update(JSON.stringify(placement)).digest('hex'), 'bc15aa6aabef2dfe845a8474e099873be26dd86fa1d73cd089176da6e48bc7a3');
  const front = plan.trees.filter(t => t.x > -190 && t.x < -145 && t.z > -90 && t.z < -40).map(t => t.height);
  assert.ok(front.length > 8 && Math.min(...front) > 10 && Math.max(...front) < 14);
  assert.ok(Math.max(...front) - Math.min(...front) > 1, 'the lower front canopy must retain varied heights');
  for (const [x,z] of [[0,0], [100,40], [-90,-90], [0,160]]) assert.equal(contextTerrainHeight(x,z), -0.025);
  assert.equal(woodlandDensity(0,200), 0);
  const { data, size } = woodlandGroundMask(road);
  for (let row = 0; row < size; row++) {
    const z = CONTEXT_EXTENT.minZ + (row + 0.5) / size * (CONTEXT_EXTENT.maxZ - CONTEXT_EXTENT.minZ);
    if (road(0,z) <= 5) assert.ok(data.slice(row * size, (row + 1) * size).every(v => v === 0));
  }
});
test('neighbouring districts follow receiver triangles and shade only direct sunlight', () => {
  const geometry = new PlaneGeometry(4000,4000,16,16).rotateX(-Math.PI/2), positions = geometry.attributes.position;
  for (let i=0;i<positions.count;i++) {
    const x=positions.getX(i),z=positions.getZ(i);
    positions.setY(i,.001*x+.002*z+2*Math.sin(x*.01)+Math.cos(z*.02));
  }
  geometry.computeVertexNormals();
  const material = new MeshStandardMaterial(), original = material.onBeforeCompile;
  const terrain = new Mesh(geometry,material), landscape = new Scene(); landscape.add(terrain);
  const context = buildContextDistricts(terrain); landscape.add(context.object); landscape.userData.contextDistricts = context;
  assert.equal(context.buildings.length,10);
  assert.ok(context.stats.triangles < 80000 && context.stats.batches <= 18);
  context.object.traverse(mesh => {
    if (!mesh.isMesh) return;
    assert.equal(mesh.castShadow,false);
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
  });
  const ground = createGroundSampler(context.receivers,[-1000,720,-800,120]);
  const terrainGround = createGroundSampler([terrain],[-1000,720,-800,120]);
  assert.ok(context.trees.length>=100&&context.trees.length<=220);
  assert.equal(context.forecourts.length,4);
  const landuse=context.landuse.texture,{data:weights,width:landWidth,height:landHeight}=landuse.image;
  assert.equal(landuse.colorSpace,'');assert.equal(landuse.generateMipmaps,true);
  assert.ok(weights.some((v,i)=>i%2===0&&v>200)&&weights.some((v,i)=>i%2===1&&v>150));
  for(let row=0;row<landHeight;row++)for(let col=0;col<landWidth;col++)if(!row||!col||row===landHeight-1||col===landWidth-1)
    assert.equal(weights[(row*landWidth+col)*2]+weights[(row*landWidth+col)*2+1],0,'land use must fade to the unchanged terrain');
  for(const tree of context.trees) {
    assert.ok(Math.abs(tree.ground-terrainGround.heightAt(tree.x,tree.z)+.035)<1e-6,'tree root misses the rendered slope');
    for(const [x0,x1,z0,z1] of context.plantingExclusions) {
      const distance=Math.hypot(Math.max(x0-tree.x,0,tree.x-x1),Math.max(z0-tree.z,0,tree.z-z1));
      assert.ok(distance>=tree.crownRadius+.69,'tree crown enters a road, path, forecourt or building');
    }
  }
  const ray = new Raycaster(), down = new Vector3(0,-1,0); landscape.updateMatrixWorld(true);
  for (const region of context.regions) for (let i=0;i<20;i++) {
    const [x0,x1,z0,z1] = region.bounds;
    const x=x0+(x1-x0)*((i*.6180339+.37)%1),z=z0+(z1-z0)*((i*.4142135+.27)%1);
    ray.set(new Vector3(x,100,z),down);
    const hit=ray.intersectObjects(context.receivers,false)[0]; assert.ok(hit);
    assert.ok(Math.abs(ground.heightAt(x,z)-hit.point.y)<1e-5);
  }
  for (const b of context.buildings) for (const x of [b.x-b.w/2,b.x+b.w/2]) for (const z of [b.z-b.d/2,b.z+b.d/2]) {
    const height=terrainGround.heightAt(x,z);
    assert.ok(b.bottom < height && b.base > height);
  }
  const districtAsphalt=context.receivers.filter(m=>m.material.name==='context-ground');
  const districtPaving=context.receivers.filter(m=>m.material.name==='context-paving');
  const surfaceHits=(meshes,x,z)=>{ray.set(new Vector3(x,100,z),down);return ray.intersectObjects(meshes,false);};
  const oneSurface=(meshes,x,z)=>{
    const hits=surfaceHits(meshes,x,z);
    assert.equal(hits.length,1,`missing or duplicate district surface at ${x}, ${z}`);
    return hits[0].point.y;
  };
  for(const building of context.buildings) {
    const engineering=building.district==='engineering', side=building.z<-450?1:-1;
    const front=engineering?building.z+side*building.d/2:building.z+building.d/2;
    const run=Math.max(14,Math.min(32,(building.base-terrainGround.heightAt(building.x,front+1))*22));
    const end=engineering?(side>0?-464:-403):front+run;
    const width=engineering?building.w-4:3.6, direction=Math.sign(end-front);
    for(const across of[-.413,.127,.431]) {
      const x=building.x+width*across,z=front+(end-front)*.371;
      assert.ok(oneSurface(districtPaving,x,z)>terrainGround.heightAt(x,z)+.025,'ramp buried in terrain');
      assert.ok(Math.abs(oneSurface(districtPaving,x,front+direction*.002)-building.base)<.002,'ramp misses door level');
      const inside=oneSurface(districtPaving,x,end-direction*.002);
      const outsideHits=surfaceHits(engineering?districtAsphalt:districtPaving,x,end+direction*.002);
      assert.ok(outsideHits.length,`${building.id}: missing adjoining path/yard`);
      const outside=outsideHits[0].point.y;
      assert.ok(Math.abs(inside-outside)<.002,`${building.id}: ramp end misses its path/yard across the slope`);
    }
    for(const s of[-1,1]) {
      const x=building.x+s*width/2,z=front+(end-front)*.413;
      const y=(terrainGround.heightAt(x,z)+oneSurface(districtPaving,x-s*.01,z))/2;
      ray.set(new Vector3(x+s*.2,y,z),new Vector3(-s,0,0));
      const hit=ray.intersectObjects(districtPaving,false)[0];
      assert.ok(hit&&Math.abs(hit.point.x-x)<.001,`${building.id}: missing outward ramp side fill`);
    }
  }
  // Away from shared triangle edges: reject coincident faces as well as 1mm layers.
  for(const [x,z] of[[100.31,-425.27],[520.31,62.27],[350.31,-315.27]])oneSurface(districtAsphalt,x,z);
  // The western branch and shared parking must join without duplicate surfaces or blocking paths.
  for(const [x,z] of[[-290.31,-315.27],[-365.31,-171.27],[-294.31,-171.27],[-290.31,-76.27]])oneSurface(districtAsphalt,x,z);
  for(const x of[-303.17,-276.83])oneSurface(districtPaving,x,-69.23);
  for(let z=-308.7;z<-70.1;z+=4.7)oneSurface(districtAsphalt,-290.31,z);
  for(let x=-398.7;x<-286.1;x+=1.7) {
    oneSurface(districtAsphalt,x,-171.27);
    assert.equal(surfaceHits(districtPaving,x,-171.27).length,0,'raised footpath blocks parking access');
  }
  for(const id of['a3','a4']) {
    const building=context.buildings.find(b=>b.id===id),court=context.forecourts.find(c=>c.id===id);
    const end=(court.rect[2]+court.rect[3])/2;
    for(let x=building.x+.17;x<-294.1;x+=1.7)oneSurface(districtPaving,x,end+.17);
    assert.equal(surfaceHits(districtPaving,-293.9,end+.17).length,0,'door path enters carriageway');
    const left=oneSurface(districtPaving,-296.002,end+.17),right=oneSurface(districtPaving,-295.998,end+.17);
    assert.ok(Math.abs(left-right)<.001,'door path does not join the western footpath');
  }
  const sun = new DirectionalLight(), shadows = createCampusShadows(landscape,{shadowMap:{}},sun);
  const visibility = createContextVisibility(landscape,DAYLIGHT.direction),data=visibility.texture.image.data,size=visibility.stats.size;
  assert.ok(visibility.regions.every(region=>region.exposedShadowArea>100));
  assert.equal(visibility.texture.colorSpace,'');
  for (const region of visibility.regions) {
    const ox=Math.round(region.atlas[0]*size),oy=Math.round(region.atlas[1]*size),span=Math.round(region.atlas[2]*size);
    for (let i=0;i<span;i++) for (const [x,y] of [[ox+i,oy],[ox+i,oy+span-1],[ox,oy+i],[ox+span-1,oy+i]]) assert.equal(data[y*size+x],255,'shadow clipped at atlas boundary');
    for (const box of context.casters.filter(b=>b.district===region.id&&b.groundFootprint)) {
      const height=box.max[1]-box.min[1],sun=DAYLIGHT.direction;
      const x=(box.min[0]+box.max[0])/2-height*sun[0]/sun[1]*.3;
      const z=(sun[2]>0?box.min[2]:box.max[2])-height*sun[2]/sun[1]*.3;
      assert.ok(rayHitsContextBox(x,ground.heightAt(x,z)+.015,z,DAYLIGHT.direction,box));
      assert.equal(rayHitsContextBox(x,ground.heightAt(x,z)+.015,z,DAYLIGHT.direction.map(v=>-v),box),false);
      const ix=ox+Math.floor((x-region.bounds[0])/(region.bounds[1]-region.bounds[0])*span),iy=oy+Math.floor((z-region.bounds[2])/(region.bounds[3]-region.bounds[2])*span);
      assert.ok(data[iy*size+ix]<128,'predicted sun shadow missing');
    }
  }
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('directLight.color*=districtSunVisibility(vDistrictWorld.xz);'));
  assert.ok(shader.fragmentShader.includes('campusReceiverGradient'));
  assert.ok(shader.fragmentShader.includes('#include <lights_fragment_maps>'));
  assert.equal(shader.uniforms.uDistrictVisibility.value,visibility.texture);
  visibility.dispose(); visibility.dispose(); shadows.dispose();
  landuse.dispose();
  assert.equal(material.onBeforeCompile,original);
  landscape.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
});
test('indexed crown shadows match unscreened rays on slopes and multiply crown transmission', () => {
  const shape={center:[0,5,0],radii:[2,3,1]};
  for(const [x,direction,hit] of [[0,[0,1,0],true],[0,[0,-1,0],false],[2,[0,1,0],true],[2.001,[0,1,0],false]])
    assert.equal(rayHitsContextEllipsoid(x,0,0,direction,shape),hit);
  const geometry=new PlaneGeometry(160,160,8,8).rotateX(-Math.PI/2),p=geometry.attributes.position;
  for(let i=0;i<p.count;i++)p.setY(i,3*Math.sin(p.getX(i)*.04)+p.getZ(i)*.06);
  const terrain=new Mesh(geometry,new MeshStandardMaterial()),bounds=[-70,70,-70,70];
  const ground=createGroundSampler([terrain],bounds),casters=[
    {district:'test',ellipsoid:shape,opacity:.65},
    {district:'test',ellipsoid:{center:[10,12,-16],radii:[8,6,9]},opacity:.65},
    {district:'test',min:[-38,-12,4],max:[-15,20,30],groundFootprint:true},
  ];
  for(const direction of [DAYLIGHT.direction,[0,1,0],[.62,.72,-.43]]) {
    const sun=new Vector3(...direction).normalize().toArray();
    const atlas=bakeContextVisibility({receivers:[terrain],casters,regions:[{id:'test',bounds}]},direction);
    for(let i=0;i<400;i++) {
      const col=(i*137+24)%480,row=(i*79+17)%480;let visible=0;
      for(const [sx,sz] of [[.25,.25],[.75,.25],[.25,.75],[.75,.75]]) {
        const x=-70+(col+sx)/480*140,z=-70+(row+sz)/480*140,y=ground.heightAt(x,z)+.015;
        let transmission=1;
        for(const caster of casters)if(caster.ellipsoid?rayHitsContextEllipsoid(x,y,z,sun,caster.ellipsoid):rayHitsContextBox(x,y,z,sun,caster))transmission*=caster.ellipsoid ? .35 : 0;
        visible+=transmission;
      }
      assert.equal(atlas.texture.image.data[(row+16)*1024+col+16],Math.round(visible/4*255));
    }
    atlas.texture.dispose();
  }
  const flat=new Mesh(new PlaneGeometry(20,20).rotateX(-Math.PI/2),terrain.material);
  const overlap=bakeContextVisibility({receivers:[flat],casters:[0,1].map(()=>({district:'test',ellipsoid:shape,opacity:.65})),regions:[{id:'test',bounds:[-8,8,-8,8]}]},[0,1,0]);
  assert.equal(overlap.texture.image.data[256*1024+256],31);
  overlap.texture.dispose();flat.geometry.dispose();geometry.dispose();terrain.material.dispose();
});
test('quality modes cap pixel cost while preserving portrait and landscape aspect', () => {
  for (const [width, height] of [[1920,1080], [3840,2160], [390,844], [1000,500]]) {
    let pixels = 0;
    for (const mode of Object.keys(QUALITY)) {
      const size = renderSize(width, height, mode), count = size.width * size.height;
      assert.ok(count <= QUALITY[mode].maxPixels && count >= pixels);
      assert.ok(Math.abs(size.width / size.height - width / height) < .01);
      pixels = count;
    }
  }
  assert.deepEqual(renderSize(0, 0, 'balanced'), { width: 1, height: 1 });
});
test('indirect-light probes stay outside buildings and reject an obstructed plan', () => {
  const { grid, count } = courtyardProbePlan();
  assert.equal(count, 315);
  assert.ok(grid.boundingBox.min.y > 0);
  grid.dispose();
  assert.throws(() => courtyardProbePlan([{ id: 'obstruction', x: 0, z: 2, w: 5, d: 5, floors: 3, floorHeight: 3.6 }]), /intersects obstruction/);
});
test('leaf backlighting stays live, follows local GI, and preserves shadow hooks', async t => {
  const map = new Texture(), sky = new CubeTexture(), atlas = new Data3DTexture(new Float32Array(4),1,1,1);
  const leaf = foliageMaterial({ veins: true }), otherLeaf = foliageMaterial({ veins: true });
  const cards = [foliageMaterial({ map }), foliageMaterial({ map, canopyVolume: true })];
  const materials = [leaf,otherLeaf,...cards], geometry = new PlaneGeometry(), scene = new Scene();
  for (const material of materials) scene.add(new Mesh(geometry,material));
  const compile = material => {
    const shader = { uniforms:{}, vertexShader:ShaderLib.standard.vertexShader, fragmentShader:ShaderLib.standard.fragmentShader };
    material.onBeforeCompile(shader); return shader;
  };
  const initialHook = leaf.onBeforeCompile, initialKey = leaf.customProgramCacheKey();
  const renderer = { extensions:{has:()=>true}, shadowMap:{}, getContext:()=>({isContextLost:()=>false}) };
  const sun = new DirectionalLight(); sun.userData.direction = new Vector3(...DAYLIGHT.direction).normalize();
  let shadows, gi;
  t.after(() => {
    gi?.dispose(); shadows?.dispose();
    geometry.dispose(); for (const material of materials) material.dispose();
    map.dispose(); sky.dispose(); atlas.dispose();
  });
  const standalone = compile(leaf), control = leaf.userData.leafSkyTransmission;
  assert.equal(standalone.uniforms.uCampusLeafSkyTransmission,control);
  assert.equal(control.value,.25);
  assert.notEqual(control,otherLeaf.userData.leafSkyTransmission);
  for (const value of [0,.25]) {
    control.value = value;
    assert.equal(standalone.uniforms.uCampusLeafSkyTransmission.value,value);
    assert.equal(leaf.customProgramCacheKey(),initialKey,'live strength must not require recompilation');
  }
  assert.ok(standalone.fragmentShader.includes('getIBLIrradiance(-foliageFaceNormal)'));
  assert.ok(!standalone.fragmentShader.includes('campusLocalIrradiance'));
  shadows = createCampusShadows(scene,renderer,sun);
  const shadowHook = leaf.onBeforeCompile, shadowKey = leaf.customProgramCacheKey();
  // Exercise GI readiness and enable/disable without rendering a cubemap.
  const atlases = new Map();
  t.mock.method(LightProbeGridWebGL.prototype,'bake',function() {
    if(!atlases.has(this)) atlases.set(this,atlases.size ? new Data3DTexture(new Float32Array(4),1,1,1) : atlas);
    this.texture = atlases.get(this);
  });
  gi = createCourtyardIndirect(scene,renderer,{sun,probeBackground:{texture:sky},skyTarget:{texture:map}});
  const combined = compile(leaf);
  assert.equal(combined.uniforms.uCampusLeafSkyTransmission,control);
  assert.ok(combined.fragmentShader.includes('campusLeafTransmissionShadow'));
  assert.match(combined.fragmentShader,/foliageBackGI\s*=\s*campusGIWeight\(vCampusGIPosition,\s*foliageBackWorldNormal\)/);
  assert.match(combined.fragmentShader,/foliageBackIrradiance\s*=\s*mix\(foliageBackIrradiance,\s*campusLocalIrradiance\(vCampusGIPosition,\s*foliageBackWorldNormal\),\s*foliageBackGI\)/);
  assert.match(combined.fragmentShader,/transformNormalByInverseViewMatrix\(-foliageFaceNormal,\s*viewMatrix\)/);
  for (const card of cards) {
    const shader = compile(card);
    assert.equal(card.userData.leafSkyTransmission,undefined);
    assert.equal(shader.uniforms.uCampusLeafSkyTransmission,undefined);
    assert.ok(!shader.fragmentShader.includes('foliageBackGI'));
  }
  gi.setEnabled(true);
  assert.equal(combined.uniforms.uCampusGIEnabled.value,0,'unbaked GI must retain the PMREM fallback');
  const empty=combined.uniforms.uCampusGIAtlas.value,progress=[];
  await gi.bake({ onProgress:value=>progress.push(value), yieldControl:async()=>{
    assert.equal(combined.uniforms.uCampusGIAtlas.value,empty);
    assert.equal(combined.uniforms.uCampusArcadeAtlas0.value,empty);
    assert.equal(combined.uniforms.uCampusArcadeAtlas1.value,empty);
    assert.equal(combined.uniforms.uCampusArcadeAtlas2.value,empty);
    assert.equal(combined.uniforms.uCampusGIEnabled.value,0);
  } });
  assert.equal(progress.at(-1),1);
  assert.ok(progress.every((v,i)=>i===0||v>progress[i-1]));
  assert.equal(atlases.size,4);
  assert.equal(combined.uniforms.uCampusGIAtlas.value,atlas);
  assert.deepEqual([combined.uniforms.uCampusArcadeAtlas0.value,combined.uniforms.uCampusArcadeAtlas1.value,combined.uniforms.uCampusArcadeAtlas2.value],[...atlases.values()].slice(1));
  assert.equal(gi.stats.courtyardProbes,315);assert.equal(gi.stats.arcadeProbes,432);assert.equal(gi.stats.cafeProbes,160);assert.equal(gi.stats.probes,907);
  gi.setEnabled(true); assert.equal(combined.uniforms.uCampusGIEnabled.value,1);
  assert.equal(gi.getState().arcadeEnabled,true);
  gi.setArcadeEnabled(false);assert.equal(gi.getState().arcadeEnabled,false);assert.equal(gi.getState().enabled,true);
  gi.setArcadeEnabled(true);
  gi.setEnabled(false); assert.equal(combined.uniforms.uCampusGIEnabled.value,0);
  assert.equal(gi.getState().arcadeEnabled,false);
  gi.setEnabled(true); gi.dispose();
  assert.equal(combined.uniforms.uCampusGIEnabled.value,0);
  assert.equal(leaf.onBeforeCompile,shadowHook); assert.equal(leaf.customProgramCacheKey(),shadowKey);
  assert.ok(!compile(leaf).fragmentShader.includes('campusLocalIrradiance'));
  shadows.dispose();
  assert.equal(leaf.onBeforeCompile,initialHook); assert.equal(leaf.customProgramCacheKey(),initialKey);
});
test('failed local irradiance capture restores fallback and releases all probe grids', async t => {
  const scene=new Scene(),material=new MeshStandardMaterial(),geometry=new BoxGeometry(),sky=new CubeTexture();
  scene.add(new Mesh(geometry,material));
  const original=material.onBeforeCompile,key=material.customProgramCacheKey;
  const sun=new DirectionalLight();sun.userData.direction=new Vector3(...DAYLIGHT.direction).normalize();
  const renderer={extensions:{has:()=>true},shadowMap:{},getContext:()=>({isContextLost:()=>false})};
  const grids=new Set(),released=new Set();
  t.mock.method(LightProbeGridWebGL.prototype,'bake',function(){grids.add(this);if(grids.size===4)throw new Error('capture failed');});
  t.mock.method(LightProbeGridWebGL.prototype,'dispose',function(){assert.ok(!released.has(this));released.add(this);});
  const gi=createCourtyardIndirect(scene,renderer,{sun,probeBackground:{texture:sky},skyTarget:{texture:sky}});
  const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader);
  const empty=shader.uniforms.uCampusGIAtlas.value;
  await assert.rejects(gi.bake({yieldControl:async()=>{}}),/capture failed/);
  assert.equal(gi.getState().ready,false);gi.setEnabled(true);gi.setArcadeEnabled(true);
  assert.equal(gi.getState().enabled,false);assert.equal(gi.getState().arcadeEnabled,false);
  assert.equal(shader.uniforms.uCampusGIAtlas.value,empty);assert.equal(shader.uniforms.uCampusArcadeAtlas0.value,empty);
  assert.equal(shader.uniforms.uCampusArcadeAtlas1.value,empty);assert.equal(shader.uniforms.uCampusArcadeAtlas2.value,empty);
  assert.equal(material.onBeforeCompile,original);assert.equal(material.customProgramCacheKey,key);
  assert.equal(grids.size,4);assert.equal(released.size,4);assert.equal(renderer.shadowMap.needsUpdate,true);assert.equal(sun.shadow.needsUpdate,true);
  gi.dispose();await assert.rejects(gi.bake(),/disposed/);
  material.dispose();geometry.dispose();sky.dispose();
});
test('quality changes preserve material hooks and the physical sun size', () => {
  const scene = new Scene(), material = new MeshStandardMaterial(), geometry = new BoxGeometry();
  const original = shader => { shader.fragmentShader += '\n// existing material detail'; };
  material.onBeforeCompile = original; material.customProgramCacheKey = () => 'existing-material';
  scene.add(new Mesh(geometry, material));
  const sun = new DirectionalLight(), shadows = createCampusShadows(scene, { shadowMap: {} }, sun);
  const shader = { uniforms: {}, fragmentShader: '#include <common>\n#include <shadowmap_pars_fragment>' };
  material.onBeforeCompile(shader);
  assert.ok(shader.fragmentShader.includes('existing material detail'));
  assert.ok(shader.fragmentShader.includes('campusLeafTransmissionShadow'));
  for (const preset of Object.values(QUALITY)) {
    shadows.setQuality(preset);
    assert.equal(shader.uniforms.uCampusSunRadius.value, SUN_ANGULAR_RADIUS);
    assert.equal(shader.uniforms.uCampusShadowSamples.value, preset.shadowSamples);
  }
  shadows.dispose();
  assert.equal(material.onBeforeCompile, original);
  assert.equal(material.customProgramCacheKey(), 'existing-material');
  geometry.dispose(); material.dispose();
});
test('comparison filtering covers opaque surfaces and foliage while preserving material hooks', () => {
  const leaf=foliageMaterial({veins:true}),card=foliageMaterial({map:new Texture(),canopyVolume:true}),wall=new MeshStandardMaterial();
  const materials=[leaf,card,wall,new MeshPhysicalMaterial()],scene=new Scene(),geometry=new BoxGeometry();
  const originals=materials.map(m=>({compile:m.onBeforeCompile,key:m.customProgramCacheKey}));
  materials.forEach(m=>scene.add(new Mesh(geometry,m)));
  scene.add(new Mesh(geometry,leaf));
  const shadows=createCampusShadows(scene,{shadowMap:{}},new DirectionalLight());
  materials.forEach((material,i)=>{
    const shader={uniforms:{},vertexShader:ShaderLib.standard.vertexShader,fragmentShader:ShaderLib.standard.fragmentShader};
    material.onBeforeCompile(shader);
    assert.ok(shader.fragmentShader.includes('visibility += campusShadowTapVisibility(shadowMap, uv, shadowMapSize, receiver, gradient);'));
    assert.ok(!shader.fragmentShader.includes('CAMPUS_LEAF_FILTER'));
    assert.ok(material.customProgramCacheKey().endsWith('-campus-soft-sun-v3-tap-bilinear'));
    assert.equal(shader.uniforms.uCampusShadowSamples,shadows.uniforms.uCampusShadowSamples);
    if(i===0)assert.equal(shader.uniforms.uCampusLeafSkyTransmission,leaf.userData.leafSkyTransmission);
  });
  shadows.dispose();
  materials.forEach((material,i)=>{
    assert.equal(material.onBeforeCompile,originals[i].compile);
    assert.equal(material.customProgramCacheKey,originals[i].key);
    material.map?.dispose();material.dispose();
  });
  geometry.dispose();
});
test('overview shadows cover the woodland without reducing pedestrian shadow precision', () => {
  const sun = new DirectionalLight();
  sun.userData.direction = new Vector3(...DAYLIGHT.direction).normalize();
  sun.userData.campusOverviewBounds = new Box3(new Vector3(-480, -1, -400), new Vector3(380, 45, 250));
  for (const shot of [-1, 0, 5]) {
    fitCampusShadow(sun, shot); sun.shadow.updateMatrices(sun);
    for (const x of [-480, 380]) for (const y of [-1, 45]) for (const z of [-400, 250]) {
      const uv = new Vector3(x,y,z).applyMatrix4(sun.shadow.matrix);
      assert.ok(uv.toArray().every(v => v > 0 && v < 1), `woodland falls outside shot ${shot}`);
    }
  }
  const overviewSpan = sun.shadow.camera.right - sun.shadow.camera.left;
  fitCampusShadow(sun, 2);
  assert.equal(sun.shadow.camera.right - sun.shadow.camera.left, 120);
  assert.ok(overviewSpan > 500);
});
test('arcade shadows align the long eave and restore the overview orientation after a cut', () => {
  const sun=new DirectionalLight();
  sun.userData.direction=new Vector3(...DAYLIGHT.direction).normalize();
  fitCampusShadow(sun,4);sun.shadow.updateMatrices(sun);
  const projection=sun.shadow.matrix;
  const eave=[-46,-24,-2].map(z=>new Vector3(-20.8,3.6,z).applyMatrix4(projection));
  assert.ok(eave.every(p=>Math.abs(p.x-eave[0].x)<1e-12),'long eave must follow one shadow texel column');
  // Keep both the near arcade and the opposing headquarters inside the rotated volume.
  for(const bounds of [[-25,0,-47,-20,5,-1],[-30,0,-76,30,32,-52]]) {
    const [minX,minY,minZ,maxX,maxY,maxZ]=bounds;
    for(const x of [minX,maxX])for(const y of [minY,maxY])for(const z of [minZ,maxZ]) {
      const p=new Vector3(x,y,z).applyMatrix4(projection);
      assert.ok(p.toArray().every(v=>v>0&&v<1),'arcade or opposing facade falls outside the shadow volume');
    }
  }
  assert.equal(sun.shadow.camera.right-sun.shadow.camera.left,104);
  for(const shot of [-1,0,1,2,3,5]) {
    fitCampusShadow(sun,4);fitCampusShadow(sun,shot);
    assert.deepEqual(sun.shadow.camera.up.toArray(),[0,1,0]);
  }
});
test('architecture has finite transforms and a bounded geometry budget', () => {
  const root = buildBuildings(); let triangles = 0, meshes = 0;
  assert.equal(root.userData.buildingCount, 7);
  root.traverse(o => {
    if (!o.isMesh) return;
    meshes++;
    const geo = o.geometry; geo.computeBoundingSphere();
    assert.ok(Number.isFinite(geo.boundingSphere.radius));
    if (o.isInstancedMesh) assert.ok(o.instanceMatrix.array.every(Number.isFinite));
    triangles += (geo.index?.count || geo.attributes.position.count) / 3 * (o.count || 1);
  });
  assert.ok(meshes < 100 && triangles > 10000 && triangles < 600000);
  assert.equal(root.userData.triangles, triangles);
});
test('roof maintenance routes, screen openings and fan surfaces match the actual geometry', () => {
  const root = buildBuildings(); root.updateMatrixWorld(true);
  const plans = root.userData.roofService.plans, meshes = [], ray = new Raycaster(), matrix = new Matrix4();
  root.traverse(o => { if (o.isMesh) meshes.push(o); });
  assert.equal(plans.length, 5);
  const cast = (from, direction, far) => {
    ray.set(from, direction); ray.near = 0; ray.far = far;
    return ray.intersectObjects(meshes, false);
  };
  const down = new Vector3(0,-1,0), forward = new Vector3(0,0,-1);
  const doors = root.getObjectByName('Charcoal powder coated metal');
  for (const p of plans) {
    const door = new Vector3(p.door[0],0,p.door[1]), turn = door.clone().add(new Vector3(0,0,.6));
    const corner = new Vector3(p.x,0,turn.z), service = new Vector3(p.x,0,p.z+.35);
    const segments = [[door,turn],[turn,corner],[corner,service],
      [service,new Vector3(p.x-4.5,0,p.z+.35)],[service,new Vector3(p.x+4.5,0,p.z+.35)]];
    let supported = 0;
    for (const [a,b] of segments) {
      const dir = b.clone().sub(a).normalize(), side = new Vector3(-dir.z,0,dir.x);
      for (const offset of [-.55,.55]) for (const height of [.1,1.85]) {
        const from = a.clone().addScaledVector(dir,.01).addScaledVector(side,offset); from.y = p.y+.17+height;
        assert.equal(cast(from,dir,a.distanceTo(b)-.02).length,0,'maintenance route is obstructed');
      }
      const point = a.clone().lerp(b,.37).addScaledVector(side,.13); point.y = p.y+.5;
      const hit = cast(point,down,.5)[0]; assert.ok(hit,'roof route has no support');
      assert.ok(Math.abs(hit.point.y-p.y-.17)<1e-5 || Math.abs(hit.point.y-p.y-.12)<1e-5);
      if (Math.abs(hit.point.y-p.y-.17)<1e-5) supported++;
    }
    assert.ok(supported>=3,'the route must have actual paving above the roof');
    for (const sign of [-1,1]) {
      assert.equal(cast(new Vector3(p.x+sign*.695,p.y+1.1,p.gate.z+.2),forward,.4).length,0);
      assert.ok(cast(new Vector3(p.x+sign*.705,p.y+1.1,p.gate.z+.2),forward,.4).length>0);
    }
    let foundDoor = false;
    for (let i=0;i<doors.count;i++) {
      doors.getMatrixAt(i,matrix);
      const position = new Vector3().setFromMatrixPosition(matrix), size = new Vector3().setFromMatrixScale(matrix);
      if (Math.abs(position.x-door.x)>1e-5 || Math.abs(position.z-door.z+.02)>1e-5) continue;
      assert.ok(Math.abs(size.x-1.15)<1e-5 && Math.abs(size.y-2.05)<1e-5);
      assert.ok(Math.abs(position.y-size.y/2-p.y-.17)<1e-5); foundDoor = true;
    }
    assert.ok(foundDoor,'roof door must meet the finished paving height');
  }
  const ring = root.getObjectByName('Roof fan collars'), well = root.getObjectByName('Recessed roof fan wells');
  assert.equal(ring.count,30); assert.equal(well.count,30);
  for (let i=0;i<ring.count;i+=6) {
    ring.getMatrixAt(i,matrix); const center = new Vector3().setFromMatrixPosition(matrix);
    for (const [radius,height,name] of [[.69,.075,ring.name],[.6,.01,well.name],[.17,.045,'Zinc coping and equipment']]) {
      const hit = cast(center.clone().add(new Vector3(radius,.3,0)),down,.4)[0];
      assert.ok(hit); assert.equal(hit.object.name,name); assert.ok(Math.abs(hit.point.y-center.y-height)<1e-5);
    }
    const inner = cast(center.clone().add(new Vector3(.5,.04,0)),new Vector3(1,0,0),.3)[0];
    assert.ok(inner && inner.object===ring,'fan collar must have an inward-facing inner wall');
  }
});

test('curtain-wall spandrels share the window plane and retain a separated opaque backing', () => {
  const architecture = buildBuildings(), panes = [], backings = [], matrix = new Matrix4();
  architecture.traverse(mesh => {
    if (!mesh.isInstancedMesh) return;
    const glass = mesh.material.userData.campusGlass, backing = mesh.material.name === 'Insulated spandrel backing';
    if (!glass && !backing) return;
    if (glass) for (const name of ['paneDetail','paneSize','paneRoom','paneType']) assert.equal(mesh.geometry.getAttribute(name).count,mesh.count);
    for (let i=0; i<mesh.count; i++) {
      mesh.getMatrixAt(i,matrix);
      const record = {
        center:new Vector3().setFromMatrixPosition(matrix), normal:new Vector3().setFromMatrixColumn(matrix,2).normalize(),
        width:new Vector3().setFromMatrixColumn(matrix,0).length(), depth:new Vector3().setFromMatrixColumn(matrix,2).length(),
        inverse:matrix.clone().invert(), type:glass ? mesh.geometry.getAttribute('paneType').getX(i) : null,
      };
      (glass ? panes : backings).push(record);
    }
  });
  const vision = panes.filter(p=>p.type===0), spandrels = panes.filter(p=>p.type===1);
  assert.equal(vision.length,1896); assert.ok(spandrels.length>1000);
  assert.equal(spandrels.length,architecture.userData.spandrelPanes);
  for (const pane of spandrels) {
    const window = vision.find(p=>p.normal.dot(pane.normal)>.999 && Math.abs(p.center.clone().sub(pane.center).dot(pane.normal))<1e-4 && p.center.distanceTo(pane.center)<32 && pane.center.y-p.center.y>.2 && pane.center.y-p.center.y<2.5);
    assert.ok(window,'spandrel has no coplanar vision glazing on its storey');
    assert.ok(Math.abs(window.depth-pane.depth)<1e-6);
    const backing = backings.find(p=>{
      const local = pane.center.clone().applyMatrix4(p.inverse);
      return p.normal.dot(pane.normal)>.999 && Math.abs(local.y)<1e-5 && Math.abs(local.x)<.5 && local.z>.5 && local.z<1;
    });
    assert.ok(backing,`missing recessed opaque backing at ${pane.center.toArray()}`);
    const clearance = pane.center.clone().sub(backing.center).dot(pane.normal)-(pane.depth+backing.depth)/2;
    assert.ok(Math.abs(clearance-.0225)<1e-5,'glass touches or intersects its backing');
  }
});
test('ordinary curtain glazing bites into connected frames on all four edges', () => {
  const architecture=buildBuildings(), panes=[], solids=[], matrix=new Matrix4(), point=new Vector3();
  architecture.updateMatrixWorld(true);
  // Inspect the actual uploaded box and chamfer triangles, not design metadata.
  const addSolid=(mesh,transform,start=0,count=mesh.geometry.attributes.position.count)=>{
    const positions=mesh.geometry.attributes.position, vertices=[];
    for(let i=start;i<start+count;i++)vertices.push(new Vector3().fromBufferAttribute(positions,i).applyMatrix4(transform));
    solids.push({vertices,index:mesh.geometry.index?.array,bounds:new Box3().setFromPoints(vertices),material:mesh.material.name});
  };
  architecture.traverse(mesh=>{
    if(!mesh.isMesh)return;
    if(mesh.material.userData.campusGlass) {
      const attributes=mesh.geometry.attributes;
      for(let i=0;i<mesh.count;i++) {
        mesh.getMatrixAt(i,matrix);matrix.premultiply(mesh.matrixWorld);
        const tangent=new Vector3().setFromMatrixColumn(matrix,0),normal=new Vector3().setFromMatrixColumn(matrix,2);
        panes.push({center:new Vector3().setFromMatrixPosition(matrix),width:tangent.length(),depth:normal.length(),
          height:new Vector3().setFromMatrixColumn(matrix,1).length(),tangent:tangent.normalize(),normal:normal.normalize(),
          type:attributes.paneType.getX(i),room:[attributes.paneRoom.getZ(i),attributes.paneRoom.getW(i)]});
      }
    } else if(!['Anodized champagne aluminum','Charcoal powder coated metal','Basalt cladding'].includes(mesh.material.name))return;
    else if(mesh.isInstancedMesh) {
      for(let i=0;i<mesh.count;i++){mesh.getMatrixAt(i,matrix);addSolid(mesh,matrix.clone().premultiply(mesh.matrixWorld));}
    } else if(mesh.userData.componentBounds) {
      for(let i=0;i<mesh.userData.componentBounds.length;i++)addSolid(mesh,mesh.matrixWorld,i*132,132);
    }
  });
  const layouts=[3.6,3.8,4.2].flatMap(fh=>[.42,.64].map(spandrel=>({fh,height:fh-spandrel-.1505})));
  const ordinary=panes.filter(p=>p.type===0&&Math.abs(p.normal.y)<1e-5&&layouts.some(l=>Math.abs(l.height-p.height)<1e-5));
  assert.equal(ordinary.length,1510,'the test must cover every ordinary curtain pane');
  const mullions=new Set();
  for(const solid of solids) {
    const size=solid.bounds.getSize(new Vector3());
    if(size.y<3.59||Math.abs(Math.min(size.x,size.z)-.075)>1e-5||Math.abs(Math.max(size.x,size.z)-.24)>1e-5)continue;
    const key=[...solid.bounds.min.toArray(),...solid.bounds.max.toArray()].map(v=>v.toFixed(5)).join(',');
    assert.ok(!mullions.has(key),'entrance closure duplicates an existing mullion');mullions.add(key);
  }
  const ray=new Raycaster(), hit=new Vector3(), expected=new Vector3(), up=new Vector3(0,1,0);
  let edgeSamples=0, portalEdges=0;
  const actualCap=(sample,normal,candidates,outset)=>{
    expected.copy(sample).addScaledVector(normal,outset);
    ray.set(sample.clone().addScaledVector(normal,Math.max(.08,outset+.05)),normal.clone().negate());
    for(const solid of candidates) {
      if(!solid.bounds.clone().expandByScalar(1e-5).containsPoint(expected))continue;
      const {vertices,index}=solid;
      for(let i=0;i<(index?.length||vertices.length);i+=3) {
        if(!ray.ray.intersectTriangle(vertices[index?index[i]:i],vertices[index?index[i+1]:i+1],vertices[index?index[i+2]:i+2],false,hit))continue;
        if(hit.distanceTo(expected)<3e-5) {
          assert.ok(solid.bounds.clone().expandByScalar(1e-5).containsPoint(sample),'frame cap floats ahead of the glass edge');
          edgeSamples++;return solid;
        }
      }
    }
    return false;
  };
  const edgeBite=(solid,sample,axis,side)=>{
    const center=solid.bounds.getCenter(new Vector3()),size=solid.bounds.getSize(new Vector3());
    const half=(Math.abs(axis.x)*size.x+Math.abs(axis.y)*size.y+Math.abs(axis.z)*size.z)/2;
    const inwardEdge=center.dot(axis)-side*half;
    assert.ok(Math.abs(side*(sample.dot(axis)+side*.003-inwardEdge)-.006)<3e-5,'glass must bite exactly 6mm behind the cap');
  };
  for(const pane of ordinary) {
    const layout=layouts.find(l=>Math.abs(l.height-pane.height)<1e-5),base=pane.center.y-pane.height/2-.074;
    assert.ok(Math.abs(pane.center.y-pane.room[0]-base)<3e-6,'moving the pane moved its room floor');
    assert.ok(Math.abs(pane.center.y+pane.room[1]-base-layout.fh+.28)<3e-6,'moving the pane moved its room ceiling');
    const spandrel=panes.find(p=>p.type===1&&p.normal.dot(pane.normal)>.999&&
      Math.hypot(p.center.x-pane.center.x,p.center.z-pane.center.z)<1e-4&&p.center.y>pane.center.y&&p.center.y-pane.center.y<2.5);
    assert.ok(spandrel);assert.ok(Math.abs(spandrel.width-pane.width)<1e-5);
    assert.ok(Math.abs(spandrel.center.y-spandrel.height/2-pane.center.y-pane.height/2-.053)<3e-6,'glass faces overlap at the transom');
    const front=pane.center.clone().addScaledVector(pane.normal,pane.depth/2);
    const spanBounds=new Box3().setFromPoints([
      front.clone().addScaledVector(pane.tangent,-pane.width/2).setY(base-.01),
      front.clone().addScaledVector(pane.tangent,pane.width/2).setY(base+layout.fh+.09),
    ]).expandByScalar(.55);
    const candidates=solids.filter(s=>s.bounds.intersectsBox(spanBounds));
    let portalJamb;
    for(const glass of [pane,spandrel]) {
      const face=glass.center.clone().addScaledVector(glass.normal,glass.depth/2);
      for(const fraction of [.003/glass.height,.5,1-.003/glass.height])for(const side of [-1,1]) {
        point.copy(face).addScaledVector(glass.tangent,side*(glass.width/2-.003)).addScaledVector(up,(fraction-.5)*glass.height);
        const cap=actualCap(point,glass.normal,candidates,.0315);
        if(cap) {
          edgeBite(cap,point,glass.tangent,side);
          if(glass===spandrel&&side===1&&portalJamb)assert.ok(cap.bounds.min.y>=portalJamb.bounds.max.y-1e-5,'new short mullion intersects the existing portal jamb');
        }
        else {
          // One gallery podium window already terminates in the unchanged
          // stone entrance jamb. Its new metal closure starts above the jamb.
          const gallery=BUILDINGS.find(b=>b.id==='gallery');
          assert.ok(glass===pane&&side===1&&glass.normal.z<-.999&&point.x>gallery.x+4&&point.x<gallery.x+4.44&&
            Math.abs(point.z-(gallery.z+1-(gallery.d-4)/2+.1275))<1e-5,'unexpected nonmetal curtain edge');
          const jamb=actualCap(point,glass.normal,candidates,.5025);
          assert.equal(jamb?.material,'Basalt cladding','portal-adjacent glass has no real stone closure');portalJamb=jamb;portalEdges++;
        }
      }
      for(const fraction of [.05,.5,.95]) {
        point.copy(face).addScaledVector(glass.tangent,(fraction-.5)*glass.width).addScaledVector(up,-glass.height/2+.003);
        const bottom=actualCap(point,glass.normal,candidates,.0275);
        assert.ok(bottom,`missing bottom cap at ${point.toArray()}`);edgeBite(bottom,point,up,-1);
        point.copy(face).addScaledVector(glass.tangent,(fraction-.5)*glass.width).addScaledVector(up,glass.height/2-.003);
        const top=actualCap(point,glass.normal,candidates,.0275);
        assert.ok(top,`missing top cap at ${point.toArray()}`);edgeBite(top,point,up,1);
      }
    }
  }
  assert.equal(edgeSamples,ordinary.length*24);
  assert.equal(portalEdges,3,'only the existing gallery jamb can replace an ordinary vertical cap');
  // The C arcade's back face stays in the same plane above the ground floor.
  // Its shared sill must not have a second, coplanar aluminum cap underneath.
  const c=BUILDINGS.find(b=>b.id==='c'),backPlane=c.x-c.w/2+.1,jointY=.16+c.floorHeight;
  for(const y of [.02,.04,.05])for(const fraction of [.2,.5,.8]) {
    point.set(backPlane,jointY+y,c.z+(fraction-.5)*c.d);
    ray.set(point.clone().add(new Vector3(-.1,0,0)),new Vector3(1,0,0));
    const caps=new Set();
    for(const solid of solids) {
      if(!solid.bounds.clone().expandByScalar(1e-5).containsPoint(point))continue;
      const {vertices,index}=solid;
      for(let i=0;i<(index?.length||vertices.length);i+=3) {
        if(ray.ray.intersectTriangle(vertices[index?index[i]:i],vertices[index?index[i+1]:i+1],vertices[index?index[i+2]:i+2],false,hit)&&hit.distanceTo(point)<3e-5)caps.add(solid);
      }
    }
    assert.equal(caps.size,1,'continuous curtain storeys have overlapping pressure caps');
    assert.equal([...caps][0].material,'Charcoal powder coated metal');
  }
  // Portal head panes have no ordinary vision pane below: the entrance system
  // owns their framing and is intentionally outside this repair's assertions.
  assert.equal(panes.filter(p=>p.type===1).length-ordinary.length,38);
});
test('glass uses its 512px reflection detail while retaining geometric roughness filtering', () => {
  const architecture = buildBuildings(), materials = new Set(), original = ShaderChunk.lights_physical_fragment;
  architecture.traverse(o=>{if(o.material?.userData.campusGlass)materials.add(o.material);});
  assert.equal(materials.size,4);
  const c=BUILDINGS.find(b=>b.id==='c'),matrix=new Matrix4();let target=0,vision=0,spandrel=0,panes=0;
  architecture.traverse(mesh=>{
    if(!mesh.isInstancedMesh||!mesh.material.userData.campusGlass)return;
    const id=mesh.material.userData.campusGlass.probe.id,unit=new Box3().setFromBufferAttribute(mesh.geometry.attributes.position);
    for(let i=0;i<mesh.count;i++){
      mesh.getMatrixAt(i,matrix);panes++;
      const p=new Vector3().setFromMatrixPosition(matrix),n=new Vector3().setFromMatrixColumn(matrix,2).normalize();
      const bounds=unit.clone().applyMatrix4(matrix);
      const upperEast=n.x>.999&&p.x>=c.x-c.w/2&&p.x<=c.x+c.w/2&&p.z>=c.z-c.d/2&&p.z<=c.z+c.d/2&&bounds.min.y>=.16+c.floorHeight-1e-5;
      assert.equal(id==='c-upper-east',upperEast,'only the real C east upper panes use the elevated probe');
      if(upperEast){target++;if(mesh.geometry.attributes.paneType.getX(i)===1)spandrel++;else vision++;}
    }
  });
  assert.equal(panes,3444);assert.equal(target,144);assert.equal(vision,72);assert.equal(spandrel,72);
  const upper=[...materials].find(m=>m.userData.campusGlass.probe.id==='c-upper-east');
  assert.deepEqual(upper.userData.campusGlass.probe.position,[c.x+c.w/2+1.2,.16+(1+c.floors)*c.floorHeight/2,c.z]);
  assert.equal(upper.userData.campusGlass.planarUniforms,undefined);
  assert.ok([...materials].find(m=>m.userData.campusGlass.probe.id==='west').userData.campusGlass.planarUniforms);
  for (const material of materials) {
    const shader={uniforms:{},vertexShader:ShaderLib.physical.vertexShader,fragmentShader:ShaderLib.physical.fragmentShader};
    material.onBeforeCompile(shader);
    const floors=[...shader.fragmentShader.matchAll(/max\( (?:roughnessFactor|material.clearcoatRoughness), ([\d.]+) \)/g)].map(match=>Number(match[1]));
    assert.equal(floors.length,2);
    for (const floor of floors) assert.ok(-2*Math.log2(1.16*floor)>8.9,'glass loses the highest reflection mip');
    const low=Math.max(floors[0],material.roughness*.9), high=Math.max(floors[0],material.roughness*1.1);
    assert.ok(high-low>.004,'the roughness floor erases all pane variation');
    assert.ok(shader.fragmentShader.includes('material.roughness += geometryRoughness;'));
    assert.ok(shader.fragmentShader.includes('material.clearcoatRoughness += geometryRoughness;'));
  }
  assert.equal(ShaderChunk.lights_physical_fragment,original,'glass changed the global shader chunk');
});
test('chamfers stay inside the individual solids used for camera clearance', () => {
  const architecture = buildBuildings(), point = new Vector3(); let components = 0;
  architecture.traverse(o => {
    const boxes = o.userData.componentBounds;
    if (!boxes) return;
    const position = o.geometry.attributes.position;
    assert.equal(position.count, boxes.length * 44 * 3);
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      assert.ok(boxes[Math.floor(i / 132)].distanceToPoint(point) < 1e-5, 'bevel expands its original solid');
    }
    components += boxes.length;
  });
  assert.ok(components > 1000);
});
test('arcade stones meet the original floor level with shallow, closed joints and sound cut geometry', () => {
  const architecture=buildBuildings(), paving=architecture.getObjectByName('Cut stone arcade paving');
  architecture.updateMatrixWorld(true);
  const stats=architecture.userData.arcadePaving, ray=new Raycaster(), down=new Vector3(0,-1,0);
  const a=new Vector3(), b=new Vector3(), c=new Vector3(), cutSamples=[]; let meshes=0, triangles=0, joints=0;
  assert.deepEqual(stats.surfaces.map(s=>s.id),['a','c']);
  paving.traverse(mesh=>{
    if(!mesh.isMesh)return;
    meshes++;
    const p=mesh.geometry.attributes.position, n=mesh.geometry.attributes.normal, index=mesh.geometry.index;
    assert.ok(p.array.every(Number.isFinite) && n.array.every(Number.isFinite));
    for(let i=0;i<(index?.count||p.count);i+=3) {
      a.fromBufferAttribute(p,index?index.getX(i):i);b.fromBufferAttribute(p,index?index.getX(i+1):i+1);c.fromBufferAttribute(p,index?index.getX(i+2):i+2);
      if(!mesh.isInstancedMesh && Math.abs(a.y-.18)<1e-5 && Math.abs(b.y-.18)<1e-5 && Math.abs(c.y-.18)<1e-5)
        cutSamples.push(a.clone().add(b).add(c).multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld));
      assert.ok(b.sub(a).cross(c.sub(a)).lengthSq()>1e-14,'collapsed stone face');
    }
    for(const attribute of [mesh.geometry.attributes.color,mesh.instanceColor].filter(Boolean))
      assert.ok(attribute.array.every(v=>v>.96 && v<1.04),'stone tint must be a small linear reflectance variation');
    triangles+=(index?.count||p.count)/3*(mesh.count||1);
  });
  assert.ok(meshes<=2 && triangles>10000 && triangles<25000);
  assert.equal(triangles,stats.triangles);
  assert.ok(cutSamples.length>100);
  for(const point of cutSamples) {
    ray.set(point.clone().setY(.19),down);
    const hit=ray.intersectObject(architecture,true)[0];assert.ok(hit);
    assert.ok(Math.abs(hit.point.y-.18)<1e-5);
    assert.equal(hit.object.material.name,'Flamed warm grey arcade stone','cut stone intersects a column or frame');
  }
  const hitAt=(surface,u,v)=>{
    ray.set(new Vector3(surface.origin[0]+surface.tangent[0]*u+surface.normal[0]*v,.19,
      surface.origin[1]+surface.tangent[1]*u+surface.normal[1]*v),down);
    const hit=ray.intersectObject(architecture,true)[0];assert.ok(hit,'open hole through the arcade');return hit;
  };
  for(const surface of stats.surfaces) {
    for(const tile of surface.tiles) {
      if(!tile.regular)continue;
      const [u0,u1,v0,v1]=tile.rect;
      const hit=hitAt(surface,(u0+u1)/2,(v0+v1)/2);
      assert.ok(Math.abs(hit.point.y-.18)<1e-5,'stone changes the pedestrian floor height');
      assert.equal(hit.object.material.name,'Flamed warm grey arcade stone');
      for(const other of surface.tiles) {
        if(!tile.regular || !other.regular || other.cell[0]!==tile.cell[0]+1 || other.cell[1]!==tile.cell[1])continue;
        assert.ok(Math.abs(other.rect[0]-u1-.003)<1e-8);
        const seam=hitAt(surface,(u1+other.rect[0])/2,(v0+v1)/2);
        assert.equal(seam.object.material.name,'Arcade stone joint mortar');
        assert.ok(Math.abs(seam.point.y-.178)<1e-5,'old slab fills the seam or leaves a deep crack');
        joints++;
      }
    }
  }
  assert.ok(joints>100);
});
test('soffit boards keep metre-scale grain through cuts, close their joints, and preserve headroom', () => {
  const architecture=buildBuildings();architecture.updateMatrixWorld(true);
  const group=architecture.getObjectByName('Jointed ash arcade soffits'),stats=architecture.userData.arcadeSoffit;
  const full=group.getObjectByName('Full length ash soffit boards');let cut,triangles=0,meshes=0,samples=0,joints=0;
  group.traverse(mesh=>{
    if(!mesh.isMesh)return;
    meshes++;triangles+=mesh.geometry.attributes.position.count/3*(mesh.count||1);
    assert.ok(mesh.castShadow && mesh.receiveShadow);
    if(!mesh.isInstancedMesh && mesh.material===full.material)cut=mesh;
  });
  assert.equal(meshes,3);assert.equal(triangles,stats.triangles);assert.ok(triangles<25000);
  const ray=new Raycaster(),up=new Vector3(0,1,0),point=new Vector3(),matrix=new Matrix4();
  const hitAt=(p,name,y)=>{
    ray.set(p.clone().setY(3.4),up);
    const hit=ray.intersectObject(architecture,true)[0];assert.ok(hit);
    assert.equal(hit.object.material.name,name);
    assert.ok(Math.abs(hit.point.y-y)<1e-5,'board or backing changed the ceiling level');
  };
  for(const surface of stats.surfaces) {
    const toWorld=(u,v)=>new Vector3(surface.origin[0]+surface.tangent[0]*u+surface.normal[0]*v,3.4,
      surface.origin[1]+surface.tangent[1]*u+surface.normal[1]*v);
    const blocked=(u,v)=>surface.obstacles.some(r=>u>=r[0] && u<=r[1] && v>=r[2] && v<=r[3]);
    for(const board of surface.boards) {
      const mesh=board.regular?full:cut,p=mesh.geometry.attributes.position,uv=mesh.geometry.attributes.uv,n=mesh.geometry.attributes.normal;
      const begin=board.regular?0:board.vertexStart,end=board.regular?p.count:begin+board.vertexCount;
      const phase=board.regular?mesh.geometry.attributes.soffitPhase:null;
      if(board.regular)full.getMatrixAt(board.instance,matrix);
      const vertices=[];
      for(let i=begin;i<end;i++) {
        point.fromBufferAttribute(p,i);if(board.regular)point.applyMatrix4(matrix);
        assert.ok(point.toArray().every(Number.isFinite) && point.y>=3.41-1e-5 && point.y<=3.43+1e-5);
        const dx=point.x-surface.origin[0],dz=point.z-surface.origin[1];
        const u=dx*surface.tangent[0]+dz*surface.tangent[1],v=dx*surface.normal[0]+dz*surface.normal[1];
        assert.ok(Math.abs(uv.getX(i)+(phase?.getX(board.instance)||0)-(u-board.uvOrigin[0]+board.phase[0]))<1e-5,'grain length changes after instancing or merging');
        assert.ok(Math.abs(uv.getY(i)+(phase?.getY(board.instance)||0)-(v-board.uvOrigin[1]+board.phase[1]))<1e-5,'short board flips or stretches grain width');
        vertices.push(point.clone());
      }
      for(let i=begin;i<end;i+=3) {
        if(n.getY(i)>-.999 || n.getY(i+1)>-.999 || n.getY(i+2)>-.999)continue;
        const j=i-begin,center=vertices[j].clone().add(vertices[j+1]).add(vertices[j+2]).multiplyScalar(1/3);
        hitAt(center,full.material.name,3.41);samples++;
      }
      const next=surface.boards.find(other=>other.row===board.row && other.segment===board.segment+1);
      if(next) {
        const u=(board.rect[1]+next.rect[0])/2,v=(board.rect[2]+board.rect[3])/2;
        assert.ok(Math.abs(next.rect[0]-board.rect[1]-.003)<1e-8);
        if(!blocked(u,v)){hitAt(toWorld(u,v),'Recessed soffit backing',3.435);joints++;}
      }
    }
    for(let row=0;row<stats.rows-1;row++) {
      const board=surface.boards.find(b=>b.row===row),u=.317,v=board.rect[3]+stats.joint/2;
      if(!blocked(u,v)){hitAt(toWorld(u,v),'Recessed soffit backing',3.435);joints++;}
    }
  }
  assert.ok(samples>1000 && joints>400);
});
test('procedural bark stores normalized normals independently of albedo', () => {
  const material = createBarkMaterial(), data = material.normalMap.image.data;
  assert.notEqual(material.map.colorSpace, material.normalMap.colorSpace);
  let relief = 0;
  for (let i = 0; i < data.length; i += 4 * 127) {
    const x = data[i] / 127.5 - 1, y = data[i+1] / 127.5 - 1, z = data[i+2] / 127.5 - 1;
    assert.ok(Math.abs(Math.hypot(x,y,z) - 1) < .008 && z > 0);
    relief = Math.max(relief, Math.hypot(x,y));
  }
  assert.ok(relief > .3);
  material.map.dispose(); material.normalMap.dispose(); material.roughnessMap.dispose(); material.dispose();
});
test('broad groundcover leaves have curved, consistently wound surfaces within their physical scale', () => {
  const geometry = groundcoverLeafGeometry(), p = geometry.attributes.position, n = geometry.attributes.normal;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  assert.equal(geometry.index.count / 3, 20);
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(n, i);
    assert.ok(a.toArray().every(Number.isFinite) && a.x >= -0.5 && a.x <= 0.5 && a.y >= 0 && a.y <= 1);
    assert.ok(Math.abs(b.length() - 1) < 1e-6 && b.z > 0);
  }
  for (let i = 0; i < geometry.index.count; i += 3) {
    a.fromBufferAttribute(p, geometry.index.getX(i)); b.fromBufferAttribute(p, geometry.index.getX(i+1)); c.fromBufferAttribute(p, geometry.index.getX(i+2));
    assert.ok(b.sub(a).cross(c.sub(a)).z > 0, 'flipped or collapsed leaf face');
  }
  geometry.dispose();
});
test('raising tree crowns preserves connected curves and footprint while respecting design height', () => {
  for (const generate of [genMaple, genCherry]) for(const plannedTop of [null,12]) {
    const base = new Vector3(3,-.012,-7), tree = generate(rng('crown-clearance'), { h:12, base, spread:0.4, detail:0.15, shellDensity:0.8 });
    const before = tree.branches.map(b => b.pts.map(p => p.clone()));
    const height = Math.max(...before.flat().map(p => p.y)), junctions = new Map();
    raiseCrown(tree, base, 3.55, plannedTop);
    assert.equal(tree.branches[0].pts[0].y, before[0][0].y);
    assert.ok(Math.abs(Math.max(...tree.branches.flatMap(b => b.pts.map(p => p.y))) - (plannedTop === null ? height : base.y+plannedTop)) < 1e-9);
    tree.branches.forEach((branch, bi) => branch.pts.forEach((p, i) => {
      const original = before[bi][i], key = original.toArray().join(',');
      assert.equal(p.x, original.x); assert.equal(p.z, original.z);
      if (junctions.has(key)) assert.ok(p.distanceTo(junctions.get(key)) < 1e-9, 'branch junction separated');
      else junctions.set(key, p);
      if (branch.level > 0 && Math.hypot(p.x-base.x, p.z-base.z) > 0.5) assert.ok(p.y >= base.y+3.55 - 1e-9);
      if (i > 0 && Math.abs(original.y - before[bi][i-1].y) > 1e-5) assert.ok(Math.abs(p.y-branch.pts[i-1].y) > 1e-6, 'curved limb flattened');
    }));
  }
});
test('crown shading follows both height-map slopes without changing the placement envelope', () => {
  const raw={c:new Vector3(2,6.8,-3),r:new Vector3(4,5.4,5)};
  // Independent forward map: ground=1, fork=3 maps to newFork=4; then scale 1.2 and translate -.7.
  const first=y=>y<4?1+(y-1)*4/3:5+(y-4)*8/9,forward=y=>first(y)*1.2-.7;
  const env={c:raw.c.clone().setY(forward(raw.c.y)),r:raw.r.clone().setY(raw.r.y*1.2)};
  const original={c:env.c.clone(),r:env.r.clone()};
  const field=remappedCrownField(env,{ground:1,height:12,fork:3,newFork:4,rawCrownY:raw.c.y,firstCrownY:first(raw.c.y),firstRadiusY:raw.r.y});
  for(let latitude=0;latitude<=20;latitude++)for(let longitude=0;longitude<16;longitude++)for(const radius of [.4,1,1.3]) {
    const t=latitude*Math.PI/20,a=longitude*Math.PI/8;
    const p=new Vector3(raw.c.x+raw.r.x*radius*Math.sin(t)*Math.cos(a),raw.c.y+raw.r.y*radius*Math.cos(t),raw.c.z+raw.r.z*radius*Math.sin(t)*Math.sin(a));
    const mapped=p.clone().setY(forward(p.y)),part=field(mapped),expected=envNormal(p,raw);
    expected.y/=(p.y<4?4/3:8/9)*1.2;expected.normalize();
    assert.ok(Math.abs(envRho(mapped,part)-envRho(p,raw))<1e-12);
    assert.ok(envNormal(mapped,part).distanceTo(expected)<1e-12);
  }
  const below=new Vector3(3,forward(4)-1e-8,-1),above=below.clone().setY(forward(4)+1e-8);
  assert.ok(Math.abs(envRho(below,field(below))-envRho(above,field(above)))<1e-8);
  assert.deepEqual(env,original);
});
test('shared cherry defaults preserve legacy geometry and the subsequent random stream', () => {
  for(const [h,digest,next] of [
    [8,'f81bec6d0947d8cd66ea49c12545d1398be8cd588583512acb9e5b21f926e089',.3667557055596262],
    [12,'6401f1a6a6d4123e11beab6308d0c7ec129cae939c2f497a77882a109aaa9bf2',.0967262287158519],
  ]) {
    const random=rng('legacy-cherry-'+h);
    const tree=genCherry(random,{h,base:new Vector3(3,-.012,-7),lean:new Vector3(.2,0,-.1),spread:.88,detail:.25});
    assert.equal(createHash('sha256').update(JSON.stringify(tree)).digest('hex'),digest);
    assert.equal(random.next(),next);
  }
});
function campusTreeFixture(ti, { x=3, z=-7, height=12, radius=4.4, ground=-.012, hero=false, growth={scaffoldWobble:.22,droopScale:.3} }={}) {
  const random=rng(`courtyard-tree-${ti}`),base=new Vector3(x,ground,z),form=ti%3;
  const lean=new Vector3(random.float(-.45,.45),0,random.float(-.45,.45));
  const tree=(form===1?genCherry:genMaple)(random,{h:height,base,lean,spread:radius/height,detail:hero?.25:.16,shellDensity:1.35,leaders:form===2?2:3,scaffolds:4,clump:.38,...growth});
  const junctions=captureTreeJunctions(tree.branches),trunk=tree.branches[0],fork=trunk.pts.at(-1).y-ground,newFork=random.float(3.15,3.55);
  const lift=y=>ground+(y-ground<fork?(y-ground)*newFork/fork:newFork+(y-ground-fork)*(height-newFork)/(height-fork));
  for(const branch of tree.branches)for(const p of branch.pts)p.y=lift(p.y);
  tree.env.c.y=lift(tree.env.c.y);raiseCrown(tree,base,3.55,form===1?height:null);
  return{tree,junctions};
}
test('campus cherry growth removes the arrival hook without stretching its trunk or breaking attachments', () => {
  const record={x:-8,z:38,height:11.270037524169311,radius:4.379046484827995,hero:true};
  const {tree:before}=campusTreeFixture(7,{...record,growth:{}}),{tree:after,junctions}=campusTreeFixture(7,record);
  const hooks=tree=>tree.branches.filter(b=>b.level===1).filter(b=>{
    const initial=b.pts[1].clone().sub(b.pts[0]);
    return b.pts.some((p,i)=>i>0&&p.clone().sub(b.pts[i-1]).dot(initial)<0);
  }).length;
  assert.ok(hooks(before)>=2,'the legacy fixture must reproduce the hooked primary limbs');
  assert.equal(hooks(after),0);
  const fork=tree=>Math.min(...tree.branches.filter(b=>b.level===1).map(b=>b.pts[0].y+.012));
  assert.ok(fork(before)>6&&fork(after)>2.5&&fork(after)<4);
  assert.ok(Math.abs(Math.max(...after.branches.flatMap(b=>b.pts.map(p=>p.y+.012)))-record.height)<1e-9);
  for(const branch of after.branches)for(const p of branch.pts)if(branch.level>0&&Math.hypot(p.x-record.x,p.z-record.z)>.5)assert.ok(p.y+.012>=3.55-1e-9);
  restoreTreeJunctions(after.branches,junctions);
  for(const link of junctions){
    const parent=after.branches[link.parent],p=parent.pts[link.segment].clone().lerp(parent.pts[link.segment+1],link.t);
    assert.ok(p.distanceTo(after.branches[link.child].pts[0])<1e-9);
  }
});
test('campus caliper preserves original bark data and remapped branch roots enter the actual parent mesh', () => {
  const gain=campusBarkDisplacement(()=>1);
  for(const[level,s,expected]of[[0,5,.68],[1,.35,.68],[1,.725,.5712],[1,1.1,.4624],[3,0,.4624]])assert.ok(Math.abs(gain(0,s,1,{level},null)-expected)<1e-12);
  // Actual tree 43 and the three roots that separated when the original height
  // map interpolated a child independently of its parent's crossing segment.
  const {tree,junctions}=campusTreeFixture(43,{x:-53.91748518124223,z:11.92075766902417,height:10.057673955336213,radius:4.175343716144562,growth:{}});
  const before=tree.branches.map(b=>({pts:b.pts.map(p=>p.clone()),rads:b.rads.slice(),pd:b.pd.slice()}));
  const displacement=campusBarkDisplacement(trunkDisp({seed:43,bump:.065,flare:.25,flareH:.3,flute:.023})),radial=r=>r>.14?9:r>.05?6:3;
  function closedOracle(branch) {
    const accumulator=new BarkAccum();accumulator.addBranch(branch,{seed:43,disp:displacement,radial});
    const geo=accumulator.toGeometry(),points=Array.from({length:geo.attributes.position.count},(_,i)=>new Vector3().fromBufferAttribute(geo.attributes.position,i)),indices=Array.from(geo.index.array),S=radial(branch.rads[0]);geo.dispose();
    // The oracle closes only its analytical volume. These disks never enter
    // product geometry; assertions inspect the actual displaced tube walls.
    for(const[offset,p]of[[0,branch.pts[0]],[(branch.pts.length-1)*(S+1),branch.pts.at(-1)]]) {
      const center=points.length;points.push(p.clone());for(let j=0;j<S;j++)indices.push(center,offset+j,offset+j+1);
    }
    return{points,indices,S};
  }
  const ray=new Ray(new Vector3(),new Vector3(.371,.597,.711).normalize()),hit=new Vector3();
  function inside(mesh,p) {
    ray.origin.copy(p);const distances=[];
    for(let i=0;i<mesh.indices.length;i+=3)if(ray.intersectTriangle(mesh.points[mesh.indices[i]],mesh.points[mesh.indices[i+1]],mesh.points[mesh.indices[i+2]],false,hit)) {
      const d=hit.distanceTo(p);if(d<1e-7)return true;if(!distances.some(old=>Math.abs(old-d)<1e-7))distances.push(d);
    }
    return distances.length%2===1;
  }
  function outsideSamples(parentIndex,childIndex) {
    const parent=closedOracle(tree.branches[parentIndex]),child=closedOracle(tree.branches[childIndex]),center=tree.branches[childIndex].pts[0],samples=[center];
    for(let j=0;j<child.S;j++)for(let sub=0;sub<4;sub++)for(const r of[.25,.5,.75,1])samples.push(child.points[j].clone().lerp(child.points[j+1],sub/4).sub(center).multiplyScalar(r).add(center));
    assert.equal(samples.length,49);return samples.filter(p=>!inside(parent,p)).length;
  }
  for(const[parent,child]of[[24,26],[27,48],[53,60]]) {
    assert.equal(junctions.find(j=>j.child===child).parent,parent);
    assert.ok(outsideSamples(parent,child)>40,'fixture must reproduce the original separated root');
  }
  assert.equal(restoreTreeJunctions(tree.branches,junctions),5);
  for(const[parent,child]of[[24,26],[27,48],[53,60]])assert.equal(outsideSamples(parent,child),0,'the complete root disk must lie inside actual parent triangles');
  tree.branches.forEach((branch,bi)=>{
    assert.deepEqual(branch.rads,before[bi].rads);assert.deepEqual(branch.pd,before[bi].pd);
    for(let i=1;i<branch.pts.length;i++)assert.deepEqual(branch.pts[i],before[bi].pts[i],'only the junction root may move');
    assert.ok(Math.abs(branch.pts[0].x-before[bi].pts[0].x)<1e-10&&Math.abs(branch.pts[0].z-before[bi].pts[0].z)<1e-10);
  });
});
test('64 trunk terminal domes connect existing rings with outward nondegenerate faces and a fixed budget', () => {
  let triangles=0;
  for(let ti=0;ti<64;ti++) {
    const {tree,junctions}=campusTreeFixture(ti,{height:10+(ti%9)*.55});restoreTreeJunctions(tree.branches,junctions);
    const trunk=tree.branches[0],accumulator=new BarkAccum(),radial=r=>r>.14?9:r>.05?6:3;
    accumulator.addBranch(trunk,{seed:ti,radial,disp:campusBarkDisplacement(trunkDisp({seed:ti,bump:.065,flare:.25,flareH:.3,flute:.023}))});
    const before=accumulator.toGeometry(),firstTriangle=accumulator.idx.length,ring=accumulator.vc-10;
    closeTrunkTerminal(accumulator,trunk);const after=accumulator.toGeometry(),p=after.attributes.position,n=after.attributes.normal;
    assert.deepEqual(p.array.slice(0,before.attributes.position.array.length),before.attributes.position.array);
    assert.deepEqual(n.array.slice(0,before.attributes.normal.array.length),before.attributes.normal.array);
    assert.equal(after.index.count-firstTriangle,81);triangles+=(after.index.count-firstTriangle)/3;
    const axis=trunk.pts.at(-1).clone().sub(trunk.pts.at(-2)).normalize(),edges=new Map(),a=new Vector3(),b=new Vector3(),c=new Vector3();
    const key=i=>[p.getX(i),p.getY(i),p.getZ(i)].map(v=>Math.round(v*1e6)).join(',');
    for(let i=0;i<after.index.count;i+=3) {
      const ids=[after.index.getX(i),after.index.getX(i+1),after.index.getX(i+2)];
      for(let j=0;j<3;j++) {
        const from=key(ids[j]),to=key(ids[(j+1)%3]),id=[from,to].sort().join('|');
        if(!edges.has(id))edges.set(id,[]);edges.get(id).push(from<to?1:-1);
      }
      if(i<firstTriangle)continue;
      a.fromBufferAttribute(p,ids[0]);b.fromBufferAttribute(p,ids[1]);c.fromBufferAttribute(p,ids[2]);
      const normal=b.sub(a).cross(c.sub(a));assert.ok(normal.length()>1e-6&&normal.normalize().dot(axis)>.8);
    }
    for(let j=0;j<9;j++) {
      const uses=edges.get([key(ring+j),key(ring+j+1)].sort().join('|'));
      assert.equal(uses.length,2);assert.equal(uses[0]+uses[1],0,'old terminal edge must meet the cap with opposite winding');
    }
    for(let i=before.attributes.position.count;i<p.count;i++) {
      a.fromBufferAttribute(p,i).sub(trunk.pts.at(-1));b.fromBufferAttribute(n,i);
      assert.ok(a.dot(axis)>0&&a.dot(axis)<.08);assert.ok(Math.abs(b.length()-1)<1e-6);
    }
    before.dispose();after.dispose();
  }
  assert.equal(triangles,1728);
});
test('exposed primary roots extend into the actual trunk without moving their original surface', () => {
  const records=[
    [19,69.924535067752,-29.72706381767057,11.26407560147345,5.462792259082198],
    [25,45.73863836936653,85.64743802463636,10.584272359497845,4.591956760361791],
    [28,-82.9313553571701,19.79547171201557,12.112724852748215,5.395712192356586],
    [43,-53.91748518124223,11.92075766902417,10.057673955336213,4.175343716144562],
  ];
  let repaired=0,triangles=0;
  for(const [ti,x,z,height,radius] of records) {
    const {tree,junctions}=campusTreeFixture(ti,{x,z,height,radius});restoreTreeJunctions(tree.branches,junctions);
    const acc=new BarkAccum(),options={seed:ti,radial:r=>r>.14?9:r>.05?6:3,disp:campusBarkDisplacement(trunkDisp({seed:ti,bump:.065,flare:.25,flareH:.3,flute:.023}))};
    acc.addBranch(tree.branches[0],options);closeTrunkTerminal(acc,tree.branches[0]);
    const parent=trunkVolume(acc,0,0,tree.branches[0]);
    const ray=new Ray(new Vector3(),new Vector3(.13,1,.07).normalize()),hit=new Vector3();
    for(const link of junctions.filter(j=>j.parent===0&&tree.branches[j.child].level===1)) {
      const branch=tree.branches[link.child],rootStart=acc.vc;acc.addBranch(branch,options);
      const pos=acc.pos.slice(),uv=acc.a.slice(),index=acc.idx.slice();
      const repair=extendPrimaryRoot(acc,branch,rootStart,parent);
      assert.ok(!repair.failed);assert.deepEqual(acc.pos.slice(0,pos.length),pos);
      assert.deepEqual(acc.a.slice(0,uv.length),uv);assert.deepEqual(acc.idx.slice(0,index.length),index);
      if(!repair.changed)continue;
      repaired++;triangles+=repair.triangles;const segments=repair.vertices-1;
      for(let edge=0;edge<segments;edge++) {
        let incidence=0;
        for(let i=0;i<acc.idx.length;i+=3){const tri=acc.idx.slice(i,i+3);if(tri.includes(rootStart+edge)&&tri.includes(rootStart+edge+1))incidence++;}
        assert.equal(incidence,2,'the old open boundary needs a continuous adjacent wall');
        const a=new Vector3().fromArray(new Float32Array(acc.pos.slice((repair.innerStart+edge)*3,(repair.innerStart+edge)*3+3)));
        const b=new Vector3().fromArray(new Float32Array(acc.pos.slice((repair.innerStart+edge+1)*3,(repair.innerStart+edge+1)*3+3)));
        for(let sample=0;sample<8;sample++) {
          ray.origin.copy(a).lerp(b,sample/8);const distances=[];
          for(let i=0;i<parent.index.length;i+=3)if(ray.intersectTriangle(parent.points[parent.index[i]],parent.points[parent.index[i+1]],parent.points[parent.index[i+2]],false,hit)){
            const d=hit.distanceTo(ray.origin);if(!distances.some(x=>Math.abs(x-d)<1e-7))distances.push(d);
          }
          assert.equal(distances.length%2,1,'quantized new boundary must be hidden inside the trunk');
        }
      }
      const beforeFailure=[acc.pos.slice(),acc.nrm.slice(),acc.a.slice(),acc.b.slice(),acc.idx.slice(),acc.vc];
      assert.equal(extendPrimaryRoot(acc,branch,rootStart,{inside:()=>false,axis:parent.axis}).failed,true);
      assert.deepEqual([acc.pos,acc.nrm,acc.a,acc.b,acc.idx,acc.vc],beforeFailure,'failed searches must leave the mesh intact');
    }
  }
  assert.equal(repaired,4);assert.equal(triangles,72);
});
test('campus vegetation uses its cherry growth settings and closes trunks in the existing bark batch', () => {
  const previous=globalThis.document,roots=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='getImageData'?((x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})):String(key).includes('Gradient')?(()=>({addColorStop(){}})):key==='measureText'?(()=>({width:100})):(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>ctx})};
  try {
    const records=[3,15].map(x=>({x,z:-7,height:12,radius:4.4,ground:-.012})),group=buildVegetation(records,[],[]);roots.push(group);
    const reference=new BarkAccum();
    records.forEach((record,ti)=>{
      const {tree,junctions}=campusTreeFixture(ti,record);restoreTreeJunctions(tree.branches,junctions);
      const disp=campusBarkDisplacement(trunkDisp({seed:ti,bump:.065,flare:.25,flareH:.3,flute:.023}));
      tree.branches.forEach((branch,i)=>{
        if(branch.level!==4||i%4===0)reference.addBranch(branch,{seed:ti,disp,radial:r=>r>.14?9:r>.05?6:3});
        if(branch.level===0)closeTrunkTerminal(reference,branch);
      });
    });
    const bark=group.children.filter(m=>m.name.startsWith('mature-trunks:'));
    assert.equal(bark.length,1);assert.equal(bark[0].geometry.index.count/3,reference.triCount);
    assert.deepEqual(bark[0].geometry.attributes.position.array,new Float32Array(reference.pos));
    assert.equal(group.userData.stats.trunkCapTriangles,54);
  } finally {
    globalThis.document=previous;
    for(const group of roots){const geometries=new Set(),materials=new Set(),textures=new Set();group.traverse(m=>{if(m.geometry)geometries.add(m.geometry);if(m.material)materials.add(m.material);});for(const m of materials)for(const value of Object.values(m))if(value?.isTexture)textures.add(value);for(const x of textures)x.dispose();for(const x of geometries)x.dispose();for(const x of materials)x.dispose();}
  }
});
test('near shrub leaves have a cupped surface, stable area and an attached root', () => {
  const g=curvedShrubLeafGeometry(),p=g.attributes.position,n=g.attributes.normal;
  assert.equal(g.index.count/3,12);assert.equal(p.count,11);
  const a=new Vector3(),b=new Vector3(),c=new Vector3();let area=0;
  assert.deepEqual(a.fromBufferAttribute(p,0).toArray(),[0,0,0]);
  assert.ok(a.fromBufferAttribute(p,10).distanceTo(new Vector3(0,1,.075))<1e-7);
  for(let i=0;i<p.count;i++) {
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(n,i);
    assert.ok(a.toArray().every(Number.isFinite)&&Math.abs(a.x)<=.5&&a.y>=0&&a.y<=1);
    assert.ok(Math.abs(b.length()-1)<1e-6&&b.z>0);
  }
  for(let i=0;i<g.index.count;i+=3) {
    a.fromBufferAttribute(p,g.index.getX(i));b.fromBufferAttribute(p,g.index.getX(i+1));c.fromBufferAttribute(p,g.index.getX(i+2));
    const normal=b.sub(a).cross(c.sub(a));assert.ok(normal.z>0);area+=normal.z/2;
  }
  assert.ok(Math.abs(area/.604-1)<.02,'extra geometry must not change the leaf coverage');
  for(const row of [1,4,7])assert.ok((p.getZ(row)+p.getZ(row+2))/2-p.getZ(row+1)>.015,'leaf must have a real curved cross-section');
  g.dispose();
});
test('garden shrubs have connected branches and attached leaves within their planting footprint', () => {
  // Geometry-only canvas stub; the browser check validates the real material path.
  const previousDocument = globalThis.document;
  const context = new Proxy({}, { get: (_, key) => key === 'getImageData'
    ? (x,y,w,h) => ({ data: new Uint8ClampedArray(w*h*4) }) : () => {} });
  globalThis.document = { createElement: () => ({ getContext: () => context }) };
  try {
    const plant = { x:47.9, z:-48.1, height:.85, radius:.75, ground:-.005, kind:'shrub', detail:true };
    const group = buildVegetation([],[],[plant]), stems = [], leaves = [], matrix = new Matrix4();
    const flat=buildVegetation([],[],[{...plant,detail:false}]);
    assert.equal(group.userData.stats.detailedShrubs,1);
    assert.equal(group.userData.stats.extraShrubTriangles,group.userData.stats.shrubLeaves*8);
    for(const mesh of group.children.filter(m=>m.name.startsWith('shrub-foliage-detailed:'))) {
      const old=flat.getObjectByName(mesh.name.replace('shrub-foliage-detailed:','shrub-foliage:'));
      assert.deepEqual(mesh.instanceMatrix.array,old.instanceMatrix.array);assert.deepEqual(mesh.instanceColor.array,old.instanceColor.array);
      for(const name of ['canopyNormal','canopyAO'])assert.deepEqual(mesh.geometry.attributes[name].array,old.geometry.attributes[name].array);
    }
    for (const mesh of group.children) {
      assert.ok(!mesh.name.startsWith('shrub-interiors'), 'garden shrub contains an opaque proxy');
      if (!mesh.name.startsWith('shrub-branches') && !mesh.name.startsWith('shrub-foliage')) continue;
      for (let i=0; i<mesh.count; i++) {
        mesh.getMatrixAt(i,matrix); assert.ok(matrix.elements.every(Number.isFinite));
        if (mesh.name.startsWith('shrub-branches')) stems.push(new Line3(
          new Vector3(0,-.5,0).applyMatrix4(matrix), new Vector3(0,.5,0).applyMatrix4(matrix)));
        else leaves.push({ matrix: matrix.clone(), geometry: mesh.geometry });
      }
    }
    assert.ok(stems.length > 40 && leaves.length > 250);
    const nearest = new Vector3(), root = new Vector3(plant.x,plant.ground-.003,plant.z);
    const touches = (point, excluded) => stems.some(stem => stem !== excluded &&
      stem.closestPointToPoint(point,true,nearest).distanceTo(point) < 1e-5);
    for (const stem of stems) assert.ok(stem.start.distanceTo(root) < 1e-5 || touches(stem.start,stem), 'detached branch');
    for (const leaf of leaves) {
      assert.ok(touches(new Vector3().setFromMatrixPosition(leaf.matrix)), 'leaf floats away from twig');
      const position = leaf.geometry.attributes.position;
      for (let i=0; i<position.count; i++) {
        const p = new Vector3().fromBufferAttribute(position,i).applyMatrix4(leaf.matrix);
        assert.ok(p.y > plant.ground && Math.hypot(p.x-plant.x,p.z-plant.z) < plant.radius*1.06, 'leaf exits planting envelope');
      }
    }
    group.traverse(o => { if(o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    flat.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
  } finally {
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
});
test('district trees reuse foliage without changing existing planting or campus shadow casters', () => {
  const previousDocument=globalThis.document;
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'?(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  const roots=[];
  try {
    const woodland=[{x:-175,z:-150,height:14,ground:3,near:false}];
    const tree={district:'research',x:-370,z:-500,height:13,ground:4,crownRadius:7.6,near:true};
    const grasses=[{x:3,z:4,height:.6,radius:.4,kind:'grass'},{x:8,z:14,height:.08,radius:.2,kind:'shortGrass'}];
    const before=buildVegetation([],woodland,grasses),after=buildVegetation([],woodland,grasses,[tree]);roots.push(before,after);
    for(const mesh of before.children) {
      const same=after.getObjectByName(mesh.name);assert.ok(same);
      assert.deepEqual(same.instanceMatrix?.array,mesh.instanceMatrix?.array);
      assert.deepEqual(same.instanceColor?.array,mesh.instanceColor?.array);
      assert.deepEqual(same.geometry.attributes.position.array,mesh.geometry.attributes.position.array);
    }
    const district=after.children.filter(o=>o.name.startsWith('district-'));
    assert.equal(district.length,2);assert.equal(after.userData.stats.districtTrees,1);
    for(const mesh of district) {
      assert.equal(mesh.castShadow,false);assert.equal(mesh.receiveShadow,false);
      mesh.computeBoundingBox();const box=mesh.boundingBox;
      assert.ok(box.min.y>=tree.ground-.001);
      assert.ok(box.min.x>tree.x-tree.crownRadius&&box.max.x<tree.x+tree.crownRadius);
      assert.ok(box.min.z>tree.z-tree.crownRadius&&box.max.z<tree.z+tree.crownRadius);
    }
  } finally {
    for(const root of roots)root.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});
test('pedestrian tour and local irradiance probes clear the actual architecture', () => {
  const architecture = buildBuildings(); architecture.updateMatrixWorld(true);
  const bounds = [], instance = new Matrix4(), world = new Matrix4();
  architecture.traverse(o => {
    if (!o.isMesh) return;
    o.geometry.computeBoundingBox();
    if (o.isInstancedMesh) {
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, instance); world.multiplyMatrices(o.matrixWorld, instance);
        bounds.push(new Box3().copy(o.geometry.boundingBox).applyMatrix4(world));
      }
    } else if (o.userData.componentBounds) {
      for (const box of o.userData.componentBounds) bounds.push(box.clone().applyMatrix4(o.matrixWorld));
    } else bounds.push(new Box3().copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld));
  });
  for (let t = 0; t < DURATION; t += 0.2) {
    const p = sampleTour(t).position;
    for (const box of bounds) {
      if (p.y < box.min.y - 0.25 || p.y > box.max.y + 0.25) continue;
      assert.ok(box.distanceToPoint(p) >= 0.25, `camera touches architecture at ${t.toFixed(1)} seconds`);
    }
  }
  const plans=arcadeProbePlans(),point=new Vector3();
  assert.deepEqual(plans.map(p=>p.id),['a','c']);
  for(const {grid,count,min,max} of plans) {
    assert.equal(count,216);
    const paving=architecture.userData.arcadePaving;
    assert.ok(min.y<=paving.bedTop-.001,'local light must also cover recessed mortar and stone bevels');
    assert.ok(max.y>=3.44-1e-6,'local light must reach both the wood soffit and concrete beam underside');
    for(let y=0;y<grid.resolution.y;y++)for(let z=0;z<grid.resolution.z;z++)for(let x=0;x<grid.resolution.x;x++) {
      grid.getProbePosition(x,y,z,point);
      for(const box of bounds) assert.ok(box.distanceToPoint(point)>=.1,`light probe too close to architecture: ${point.toArray()}`);
    }
    grid.dispose();
  }
});
test('parked vehicles stay inside the parking bays and bicycle paving', () => {
  const root = buildCampusProps();
  assert.equal(root.userData.stats.cars, 10);
  assert.equal(root.userData.stats.bicycles, 5);
  assert.ok(root.userData.stats.triangles < 80000 && root.children.length <= 7);
  root.traverse(o => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      assert.ok([x,y,z].every(Number.isFinite));
      assert.ok(y >= 0 && y < 1.6);
      assert.ok(Math.abs(x) > 110
        ? Math.abs(x) <= 118 && z >= -56 && z <= 56
        : x >= -32 && x <= -26 && z >= 53 && z <= 56);
    }
  });
});

test('terrace shrubs meet recessed soil, keep connected leaves, and clear roof equipment', () => {
  const root=buildBuildings();root.updateMatrixWorld(true);
  const planting=root.getObjectByName('Terrace planting'),leaves=root.getObjectByName('Terrace shrub leaves'),stems=root.getObjectByName('Terrace shrub stems');
  const soil=root.getObjectByName('Roof planter soil'),matrix=new Matrix4(),point=new Vector3(),ray=new Raycaster();
  const architecture=[],obstacles=[],soilBoxes=[],checkedSoil=new Set();
  root.traverse(mesh=>{
    if(!mesh.isMesh||mesh===leaves||mesh===stems)return;
    architecture.push(mesh);
    if(!mesh.isInstancedMesh||mesh.geometry.type!=='BoxGeometry'||mesh===soil)return;
    mesh.geometry.computeBoundingBox();
    for(let i=0;i<mesh.count;i++) {
      mesh.getMatrixAt(i,matrix);const world=mesh.matrixWorld.clone().multiply(matrix);
      obstacles.push({name:mesh.name,inverse:world.clone().invert(),local:mesh.geometry.boundingBox.clone().expandByScalar(-1e-5),bounds:mesh.geometry.boundingBox.clone().applyMatrix4(world)});
    }
  });
  soil.geometry.computeBoundingBox();
  for(let i=0;i<soil.count;i++){soil.getMatrixAt(i,matrix);soilBoxes.push(soil.geometry.boundingBox.clone().applyMatrix4(matrix));}
  assert.equal(planting.userData.plants,483);assert.equal(planting.children.length,2);
  assert.ok(leaves.count>60000&&leaves.count<75000&&stems.count<15000);
  const lines=[];
  for(let i=0;i<stems.count;i++) {
    stems.getMatrixAt(i,matrix);
    lines.push(new Line3(new Vector3(0,-.5,0).applyMatrix4(matrix),new Vector3(0,.5,0).applyMatrix4(matrix)));
  }
  for(const record of planting.userData.records) {
    const start=lines[record.firstStem].start,ground=start.y+.003;
    ray.set(new Vector3(start.x,ground+.10,start.z),new Vector3(0,-1,0));ray.far=.12;
    const hit=ray.intersectObjects(architecture,false)[0];
    assert.equal(hit?.object,soil,'root must meet exposed soil, not a solid planter lid');
    assert.ok(Math.abs(hit.point.y-ground)<1e-5);
    const box=soilBoxes[hit.instanceId];
    if(!checkedSoil.has(hit.instanceId)) {
      checkedSoil.add(hit.instanceId);
      const centre=box.getCenter(new Vector3());
      ray.set(new Vector3(centre.x,box.max.y+.10,centre.z),new Vector3(0,-1,0));ray.far=.6;
      const bottom=ray.intersectObjects(architecture.filter(mesh=>mesh!==soil),false)[0];
      assert.equal(bottom?.object.material.name,'Architectural concrete');
      assert.ok(Math.abs(box.max.y-bottom.point.y-.37)<2e-5,'other roof geometry must not fill the planter soil volume');
      for(const [x,z]of [[box.min.x-.045,(box.min.z+box.max.z)/2],[box.max.x+.045,(box.min.z+box.max.z)/2],[(box.min.x+box.max.x)/2,box.min.z-.045],[(box.min.x+box.max.x)/2,box.max.z+.045]]) {
        ray.set(new Vector3(x,box.max.y+.08,z),new Vector3(0,-1,0));ray.far=.1;
        const rim=ray.intersectObjects(architecture,false)[0];
        assert.equal(rim?.object.material.name,'Architectural concrete');
        assert.ok(Math.abs(rim.point.y-box.max.y-.03)<2e-5,'soil must lie 3cm below all four walls');
      }
    }
    const crown=new Box3(),vertices=[];
    for(let i=record.firstStem;i<record.firstStem+record.stemCount;i++) {
      if((i-record.firstStem)%3===0)assert.ok(lines[i].start.distanceTo(start)<1e-5);
      else assert.ok(lines[i-1].end.distanceTo(lines[i].start)<1e-5,'branch segments disconnected');
    }
    for(let i=record.firstLeaf;i<record.firstLeaf+record.leafCount;i++) {
      leaves.getMatrixAt(i,matrix);point.setFromMatrixPosition(matrix);
      let distance=Infinity;
      for(let j=record.firstStem;j<record.firstStem+record.stemCount;j++)
        distance=Math.min(distance,lines[j].closestPointToPoint(point,true,new Vector3()).distanceTo(point));
      assert.ok(distance<1e-5,'leaf base misses the real branch centreline');
      const normal=new Vector3().fromBufferAttribute(leaves.geometry.attributes.canopyNormal,i);
      assert.ok(Math.abs(normal.length()-1)<1e-5);
    }
    for(const [mesh,first,count]of [[leaves,record.firstLeaf,record.leafCount],[stems,record.firstStem,record.stemCount]]) {
      const positions=mesh.geometry.attributes.position,index=mesh.geometry.index;
      for(let i=first;i<first+count;i++) {
        mesh.getMatrixAt(i,matrix);const actual=[];
        for(let j=0;j<positions.count;j++) {
          const vertex=new Vector3().fromBufferAttribute(positions,j).applyMatrix4(matrix);
          assert.ok(vertex.toArray().every(Number.isFinite));crown.expandByPoint(vertex);actual.push(vertex);
        }
        for(let j=0;j<index.count;j+=3)vertices.push([actual[index.getX(j)],actual[index.getX(j+1)],actual[index.getX(j+2)]]);
      }
    }
    for(const obstacle of obstacles) {
      if(!crown.intersectsBox(obstacle.bounds))continue;
      for(const points of vertices) {
        const triangle=new Triangle(...points.map(p=>p.clone().applyMatrix4(obstacle.inverse)));
        assert.equal(obstacle.local.intersectsTriangle(triangle),false,`terrace planting enters ${obstacle.name}`);
      }
    }
  }
  const materials=new Set();root.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();materials.add(mesh.material);}});
  for(const material of materials)material.dispose();
});

// Fixed first ten courtyard records: 4/5 share batches with new northern trees,
// 6 shares its southern batch with new tree7, and 9 is the first later control.
const groveTreeFixture = [
  [-7,-32,12.713467528112233,5.046246068854816],
  [6,-33,13.75988906470593,5.105198998772539],
  [-8,-19,13.181903739925474,5.139082405064254],
  [4,-21,13.367562364903279,4.815007517742924],
  [-5,-8,14.456927918246947,5.239303318830207],
  [7,-10,13.570947258733213,5.179888703697361],
  [-9,19,11.568132290965877,4.516456046234817],
  [-8,38,11.270037524169311,4.379046484827995],
  [9,41,10.841772515326738,4.470129114156589],
  [-53,-54,11.135636026971042,4.8747786285355685],
].map(([x,z,height,radius])=>({x,z,height,radius,ground:-.012,clearance:3,hero:true}));

test('mature whole-tree cohorts have real parent tubes and attached physical leaves', () => {
  // Keep the original ti6 path and run the same real-mesh connection/cap checks
  // on each newly calibrated parameter set; no full landscape build is needed.
  for(const ti of [6,0,1,2,3,7,8]) {
  const tree=ti===6?{x:-9,z:19,ground:-.012,height:12,radius:5,hero:true}:{...groveTreeFixture[ti]};
  const space=ti===6?null:{seed:`campus-whole-tree:${tree.x}:${tree.z}`,height:tree.height,radius:tree.radius,clearance:tree.clearance};
  const plan=buildCampusBroadleaf(tree,()=>({c:new Vector3(-9,7,19),r:new Vector3(5,5,5)}),space);
  const surfaces=plan.branches.map(branch=>{
    const acc=new BarkAccum();acc.addBranch(branch,{seed:ti,radial:()=>branch.radial});
    return {position:new Float32Array(acc.pos),index:acc.idx};
  });
  {
    const trunk=plan.branches[0],acc=new BarkAccum();acc.addBranch(trunk,{seed:ti,radial:()=>trunk.radial});
    const before=new Float32Array(acc.pos),firstCap=acc.idx.length,ring=(trunk.pts.length-1)*(trunk.radial+1);
    closeTrunkTerminal(acc,trunk);const positions=new Float32Array(acc.pos);
    assert.deepEqual(positions.slice(0,before.length),before,'the cap must retain the original terminal ring');
    for(let edge=0;edge<trunk.radial;edge++) {
      const a=ring+edge,b=a+1,uses=[];
      for(let i=0;i<acc.idx.length;i+=3)for(let j=0;j<3;j++) {
        const from=acc.idx[i+j],to=acc.idx[i+(j+1)%3];
        if(from===a&&to===b)uses.push(1);if(from===b&&to===a)uses.push(-1);
      }
      assert.equal(uses.length,2,`original trunk terminal edge${edge} must meet exactly one cap face`);
      assert.equal(uses[0]+uses[1],0,'cap and tube must traverse their shared edge in opposite directions');
    }
    const axis=trunk.pts.at(-1).clone().sub(trunk.pts.at(-2)).normalize();
    for(let i=firstCap;i<acc.idx.length;i+=3) {
      const points=[0,1,2].map(j=>new Vector3().fromArray(positions,acc.idx[i+j]*3));
      const triangle=new Triangle(...points);
      assert.ok(triangle.getArea()>1e-14,'the actual cap must not contain degenerate triangles');
      assert.ok(triangle.getNormal(new Vector3()).dot(axis)>0,'actual cap faces must wind toward the terminal axis');
    }
  }
  const volumes=new Map(),ray=new Ray(new Vector3(),new Vector3(.713,.317,.619).normalize()),hit=new Vector3();
  function inside(index,point) {
    if(!volumes.has(index)) {
      const branch=plan.branches[index],surface=surfaces[index],S=branch.radial;
      const points=Array.from({length:surface.position.length/3},(_,i)=>new Vector3().fromArray(surface.position,i*3)),indices=[...surface.index];
      // Query-only caps close the test volume. They are never added to rendered bark.
      for(const start of [0,(branch.pts.length-1)*(S+1)]) {
        const center=new Vector3();for(let i=0;i<S;i++)center.add(points[start+i]);center.divideScalar(S);
        const last=points.length;points.push(center);for(let i=0;i<S;i++)indices.push(last,start+i,start+(i+1)%S);
      }
      volumes.set(index,{points,indices});
    }
    const {points,indices}=volumes.get(index),distances=[];ray.origin.copy(point);
    for(let i=0;i<indices.length;i+=3)if(ray.intersectTriangle(points[indices[i]],points[indices[i+1]],points[indices[i+2]],false,hit)) {
      const distance=hit.distanceTo(point);if(distance<1e-8)return true;
      if(!distances.some(d=>Math.abs(d-distance)<1e-8))distances.push(distance);
    }
    return distances.length%2===1;
  }
  const a=new Vector3(),b=new Vector3(),c=new Vector3();let woodTriangles=0;
  for(let i=0;i<plan.branches.length;i++) {
    const branch=plan.branches[i],surface=surfaces[i];woodTriangles+=surface.index.length/3;
    assert.ok(surface.position.every(Number.isFinite));
    for(let j=0;j<surface.position.length;j+=3)if(branch.parent!==null)assert.ok(surface.position[j+1]-tree.ground>=3);
    for(let j=0;j<surface.index.length;j+=3) {
      a.fromArray(surface.position,surface.index[j]*3);b.fromArray(surface.position,surface.index[j+1]*3);c.fromArray(surface.position,surface.index[j+2]*3);
      assert.ok(new Triangle(a,b,c).getArea()>1e-14,'actual wood triangles must not collapse');
    }
    if(branch.parent===null)continue;
    assert.ok(branch.parent>=0&&branch.parent<i);
    for(let j=0;j<branch.radial;j++)assert.ok(inside(branch.parent,a.fromArray(surface.position,j*3)),`exposed actual root ring:${i}/${j}`);
  }
  assert.equal(plan.bindings.length,plan.leaves.length);assert.equal(plan.cards.length,0);
  for(let i=0;i<plan.leaves.length;i++) {
    const binding=plan.bindings[i],petiole=plan.branches[binding.petiole],position=surfaces[binding.petiole].position;
    assert.equal(petiole.parent,binding.parent);assert.equal(petiole.petiole,true);assert.equal(plan.branches[binding.parent].leafy,true);
    const start=(petiole.pts.length-1)*(petiole.radial+1);a.set(0,0,0);
    for(let j=0;j<petiole.radial;j++)a.add(b.fromArray(position,(start+j)*3));a.divideScalar(petiole.radial);
    c.setFromMatrixPosition(new Matrix4().fromArray(Float32Array.from(plan.leaves[i].matrix.elements)));
    assert.ok(c.distanceTo(a)<1e-5,'F32 leaf root must meet its actual petiole terminal ring');
  }
  const cohorts=plan.branches.filter(branch=>branch.level===3&&!branch.leafy&&!branch.petiole);
  assert.ok(cohorts.length>0,'maturity needs additional real woody axes, not only a leaf-count multiplier');
  const parents=new Set(cohorts.map(branch=>branch.parent));
  assert.ok(plan.branches.some((branch,i)=>branch.level===2&&!parents.has(i)),'young/weak middle axes must remain distinct from mature families');
  for(const branch of cohorts) {
    const parent=plan.branches[branch.parent],index=plan.branches.indexOf(branch);
    assert.equal(parent.level,2);assert.ok(parent.age>=.5&&parent.vigour>=.86);
    assert.ok(branch.pd.at(-1)-branch.pd[0]>.25);
    assert.ok(plan.branches.some(child=>child.parent===index&&child.leafy),'each surviving cohort must support real leafy shoots');
  }
  // Inclusive engineering guards, not leaf-area quotas or visual-realism assertions.
  // The original ti6 budget stays intact; the largest new measured tree is ~238k.
  assert.ok(woodTriangles+plan.leaves.length*6<(space?250000:230000));
  if(space) {
    const envelope=plan.crownEnvelope;
    assert.equal(plan.stats.crownEnvelope,envelope);
    assert.ok(envelope.center.every(Number.isFinite)&&envelope.radii.every(v=>Number.isFinite(v)&&v>0));
    const bounds=new Box3(),matrix=new Matrix4(),vertex=new Vector3();
    const blade=[0,0,0,-.34,.18,-.02,-.5,.45,.015,-.31,.78,.10,0,1,.16,.31,.78,.13,.5,.45,.06,.34,.18,0];
    for(const leaf of plan.leaves) {
      matrix.fromArray(Float32Array.from(leaf.matrix.elements));
      const width=vertex.setFromMatrixColumn(matrix,0).length(),length=vertex.setFromMatrixColumn(matrix,1).length();
      assert.ok(width>=.075-1e-7&&width<=.125+1e-7&&length>=.135-1e-7&&length<=.225+1e-7);
      assert.ok(Math.abs(leaf.normal.length()-1)<1e-6&&leaf.ao>=.4&&leaf.ao<=1);
      for(let j=0;j<blade.length;j+=3)bounds.expandByPoint(vertex.fromArray(blade,j).applyMatrix4(matrix));
    }
    assert.ok(bounds.min.y-tree.ground>=tree.clearance);
    assert.ok(bounds.max.y-tree.ground>tree.height-.6&&bounds.max.y-tree.ground<tree.height+.25);
    const span=bounds.getSize(new Vector3());
    assert.ok(span.x>tree.radius*1.5&&span.x<tree.radius*2.6&&span.z>tree.radius*1.5&&span.z<tree.radius*2.6);
    if(ti===8)assert.deepEqual(buildCampusBroadleaf(tree,()=>{throw new Error('new trees must use their own envelope');},space),plan,'site seed must reproduce the complete graph and leaf records');
    // This checks an AABB, not a claim that its inscribed GI ellipsoid contains every leaf.
    for(let axis=0;axis<3;axis++) {
      assert.ok(bounds.min.getComponent(axis)>=envelope.center[axis]-envelope.radii[axis]);
      assert.ok(bounds.max.getComponent(axis)<=envelope.center[axis]+envelope.radii[axis]);
    }
  }
  }
});

test('ti6 whole-tree integration preserves other tree buffers and mature pedestrian scale', async () => {
  const sourceURL=new URL('../src/campus/vegetation.js',import.meta.url),source=readFileSync(sourceURL,'utf8');
  const gate='const wholeTree=grownTree||(ti===6&&x===-9&&z===19&&tree.hero);';assert.equal(source.split(gate).length,2);
  const text=source.replace(gate,'const wholeTree=false;').replace(/from '([^']+)'/g,(_,p)=>`from '${p.startsWith('.')?new URL(p,sourceURL):import.meta.resolve(p)}'`);
  const control=(await import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'))).buildVegetation;
  const records=Array.from({length:8},(_,i)=>({x:80+i*5,z:-80,height:11,radius:4,ground:-.012}));
  records[6]={x:-9,z:19,height:12,radius:5,ground:-.012,hero:true};
  const previous=globalThis.document,roots=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='getImageData'?((x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})):String(key).includes('Gradient')?(()=>({addColorStop(){}})):key==='measureText'?(()=>({width:100})):(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>ctx})};
  try {
    const before=control(records,[],[]),after=buildVegetation(records,[],[]);roots.push(before,after);
    const unchanged=group=>group.children.filter(mesh=>!mesh.name.endsWith(':-1,0'));
    const oldMeshes=unchanged(before),newMeshes=unchanged(after);assert.ok(oldMeshes.length>0);
    assert.deepEqual(newMeshes.map(mesh=>mesh.name),oldMeshes.map(mesh=>mesh.name));
    for(let i=0;i<oldMeshes.length;i++) {
      const a=oldMeshes[i],b=newMeshes[i];assert.deepEqual(b.geometry.index?.array,a.geometry.index?.array);
      assert.deepEqual(Object.keys(b.geometry.attributes),Object.keys(a.geometry.attributes));
      for(const name of Object.keys(a.geometry.attributes))assert.deepEqual(b.geometry.attributes[name].array,a.geometry.attributes[name].array);
      assert.deepEqual(b.instanceMatrix?.array,a.instanceMatrix?.array);assert.deepEqual(b.instanceColor?.array,a.instanceColor?.array);
    }
    assert.equal(after.getObjectByName('canopy-interior:-1,0'),undefined,'the target must not retain its old alpha-card crown');
    const plan=buildCampusBroadleaf(records[6],()=>({c:new Vector3(-9,7,19),r:new Vector3(5,5,5)})),wood=new BarkAccum();
    for(const branch of plan.branches) {
      wood.addBranch(branch,{seed:6,radial:()=>branch.radial});
      if(branch.parent===null)closeTrunkTerminal(wood,branch);
    }
    const bark=after.getObjectByName('mature-trunks:-1,0').geometry;
    assert.deepEqual(bark.attributes.position.array,new Float32Array(wood.pos),'integration must emit the physical new wood without the legacy caliper scale');
    assert.deepEqual(Array.from(bark.index.array),wood.idx);
    const leaves=after.getObjectByName('individual-foliage:-1,0'),oldLeaves=before.getObjectByName('individual-foliage:-1,0');
    assert.ok(leaves.count>oldLeaves.count,'the selected target must actually use the new mature graph');
    const bounds=new Box3(),matrix=new Matrix4(),p=new Vector3(),position=leaves.geometry.attributes.position;
    for(let i=0;i<leaves.count;i++) {
      leaves.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));
      const width=p.setFromMatrixColumn(matrix,0).length(),length=p.setFromMatrixColumn(matrix,1).length();
      assert.ok(width>=.075-1e-7&&width<=.125+1e-7&&length>=.135-1e-7&&length<=.225+1e-7,'physical leaf size must not compensate for crown coverage');
      for(let j=0;j<position.count;j++)bounds.expandByPoint(p.fromBufferAttribute(position,j).applyMatrix4(matrix));
    }
    const span=bounds.getSize(new Vector3());
    assert.ok(bounds.min.y-records[6].ground>=3);
    assert.ok(bounds.max.y-records[6].ground>=11.5&&bounds.max.y-records[6].ground<=12.2);
    assert.ok(span.x>=9&&span.x<=11.5&&span.z>=9&&span.z<=11.5,'actual full leaf geometry must retain a mature crown width');
  } finally {
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
    const resources=new Set();for(const root of roots)root.traverse(mesh=>{
      if(mesh.geometry)resources.add(mesh.geometry);
      for(const material of [mesh.material,mesh.customDepthMaterial])if(material){resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);}
    });for(const resource of resources)resource.dispose();
  }
});


test('calibrated grove growth preserves actual non-target data inside shared batches', async () => {
  const sourceURL=new URL('../src/campus/vegetation.js',import.meta.url),source=readFileSync(sourceURL,'utf8');
  async function instrument(disableNew) {
    let code=source;
    const replace=(from,to)=>{assert.equal(code.split(from).length,2);code=code.replace(from,to);};
    if(disableNew)replace("const grownTree=tree.hero&&wholeGrowthSites.has(x+','+z);",'const grownTree=false;');
    // Record only queue/range ownership. Assertions below read the final uploaded
    // mesh attributes, including cap/sleeve changes and computed bark UVs.
    replace('  for(let ti=0;ti<trees.length;ti++) {','  const testRanges=[];\n  for(let ti=0;ti<trees.length;ti++) {');
    replace('    function emitTreeBark() {','    const testWoodStart={v:accumulator.vc,i:accumulator.idx.length};\n    function emitTreeBark() {');
    replace('  }\n  group.userData.wholeTrees=wholeTreeStats;',`    testRanges.push({cell,v0:testWoodStart.v,v1:accumulator.vc,i0:testWoodStart.i,i1:accumulator.idx.length,leaf0:wholeStart.leaves,leaf1:leaves.length,card0:wholeStart.cards,card1:fill.length,rng:treeRng.next()});
  }
  function testSlots(records) {
    const cells=new Map();return records.map(record=>{const p=record.matrix.elements,cell=Math.floor(p[12]/48)+','+Math.floor(p[14]/48),index=cells.get(cell)||0;cells.set(cell,index+1);return {cell,index};});
  }
  group.userData.testRanges=testRanges;group.userData.testLeafSlots=testSlots(leaves);group.userData.testCardSlots=testSlots(fill);
  group.userData.wholeTrees=wholeTreeStats;`);
    replace('  return group;','  group.userData.testFinalRandom=random.next();\n  return group;');
    code=code.replace(/from '([^']+)'/g,(_,path)=>`from '${path.startsWith('.')?new URL(path,sourceURL):import.meta.resolve(path)}'`);
    return (await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'))).buildVegetation;
  }
  const control=await instrument(true),candidate=await instrument(false),previous=globalThis.document,roots=[];
  const ctx=new Proxy({}, {get:(_,key)=>key==='getImageData'?((x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})):String(key).includes('Gradient')?(()=>({addColorStop(){}})):key==='measureText'?(()=>({width:100})):(()=>{})});
  globalThis.document={createElement:()=>({getContext:()=>ctx})};
  try {
    const oldRecords=structuredClone(groveTreeFixture),newRecords=structuredClone(groveTreeFixture);
    const before=control(oldRecords,[],[]),after=candidate(newRecords,[],[]);roots.push(before,after);
    assert.deepEqual(after.userData.wholeTrees.map(tree=>tree.tree),[0,1,2,3,6,7,8]);
    assert.deepEqual(after.userData.stats.treeForms,{broadleaf:8,vase:1,upright:1});
    assert.equal(after.userData.testFinalRandom,before.userData.testFinalRandom);
    for(let ti=0;ti<10;ti++)assert.equal(after.userData.testRanges[ti].rng,before.userData.testRanges[ti].rng,`original private RNG changed: ${ti}`);
    for(const ti of [0,1,2,3,7,8]) {
      const range=after.userData.testRanges[ti],plan=after.userData.wholeTrees.find(tree=>tree.tree===ti);
      assert.equal(range.card1-range.card0,0,'whole growth must not append the old card crown');
      assert.equal(range.leaf1-range.leaf0,plan.leaves);
      assert.deepEqual(newRecords[ti].crownEnvelope,plan.crownEnvelope);
      const {crownEnvelope,...site}=newRecords[ti];assert.deepEqual(site,oldRecords[ti]);
    }
    const compareInstances=(ti,prefix,slotsKey,startKey,endKey)=>{
      const a=before.userData.testRanges[ti],b=after.userData.testRanges[ti];
      assert.equal(a[endKey]-a[startKey],b[endKey]-b[startKey]);
      for(let n=0;n<a[endKey]-a[startKey];n++) {
        const sa=before.userData[slotsKey][a[startKey]+n],sb=after.userData[slotsKey][b[startKey]+n];
        const ma=before.getObjectByName(prefix+':'+sa.cell),mb=after.getObjectByName(prefix+':'+sb.cell);
        assert.ok(ma&&mb);assert.equal(sa.cell,sb.cell);
        for(const [aa,bb,size]of [[ma.instanceMatrix.array,mb.instanceMatrix.array,16],[ma.instanceColor.array,mb.instanceColor.array,3],
          [ma.geometry.attributes.canopyNormal.array,mb.geometry.attributes.canopyNormal.array,3],[ma.geometry.attributes.canopyAO.array,mb.geometry.attributes.canopyAO.array,1]])
          assert.deepEqual(bb.slice(sb.index*size,(sb.index+1)*size),aa.slice(sa.index*size,(sa.index+1)*size),`actual ${prefix} record changed: tree ${ti}, instance ${n}`);
      }
    };
    for(const ti of [4,5,6,9]) {
      assert.deepEqual(newRecords[ti],oldRecords[ti]);
      const a=before.userData.testRanges[ti],b=after.userData.testRanges[ti];assert.equal(a.cell,b.cell);
      if(ti!==9)assert.ok(after.userData.testRanges.some((r,index)=>index!==ti&&[0,1,2,3,7,8].includes(index)&&r.cell===b.cell),'fixture must exercise a genuinely shared bark batch');
      const ga=before.getObjectByName('mature-trunks:'+a.cell).geometry,gb=after.getObjectByName('mature-trunks:'+b.cell).geometry;
      assert.deepEqual(Object.keys(gb.attributes),Object.keys(ga.attributes));
      for(const name of Object.keys(ga.attributes)) {
        const aa=ga.attributes[name],bb=gb.attributes[name];assert.equal(aa.itemSize,bb.itemSize);
        assert.deepEqual(bb.array.slice(b.v0*bb.itemSize,b.v1*bb.itemSize),aa.array.slice(a.v0*aa.itemSize,a.v1*aa.itemSize),`actual bark ${name} changed: tree ${ti}`);
      }
      assert.deepEqual(Array.from(gb.index.array.slice(b.i0,b.i1),index=>index-b.v0),Array.from(ga.index.array.slice(a.i0,a.i1),index=>index-a.v0));
      compareInstances(ti,'individual-foliage','testLeafSlots','leaf0','leaf1');
      compareInstances(ti,'canopy-interior','testCardSlots','card0','card1');
    }
    assert.deepEqual(after.userData.wholeTrees.find(tree=>tree.tree===6),before.userData.wholeTrees[0]);
  } finally {
    if(previous===undefined)delete globalThis.document;else globalThis.document=previous;
    const resources=new Set();for(const root of roots)root.traverse(mesh=>{
      if(mesh.isInstancedMesh)resources.add(mesh);if(mesh.geometry)resources.add(mesh.geometry);
      for(const material of [mesh.material,mesh.customDepthMaterial])if(material){resources.add(material);for(const value of Object.values(material))if(value?.isTexture)resources.add(value);}
    });for(const resource of resources)resource.dispose();
  }
});

test('GI proxy uses world crown envelopes without moving legacy instances or adding atlases', async t => {
  const trees=[
    {x:120,z:-70,ground:5,height:12,radius:4,crownEnvelope:{center:[13,8,-29],radii:[2.25,3.5,4.75]}},
    {x:-8,z:17,ground:2,height:10,radius:4},
  ];
  const shrubs=[{shapeSeed:'south',leafBounds:{min:[9,.3,23],max:[11,1.7,25]}}];
  const before=structuredClone({trees,shrubs}),scene=new Scene(),sky=new CubeTexture(),sun=new DirectionalLight();
  sun.userData.direction=new Vector3(...DAYLIGHT.direction).normalize();
  const renderer={extensions:{has:()=>true},shadowMap:{},getContext:()=>({isContextLost:()=>false})};
  const atlases=new Map();let captured=null,instanceDisposals=0,geometryDisposals=0,materialDisposals=0,depthDisposals=0;
  t.mock.method(LightProbeGridWebGL.prototype,'bake',function(renderer,proxy) {
    if(!captured) {
      const crowns=[];proxy.traverse(mesh=>{if(mesh.isInstancedMesh&&mesh.geometry.type==='IcosahedronGeometry')crowns.push(mesh);});
      assert.equal(crowns.length,1);captured=crowns[0];assert.equal(captured.count,3);
      const expected=[new Matrix4().makeScale(2.25,3.5,4.75).setPosition(13,8,-29),new Matrix4().makeScale(4,2.9,4).setPosition(-8,9.1,17),new Matrix4().makeScale(1,.7,1).setPosition(10,1,24)];
      const actual=new Matrix4();for(let i=0;i<3;i++){captured.getMatrixAt(i,actual);assert.deepEqual(actual.elements,Array.from(Float32Array.from(expected[i].elements)));}
      assert.ok(captured.instanceMatrix.array.every(Number.isFinite));
      assert.equal(captured.castShadow,true);assert.equal(captured.receiveShadow,true);
      captured.addEventListener('dispose',()=>instanceDisposals++);captured.geometry.addEventListener('dispose',()=>geometryDisposals++);
      captured.material.addEventListener('dispose',()=>materialDisposals++);captured.customDepthMaterial.addEventListener('dispose',()=>depthDisposals++);
    }
    if(!atlases.has(this))atlases.set(this,new Data3DTexture(new Float32Array(4),1,1,1));
    this.texture=atlases.get(this);
  });
  let gi;
  t.after(()=>{gi?.dispose();sky.dispose();});
  gi=createCourtyardIndirect(scene,renderer,{sun,probeBackground:{texture:sky},skyTarget:{texture:sky}},{trees,shrubs});
  const lighting={sun,probeBackground:{texture:sky},skyTarget:{texture:sky}};
  const diagonal=.14/Math.sqrt(3),nearBounds={min:[diagonal-.01,.4+diagonal-.01,2+diagonal-.01],max:[diagonal+.01,.4+diagonal+.01,2+diagonal+.01]};
  assert.throws(()=>createCourtyardIndirect(scene,renderer,lighting,{shrubs:[{shapeSeed:'near',leafBounds:nearBounds}]}),/Light probe intersects/);
  for(const leafBounds of [null,{min:[1,0,0],max:[0,1,1]},{min:[NaN,0,0],max:[1,1,1]}])
    assert.throws(()=>createCourtyardIndirect(scene,renderer,lighting,{shrubs:[{shapeSeed:'bad',leafBounds}]}),/Invalid mature shrub/);
  await gi.bake({yieldControl:async()=>{}});
  assert.ok(captured);assert.equal(atlases.size,4);assert.equal(gi.stats.probes,907);
  assert.equal(gi.stats.shrubProxies,1);
  assert.deepEqual({trees,shrubs},before,'proxy creation must not mutate source envelope/site records');
  assert.deepEqual([instanceDisposals,geometryDisposals,materialDisposals,depthDisposals],[1,1,1,1]);
  gi.dispose();gi.dispose();
  assert.deepEqual([instanceDisposals,geometryDisposals,materialDisposals,depthDisposals],[1,1,1,1]);
});
