import * as THREE from 'three';
import { LightProbeGridWebGL } from 'three/addons/lighting/LightProbeGridWebGL.js';
import { BUILDINGS, footprint } from './layout.js';

// Matches buildings.js/arcade() and its recessed ground-floor facade.
const ARCADE_DEPTH = 2.4, ARCADE_FLOOR = 0.18, ARCADE_BED_BOTTOM = 0;

export function arcadeProbePlans(buildings = BUILDINGS) {
  return buildings.filter(b => b.arcade).map(b => {
    if(b.entranceSide !== 'east') throw new Error('Arcade irradiance currently covers the two east-facing west arcades');
    const front = b.x + b.w / 2, ceiling = 0.16 + b.floorHeight - 0.35;
    const wall = front - ARCADE_DEPTH - 0.1275;
    // Two rows lie behind the columns; the third sees their courtyard-facing
    // sides. Keep the regular grid: moving individual probes invalidates interpolation.
    const min = new THREE.Vector3(front - 1.72, 0.40, b.z - b.d / 2 + 0.9);
    const max = new THREE.Vector3(front + 0.30, ceiling - 0.24, b.z + b.d / 2 - 0.9);
    const size = max.clone().sub(min), grid = new LightProbeGridWebGL(size.x,size.y,size.z,3,4,18);
    grid.position.copy(min).add(max).multiplyScalar(0.5); grid.updateBoundingBox();
    return { id:b.id, building:b, grid, count:216, front, wall, ceiling,
      // Include stone sides (.16), bevels (.179), mortar (.178) and its exposed
      // plinth down to y=0. The 2cm fade ends at that lowest visible face; using
      // the stone top as a cutoff sends every joint back to the brighter PMREM.
      min:new THREE.Vector3(wall,ARCADE_BED_BOTTOM-.02,b.z-b.d/2),
      max:new THREE.Vector3(front+0.75,ceiling+.03,b.z+b.d/2) };
  });
}

// Commons' five-metre cafe recess, matching commonsCafe() and the wood roof.
export function cafeProbePlan(buildings = BUILDINGS) {
  const b=buildings.find(b=>b.kind==='commons');
  if(!b) throw new Error('Cafe irradiance requires the commons building');
  const front=b.x+b.w/2,wall=front-5-.1275,ceiling=.16+b.floorHeight-.44;
  // Four regular columns avoid seats and structural posts. The outer column
  // captures the courtyard-facing sides instead of clamping them to dark fill.
  const low=new THREE.Vector3(front-4.70,.40,b.z-b.d/2+.45);
  const high=new THREE.Vector3(front+.20,ceiling-.27,b.z+b.d/2-.45);
  const size=high.clone().sub(low),grid=new LightProbeGridWebGL(size.x,size.y,size.z,4,4,10);
  grid.position.copy(low).add(high).multiplyScalar(.5);grid.updateBoundingBox();
  return {id:b.id,building:b,grid,count:160,front,wall,ceiling,
    min:new THREE.Vector3(wall,-.02,b.z-b.d/2-.7),
    max:new THREE.Vector3(front+.8,ceiling+.02,b.z+b.d/2+.7)};
}

// The central strip is outside all seven buildings. Keep this small until a GPU A/B justifies it.
export function courtyardProbePlan(buildings = BUILDINGS) {
  const grid = new LightProbeGridWebGL(40, 13.6, 104, 7, 3, 15);
  grid.position.set(0, 7.2, 2); grid.updateBoundingBox();
  const point = new THREE.Vector3(), count = grid.resolution.x * grid.resolution.y * grid.resolution.z;
  for(let y = 0; y < grid.resolution.y; y++) for(let z = 0; z < grid.resolution.z; z++) for(let x = 0; x < grid.resolution.x; x++) {
    grid.getProbePosition(x, y, z, point);
    for(const building of buildings) {
      const box = footprint(building, 0.25);
      if(point.x >= box.minX && point.x <= box.maxX && point.z >= box.minZ && point.z <= box.maxZ && point.y <= building.floors * building.floorHeight + 1) {
        throw new Error(`Courtyard light probe intersects ${building.id}; revise its volume before baking`);
      }
    }
  }
  return { grid, count };
}

