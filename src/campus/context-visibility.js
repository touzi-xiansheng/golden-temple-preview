import * as THREE from 'three';

// The receiver index uses the rendered triangles, including road/paving lifts.
// A vertical query touches one small cell rather than raycasting the 7km terrain.
export function createGroundSampler(meshes, bounds, cellSize = 24) {
  const triangles = [], cells = new Map();
  let minHeight=Infinity;
  const [minX, maxX, minZ, maxZ] = bounds;
  const key = (x, z) => `${x},${z}`;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry, p = geo.attributes.position, index = geo.index;
    for (let i = 0, count = index?.count ?? p.count; i < count; i += 3) {
      a.fromBufferAttribute(p, index ? index.getX(i) : i).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2).applyMatrix4(mesh.matrixWorld);
      const x0 = Math.max(minX, Math.min(a.x, b.x, c.x)), x1 = Math.min(maxX, Math.max(a.x, b.x, c.x));
      const z0 = Math.max(minZ, Math.min(a.z, b.z, c.z)), z1 = Math.min(maxZ, Math.max(a.z, b.z, c.z));
      const den = (b.z-c.z)*(a.x-c.x)+(c.x-b.x)*(a.z-c.z);
      if (x0 > x1 || z0 > z1 || Math.abs(den) < 1e-8) continue;
      const id = triangles.length;
      triangles.push({ a:a.toArray(), b:b.toArray(), c:c.toArray(), den });
      minHeight=Math.min(minHeight,a.y,b.y,c.y);
      for (let iz=Math.floor(z0/cellSize);iz<=Math.floor(z1/cellSize);iz++) for (let ix=Math.floor(x0/cellSize);ix<=Math.floor(x1/cellSize);ix++) {
        const k=key(ix,iz); if(!cells.has(k))cells.set(k,[]); cells.get(k).push(id);
      }
    }
  }
  function heightAt(x,z) {
    let height=-Infinity;
    for(const id of cells.get(key(Math.floor(x/cellSize),Math.floor(z/cellSize))) || []) {
      const {a,b,c,den}=triangles[id];
      const u=((b[2]-c[2])*(x-c[0])+(c[0]-b[0])*(z-c[2]))/den;
      const v=((c[2]-a[2])*(x-c[0])+(a[0]-c[0])*(z-c[2]))/den;
      if(u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7)height=Math.max(height,u*a[1]+v*b[1]+(1-u-v)*c[1]);
    }
    if(!Number.isFinite(height))throw new Error(`Context receiver has no ground at ${x}, ${z}`);
    return height;
  }
  function inRect(rect) {
    const ids=new Set();
    for(let iz=Math.floor(rect[2]/cellSize);iz<=Math.floor(rect[3]/cellSize);iz++) for(let ix=Math.floor(rect[0]/cellSize);ix<=Math.floor(rect[1]/cellSize);ix++) {
      for(const id of cells.get(key(ix,iz)) || [])ids.add(id);
    }
    return [...ids].map(id=>triangles[id]);
  }
  return {heightAt,inRect,triangles:triangles.length,cells:cells.size,minHeight};
}

export function rayHitsContextBox(x,y,z,direction,box) {
  let near=0.002,far=Infinity;
  for(let axis=0;axis<3;axis++) {
    const p=axis===0?x:axis===1?y:z,d=direction[axis];
    if(Math.abs(d)<1e-10) { if(p<box.min[axis]||p>box.max[axis])return false; continue; }
    let a=(box.min[axis]-p)/d,b=(box.max[axis]-p)/d;
    if(a>b)[a,b]=[b,a];near=Math.max(near,a);far=Math.min(far,b);
    if(near>far)return false;
  }
  return far>=near;
}

export function rayHitsContextEllipsoid(x,y,z,direction,{center,radii}) {
  const px=(x-center[0])/radii[0],py=(y-center[1])/radii[1],pz=(z-center[2])/radii[2];
  const dx=direction[0]/radii[0],dy=direction[1]/radii[1],dz=direction[2]/radii[2];
  const lengthSq=dx*dx+dy*dy+dz*dz;
  if(!(lengthSq>0))return false;
  // Closest point on the forward ray avoids cancellation in the quadratic roots.
  const t=Math.max(.002,-(px*dx+py*dy+pz*dz)/lengthSq);
  return (px+t*dx)**2+(py+t*dy)**2+(pz+t*dz)**2<=1+1e-12;
}

