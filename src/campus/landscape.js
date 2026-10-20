import * as THREE from 'three';
import { Builder, mat4 } from '../core/geom.js';
import { rng, fbm2 } from '../core/rng.js';
import { BUILDINGS, COURTYARDS, entrancePoint, footprint } from './layout.js';
import { buildVegetationSteps, stageMatureBorder } from './vegetation.js';
import { planNorthGrove } from './north-grove.js';
import { createTurfTextures } from './turf-texture.js';
import { createMulchTextures } from './mulch-texture.js';
import { CONTEXT_EXTENT, contextTerrainHeight, planContextWoodland, woodlandGroundMask } from './site-context.js';
import { buildContextDistricts, CONTEXT_JUNCTION } from './context-districts.js';
import { createGroundSampler } from './context-visibility.js';
import { sampleTour, TOUR, SHOT_SECONDS } from './tour.js';
import { buildMownTurfSteps } from './mown-turf.js';
import { finishBuild } from './loading.js';

const TAU = Math.PI * 2;

function createTurfSurfaceSampler(surfaces,baseY,minZ) {
  const regions=surfaces.map(surface=>({...surface,
    minX:Math.min(...surface.points.map(p=>p.x)),maxX:Math.max(...surface.points.map(p=>p.x)),
    minZ:Math.min(...surface.points.map(p=>p.z)),maxZ:Math.max(...surface.points.map(p=>p.z))}));
  const structures=BUILDINGS.map(building=>footprint(building,.6));
  // Include the entrance landing and its adjoining ramp, outside the building footprint.
  for(const building of BUILDINGS.filter(b=>!b.arcade)) {
    const entry=entrancePoint(building),width=building.kind==='headquarters'?10.6:building.kind==='commons'?9.5:8;
    const points=[-width/2-1.95,width/2+1.95].flatMap(u=>[-.6,2.5].map(v=>({
      x:entry.x+entry.nz*u+entry.nx*v,z:entry.z-entry.nx*u+entry.nz*v})));
    structures.push({minX:Math.min(...points.map(p=>p.x)),maxX:Math.max(...points.map(p=>p.x)),
      minZ:Math.min(...points.map(p=>p.z)),maxZ:Math.max(...points.map(p=>p.z))});
  }
  function contour(x,z,points) {
    let inside=false,distance=Infinity;
    for(let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[j],b=points[i],dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
      const t=den?THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/den,0,1):0;
      distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }
    return {inside,distance};
  }
  return (x,z,margin=0)=>{
    // This field is confined to the south campus and inside the actual inner road curb.
    if(z-margin<minZ)return null;
    const qx=Math.abs(x)-(209/2-6.5),qz=Math.abs(z-4)-(177/2-6.5);
    const curbDistance=Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0)-6.5;
    if(curbDistance>=-.25-margin)return null;
    if(structures.some(r=>x>=r.minX-margin&&x<=r.maxX+margin&&z>=r.minZ-margin&&z<=r.maxZ+margin))return null;
    let y=baseY;
    for(const region of regions) {
      if(x<region.minX-margin||x>region.maxX+margin||z<region.minZ-margin||z>region.maxZ+margin)continue;
      let {inside,distance}=contour(x,z,region.points);
      for(const hole of region.holes) {const h=contour(x,z,hole);inside&&=!h.inside;distance=Math.min(distance,h.distance);}
      // A complete cluster must stay on one plane, even across the 18mm lawn-island step.
      if(distance<=margin||(!region.lawn&&inside))return null;
      if(region.lawn&&inside)y=region.y;
    }
    return y;
  };
}

function markDetailedShrubs(shrubs) {
  const walkingSegments=[];
  for(let shot=0;shot<TOUR.length;shot++) {
    if(!TOUR[shot].points.every(p=>p[1]<4))continue;
    let previous;
    // Quarter-second samples keep separate walking shots separate at camera cuts.
    for(let step=0;step<=40;step++) {
      const position=sampleTour((shot+Math.min(step/40,1-1e-8))*SHOT_SECONDS).position;
      if(previous)walkingSegments.push(new THREE.Line3(previous,position));previous=position;
    }
  }
  const center=new THREE.Vector3(),nearest=new THREE.Vector3();
  for(const plant of shrubs) {
    if(!['shrub','matureShrub'].includes(plant.kind??'shrub'))continue;
    center.set(plant.x,(plant.ground??0)+plant.height*.5,plant.z);
    // shortcut: detail follows the fixed tour; use distance LOD if free-camera close-ups become primary.
    plant.detail=walkingSegments.some(segment=>segment.closestPointToPoint(center,true,nearest).distanceToSquared(center)<=8*8);
  }
}