function proxyScene(lighting, trees, paths, arcades = [], shrubs = []) {
  const scene = new THREE.Scene();
  scene.background = lighting.probeBackground.texture;
  scene.backgroundIntensity = 1;
  scene.environment = lighting.skyTarget.texture;
  scene.environmentIntensity = 1;
  const ownedGeometry = [], ownedMaterial = [], ownedInstances = [];
  const geometry = value => { ownedGeometry.push(value); return value; };
  const material = params => { const m = new THREE.MeshStandardMaterial(params); ownedMaterial.push(m); return m; };
  const box = geometry(new THREE.BoxGeometry()), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion();
  const volumes=[],columns=[],bases=[],ceilings=[],floors=[],slabs=[];
  const record=(x,y,z,w,h,d,color)=>({position:[x,y,z],size:[w,h,d],color});
  for(const b of BUILDINGS) {
    const h=b.floors*b.floorHeight, facade=b.kind==='headquarters'?'#777f7d':'#b5b0a2';
    const arcade=arcades.find(a=>a.id===b.id);
    if(b.kind==='commons') {
      // Match the real cafe void for its local irradiance capture.
      const front=b.x+b.w/2,slabY=.16+b.floorHeight,ceiling=slabY-.44;
      volumes.push(record(b.x-2.5,.16+b.floorHeight/2,b.z,b.w-5-.46,b.floorHeight,b.d-.46,'#283236'));
      volumes.push(record(b.x-3.5,slabY+(b.floors-1)*b.floorHeight/2,b.z+3.4,b.w-8,(b.floors-1)*b.floorHeight,b.d-7,facade));
      ceilings.push(record(b.x,slabY-.18,b.z,b.w+1.6,.52,b.d+1.4));
      floors.push(record((front-5.08+front+.08)/2,.08,b.z,5.16,.16,b.d+.16));
      for(const [x0,x1,z0,z1] of [[-16.55,front+.08,54.65,56.92],[-22,-16.55,54.65,54.845]])
        floors.push(record((x0+x1)/2,.08,(z0+z1)/2,x1-x0,.16,z1-z0));
      for(const z of [57.8,63.2,68.6,74.0]) {
        columns.push(record(front-.35,(ceiling+.16)/2,z,.24,ceiling-.16,.24,'#353f40'));
        bases.push(record(front-.35,.18,z,.32,.04,.32,'#353f40'));
      }
      continue;
    }
    if(!arcade) { volumes.push(record(b.x,h/2,b.z,b.w,h,b.d,facade)); continue; }
    const {front,wall,ceiling}=arcade,slabY=.16+b.floorHeight,left=b.x-b.w/2;
    // The actual recess is closed by glazing: a dark diffuse proxy supplies its
    // average bounce, while specular glass remains the reflection system's job.
    volumes.push(record((left+wall)/2,slabY/2,b.z,wall-left,slabY,b.d,'#283236'));
    volumes.push(record(b.x,(slabY+.16+h)/2,b.z,b.w,.16+h-slabY,b.d,facade));
    slabs.push(record(front-ARCADE_DEPTH/2,slabY-.16,b.z,ARCADE_DEPTH,.32,b.d));
    ceilings.push(record(front-ARCADE_DEPTH/2,ceiling+.01,b.z,ARCADE_DEPTH-.35,.02,b.d-.6));
    floors.push(record(front-ARCADE_DEPTH/2,ARCADE_FLOOR/2,b.z,ARCADE_DEPTH,ARCADE_FLOOR,b.d));
    const bays=2*Math.ceil(b.d/12),step=(b.d-1.2)/bays;
    for(let i=0;i<=bays;i++) {
      const u=-(b.d-1.2)/2+i*step;if(Math.abs(u)<3)continue;
      columns.push(record(front-.28,(slabY-.32+.18)/2,b.z-u,.44,slabY-.32-.18,.44));
      bases.push(record(front-.28,.318,b.z-u,.46,.284,.46));
    }
  }
  const addBoxes=(records,color,roughness,name)=>{
    const mesh=new THREE.InstancedMesh(box,material({color:0xffffff,roughness}),records.length);
    records.forEach((r,i)=>{
      matrix.makeScale(...r.size).setPosition(...r.position);mesh.setMatrixAt(i,matrix);
      mesh.setColorAt(i,new THREE.Color(r.color||color));
    });
    mesh.name=name;mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);ownedInstances.push(mesh);
  };
  addBoxes(volumes,'#b5b0a2',.85,'GI building volumes');
  // These constants are the actual buildingMaterials() base colours/roughness.
  addBoxes(columns,'#a9ada7',.84,'GI arcade columns');
  addBoxes(bases,'#555c5b',.8,'GI arcade column bases');
  addBoxes(slabs,'#a9ada7',.84,'GI arcade slabs');
  addBoxes(ceilings,'#805b3d',.72,'GI arcade ash soffits');
  addBoxes(floors,'#8d8b80',.82,'GI arcade stone floors');
  const ground = new THREE.Mesh(geometry(new THREE.PlaneGeometry(600, 600)), material({ color: '#3e5427', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.025; ground.receiveShadow = true; scene.add(ground);
  const segments = paths.flatMap(path => path.points.slice(1).map((b, i) => ({ a: path.points[i], b, width: path.width })))
    .filter(({ a, b }) => Math.hypot(b.x - a.x, b.z - a.z) > 0.01);
  const paving = new THREE.InstancedMesh(box, material({ color: '#c5c2b4', roughness: 0.95 }), segments.length);
  segments.forEach(({ a, b, width }, i) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    rotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(dx, dz));
    matrix.compose(new THREE.Vector3((a.x + b.x) / 2, 0.04, (a.z + b.z) / 2), rotation, new THREE.Vector3(width, 0.02, Math.hypot(dx, dz) + 0.02));
    paving.setMatrixAt(i, matrix);
  });
  paving.receiveShadow = true; scene.add(paving); ownedInstances.push(paving);
  const canopy = new THREE.InstancedMesh(geometry(new THREE.IcosahedronGeometry(1, 1)), material({ color: '#365329', roughness: 1, alphaHash: true, opacity: 0.55, side: THREE.DoubleSide }), trees.length + shrubs.length);
  trees.forEach((tree, i) => {
    if(tree.crownEnvelope)matrix.makeScale(...tree.crownEnvelope.radii).setPosition(...tree.crownEnvelope.center);
    else matrix.makeScale(tree.radius || tree.height * 0.36, tree.height * 0.29, tree.radius || tree.height * 0.36)
      .setPosition(tree.x, (tree.ground || 0) + tree.height * 0.71, tree.z);
    canopy.setMatrixAt(i, matrix);
  });
  // shortcut: bounds-derived porous shells approximate broad shrub occlusion; use leaf transport if a view proves this insufficient.
  shrubs.forEach((shrub, i) => {
    matrix.makeScale(...shrub.radii).setPosition(...shrub.center);
    canopy.setMatrixAt(trees.length + i, matrix);
  });
  canopy.castShadow = canopy.receiveShadow = true;
  canopy.customDepthMaterial = new THREE.MeshDepthMaterial({ alphaHash: true, opacity: 0.55, side: THREE.DoubleSide });
  ownedMaterial.push(canopy.customDepthMaterial); scene.add(canopy); ownedInstances.push(canopy);
  const sun = new THREE.DirectionalLight(lighting.sun.color.clone(), lighting.sun.intensity);
  sun.position.copy(lighting.sun.userData.direction).multiplyScalar(180).add(new THREE.Vector3(0, 10, 2));
  sun.target.position.set(0, 10, 2); sun.castShadow = true;
  sun.shadow.mapSize.setScalar(1024);
  Object.assign(sun.shadow.camera, { left: -110, right: 110, bottom: -110, top: 110, near: 30, far: 350 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.00008;
  scene.add(sun, sun.target);
  let triangles = 0;
  scene.traverse(o => { if(o.isMesh) triangles += (o.geometry.index?.count || o.geometry.attributes.position.count) / 3 * (o.isInstancedMesh ? o.count : 1); });
  let disposed = false;
  return {
    scene, triangles,
    dispose() {
      if(disposed) return;
      disposed = true;
      for(const mesh of ownedInstances) mesh.dispose();
      for(const item of ownedGeometry) item.dispose();
      for(const item of ownedMaterial) item.dispose();
      sun.shadow.map?.dispose(); sun.shadow.mapPass?.dispose();
    },
  };
}

// Bake before captureCampusEnvironment disposes skyTarget/probeBackground. No full-scene capture.
export function createCourtyardIndirect(scene, renderer, lighting, { trees = [], paths = [], shrubs = [] } = {}) {
  if(!renderer.extensions.has('EXT_color_buffer_float') || !renderer.extensions.has('OES_texture_float_linear')) {
    throw new Error('Courtyard irradiance requires renderable, linearly filtered float textures');
  }
  const courtyard = courtyardProbePlan(), arcades = arcadeProbePlans(), cafe = cafeProbePlan();
  const locals = [...arcades,cafe];
  const plans = [courtyard, ...locals], { grid } = courtyard;
  const count = plans.reduce((sum, plan) => sum + plan.count, 0);
  const shrubVolumes = shrubs.map(({ shapeSeed, leafBounds }) => {
    const min = leafBounds?.min, max = leafBounds?.max;
    if(!min || !max || min.length !== 3 || max.length !== 3 ||
      !min.every((v,i) => Number.isFinite(v) && Number.isFinite(max[i]) && max[i] > v)) {
      throw new Error(`Invalid mature shrub leaf bounds: ${shapeSeed}`);
    }
    return { shapeSeed, center:min.map((v,i)=>(v+max[i])/2), radii:min.map((v,i)=>(max[i]-v)/2) };
  });
  const point = new THREE.Vector3();
  for(const plan of plans) {
    const { grid:probeGrid } = plan, near = plan === courtyard ? .1 : .05;
    for(let y=0;y<probeGrid.resolution.y;y++) for(let z=0;z<probeGrid.resolution.z;z++) for(let x=0;x<probeGrid.resolution.x;x++) {
      probeGrid.getProbePosition(x,y,z,point);
      for(const shrub of shrubVolumes) {
        const scaled = point.toArray().map((v,i)=>(v-shrub.center[i])/shrub.radii[i]);
        // This lower bound also keeps the cube camera's near-clipped cube outside the proxy shell.
        const clearance = (Math.hypot(...scaled)-1)*Math.min(...shrub.radii);
        if(clearance <= Math.sqrt(3) * near + .02) throw new Error(`Light probe intersects mature shrub proxy: ${shrub.shapeSeed}`);
      }
    }
  }
  const proxy = proxyScene(lighting, trees, paths, arcades, shrubVolumes);
  const empty = new THREE.Data3DTexture(new Float32Array(4), 1, 1, 1);
  empty.type = THREE.FloatType; empty.needsUpdate = true;
  const uniforms = {
    uCampusGIAtlas: { value: empty }, uCampusGIEnabled: { value: 0 }, uCampusArcadeEnabled: { value: 0 },
    uCampusGIMin: { value: grid.boundingBox.min.clone() }, uCampusGIMax: { value: grid.boundingBox.max.clone() },
    uCampusGIResolution: { value: grid.resolution.clone() },
  };
  locals.forEach((plan, i) => {
    uniforms[`uCampusArcadeAtlas${i}`] = { value:empty };
    uniforms[`uCampusArcadeProbeMin${i}`] = { value:plan.grid.boundingBox.min.clone() };
    uniforms[`uCampusArcadeProbeMax${i}`] = { value:plan.grid.boundingBox.max.clone() };
    uniforms[`uCampusArcadeResolution${i}`] = { value:plan.grid.resolution.clone() };
    uniforms[`uCampusArcadeMin${i}`] = { value:plan.min.clone() };
    uniforms[`uCampusArcadeMax${i}`] = { value:plan.max.clone() };
  });
  // Reuse the addon's exact packing/evaluation, without its object-origin volume selection.
  const irradianceChunk = THREE.ShaderChunk.lightprobes_pars_fragment
    .replace('#ifdef USE_LIGHT_PROBES_GRID', '').replace(/#endif\s*$/, '')
    .replace('uniform highp sampler3D probesSH;', '')
    .replace(/uniform vec3 probes(?:Min|Max|Resolution);/g, '')
    .replace('vec3 getLightProbeGridIrradiance( vec3 worldPos, vec3 worldNormal )',
      'vec3 campusProbeIrradiance(highp sampler3D probesSH, vec3 probesMin, vec3 probesMax, vec3 probesResolution, vec3 worldPos, vec3 worldNormal)')
    .replace('worldNormal * probeSpacing * 0.5', 'worldNormal * min(probeSpacing * 0.1, vec3(0.35))');
  const arcadeDeclarations = locals.map((_, i) => `
    uniform highp sampler3D uCampusArcadeAtlas${i};
    uniform vec3 uCampusArcadeProbeMin${i}, uCampusArcadeProbeMax${i}, uCampusArcadeResolution${i};
    uniform vec3 uCampusArcadeMin${i}, uCampusArcadeMax${i};`).join('\n');
  const arcadeWeights = locals.map((_, i) => `
    float arcadeWeight${i}=campusArcadeWeight(p,n,uCampusArcadeMin${i},uCampusArcadeMax${i});`).join('\n');
  const totalArcadeWeight = locals.length ? locals.map((_,i)=>`arcadeWeight${i}`).join('+') : '0.0';
  const arcadeSampling = locals.map((_, i) => `
    if(arcadeWeight${i}>0.001) {
      vec3 local=campusProbeIrradiance(uCampusArcadeAtlas${i},uCampusArcadeProbeMin${i},uCampusArcadeProbeMax${i},uCampusArcadeResolution${i},p,n);
      if(arcadeWeight${i}>=1.0) return local;
      localSum+=local*arcadeWeight${i};
    }`).join('\n');
  const originals = new Map();
  scene.traverse(object => {
    const material = object.material;
    if(!material?.isMeshStandardMaterial || originals.has(material)) return;
    const compile = material.onBeforeCompile, cacheKey = material.customProgramCacheKey, key = cacheKey.call(material);
    originals.set(material, { compile, cacheKey });
    material.onBeforeCompile = function(shader, activeRenderer) {
      compile.call(this, shader, activeRenderer); Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCampusGIPosition;')
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>
          vec4 giPosition = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            giPosition = instanceMatrix * giPosition;
          #endif
          vCampusGIPosition = (modelMatrix * giPosition).xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
          varying vec3 vCampusGIPosition;
          uniform float uCampusGIEnabled, uCampusArcadeEnabled;
          uniform highp sampler3D uCampusGIAtlas;
          uniform vec3 uCampusGIMin, uCampusGIMax, uCampusGIResolution;
          ${arcadeDeclarations}
          ${irradianceChunk}
          float campusCourtyardWeight(vec3 p) {
            vec2 outside = max(uCampusGIMin.xz - p.xz, p.xz - uCampusGIMax.xz);
            float horizontal = 1.0 - smoothstep(0.0, 4.0, max(outside.x, outside.y));
            float vertical = 1.0 - smoothstep(uCampusGIMax.y - 2.0, uCampusGIMax.y + 4.0, p.y);
            return horizontal * vertical;
          }
          float campusArcadeWeight(vec3 p,vec3 n,vec3 low,vec3 high) {
            if(uCampusArcadeEnabled<0.5 || any(lessThan(p,low-vec3(0.0001))) || any(greaterThan(p,high+vec3(0.0001)))) return 0.0;
            // Evaluate just outside the receiving surface so the actual floor,
            // wall and soffit receive GI, without extending it through a solid wall.
            vec3 q=p+n*0.02;
            vec3 lo=smoothstep(vec3(0.0),vec3(0.02,0.02,0.5),q-low);
            vec3 hi=smoothstep(vec3(0.0),vec3(0.45,0.02,0.5),high-q);
            return lo.x*lo.y*lo.z*hi.x*hi.y*hi.z;
          }
          float campusGIWeight(vec3 p,vec3 n) {
            ${arcadeWeights}
            float localWeight=clamp(${totalArcadeWeight},0.0,1.0);
            return (localWeight+(1.0-localWeight)*campusCourtyardWeight(p))*uCampusGIEnabled;
          }
          vec3 campusLocalIrradiance(vec3 p,vec3 n) {
            ${arcadeWeights}
            vec3 localSum=vec3(0.0);
            ${arcadeSampling}
            float localWeight=clamp(${totalArcadeWeight},0.0,1.0);
            float centralWeight=(1.0-localWeight)*campusCourtyardWeight(p);
            vec3 central=campusProbeIrradiance(uCampusGIAtlas,uCampusGIMin,uCampusGIMax,uCampusGIResolution,p,n);
            return (localSum+central*centralWeight)/max(localWeight+centralWeight,0.0001);
          }`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
          #if defined(RE_IndirectDiffuse)
            vec3 localNormal = transformNormalByInverseViewMatrix(geometryNormal, viewMatrix);
            float campusGI = campusGIWeight(vCampusGIPosition,localNormal);
            if(campusGI > 0.001) {
              // Replace diffuse sky/hemisphere fill, preserving direct light and specular PMREM.
              irradiance = mix(irradiance, campusLocalIrradiance(vCampusGIPosition, localNormal), campusGI);
              iblIrradiance *= 1.0 - campusGI;
            }
          #endif`)
        .replace('/* CAMPUS_LEAF_BACK_IRRADIANCE */', `
          vec3 foliageBackWorldNormal=transformNormalByInverseViewMatrix(-foliageFaceNormal,viewMatrix);
          float foliageBackGI=campusGIWeight(vCampusGIPosition,foliageBackWorldNormal);
          if(foliageBackGI>0.001) {
            foliageBackIrradiance=mix(foliageBackIrradiance,campusLocalIrradiance(vCampusGIPosition,foliageBackWorldNormal),foliageBackGI);
          }`);
    };
    material.customProgramCacheKey = () => `${key}-courtyard-arcade-irradiance-v4-${locals.length}`;
    material.needsUpdate = true;
  });
  let ready = false, disposed = false, baking = false, arcadeEnabled = true;
  const stats = { probes: count, courtyardProbes:courtyard.count, arcadeProbes:arcades.reduce((sum,plan)=>sum+plan.count,0), cafeProbes:cafe.count, cubeViews: count * 6, proxyTriangles: proxy.triangles, shrubProxies: shrubVolumes.length, bakeMs: 0 };
  const api = {
    stats,
    // The coarse grid captures sky visibility and one diffuse reflection, not small crevice AO.
    async bake({ onProgress = () => {}, yieldControl = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
      if(disposed) throw new Error('Courtyard irradiance has been disposed');
      if(ready) return stats;
      if(baking) throw new Error('Courtyard irradiance capture is already running');
      baking = true;
      const startTime = performance.now();
      try {
        let completed=0;
        for(const plan of plans) {
          for(let start = 0; start < plan.count; start += 14) {
            if(disposed || renderer.getContext().isContextLost()) throw new Error('Courtyard irradiance capture interrupted');
            const batch=Math.min(14,plan.count-start);
            plan.grid.bake(renderer, proxy.scene, { cubemapSize:8, near:plan===courtyard?0.1:0.05, far:500, start, count:batch });
            completed+=batch; onProgress(completed/count);
            await yieldControl();
          }
        }
        if(disposed || renderer.getContext().isContextLost()) throw new Error('Courtyard irradiance capture interrupted');
        uniforms.uCampusGIAtlas.value = grid.texture;
        locals.forEach((plan,i)=>{ uniforms[`uCampusArcadeAtlas${i}`].value=plan.grid.texture; });
        uniforms.uCampusArcadeEnabled.value = arcadeEnabled ? 1 : 0;
        stats.bakeMs = performance.now() - startTime; ready = true;
        proxy.dispose();
        return stats;
      } catch(error) {
        api.dispose();
        throw error;
      } finally {
        baking = false;
        // Probe baking renders another scene's shadow map; refresh the real sun before capture/view.
        renderer.shadowMap.needsUpdate = true; lighting.sun.shadow.needsUpdate = true;
      }
    },
    setEnabled(value) { uniforms.uCampusGIEnabled.value = value && ready && !disposed ? 1 : 0; },
    setArcadeEnabled(value) { arcadeEnabled=!!value; uniforms.uCampusArcadeEnabled.value = arcadeEnabled && ready && !disposed ? 1 : 0; },
    getState: () => ({ ready, enabled: uniforms.uCampusGIEnabled.value === 1, arcadeEnabled:uniforms.uCampusGIEnabled.value===1&&uniforms.uCampusArcadeEnabled.value===1, ...stats }),
    dispose() {
      if(disposed) return;
      disposed = true; uniforms.uCampusGIEnabled.value = uniforms.uCampusArcadeEnabled.value = 0;
      for(const [material, original] of originals) {
        material.onBeforeCompile = original.compile; material.customProgramCacheKey = original.cacheKey; material.needsUpdate = true;
      }
      originals.clear(); for(const plan of plans) plan.grid.dispose(); empty.dispose(); proxy.dispose();
    },
  };
  return api;
}