function casterIndex(casters,bounds,sun,minHeight) {
  const cellSize=24,columns=Math.ceil((bounds[1]-bounds[0])/cellSize),rows=Math.ceil((bounds[3]-bounds[2])/cellSize);
  const cells=Array.from({length:columns*rows},()=>[]),footprints=[];
  let maxCandidates=0;
  for(const caster of casters) {
    const shape=caster.ellipsoid;
    if(shape && (shape.center.length!==3||shape.radii.length!==3||!shape.center.every(Number.isFinite)||!shape.radii.every(r=>Number.isFinite(r)&&r>0)))throw new Error('Context crown ellipsoids require finite centres and positive radii');
    const min=shape?shape.center.map((v,i)=>v-shape.radii[i]):caster.min;
    const max=shape?shape.center.map((v,i)=>v+shape.radii[i]):caster.max;
    const transmission=shape?1-THREE.MathUtils.clamp(caster.opacity??.65,0,1):0;
    if(!Number.isFinite(transmission))throw new Error('Context crown opacity must be finite');
    const entry={caster,min,max,transmission};
    if(caster.groundFootprint)footprints.push(entry);
    // Include the caster's own footprint AND its projection to the lowest receiver:
    // shadows on higher terrain lie between them, not only at the low-plane projection.
    const height=Math.max(0,max[1]-minHeight),sx=-sun[0]/sun[1]*height,sz=-sun[2]/sun[1]*height;
    const x0=Math.max(bounds[0],min[0]+Math.min(0,sx)-1e-5),x1=Math.min(bounds[1],max[0]+Math.max(0,sx)+1e-5);
    const z0=Math.max(bounds[2],min[2]+Math.min(0,sz)-1e-5),z1=Math.min(bounds[3],max[2]+Math.max(0,sz)+1e-5);
    if(x0>x1||z0>z1)continue;
    for(let row=Math.floor((z0-bounds[2])/cellSize);row<=Math.min(rows-1,Math.floor((z1-bounds[2])/cellSize));row++) {
      for(let col=Math.floor((x0-bounds[0])/cellSize);col<=Math.min(columns-1,Math.floor((x1-bounds[0])/cellSize));col++) {
        const cell=cells[row*columns+col];cell.push(entry);maxCandidates=Math.max(maxCandidates,cell.length);
      }
    }
  }
  return {footprints,maxCandidates,candidatesAt(x,z){return cells[Math.floor((z-bounds[2])/cellSize)*columns+Math.floor((x-bounds[0])/cellSize)];}};
}

export function bakeContextVisibility({receivers,casters,regions}, direction) {
  // shortcut: fixed daylight and axis-aligned neighbours; rebake if either changes.
  const started=performance.now(),sun=new THREE.Vector3(...direction).normalize().toArray();
  if(!sun.every(Number.isFinite)||sun[1]<0.1)throw new Error('Context shadow atlas requires the configured daytime sun');
  const size=1024,tile=512,gutter=16,inner=tile-gutter*2,data=new Uint8Array(size*size).fill(255);
  const bounds=[Math.min(...regions.map(r=>r.bounds[0])),Math.max(...regions.map(r=>r.bounds[1])),Math.min(...regions.map(r=>r.bounds[2])),Math.max(...regions.map(r=>r.bounds[3]))];
  const ground=createGroundSampler(receivers,bounds),results=[];
  const offsets=[[.25,.25],[.75,.25],[.25,.75],[.75,.75]];
  let tests=0,shadowTexels=0,partialTexels=0,maxCandidates=0;
  regions.forEach((region,index)=>{
    const [minX,maxX,minZ,maxZ]=region.bounds,dx=(maxX-minX)/inner,dz=(maxZ-minZ)/inner;
    const ox=(index%2)*tile+gutter,oy=Math.floor(index/2)*tile+gutter;
    const boxes=casters.filter(box=>box.district===region.id);
    const indexGrid=casterIndex(boxes,region.bounds,sun,ground.minHeight);
    maxCandidates=Math.max(maxCandidates,indexGrid.maxCandidates);
    let shaded=0,exposed=0;
    for(let row=0;row<inner;row++)for(let col=0;col<inner;col++) {
      let visible=0;
      for(const [sx,sz] of offsets) {
        const x=minX+(col+sx)*dx,z=minZ+(row+sz)*dz,candidates=indexGrid.candidatesAt(x,z);
        if(!candidates.length){visible++;continue;}
        const y=ground.heightAt(x,z)+.015;
        let transmission=1;
        for(const {caster,transmission:through} of candidates) {
          tests++;
          const hit=caster.ellipsoid?rayHitsContextEllipsoid(x,y,z,sun,caster.ellipsoid):rayHitsContextBox(x,y,z,sun,caster);
          // shortcut: distant crowns use uniform ellipsoid opacity; replace with
          // detailed foliage visibility if they enter a close view or animate.
          if(hit)transmission*=through;
          if(transmission===0)break;
        }
        visible+=transmission;
      }
      data[(oy+row)*size+ox+col]=Math.round(255*visible/4);
      if(visible<4){
        shaded++;shadowTexels++;if(visible>0)partialTexels++;
        const x=minX+(col+.5)*dx,z=minZ+(row+.5)*dz;
        if(!indexGrid.footprints.some(b=>x>=b.min[0]&&x<=b.max[0]&&z>=b.min[2]&&z<=b.max[2]))exposed++;
      }
    }
    results.push({id:region.id,bounds:region.bounds,atlas:[ox/size,oy/size,inner/size,inner/size],texelMetres:[dx,dz],shadowArea:shaded*dx*dz,exposedShadowArea:exposed*dx*dz});
  });
  const texture=new THREE.DataTexture(data,size,size,THREE.RedFormat);
  texture.colorSpace=THREE.NoColorSpace;texture.generateMipmaps=true;
  texture.minFilter=THREE.LinearMipmapLinearFilter;texture.magFilter=THREE.LinearFilter;texture.needsUpdate=true;
  return {texture,regions:results,stats:{bakeMs:Math.round(performance.now()-started),size,bytesWithMips:Math.ceil(size*size*4/3),rayTests:tests,shadowTexels,partialTexels,receiverTriangles:ground.triangles,maxCandidates}};
}