function surface(color, kind, woodland = null) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
  const turf = kind === 'lawn' ? createTurfTextures() : null;
  const mulch = kind === 'soil' ? createMulchTextures() : null;
  if(turf)material.userData.turfMap=turf.map;
  if (turf || mulch) material.color.set('#ffffff');
  material.name=`campus-${kind}`;
  material.onBeforeCompile = (shader) => {
    if (turf) {
      shader.uniforms.uCampusTurf = { value: turf.map };
      shader.uniforms.uCampusTurfHeight = { value: turf.bump };
      shader.uniforms.uCampusWoodland = { value: woodland };
      shader.uniforms.uCampusContextExtent = { value: new THREE.Vector4(CONTEXT_EXTENT.minX,CONTEXT_EXTENT.minZ,CONTEXT_EXTENT.maxX-CONTEXT_EXTENT.minX,CONTEXT_EXTENT.maxZ-CONTEXT_EXTENT.minZ) };
      const district=material.userData.districtLanduse,[x0,x1,z0,z1]=district.bounds;
      shader.uniforms.uCampusDistrictLanduse={value:district.texture};
      shader.uniforms.uCampusDistrictExtent={value:new THREE.Vector4(x0,z0,x1-x0,z1-z0)};
    }
    if (mulch) {
      shader.uniforms.uCampusMulch = { value: mulch.map };
      shader.uniforms.uCampusMulchHeight = { value: mulch.bump };
    }
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vSurface;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvSurface = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vSurface;
      ${turf ? 'uniform sampler2D uCampusTurf, uCampusTurfHeight, uCampusWoodland, uCampusDistrictLanduse; uniform vec4 uCampusContextExtent, uCampusDistrictExtent;' : ''}
      ${mulch ? 'uniform sampler2D uCampusMulch, uCampusMulchHeight;' : ''}
      float surfaceHash(vec2 p) { return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
      float surfaceNoise(vec2 p) {
        vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        float n=mix(mix(surfaceHash(i),surfaceHash(i+vec2(1,0)),f.x),mix(surfaceHash(i+vec2(0,1)),surfaceHash(i+1.0),f.x),f.y);
        return mix(0.5,n,1.0-smoothstep(0.2,0.8,length(fwidth(p))));
      }
    `).replace('#include <color_fragment>', `#include <color_fragment>
      vec2 p = vSurface.xz;
      float fine = surfaceNoise(p * 45.0);
      float grainAA = 1.0-smoothstep(0.004,0.018,length(fwidth(p)));
      diffuseColor.rgb *= 1.0 + (fine-0.5) * 0.24 * grainAA;
      ${kind === 'paving' ? `
      vec2 tile = p / vec2(1.2,0.6); tile.x += mod(floor(tile.y),2.0)*0.5;
      vec2 grid = abs(fract(tile)-0.5); vec2 aa = fwidth(tile);
      float joint = max(smoothstep(0.497-aa.x,0.497+aa.x,grid.x),smoothstep(0.494-aa.y,0.494+aa.y,grid.y));
      float tileShade=surfaceHash(floor(tile));
      float pavingHeight=(1.0-joint)*0.0035;
      diffuseColor.rgb *= mix(0.94,1.06,tileShade) * mix(1.0,0.68,joint);
      ` : kind === 'lawn' ? `
      float lawnCoarse=surfaceNoise(p*0.43), lawnClump=surfaceNoise(p*2.0);
      float broad=surfaceNoise(p*0.08)*0.45+lawnCoarse*0.25+lawnClump*0.3;
      float lawnBlade=surfaceNoise(p*7.0);
      float lawnNear=1.0-smoothstep(35.0,95.0,length(vViewPosition));
      vec2 turfUV=p/${turf?.metres || 1};
      vec3 turfColor=texture2D(uCampusTurf,turfUV).rgb;
      float turfHeight=texture2D(uCampusTurfHeight,turfUV).r;
      diffuseColor.rgb*=turfColor;
      // Heights are metres; each noise band also fades with its pixel footprint.
      float lawnHeight=lawnNear*(0.008*(lawnCoarse-0.5)+0.012*(lawnClump-0.5)+0.009*(lawnBlade-0.5)+0.006*(turfHeight-0.5));
      diffuseColor.rgb *= mix(0.77,1.22,broad);
      diffuseColor.rgb *= 0.94+0.12*lawnBlade;
      diffuseColor.rgb *= 0.96 + surfaceNoise(p*0.017)*0.08;
      float exterior=smoothstep(150.0,225.0,length(p)+(surfaceNoise(p*0.018)-0.5)*22.0);
      float meadow=surfaceNoise(p*0.016)*0.65+surfaceNoise(p*0.055)*0.25+surfaceNoise(p*0.21)*0.1;
      vec3 meadowColor=mix(vec3(0.067,0.088,0.034),vec3(0.145,0.128,0.064),meadow);
      diffuseColor.rgb=mix(diffuseColor.rgb,meadowColor,exterior*0.85);
      // The same density field places trees and darkens their understory; the
      // open meadow continues through gaps instead of a rectangular forest mat.
      vec2 woodlandUV=(p-uCampusContextExtent.xy)/uCampusContextExtent.zw;
      float forestFloor=texture2D(uCampusWoodland,woodlandUV).r;
      vec3 woodlandColor=mix(vec3(0.027,0.036,0.017),vec3(0.059,0.064,0.028),meadow);
      diffuseColor.rgb=mix(diffuseColor.rgb,woodlandColor,forestFloor*0.80);
      vec2 districtUV=(p-uCampusDistrictExtent.xy)/uCampusDistrictExtent.zw;
      float districtEdge=min(min(districtUV.x,1.0-districtUV.x)*uCampusDistrictExtent.z,min(districtUV.y,1.0-districtUV.y)*uCampusDistrictExtent.w);
      vec2 districtCover=texture2D(uCampusDistrictLanduse,districtUV).rg*smoothstep(0.0,12.0,districtEdge);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.075,0.119,0.047)*(0.95+meadow*0.1),districtCover.r*0.86);
      diffuseColor.rgb=mix(diffuseColor.rgb,woodlandColor,districtCover.g*0.72);
      ` : kind === 'soil' ? `
      vec2 mulchUV=p/${mulch?.metres || 1};
      float mulchChip=texture2D(uCampusMulchHeight,mulchUV).r;
      float mulchNear=1.0-smoothstep(15.0,45.0,length(vViewPosition));
      float mulchHeight=mulchNear*(mulchChip-.5)*.008;
      diffuseColor.rgb*=texture2D(uCampusMulch,mulchUV).rgb*(.85+.3*surfaceNoise(p*.7));
      ` : `diffuseColor.rgb *= 0.94+surfaceNoise(p*0.7)*0.12;`}
    `);
    if(kind==='paving') shader.fragmentShader=shader.fragmentShader
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor+joint*0.035-(tileShade-0.5)*0.08,0.78,1.0);')
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 paveDx=dFdx(-vViewPosition),paveDy=dFdy(-vViewPosition);
        vec3 paveR1=cross(paveDy,normal),paveR2=cross(normal,paveDx);
        float paveDet=dot(paveDx,paveR1);
        normal=normalize(abs(paveDet)*normal-sign(paveDet)*(dFdx(pavingHeight)*paveR1+dFdy(pavingHeight)*paveR2));
      `);
    if(kind==='lawn') shader.fragmentShader=shader.fragmentShader
      .replace('#include <roughnessmap_fragment>',`#include <roughnessmap_fragment>
        roughnessFactor=clamp(roughnessFactor+lawnNear*(0.018*(1.0-lawnClump)-0.065*lawnBlade),0.86,1.0);
      `)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 lawnDx=dFdx(-vViewPosition),lawnDy=dFdy(-vViewPosition);
        vec3 lawnR1=cross(lawnDy,normal),lawnR2=cross(normal,lawnDx);
        float lawnDet=dot(lawnDx,lawnR1);
        vec3 lawnGradient=dFdx(lawnHeight)*lawnR1+dFdy(lawnHeight)*lawnR2;
        if(abs(lawnDet)>1e-10) normal=normalize(abs(lawnDet)*normal-sign(lawnDet)*lawnGradient);
      `);
    if(kind==='soil') shader.fragmentShader=shader.fragmentShader
      .replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor=clamp(.98-.07*mulchChip,0.9,1.0);')
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        vec3 soilDx=dFdx(-vViewPosition),soilDy=dFdy(-vViewPosition);
        vec3 soilR1=cross(soilDy,normal),soilR2=cross(normal,soilDx);
        float soilDet=dot(soilDx,soilR1);
        if(abs(soilDet)>1e-10) normal=normalize(abs(soilDet)*normal-sign(soilDet)*(dFdx(mulchHeight)*soilR1+dFdy(mulchHeight)*soilR2));
      `);
  };
  material.customProgramCacheKey = () => `campus-surface-${kind}-landuse-v5`;
  return material;
}

function roundRect(w, d, r) {
  const s = new THREE.Shape(), x = -w / 2, y = -d / 2;
  s.moveTo(x+r, y); s.lineTo(x+w-r,y); s.quadraticCurveTo(x+w,y,x+w,y+r);
  s.lineTo(x+w,y+d-r); s.quadraticCurveTo(x+w,y+d,x+w-r,y+d);
  s.lineTo(x+r,y+d); s.quadraticCurveTo(x,y+d,x,y+d-r);
  s.lineTo(x,y+r); s.quadraticCurveTo(x,y,x+r,y); s.closePath(); return s;
}

// One south-courtyard layout experiment; all previous planting is generated first.
function southBorderContour(x,z,points) {
  let inside=false,distance=Infinity;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[j],b=points[i],dx=b.x-a.x,dz=b.z-a.z,den=dx*dx+dz*dz;
    const t=den?THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/den,0,1):0;
    distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
    if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return {inside,distance};
}
function southBorderInterval(points,z) {
  const xs=[];
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[j],b=points[i];
    if((a.z>z)!==(b.z>z))xs.push(a.x+(z-a.z)*(b.x-a.x)/(b.z-a.z));
  }
  return xs.length?[Math.min(...xs),Math.max(...xs)]:null;
}
function southBorderOutline(oldOutlines) {
  const smooth=THREE.MathUtils.smoothstep;
  const zs=[...new Set([...oldOutlines.flat().map(p=>p.z),...Array.from({length:81},(_,i)=>25.2+i*(32-25.2)/80)])].sort((a,b)=>a-b),left=[],right=[];
  for(const z of zs) {
    const spans=oldOutlines.map(points=>southBorderInterval(points,z)).filter(Boolean);
    const width=1.35*smooth(z,25.2,27.3)*(1-smooth(z,30.2,32)),center=-10.15+.10*(z-28.7);
    if(width>0)spans.push([center-width,center+width]);
    if(!spans.length){const p=oldOutlines.flat().find(p=>p.z===z);spans.push([p.x,p.x]);}
    left.push({x:Math.min(...spans.map(p=>p[0])),z});right.push({x:Math.max(...spans.map(p=>p[1])),z});
  }
  const points=[...left,...right.reverse()];
  return points.filter((p,i)=>Math.hypot(p.x-points[(i+points.length-1)%points.length].x,p.z-points[(i+points.length-1)%points.length].z)>1e-8);
}
function* planSouthBorder(shrubs,trees,freePlant,outline) {
  const selected=shrubs.filter(p=>['shrub','groundcover','flower','grass'].includes(p.kind)&&
    (Math.hypot((p.x+10.5)/3,(p.z-20)/7.5)<1||Math.hypot((p.x+9)/4,(p.z-36)/6)<1));
  const expected={shrub:33,groundcover:43,flower:25,grass:7},staged=[],random=rng('south-border-layout-v1');
  if(selected.length!==108||Object.entries(expected).some(([kind,n])=>selected.filter(p=>p.kind===kind).length!==n))return null;
  const candidates=[];
  for(let z=13;z<42;z+=.31)for(let x=-13.5;x< -5;x+=.31) {
    const px=x+random.float(-.10,.10),pz=z+random.float(-.10,.10),c=southBorderContour(px,pz,outline);
    if(!c.inside||c.distance<.51)continue;
    const edge=southBorderInterval(outline,pz);
    candidates.push({x:px,z:pz,distance:c.distance,front:edge[1]-px,noise:random.next()});
  }
  function safe(p,r) {
    if(p.distance<r||!freePlant(p.x,p.z,r)||trees.some(t=>Math.hypot(p.x-t.x,p.z-t.z)<.65+r))return false;
    const dx=p.x+14,dz=p.z-20,u=Math.cos(1.5)*dx-Math.sin(1.5)*dz,v=Math.sin(1.5)*dx+Math.cos(1.5)*dz;
    return !(Math.abs(u)<1.95+r&&v> -1.25-r&&v<.58+r);
  }
  function* place(records,kind,lobe=null) {
    for(const plant of records) {
      yield '正在布置庭院与种植区域…';
      const r=kind==='shrub'?plant.radius*1.06:kind==='grass'?.62:.51;
      let best=null,bestScore=Infinity;
      for(const point of candidates) {
        if(!safe(point,r))continue;
        const q=lobe?Math.hypot((point.x-lobe[0])/lobe[2],(point.z-lobe[1])/lobe[3]):0;
        if(staged.some(s=>Math.hypot(s.x-point.x,s.z-point.z)<(kind==='shrub'&&s.kind==='shrub'?.82:.66)*(plant.radius+s.radius)))continue;
        const targetFront=kind==='groundcover'?.72:kind==='flower'?1.45:kind==='grass'?2.3:2.8+(plant.height-.6);
        const score=lobe?q*.7+Math.abs(point.front-targetFront)*.4+point.noise*.22:
          Math.abs(point.front-targetFront)*.65+point.noise*.3+staged.filter(s=>s.kind===kind).reduce((n,s)=>n+Math.exp(-Math.hypot(s.x-point.x,s.z-point.z)/1.2),0);
        if(score<bestScore){bestScore=score;best=point;}
      }
      if(!best)return false;
      staged.push({...plant,x:best.x,z:best.z,shapeSeed:plant.shapeSeed??`campus-plant:${plant.kind}:${plant.x}:${plant.z}`,
        southBorderOrigin:[plant.x,plant.z],southBorderDetail:!!plant.detail,original:plant});
    }
    return true;
  }
  const bushes=selected.filter(p=>p.kind==='shrub').sort((a,b)=>b.radius-a.radius),north=[],south=[];
  for(let i=0;i<bushes.length;i++)(Math.floor((i+1)*19/33)>Math.floor(i*19/33)?north:south).push(bushes[i]);
  if(!(yield* place(north,'shrub',[-11.4,23.5,1.35,6.4]))||!(yield* place(south,'shrub',[-10.5,32.8,1.6,6.2]))||
     !(yield* place(selected.filter(p=>p.kind==='groundcover'),'groundcover'))||!(yield* place(selected.filter(p=>p.kind==='flower'),'flower'))||!(yield* place(selected.filter(p=>p.kind==='grass'),'grass')))return null;
  return {moves:staged,selected};
}

// One accepted-site southeast sample. These two polygons have two proper crossings.
function southeastBoundary(first,second,subtract=false) {
  const area=points=>points.reduce((n,p,i)=>{const q=points[(i+1)%points.length];return n+p.x*q.z-p.z*q.x;},0)/2;
  const ring=points=>area(points)>0?points.map(p=>({...p})):points.toReversed().map(p=>({...p}));
  const a=ring(first),b=ring(second),hits=[];
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++){
    const p=a[i],q=a[(i+1)%a.length],r=b[j],s=b[(j+1)%b.length],ux=q.x-p.x,uz=q.z-p.z,vx=s.x-r.x,vz=s.z-r.z,den=ux*vz-uz*vx;
    if(Math.abs(den)<1e-12)continue;
    const t=((r.x-p.x)*vz-(r.z-p.z)*vx)/den,u=((r.x-p.x)*uz-(r.z-p.z)*ux)/den;
    if(t<0||t>1||u<0||u>1)continue;
    if(t<1e-9||t>1-1e-9||u<1e-9||u>1-1e-9)throw Error('Southeast sample tangent/vertex boundary');
    hits.push({i,j,t,u,p:{x:p.x+ux*t,z:p.z+uz*t}});
  }
  if(!hits.length&&subtract&&!b.some(p=>southBorderContour(p.x,p.z,a).inside)&&!a.some(p=>southBorderContour(p.x,p.z,b).inside))return first;
  if(hits.length!==2)throw Error(`Southeast sample expected2 crossings, got${hits.length}`);
  function arcs(poly,edge,fraction,other){
    const order=hits.toSorted((p,q)=>p[edge]+p[fraction]-q[edge]-q[fraction]);
    return order.map((from,k)=>{
      const to=order[(k+1)%order.length],points=[from.p];
      if(from[edge]!==to[edge]||from[fraction]>to[fraction])for(let n=1;n<=poly.length;n++){const i=(from[edge]+n)%poly.length;points.push(poly[i]);if(i===to[edge])break;}
      points.push(to.p);const m=Math.floor((points.length-1)/2),p=points[m],q=points[m+1];
      return {points,inside:southBorderContour((p.x+q.x)/2,(p.z+q.z)/2,other).inside};
    });
  }
  const left=arcs(a,'i','t',b).filter(p=>!p.inside),right=arcs(b,'j','u',a).filter(p=>subtract?p.inside:!p.inside);
  if(left.length!==1||right.length!==1)throw Error('Southeast sample boundary connectivity changed');
  const l=left[0].points,r=subtract?right[0].points.toReversed():right[0].points;
  if(Math.hypot(l.at(-1).x-r[0].x,l.at(-1).z-r[0].z)>1e-7||Math.hypot(r.at(-1).x-l[0].x,r.at(-1).z-l[0].z)>1e-7)throw Error('Southeast sample open boundary');
  const result=[...l.slice(0,-1),...r.slice(0,-1)];if(area(result)<1)throw Error('Southeast sample nonpositive area');return result;
}
const SOUTHEAST_EXTENSION=[[7.6,31.4],[10.8,31.4],[12.9,32],[12.5,34],[10.9,37],[10.5,39.3],[9.8,40.6],[6.9,40.6],[6.9,36],[7.6,33]].map(([x,z])=>({x,z}));
const SOUTHEAST_MATURE=[{"x":9.150903144429902,"z":37.85783887110426,"height":1.6792535438667984,"radius":1.121231233922299,"ground":-0.007,"kind":"matureShrub","shapeSeed":"south-garden-clearing-v1:mature:26","gardenGroup":4},{"x":9.75640416819602,"z":36.265853654372115,"height":1.458418811066076,"radius":0.9924109731218778,"ground":-0.007,"kind":"matureShrub","shapeSeed":"south-garden-clearing-v1:mature:27","gardenGroup":4},{"x":10.020665311536282,"z":34.5030797999609,"height":1.8648056063335388,"radius":1.2294699370278976,"ground":-0.007,"kind":"matureShrub","shapeSeed":"south-garden-clearing-v1:mature:28","gardenGroup":4},{"x":8.24452999137342,"z":36.47876379136004,"height":1.6744804097339512,"radius":1.118446905678138,"ground":-0.007,"kind":"matureShrub","shapeSeed":"south-garden-clearing-v1:mature:29","gardenGroup":4},{"x":8.798093634555116,"z":39.362234551385136,"height":1.3600544014014304,"radius":0.9350317341508344,"ground":-0.007,"kind":"matureShrub","shapeSeed":"south-garden-clearing-v1:mature:30","gardenGroup":4},{"x":9.398847074473741,"z":32.92233199703979,"height":1.5863566997926681,"radius":1.0670414082123898,"ground":-0.007,"kind":"matureShrub","shapeSeed":"south-garden-clearing-v1:mature:31","gardenGroup":4}];
function planSoutheastSample(outline,existing,trees,freePlant) {
  const random=rng('southeast-sample-low-v1'),staged=SOUTHEAST_MATURE.map(p=>({...p})),points=[];
  const outer=[[12.9,32],[12.5,34],[10.9,37],[10.5,39.3],[9.8,40.6]].map(([x,z])=>({x,z}));
  function lineDistance(x,z,line){let distance=Infinity;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));}return distance;}
  function benchDistance(x,z){const dx=x-13,dz=z-39,u=Math.cos(-1.1)*dx-Math.sin(-1.1)*dz,v=Math.sin(-1.1)*dx+Math.cos(-1.1)*dz,qx=Math.abs(u)-1.95,qz=Math.abs(v+.335)-.915;return Math.hypot(Math.max(qx,0),Math.max(qz,0))+Math.min(Math.max(qx,qz),0);}
  function safe(p,r){const edge=southBorderContour(p.x,p.z,outline);return edge.inside&&edge.distance>=r+.025&&freePlant(p.x,p.z,r+.25)&&benchDistance(p.x,p.z)>=r&&!trees.some(t=>Math.hypot(p.x-t.x,p.z-t.z)<r+.65)&&!(p.x-r<5.5&&p.z-r<42&&p.z+r>17);}
  for(const p of staged)if(!safe(p,p.radius))throw Error(`Southeast fixed mature does not fit ${p.shapeSeed}`);
  for(let z=31.5;z<=40.3;z+=.23)for(let x=7;x<=12.7;x+=.23){const p={x:x+random.float(-.035,.035),z:z+random.float(-.035,.035),noise:random.next()};if(!southBorderContour(p.x,p.z,SOUTHEAST_EXTENSION).inside)continue;p.outer=lineDistance(p.x,p.z,outer);points.push(p);}
  const groups=[
    {name:'middle-north',count:5,height:[.6,.9],radius:[.6,.75],center:[10.2,34.2],spread:[1.6,2.2],depth:[1.25,2.6]},
    {name:'middle-south',count:3,height:[.6,.9],radius:[.6,.75],center:[8.8,37.4],spread:[1.6,2.0],depth:[1.2,2.6]},
    {name:'outer-north',count:10,height:[.30,.48],radius:[.42,.55],center:[11.3,33.2],spread:[1.6,1.8],depth:[.5,1.3]},
    {name:'outer-middle',count:9,height:[.30,.48],radius:[.42,.55],center:[10.4,35.9],spread:[1.4,1.7],depth:[.5,1.3]},
    {name:'outer-south',count:7,height:[.30,.48],radius:[.42,.55],center:[9.6,38.6],spread:[1.4,1.6],depth:[.5,1.3]},
    {name:'inner-north',count:6,height:[.30,.48],radius:[.42,.55],center:[8.0,33.7],spread:[1.3,1.8],depth:[2.0,4.5]},
    {name:'inner-south',count:4,height:[.30,.48],radius:[.42,.55],center:[7.7,37.7],spread:[1.2,1.8],depth:[2.0,4.5]}
  ];
  for(const group of groups)for(let n=0;n<group.count;n++){
    const height=random.float(...group.height),radius=random.float(...group.radius),r=radius*1.06;let best=null,score=Infinity;
    for(const p of points){
      if(!safe(p,r)||existing.some(q=>q.kind==='shrub'&&Math.hypot(p.x-q.x,p.z-q.z)<.22))continue;
      if(staged.some(q=>Math.hypot(p.x-q.x,p.z-q.z)<(q.kind==='matureShrub'?.28:.60*(q.radius+radius))))continue;
      const q=Math.hypot((p.x-group.center[0])/group.spread[0],(p.z-group.center[1])/group.spread[1]);if(q>1.6)continue;
      const depth=Math.max(group.depth[0]-p.outer,p.outer-group.depth[1],0),crowding=staged.filter(q=>q.sampleGroup===group.name).reduce((s,q)=>s+Math.exp(-Math.hypot(p.x-q.x,p.z-q.z)/.75),0);
      const value=q*.30+depth*1.4+crowding*.40+p.noise*.15;
      if(value<score){best=p;score=value;}
    }
    if(!best)throw Error(`Southeast ${group.name} capacity ${n}/${group.count}`);
    staged.push({x:best.x,z:best.z,height,radius,ground:-.007,kind:'shrub',skipExtraGrowth:true,shapeSeed:`southeast-sample-low-v1:${staged.length-6}`,sampleGroup:group.name});
  }
  return {plants:staged,groups};
}