// Call after daylight() has wrapped the scene's materials, before compileAsync().
// Far buildings never join the campus shadow camera or its bounds.
export function createContextVisibility(landscape, sunDirection) {
  const context=landscape.userData.contextDistricts;
  if(!context)throw new Error('Context district geometry must be built before its visibility atlas');
  const atlas=bakeContextVisibility(context,Array.isArray(sunDirection)?sunDirection:sunDirection.toArray());
  const originals=new Map();
  for(const material of new Set(context.receivers.map(mesh=>mesh.material))) {
    const compile=material.onBeforeCompile,cacheKey=material.customProgramCacheKey,key=cacheKey.call(material);
    const wrapper=function(shader,renderer) {
      compile.call(this,shader,renderer);
      shader.uniforms.uDistrictVisibility={value:atlas.texture};
      shader.uniforms.uDistrictBounds={value:atlas.regions.map(r=>new THREE.Vector4(r.bounds[0],r.bounds[2],r.bounds[1]-r.bounds[0],r.bounds[3]-r.bounds[2]))};
      shader.uniforms.uDistrictAtlas={value:atlas.regions.map(r=>new THREE.Vector4(...r.atlas))};
      shader.vertexShader=shader.vertexShader
        .replace('#include <common>','#include <common>\nvarying vec3 vDistrictWorld;')
        .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
          vec4 districtPosition=vec4(transformed,1.0);
          #ifdef USE_INSTANCING
            districtPosition=instanceMatrix*districtPosition;
          #endif
          vDistrictWorld=(modelMatrix*districtPosition).xyz;`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vDistrictWorld;
        uniform sampler2D uDistrictVisibility;
        uniform vec4 uDistrictBounds[3],uDistrictAtlas[3];
        float districtSunVisibility(vec2 p) {
          for(int j=0;j<3;j++) {
            vec2 uv=(p-uDistrictBounds[j].xy)/uDistrictBounds[j].zw;
            if(all(greaterThanEqual(uv,vec2(0.0)))&&all(lessThanEqual(uv,vec2(1.0))))
              return texture2D(uDistrictVisibility,uDistrictAtlas[j].xy+uv*uDistrictAtlas[j].zw).r;
          }
          return 1.0;
        }`);
      const marker='getDirectionalLightInfo( directionalLight, directLight );';
      const lights=THREE.ShaderChunk.lights_fragment_begin;
      if(!lights.includes(marker))throw new Error('Context visibility: unsupported directional light chunk');
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',lights.replace(marker,`${marker}
        #if UNROLLED_LOOP_INDEX == 0
          directLight.color*=districtSunVisibility(vDistrictWorld.xz);
        #endif`));
    };
    originals.set(material,{compile,cacheKey,wrapper});
    material.onBeforeCompile=wrapper;material.customProgramCacheKey=()=>`${key}-district-direct-visibility-v1`;material.needsUpdate=true;
  }
  let disposed=false;
  return {stats:atlas.stats,regions:atlas.regions,texture:atlas.texture,dispose(){
    if(disposed)return;disposed=true;
    for(const [material,old] of originals)if(material.onBeforeCompile===old.wrapper){material.onBeforeCompile=old.compile;material.customProgramCacheKey=old.cacheKey;material.needsUpdate=true;}
    atlas.texture.dispose();
  }};
}