// Fixed south-border geometry only: two simple rings with exactly four proper crossings.
// This is not a general polygon boolean. Any changed topology aborts planning before commit.
function cutSouthBorderLawn(garden, soil) {
  const eps=1e-9, cross=(a,b)=>a.x*b.z-a.z*b.x;
  const sub=(a,b)=>({x:a.x-b.x,z:a.z-b.z});
  const mix=(a,b,t)=>({x:a.x+(b.x-a.x)*t,z:a.z+(b.z-a.z)*t});
  const area=p=>p.reduce((n,a,i)=>n+cross(a,p[(i+1)%p.length]),0)/2;
  const check=(ok,message)=>{if(!ok)throw new Error(`South border surface: ${message}`);};
  function ring(input) {
    const out=[];
    for(const p of input) {
      check(Number.isFinite(p.x)&&Number.isFinite(p.z),'nonfinite contour');
      if(!out.length||Math.hypot(p.x-out.at(-1).x,p.z-out.at(-1).z)>eps)out.push({...p});
    }
    if(out.length>1&&Math.hypot(out[0].x-out.at(-1).x,out[0].z-out.at(-1).z)<eps)out.pop();
    check(out.length>=3&&Math.abs(area(out))>1,'empty contour');
    if(area(out)<0)out.reverse();
    return out;
  }
  const a=ring(garden),b=ring(soil),hits=[];
  for(let i=0;i<a.length;i++)for(let j=0;j<b.length;j++) {
    const u=sub(a[(i+1)%a.length],a[i]),v=sub(b[(j+1)%b.length],b[j]),w=sub(b[j],a[i]),den=cross(u,v);
    if(Math.abs(den)<1e-12)continue;
    const t=cross(w,v)/den,s=cross(w,u)/den;
    if(t<0||t>1||s<0||s>1)continue;
    check(t>eps&&t<1-eps&&s>eps&&s<1-eps,'vertex/tangent crossing');
    hits.push({i,j,t,s,p:mix(a[i],a[(i+1)%a.length],t)});
  }
  check(hits.length===4,'expected four proper crossings');
  function inside(p,poly) {
    let result=false;
    for(let i=0,j=poly.length-1;i<poly.length;j=i++) {
      const u=poly[j],v=poly[i];
      if((u.z>p.z)!==(v.z>p.z)&&p.x<(v.x-u.x)*(p.z-u.z)/(v.z-u.z)+u.x)result=!result;
    }
    return result;
  }
  function arcs(poly,edge,fraction,other) {
    // Sorting by fractional position is essential: two crossings share one garden edge.
    const order=hits.toSorted((p,q)=>p[edge]+p[fraction]-q[edge]-q[fraction]);
    return order.map((from,k)=>{
      const to=order[(k+1)%order.length],points=[from.p];
      if(from[edge]!==to[edge]||from[fraction]>to[fraction]) {
        let i=from[edge];
        for(let guard=0;guard<poly.length;guard++) {
          i=(i+1)%poly.length;points.push(poly[i]);if(i===to[edge])break;
        }
      }
      points.push(to.p);
      const mid=Math.floor((points.length-1)/2);
      return {from,to,points,inside:inside(mix(points[mid],points[mid+1],.5),other)};
    });
  }
  const keptGarden=arcs(a,'i','t',b).filter(r=>!r.inside),keptSoil=arcs(b,'j','s',a).filter(r=>r.inside);
  check(keptGarden.length===2&&keptSoil.length===2,'expected two exterior grass components');
  const lawnOutlines=keptGarden.map(g=>{
    const s=keptSoil.find(s=>s.from===g.from&&s.to===g.to);
    check(!!s,'unexpected boundary connectivity');
    const points=[...g.points.slice(0,-1),...s.points.toReversed().slice(0,-1)];
    check(area(points)>1,'invalid grass loop');return points;
  });
  // Share the exact intersection points with the soil edge, rather than leaving T-junctions.
  const soilOutline=b.flatMap((p,j)=>[p,...hits.filter(h=>h.j===j).sort((x,y)=>x.s-y.s).map(h=>h.p)]);
  return {lawnOutlines,soilOutline};
}

function filterSouthBorderGrass(group,prefix,outline,oldOutlines,refined=false) {
  // Grass clipping only needs polygon membership, not distance to every edge.
  const contains=refined?(p,points)=>{
    let inside=false;
    for(let i=0,j=points.length-1;i<points.length;j=i++) {
      const a=points[j],b=points[i];
      if((a.z>p.z)!==(b.z>p.z)&&p.x<(b.x-a.x)*(p.z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }
    return inside;
  }:(p,points)=>southBorderContour(p.x,p.z,points).inside;
  const added=p=>contains(p,outline)&&!oldOutlines.some(o=>contains(p,o));
  const bounds=new THREE.Box2().setFromPoints(outline.map(p=>new THREE.Vector2(p.x,p.z)));
  const cutEdges=[outline,...oldOutlines].flatMap(points=>points.map((p,i)=>[p,points[(i+1)%points.length]]));
  function crosses(a,b,c,d) {
    const ux=b.x-a.x,uz=b.z-a.z,vx=d.x-c.x,vz=d.z-c.z,den=ux*vz-uz*vx;if(Math.abs(den)<1e-12)return null;
    const wx=c.x-a.x,wz=c.z-a.z,t=(wx*vz-wz*vx)/den,s=(wx*uz-wz*ux)/den;
    return t>=0&&t<=1&&s>=0&&s<=1?{x:a.x+ux*t,z:a.z+uz*t}:null;
  }
  const removed=[];
  for(const mesh of [...group.children]) {
    if(!mesh.isInstancedMesh||!mesh.name.startsWith(prefix+':'))continue;
    const positions=mesh.geometry.attributes.position,indices=mesh.geometry.index?.array??Array.from({length:positions.count},(_,i)=>i),used=[...new Set(indices)],matrix=new THREE.Matrix4(),keep=[];
    for(let i=0;i<mesh.count;i++) {
      matrix.fromArray(mesh.instanceMatrix.array,i*16);const center=new THREE.Vector2(matrix.elements[12],matrix.elements[14]);
      if(center.x<bounds.min.x-1||center.x>bounds.max.x+1||center.y<bounds.min.y-1||center.y>bounds.max.y+1){keep.push(i);continue;}
      const vertices=new Map(used.map(index=>[index,new THREE.Vector3().fromBufferAttribute(positions,index).applyMatrix4(matrix)]));
      let hit=[...vertices.values()].some(added);
      // A blade can cross a soil boundary even when both its endpoints lie outside.
      for(let t=0;!hit&&t<indices.length;t+=3)for(let k=0;!hit&&k<3;k++) {
        const a=vertices.get(indices[t+k]),b=vertices.get(indices[t+(k+1)%3]);
        for(const[c,d]of cutEdges) {
          if(Math.max(a.x,b.x)<Math.min(c.x,d.x)||Math.min(a.x,b.x)>Math.max(c.x,d.x)||Math.max(a.z,b.z)<Math.min(c.z,d.z)||Math.min(a.z,b.z)>Math.max(c.z,d.z))continue;
          const p=crosses(a,b,c,d);if(!p)continue;
          const dx=b.x-a.x,dz=b.z-a.z;
          if(added({x:p.x+dx*1e-5,z:p.z+dz*1e-5})||added({x:p.x-dx*1e-5,z:p.z-dz*1e-5})){hit=true;break;}
        }
      }
      if(hit)removed.push({mesh:mesh.name,index:i,matrix:Array.from(mesh.instanceMatrix.array.slice(i*16,i*16+16))});else keep.push(i);
    }
    if(keep.length===mesh.count)continue;
    if(!keep.length){group.remove(mesh);continue;}
    const values=new Float32Array(keep.length*16);keep.forEach((index,i)=>values.set(mesh.instanceMatrix.array.subarray(index*16,index*16+16),i*16));
    mesh.instanceMatrix=new THREE.InstancedBufferAttribute(values,16);mesh.count=keep.length;mesh.computeBoundingBox();mesh.computeBoundingSphere();
  }
  return removed;
}

export function buildLandscape() {
  return finishBuild(buildLandscapeSteps());
}

export function* buildLandscapeSteps({ refined = false } = {}) {
  const group = new THREE.Group(); group.name = 'campus-landscape';
  const b = new Builder(), random = rng('campus-site');
  const paths = [], beds = [], turfSurfaces=[], southDeferred=[], southeastDeferred=[];
  const accessCurve=new THREE.CatmullRomCurve3([[108,0,59],[135,0,59],[158,0,73],[188,0,108],[238,0,138],[350,0,151],[660,0,142],[2200,0,142]].map(p=>new THREE.Vector3(...p)),false,'centripetal');
  const accessPoints=accessCurve.getSpacedPoints(320);
  function accessDistance(x,z) {
    let nearest=Infinity;
    for(let i=0;i<accessPoints.length-1;i++) {
      const a=accessPoints[i],c=accessPoints[i+1],dx=c.x-a.x,dz=c.z-a.z;
      const t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
      nearest=Math.min(nearest,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
    }
    return nearest;
  }
  const field = woodlandGroundMask(accessDistance);
  yield '正在生成地形与地面材质…';
  const woodland = new THREE.DataTexture(field.data,field.size,field.size,THREE.RedFormat);
  woodland.minFilter=woodland.magFilter=THREE.LinearFilter;woodland.needsUpdate=true;
  const lawn = surface('#597245', 'lawn',woodland), paving = surface('#c5c2b4', 'paving');
  const asphalt = surface('#43494a', 'asphalt'), curb = surface('#b3b2a8', 'stone');
  const gravel = surface('#8a897d', 'stone'), dark = new THREE.MeshStandardMaterial({ color: '#333b3c', roughness: 0.7, metalness: 0.35 });
  const white = new THREE.MeshStandardMaterial({ color: '#e0dfcc', roughness: 0.95 });
  const timber = surface('#887158', 'wood');
  yield '正在铺设园区道路…';

  function slab(material, x, z, w, d, y = 0.03, h = 0.06) { b.box(material, w, h, d, [x, y-h/2, z]); }
  function rounded(material, x, z, w, d, radius, y, thickness = 0.08) {
    const geo = new THREE.ExtrudeGeometry(roundRect(w,d,radius), { depth: thickness, bevelEnabled: false, curveSegments: 8 });
    b.add(geo, material, mat4([x,y-thickness,z],[-Math.PI/2,0,0])); geo.dispose();
  }
  function ring(material, outerW, outerD, radius, width, y, thickness) {
    const shape=roundRect(outerW,outerD,radius), hole=roundRect(outerW-width*2,outerD-width*2,Math.max(0.1,radius-width));
    shape.holes.push(new THREE.Path(hole.getPoints(12).reverse()));
    const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled:false, curveSegments:12 });
    b.add(geo,material,mat4([0,y-thickness,4],[-Math.PI/2,0,0])); geo.dispose();
  }
  function roadCurb(w, d, radius, outer) {
    const width=0.25, left=-w/2+width/2, right=-left, north=4-d/2+width/2, south=4+d/2-width/2;
    slab(curb,0,north,w-radius*2,width,0.18,0.22);
    const half=(w-radius*2)/2;
    for (const side of [-1,1]) slab(curb,side*(half+6)/2,south,half-6,width,0.18,0.22);
    const ends=[4-d/2+radius,4+d/2-radius];
    const runs=outer ? [[ends[0],-66.6],[-59.4,54.3],[63.7,ends[1]]] : [[...ends]];
    for (const x of [left,right]) for (const [start,end] of runs) slab(curb,x,(start+end)/2,width,end-start,0.18,0.22);
    for (let i=0;i<4;i++) {
      const angle=i*Math.PI/2, cx=(i===0||i===3?1:-1)*(w/2-radius), cy=(i<2?1:-1)*(d/2-radius);
      const shape=new THREE.Shape(); shape.absarc(cx,cy,radius,angle,angle+Math.PI/2,false);
      shape.absarc(cx,cy,radius-width,angle+Math.PI/2,angle,true); shape.closePath();
      const geo=new THREE.ExtrudeGeometry(shape,{depth:0.22,bevelEnabled:false,curveSegments:10});
      b.add(geo,curb,mat4([0,-0.04,4],[-Math.PI/2,0,0])); geo.dispose();
    }
  }
  const terrainHeight=contextTerrainHeight;
  // Keep the complete road ring level, with enough outer rings for low, gradual
  // landforms rather than a distant raised platform or mountain backdrop.
  const terrainPositions=[0,-0.025,0], terrainIndices=[], segments=160;
  const radii=[160,180,205,235,270,315,370,440,530,650,800,1000,1400,2100,3400,7000];
  for(const radius of radii) for(let i=0;i<segments;i++) {
    const angle=i*TAU/segments, x=Math.cos(angle)*radius,z=Math.sin(angle)*radius;
    terrainPositions.push(x,terrainHeight(x,z),z);
  }
  for(let i=0;i<segments;i++) terrainIndices.push(0,1+(i+1)%segments,1+i);
  for(let r=0;r<radii.length-1;r++) for(let i=0;i<segments;i++) {
    const a=1+r*segments+i, next=1+r*segments+(i+1)%segments;
    terrainIndices.push(a,next,a+segments,next,next+segments,a+segments);
  }
  const terrain=new THREE.BufferGeometry(); terrain.setAttribute('position',new THREE.Float32BufferAttribute(terrainPositions,3)); terrain.setIndex(terrainIndices); terrain.computeVertexNormals();
  const terrainMesh=new THREE.Mesh(terrain,lawn); terrainMesh.receiveShadow=true; terrainMesh.name='continuous-meadow-and-low-rolling-ground'; group.add(terrainMesh);
  const contextDistricts=buildContextDistricts(terrainMesh,{refined});group.add(contextDistricts.object);
  lawn.userData.districtLanduse=contextDistricts.landuse;
  group.userData.contextDistricts=contextDistricts;
  yield;
  // Index the rendered terrain only where the approach and woodland query it.
  // Keep the original raycast path for the legacy generator.
  const queryBounds=new THREE.Box3().setFromPoints(accessPoints).expandByScalar(5);
  const groundSampler=refined?createGroundSampler([terrainMesh],[
    Math.min(CONTEXT_EXTENT.minX,queryBounds.min.x),Math.max(CONTEXT_EXTENT.maxX,queryBounds.max.x),
    Math.min(CONTEXT_EXTENT.minZ,queryBounds.min.z),Math.max(CONTEXT_EXTENT.maxZ,queryBounds.max.z),
  ]):null;
  const groundRay=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));
  function groundAt(x,z) {
    if(groundSampler)return groundSampler.heightAt(x,z)-.035;
    groundRay.ray.origin.set(x,200,z);const hit=groundRay.intersectObject(terrainMesh,false)[0];return(hit?.point.y??terrainHeight(x,z))-.035;
  }


  ring(asphalt,223,191,13.5,7,0.015,0.04);
  roadCurb(223.5,191.5,13.75,true);
  roadCurb(209,177,6.5,false);
  // A two-lane approach physically connects the ring road to the surrounding street network.
  function roadRibbon(width,offset,material,from=0,to=accessPoints.length-1,lift=0.055,skipJunction=false) {
    const positions=[],indices=[];
    for(let i=from;i<=to;i++) {
      const p=accessPoints[i],before=accessPoints[Math.max(0,i-1)],after=accessPoints[Math.min(accessPoints.length-1,i+1)];
      const tangent=after.clone().sub(before).normalize(),nx=-tangent.z,nz=tangent.x;
      for(const side of [-1,1]) {
        const x=p.x+nx*(offset+side*width/2),z=p.z+nz*(offset+side*width/2);
        positions.push(x,groundAt(x,z)+lift,z);
      }
      if(i>from&&(!skipJunction||Math.abs((p.x+accessPoints[i-1].x)*.5-CONTEXT_JUNCTION.x)>CONTEXT_JUNCTION.halfWidth)) {const j=(i-from)*2;indices.push(j-2,j-1,j,j-1,j+1,j);}
    }
    const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setIndex(indices);geometry.computeVertexNormals();b.add(geometry,material);geometry.dispose();
  }
  roadRibbon(8,0,asphalt);
  yield;
  roadRibbon(0.20,-4.1,curb,0,accessPoints.length-1,0.18,true);
  yield;
  roadRibbon(0.20,4.1,curb,0,accessPoints.length-1,0.18,true);
  yield;
  for(let i=1;i<accessPoints.length-2;i+=3) roadRibbon(0.10,0,white,i,i+1,0.064,true);
  roadRibbon(0.10,-3.6,white,1,accessPoints.length-1,0.064,true);
  roadRibbon(0.10,3.6,white,1,accessPoints.length-1,0.064,true);
  yield;
  for (const side of [-1,1]) {
    for (let z=-73;z<79;z+=11) slab(white,side*108,z,0.12,4,0.021,0.005);
    for (let x=14;x<95;x+=11) for(const z of [-88,96]) slab(white,side*x,z,4,0.12,0.021,0.005);
    for(let i=0;i<7;i++) slab(white,side*(0.4+i*0.72),96,0.4,6.6,0.024,0.006);
    slab(asphalt,side*119,-2,12,124,0.016);
    for(const z of [-63,59]) slab(asphalt,side*115,z,14,7,0.017);
    for(let z=-56;z<=51;z+=2.8) slab(white,side*115.5,z,5,0.09,0.025,0.005);
    slab(white,side*113,-2,0.09,112,0.025,0.005);
  }
  const mulch=surface('#504934','soil');
  yield '正在布置庭院与种植区域…';
  function emitPolygon(points,material,y,depth,holes=[],builder=b) {
    const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,-p.z)));
    for(const hole of holes)shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(p.x,-p.z))));
    const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:1});
    const position=geo.attributes.position;
    for(let i=0;i<position.array.length;i++)if(!Number.isFinite(position.array[i])){geo.dispose();throw Error('Invalid border surface');}
    builder.add(geo,material,mat4([0,y-depth,0],[-Math.PI/2,0,0]));geo.dispose();
  }
  function polygon(points, material, y=0.075, depth=0.08, holes=[],southRole=null) {
    if(material===paving)depth=Math.max(depth,y+.035);
    const region={points,holes,y,lawn:material===lawn};turfSurfaces.push(region);
    if(southRole){(southRole.startsWith('southeast-')?southeastDeferred:southDeferred).push({region,material,depth,role:southRole});return;}
    const shape=new THREE.Shape(points.map(p=>new THREE.Vector2(p.x,-p.z)));
    for(const hole of holes) shape.holes.push(new THREE.Path(hole.map(p=>new THREE.Vector2(p.x,-p.z))));
    const geo=new THREE.ExtrudeGeometry(shape,{depth,bevelEnabled:false,curveSegments:1});
    b.add(geo,material,mat4([0,y-depth,0],[-Math.PI/2,0,0]));geo.dispose();
  }
  function segmentDistance(x,z,a,c) {
    const dx=c.x-a.x,dz=c.z-a.z,den=dx*dx+dz*dz;
    const t=den?THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/den,0,1):0;
    return Math.hypot(x-a.x-dx*t,z-a.z-dz*t);
  }
  function pathDistance(x,z) {
    let d=Infinity;
    for(const path of paths) for(let i=1;i<path.points.length;i++) d=Math.min(d,segmentDistance(x,z,path.points[i-1],path.points[i])-path.width/2);
    return d;
  }
  function walkway(points,width=4,closed=false,name='connector') {
    const pts=points.map(p=>({x:p.x??p[0],z:p.z??p[1]})),left=[],right=[];
    if(closed) pts.push({...pts[0]});
    for(let i=0;i<pts.length;i++) {
      const a=pts[i?i-1:closed?pts.length-2:0],c=pts[i===pts.length-1?closed?1:i:i+1];
      const len=Math.hypot(c.x-a.x,c.z-a.z),nx=-(c.z-a.z)/len,nz=(c.x-a.x)/len;
      left.push({x:pts[i].x+nx*width/2,z:pts[i].z+nz*width/2});
      right.push({x:pts[i].x-nx*width/2,z:pts[i].z-nz*width/2});
    }
    if(closed) polygon(right.slice(0,-1),paving,0.075,0.09,[left.slice(0,-1)]);
    else polygon([...left,...right.reverse()],paving);
    const path={name,points:pts,width,closed};paths.push(path);return path;
  }
  function island(c,rx,rz,material,phase=0,southRole=null) {
    const points=Array.from({length:64},(_,i)=>{const a=i*TAU/64,k=1+0.018*Math.sin(a*3+phase)+0.012*Math.sin(a*5-phase);return{x:c.x+Math.cos(a)*rx*k,z:c.z+Math.sin(a)*rz*k};});
    polygon(points,material,-0.007,0.035,[],southRole);return points;
  }
  const courtPaths=COURTYARDS.map(c=>walkway(Array.from({length:96},(_,i)=>{
    const a=i*TAU/96,ripple=0.22*Math.sin(a*3)+0.12*Math.sin(a*5+0.6);
    return{x:c.x+Math.cos(a)*(c.walkRx+ripple),z:c.z+Math.sin(a)*(c.walkRz+ripple)};
  }),c.walkWidth,true,c.id));
  const grove=COURTYARDS.find(c=>c.id==='grove'),garden=COURTYARDS.find(c=>c.id==='garden');
  const groveSoilOutline=island(grove,grove.rx,grove.rz,mulch);
  island(garden,garden.rx,garden.rz,lawn,1,'garden');
  walkway([[0,grove.z+grove.walkRz-1],[0,garden.z-garden.walkRz+1]],4,false,'courtyard-link');
  walkway([[0,51],[0,92.4]],4.8,false,'south-approach');
  walkway([[0,99.6],[0,116]],4.8,false,'gate-approach');
  for(const building of BUILDINGS) {
    const entry=entrancePoint(building,building.arcade?-2.4:building.id==='gallery'?-3:0.15),court=building.z<0?courtPaths[0]:courtPaths[1];
    const nearest=court.points.reduce((best,p)=>Math.hypot(p.x-entry.x,p.z-entry.z)<Math.hypot(best.x-entry.x,best.z-entry.z)?p:best);
    walkway([entry,nearest],building.kind==='headquarters'?6:4,false,`entry-${building.id}`);
  }
  walkway([[-31.8,54.3],[-26.5,54.3]],2.2,false,'commons-bicycles');
  // Service access joins the two courts through the gap between the office wings.
  walkway([[-99,4],[99,4]],3.2,false,'cross-garden');
  for(const side of [-1,1]) {
    walkway([[side*99,-78],[side*99,83]],2.6,false,'perimeter');
    walkway([[side*49,-76],[side*49,82],[side*4,82]],2.4,false,'rear-access');
  }
  function insideBuilding(x,z,margin=0) { return BUILDINGS.some(building=>{const f=footprint(building,margin);return x>f.minX&&x<f.maxX&&z>f.minZ&&z<f.maxZ;}); }
  function freePlant(x,z,margin=0.3) {return !insideBuilding(x,z,margin)&&pathDistance(x,z)>margin&&accessDistance(x,z)>5+margin;}
  function rho(x,z,c,rx=c.rx,rz=c.rz) {return Math.hypot((x-c.x)/rx,(z-c.z)/rz);}
  function bed(x,z,rx,rz,kind='mixed',phase=0) {
    const record={x,z,rx,rz,kind};beds.push(record);island(record,rx,rz,mulch,phase,((x===-10.5&&z===20)||(x===-9&&z===36))?'bed':(x===8.4&&z===42)?'southeast-bed':null);return record;
  }
  // Connected, layered borders leave the sunny centre as a single usable lawn.
  for(const [x,z,rx,rz] of [[-10.5,20,3.0,7.5],[-9,36,4.0,6.0],[8.4,42,3.8,3.0],[10.3,17,2.5,3.2]]) bed(x,z,rx,rz,'perennial',z);
  for(const building of BUILDINGS) {
    if(building.kind==='office') {
      const backX=building.x+Math.sign(building.x)*(building.w/2+2.0);
      bed(backX,building.z,1.35,building.d/2-2,'shrub',building.z);
    }
  }
  for(const side of [-1,1]) for(const z of [-57,-5,56,86]) bed(side*(z===86?19:62),z,side<0?5:4.5,5,'shrub',z);
  const trees=[],shrubs=[];
  function tree(x,z,height=12,radius=4.5,hero=false) {
    if(!freePlant(x,z,1.2)||insideBuilding(x,z,radius+0.6)||Math.abs(x)>100||z< -80||z>89)return false;
    if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<(t.radius+radius)*0.82))return false;
    trees.push({x,z,height,radius,hero,ground:-0.012,clearance:3});return true;
  }
  for(const [x,z] of [[-7,-32],[6,-33],[-8,-19],[4,-21],[-5,-8],[7,-10]]) tree(x,z,random.float(12,14.5),random.float(4.6,5.3),true);
  for(const [x,z] of [[-9,19],[-8,38],[9,41]]) tree(x,z,random.float(10.5,12),random.float(4.1,4.7),true);
  for(const [x,z] of [[-53,-54],[53,-53],[-54,-28],[54,-27],[-56,29],[56,33],[-47,57],[48,59],[-16,85],[17,86]]) tree(x,z,random.float(11,14),random.float(4.3,5.1),trees.filter(t=>t.hero).length<14);
  for(let i=0;i<1400&&trees.length<64;i++) {
    const x=random.float(-92,92),z=random.float(-78,87);
    if(Math.abs(x)<22&&z>-44&&z<55)continue;
    tree(x,z,random.float(10,14),random.float(3.9,5.5));
  }
  function plant(x,z,height,kind='shrub',radius=height*0.75) {
    if(!freePlant(x,z,Math.min(radius*0.65,0.55)))return;
    if(trees.some(t=>Math.hypot(t.x-x,t.z-z)<0.65))return;
    shrubs.push({x,z,height,radius,kind,ground:-0.005});
  }
  const plantRng=rng('courtyard-planting');
  // Grove floor: broad evergreen masses under mature crowns, lower edges facing the walk.
  for(let x=-12;x<=12;x+=1.35) for(let z=-38;z<=-6;z+=1.35) {
    const px=x+plantRng.float(-0.28,0.28),pz=z+plantRng.float(-0.28,0.28),r=rho(px,pz,grove);
    if(r>0.96||plantRng.next()<0.12)continue;
    const kind=r>0.8?'groundcover':'shrub';plant(px,pz,kind==='shrub'?plantRng.float(0.52,0.98):plantRng.float(0.18,0.33),kind,kind==='shrub'?plantRng.float(0.65,0.9):0.55);
  }
  for(const area of beds) for(let x=area.x-area.rx;x<area.x+area.rx;x+=area.kind==='shrub'?1.45:1.05) for(let z=area.z-area.rz;z<area.z+area.rz;z+=area.kind==='shrub'?1.45:1.05) {
    const px=x+plantRng.float(-0.23,0.23),pz=z+plantRng.float(-0.23,0.23),r=rho(px,pz,area);
    if(r>0.94)continue;
    const field=fbm2(px*0.27,pz*0.27,2,44);
    const kind=area.kind==='shrub'?'shrub':r>0.72?'groundcover':field>0.58?'grass':field<0.43?'flower':'shrub';
    const height=kind==='shrub'?plantRng.float(0.6,1.15):kind==='grass'?plantRng.float(0.55,0.85):kind==='flower'?plantRng.float(0.4,0.65):plantRng.float(0.18,0.32);
    plant(px,pz,height,kind,kind==='shrub'?plantRng.float(0.6,0.85):0.48);
  }
  // Short turf is restricted to the lawn edges, where it changes the silhouette at walking height.
  for(const court of COURTYARDS) for(let i=0;i<900;i++) {
    const a=plantRng.float(0,TAU),r=plantRng.float(0.975,1.035),x=court.x+Math.cos(a)*court.rx*r,z=court.z+Math.sin(a)*court.rz*r;
    if(court.id==='garden'&&beds.some(b=>rho(x,z,b)<1.03))continue;
    plant(x,z,plantRng.float(0.035,0.07),'shortGrass',0.10);
  }
  // A sparse short turf canopy supplies grazing-angle relief without carpeting the whole site.
  const turfRng=rng('garden-mown-turf');
  for(let i=0;i<2900;i++) {
    const[dx,dz]=turfRng.disc(),x=garden.x+dx*garden.rx*.96,z=garden.z+dz*garden.rz*.96;
    if(beds.some(b=>rho(x,z,b)<1.06))continue;
    plant(x,z,turfRng.float(.025,.055),'shortGrass',.10);
  }
  for(const t of trees) island(t,0.65,0.62,mulch,t.x,((t.x===-9&&t.z===19)||(t.x===-8&&t.z===38))?'tree':(t.x===9&&t.z===41)?'southeast-tree':null);
  // Benches are small destinations facing the garden; seat height is 45 cm above paving.
  function bench(x,z,yaw=0) {
    const local=new Builder();
    for(let i=0;i<5;i++)local.box(timber,2.4,0.055,0.085,[0,0.52,-0.22+i*0.11],undefined,0.015);
    for(const dx of [-0.85,0.85])local.box(dark,0.08,0.43,0.43,[dx,0.29,0]);
    for(let i=0;i<3;i++)local.box(timber,2.4,0.08,0.055,[0,0.76+i*0.1,0.27],undefined,0.012);
    for(const dx of [-0.85,0.85])local.box(dark,0.055,0.84,0.055,[dx,0.5,0.27]);
    b.addBuilder(local,mat4([x,0,z],[0,yaw,0]));
  }
  for(const [x,z,yaw] of [[-13,-31,1.1],[12,-11,-1.1],[-14,20,1.5],[13,39,-1.1],[0,52,Math.PI]])bench(x,z,yaw);
  for(const court of COURTYARDS) for(let i=0;i<8;i++) {
    const a=(i+0.3)*TAU/8,x=court.x+Math.cos(a)*(court.walkRx+2.5),z=court.z+Math.sin(a)*(court.walkRz+2.5);
    if(insideBuilding(x,z,0.5)||pathDistance(x,z)<0.2)continue;
    b.cyl(dark,0.045,0.055,0.65,[x,0.325,z],undefined,8);b.box(white,0.09,0.08,0.09,[x,0.59,z]);
  }
  const context=planContextWoodland(accessDistance,groundAt),contextTrees=context.trees;
  yield;
  shrubs.push(...context.shrubs);
  for(const side of [-1,1]) for(let z=-66;z<85;z+=30) {
    b.cyl(dark,0.065,0.11,5.8,[side*102.3,2.9,z],undefined,10);
    b.box(dark,1.1,0.09,0.28,[side*101.9,5.8,z]);b.box(white,0.8,0.025,0.19,[side*101.83,5.74,z]);
  }
  const signCanvas=document.createElement('canvas');signCanvas.width=1024;signCanvas.height=256;
  const ctx=signCanvas.getContext('2d');ctx.fillStyle='#deddd4';ctx.fillRect(0,0,1024,256);
  ctx.fillStyle='#343d3d';ctx.font='500 75px sans-serif';ctx.fillText('澄境科技园',62,116);
  ctx.font='26px sans-serif';ctx.fillStyle='#6c7772';ctx.fillText('CHENGJING  ·  INNOVATION CAMPUS',68,177);
  const signMap=new THREE.CanvasTexture(signCanvas);signMap.colorSpace=THREE.SRGBColorSpace;
  b.box(curb,7.5,1.8,0.45,[15,0.9,110]);
  const sign=new THREE.Mesh(new THREE.PlaneGeometry(7.25,1.65),new THREE.MeshStandardMaterial({map:signMap,roughness:0.9}));
  sign.position.set(15,0.93,110.231);group.add(sign);
  const originalTurfSurfaces=turfSurfaces.slice();let southBorder=null,southeastSample=null;
  markDetailedShrubs(shrubs);
  try {
    const oldOutlines=southDeferred.filter(s=>s.role==='bed').map(s=>s.region.points);
    const outline=southBorderOutline(oldOutlines),plan=yield* planSouthBorder(shrubs,trees,freePlant,outline);
    if(!plan)throw Error('All108 plants did not fit');
    const cut=cutSouthBorderLawn(southDeferred.find(s=>s.role==='garden').region.points,outline),difference={lawns:cut.lawnOutlines,soil:cut.soilOutline};
    let southeastStage=null;
    try {
      const oldBed=southeastDeferred.find(s=>s.role==='southeast-bed').region.points;
      const outline=southeastBoundary(oldBed,SOUTHEAST_EXTENSION),newLawns=difference.lawns.map(p=>southeastBoundary(p,outline,true));
      if(!southeastDeferred.filter(s=>s.role==='southeast-tree').every(s=>s.region.points.every(p=>southBorderContour(p.x,p.z,outline).inside)))throw Error('Southeast tree-circle not contained by union');
      const additions=planSoutheastSample(outline,shrubs,trees,freePlant).plants;
      yield;
      markDetailedShrubs(additions);
      const mature=additions.filter(p=>p.kind==='matureShrub'),plans=stageMatureBorder(mature);
      for(let i=0;i<mature.length;i++)mature[i].maturePlan=plans[i];
      // Renew the two old shrubs occupied by this sample, after the full planting has staged.
      const replacementRecords=[{"x":8.639229387049564,"z":39.94239871850703,"height":0.7742429826525039,"radius":0.747939836315345,"kind":"shrub","ground":-0.005,"detail":true},{"x":9.771877899565736,"z":40.15790835819673,"height":0.8138215403887443,"radius":0.7078952862299047,"kind":"shrub","ground":-0.005,"detail":true}];
      const replaced=replacementRecords.map(expected=>{
        const matches=shrubs.filter(p=>Object.entries(expected).every(([key,value])=>p[key]===value));
        if(matches.length!==1)throw Error('Southeast renewal target changed');
        return matches[0];
      });
      const builder=new Builder(),surfaces=[];
      for(const points of newLawns){emitPolygon(points,lawn,-.007,.035,[],builder);surfaces.push({points,holes:[],y:-.007,lawn:true});}
      emitPolygon(difference.soil,mulch,-.007,.035,[],builder);surfaces.push({points:difference.soil,holes:[],y:-.007,lawn:false});
      emitPolygon(outline,mulch,-.007,.035,[],builder);surfaces.push({points:outline,holes:[],y:-.007,lawn:false});
      southeastStage={builder,surfaces,additions,outline,oldBed,replaced};
    }catch(error){console.warn('[campus] Southeast sample unchanged:',error.message);}
    const stagedBuilder=southeastStage?.builder??new Builder(),regions=southeastStage?.surfaces??[];
    if(!southeastStage)for(const points of difference.lawns){emitPolygon(points,lawn,-.007,.035,[],stagedBuilder);regions.push({points,holes:[],y:-.007,lawn:true});}
    if(!southeastStage){emitPolygon(difference.soil,mulch,-.007,.035,[],stagedBuilder);regions.push({points:difference.soil,holes:[],y:-.007,lawn:false});}
    // No plant, surface or sampler changes are committed before the complete layout and geometry succeed.
    b.addBuilder(stagedBuilder);
    for(const entry of southDeferred)turfSurfaces.splice(turfSurfaces.indexOf(entry.region),1);turfSurfaces.push(...regions);
    for(const move of plan.moves){const{original,...record}=move;Object.assign(original,record);}
    if(southeastStage){
      for(const entry of southeastDeferred)turfSurfaces.splice(turfSurfaces.indexOf(entry.region),1);
      for(const plant of southeastStage.replaced)shrubs.splice(shrubs.indexOf(plant),1);
      shrubs.push(...southeastStage.additions);
      southeastSample={outline:southeastStage.outline,oldBed:southeastStage.oldBed,plants:50,matureShrubs:6,replaced2:southeastStage.replaced.map(({x,z,height,radius,kind})=>({x,z,height,radius,kind}))};
    }
    southBorder={outline:difference.soil,oldOutlines,moves:plan.moves};
  }catch(error){console.warn('[campus] South border unchanged:',error.message);}
  if(!southBorder)for(const entry of southDeferred)emitPolygon(entry.region.points,entry.material,entry.region.y,entry.depth,entry.region.holes);
  if(!southeastSample)for(const entry of southeastDeferred)emitPolygon(entry.region.points,entry.material,entry.region.y,entry.depth,entry.region.holes);
  group.add(b.build({name:'campus-site',castShadow:true,receiveShadow:true}));
  if(!planNorthGrove(shrubs,trees,freePlant,groveSoilOutline))console.warn('[campus] North grove layout did not fit; retaining original planting.');
  yield;
  markDetailedShrubs(shrubs);
  if(southBorder)for(const move of southBorder.moves)if(move.original.kind==='shrub')move.original.detail=move.southBorderDetail;
  const vegetation=yield* buildVegetationSteps(trees,contextTrees,shrubs,contextDistricts.trees,{refined});group.add(vegetation);
  group.userData.matureShrubs=vegetation.userData.matureShrubs??[];
  const sampleTurfSurface=createTurfSurfaceSampler(turfSurfaces,terrainPositions[1],garden.z-garden.walkRz-garden.walkWidth/2);
  const originalTurfSampler=createTurfSurfaceSampler(originalTurfSurfaces,terrainPositions[1],garden.z-garden.walkRz-garden.walkWidth/2);
  const turf=yield* buildMownTurfSteps(southBorder?originalTurfSampler:sampleTurfSurface,lawn.userData.turfMap);group.add(turf);
  if(southBorder){
    const short=filterSouthBorderGrass(vegetation,'lawn-edge',southBorder.outline,southBorder.oldOutlines,refined);
    yield '正在整理草坪边界…';
    const mown=filterSouthBorderGrass(turf,'mown-turf',southBorder.outline,southBorder.oldOutlines,refined);
    yield;
    vegetation.userData.stats.shortGrassTufts-=short.length;vegetation.userData.stats.vegetationBatches=vegetation.children.length;
    turf.userData.stats.mownTurfTufts-=mown.length;turf.userData.stats.mownTurfBlades-=mown.length*12;turf.userData.stats.mownTurfTriangles-=mown.length*36;turf.userData.stats.mownTurfBatches=turf.children.length;
    group.userData.southBorder={plants:108,groups:[19,14],outline:southBorder.outline,shortGrassRemoved:short.length,mownTurfRemoved:mown.length};
  }
  if(southeastSample){
    const short=filterSouthBorderGrass(vegetation,'lawn-edge',southeastSample.outline,[southeastSample.oldBed],refined);
    yield;
    const mown=filterSouthBorderGrass(turf,'mown-turf',southeastSample.outline,[southeastSample.oldBed],refined);
    yield;
    vegetation.userData.stats.shortGrassTufts-=short.length;vegetation.userData.stats.vegetationBatches=vegetation.children.length;
    turf.userData.stats.mownTurfTufts-=mown.length;turf.userData.stats.mownTurfBlades-=mown.length*12;turf.userData.stats.mownTurfTriangles-=mown.length*36;turf.userData.stats.mownTurfBatches=turf.children.length;
    group.userData.southeastSample={...southeastSample,shortGrassRemoved:short.length,mownTurfRemoved:mown.length};
  }
  if(!trees.every(t=>freePlant(t.x,t.z,1.2)&&!insideBuilding(t.x,t.z,t.radius+0.6)))throw new Error('Courtyard trunk or crown intersects a building or path');
  if(!contextTrees.every(t=>accessDistance(t.x,t.z)>=5+t.crownRadius))throw new Error('Woodland crown intersects the access road');
  group.userData.courtyardPaths=paths.map(p=>({name:p.name,width:p.width,closed:p.closed,points:p.points}));
  group.userData.treePositions=trees;
  group.userData.contextTreePositions=contextTrees;
  group.userData.sampleTurfSurface=sampleTurfSurface;
  group.userData.stats={...vegetation.userData.stats,...turf.userData.stats,shrubs:shrubs.filter(s=>s.kind==='shrub'||s.kind==='matureShrub').length,plantingGroups:beds.length+1-(southBorder?1:0),paths:paths.length,accessRoadLength:Math.round(accessCurve.getLength()),contextBuildings:contextDistricts.stats.buildings,contextTriangles:contextDistricts.stats.triangles,contextBatches:contextDistricts.stats.batches};
  console.info('[campus] landscape',group.userData.stats);
  return group;
}
