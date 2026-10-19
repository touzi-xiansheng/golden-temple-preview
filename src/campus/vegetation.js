import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { instanced, mat4 } from '../core/geom.js';
import { rng } from '../core/rng.js';
import { foliageMaterial } from './foliage-material.js';
import { BARK_TILE, createBarkMaterialSteps } from './bark-material.js';
import { finishBuild } from './loading.js';
import { groundcoverLeafGeometry } from './groundcover-leaf.js';
import { shrubLeafGeometry, curvedShrubLeafGeometry } from './shrub-leaf.js';
import { captureTreeJunctions, restoreTreeJunctions, campusBarkDisplacement, closeTrunkTerminal, trunkVolume, extendPrimaryRoot } from './tree-junctions.js';
import { buildCampusBroadleaf } from './whole-tree.js';
import { COURTYARDS } from './layout.js';
import { planMatureShrub, MATURE_STEM_TAPER } from './mature-shrub.js';
import { genMaple, genCherry, BarkAccum, sampleBranch, trunkDisp, envRho, envNormal } from '../world/vegetation-tree.js';

function foliageTexture() {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const c = canvas.getContext('2d'), random = rng('campus-small-leaves');
  // Broad, overlapping small-leaf twigs fill each card; individual leaves retain their own silhouette.
  for (let branch=0;branch<15;branch++) {
    const startX=256+random.float(-35,35), startY=390+random.float(-100,100);
    const endX=random.float(30,482), endY=random.float(25,335);
    c.strokeStyle='#625c3e'; c.lineWidth=1.8;
    c.beginPath(); c.moveTo(startX,startY); c.lineTo(endX,endY); c.stroke();
    const angle=Math.atan2(endY-startY,endX-startX);
    for (let i=1;i<=9;i++) for (const side of [-1,1]) {
      const t=i/10, a=angle+side*random.float(0.45,1.0);
      const x=startX+(endX-startX)*t, y=startY+(endY-startY)*t;
      c.save(); c.translate(x+Math.cos(a)*12,y+Math.sin(a)*12); c.rotate(a+Math.PI/2);
      const green=random.int(83,128), length=random.float(13,22), width=random.float(6,10);
      c.fillStyle=`rgb(${Math.round(green*0.66)},${green},${Math.round(green*0.38)})`;
      c.beginPath(); c.moveTo(0,-length); c.bezierCurveTo(width,-length*0.45,width,length*0.45,0,length); c.bezierCurveTo(-width,length*0.45,-width,-length*0.45,0,-length); c.fill();
      c.strokeStyle='rgba(166,178,103,.45)'; c.lineWidth=0.7;
      c.beginPath(); c.moveTo(0,-length*0.8); c.lineTo(0,length*0.9); c.stroke(); c.restore();
    }
  }
  const pixels=new Uint8Array(c.getImageData(0,0,512,512).data);
  let covered=0;
  for (let i=0;i<pixels.length;i+=4) {
    if (pixels[i+3]>92) covered++;
    if (pixels[i+3]<8) { pixels[i]=67; pixels[i+1]=105; pixels[i+2]=40; }
  }
  const coverage=covered/(512*512), mips=[{data:pixels,width:512,height:512}];
  let previous=pixels, size=512;
  // Preserve the cutout coverage across mip levels instead of losing whole distant crowns.
  while(size>1) {
    const nextSize=size/2, data=new Uint8Array(nextSize*nextSize*4);
    for(let y=0;y<nextSize;y++) for(let x=0;x<nextSize;x++) {
      const dst=(y*nextSize+x)*4; let alpha=0, red=0, green=0, blue=0;
      for(let dy=0;dy<2;dy++) for(let dx=0;dx<2;dx++) {
        const src=((y*2+dy)*size+x*2+dx)*4, a=previous[src+3];
        alpha+=a; red+=previous[src]*a; green+=previous[src+1]*a; blue+=previous[src+2]*a;
      }
      data[dst]=alpha?red/alpha:67; data[dst+1]=alpha?green/alpha:105; data[dst+2]=alpha?blue/alpha:40; data[dst+3]=alpha/4;
    }
    let low=0.5, high=4;
    for(let j=0;j<10;j++) {
      const scale=(low+high)/2; let count=0;
      for(let i=3;i<data.length;i+=4) if(data[i]*scale>92) count++;
      if(count/(nextSize*nextSize)<coverage) low=scale; else high=scale;
    }
    for(let i=3;i<data.length;i+=4) data[i]=Math.min(255,data[i]*(low+high)/2);
    mips.push({data,width:nextSize,height:nextSize}); previous=data; size=nextSize;
  }
  const texture=new THREE.DataTexture(pixels,512,512,THREE.RGBAFormat);
  texture.colorSpace=THREE.SRGBColorSpace; texture.mipmaps=mips; texture.generateMipmaps=false;
  texture.minFilter=THREE.LinearMipmapLinearFilter; texture.magFilter=THREE.LinearFilter; texture.anisotropy=4; texture.needsUpdate=true;
  return texture;
}

function shrubSurface() {
  const canvas=document.createElement('canvas'),height=document.createElement('canvas');
  canvas.width=canvas.height=height.width=height.height=512;
  const c=canvas.getContext('2d'),h=height.getContext('2d'),random=rng('shrub-leaf-surface');
  c.fillStyle='#203a24';c.fillRect(0,0,512,512);h.fillStyle='#343434';h.fillRect(0,0,512,512);
  for(let i=0;i<1100;i++) {
    const x=random.float(0,512),y=random.float(0,512),angle=random.float(0,Math.PI*2),w=random.float(5,9),length=random.float(10,17);
    const tint=random.pick(['#2d4b2a','#36572f','#426334','#536f3b','#627b43']);
    for(const ox of [-512,0,512])for(const oy of [-512,0,512]) {
      if(x+ox< -20||x+ox>532||y+oy< -20||y+oy>532)continue;
      for(const ctx of [c,h]){ctx.save();ctx.translate(x+ox,y+oy);ctx.rotate(angle);}
      c.fillStyle='#1c3420';c.beginPath();c.ellipse(1,2,w+1,length+1,0,0,Math.PI*2);c.fill();
      c.fillStyle=tint;c.beginPath();c.ellipse(0,0,w,length,0,0,Math.PI*2);c.fill();
      c.strokeStyle='rgba(131,153,83,.36)';c.lineWidth=.7;c.beginPath();c.moveTo(0,-length*.85);c.lineTo(0,length*.8);c.stroke();
      h.fillStyle='#a3a3a3';h.beginPath();h.ellipse(0,0,w,length,0,0,Math.PI*2);h.fill();
      h.fillStyle='#c8c8c8';h.beginPath();h.ellipse(0,-1,w*.65,length*.8,0,0,Math.PI*2);h.fill();
      c.restore();h.restore();
    }
  }
  const map=new THREE.CanvasTexture(canvas),bumpMap=new THREE.CanvasTexture(height);map.colorSpace=THREE.SRGBColorSpace;
  for(const texture of [map,bumpMap]){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(2,1);texture.anisotropy=4;}
  return new THREE.MeshStandardMaterial({map,bumpMap,bumpScale:.0035,roughness:.94});
}

// Split by spatial cell so a courtyard camera need not draw every tree in the campus.
function* addBatches(group,geometry,material,records,name,{size=48,castShadow=true,receiveShadow=true,depth=null}={}) {
  const cells=new Map();
  for(const record of records) {
    const p=record.matrix.elements,key=`${Math.floor(p[12]/size)},${Math.floor(p[14]/size)}`;
    if(!cells.has(key))cells.set(key,[]);cells.get(key).push(record);
  }
  for(const [key,list] of cells) {
    const geo=geometry.clone();
    if(list[0].normal) {
      geo.setAttribute('canopyNormal',new THREE.InstancedBufferAttribute(new Float32Array(list.flatMap(r=>r.normal.toArray())),3));
      geo.setAttribute('canopyAO',new THREE.InstancedBufferAttribute(new Float32Array(list.map(r=>r.ao??1)),1));
    }
    const mesh=instanced(geo,material,list.map(r=>r.matrix),{castShadow,receiveShadow});
    if(list[0].color) {list.forEach((r,i)=>mesh.setColorAt(i,r.color));mesh.instanceColor.needsUpdate=true;}
    mesh.name=`${name}:${key}`;if(depth)mesh.customDepthMaterial=depth;group.add(mesh);
    yield '正在组装植物网格…';
  }
}

function flowerClusterGeometry() {
  const positions=[],colors=[],indices=[],up=new THREE.Vector3(0,1,0);
  function vertex(p,c) {const i=positions.length/3;positions.push(p.x,p.y,p.z);colors.push(...c);return i;}
  for(let flower=0;flower<5;flower++) {
    const angle=flower*2.39996,N=flower===0?up.clone():new THREE.Vector3(Math.cos(angle)*.84,.55,Math.sin(angle)*.84).normalize();
    const X=flower===0?new THREE.Vector3(1,0,0):new THREE.Vector3().crossVectors(up,N).normalize(),Y=new THREE.Vector3().crossVectors(N,X);
    const center=N.clone().multiplyScalar(flower===0?.55:.5).addScaledVector(up,.06);
    // Five separate, cupped petals per floret; no closed proxy volume inside the flower head.
    for(let petal=0;petal<5;petal++) {
      const a=petal*Math.PI*2/5+flower*.4,R=X.clone().multiplyScalar(Math.cos(a)).addScaledVector(Y,Math.sin(a)),T=new THREE.Vector3().crossVectors(N,R),start=positions.length/3;
      for(const[w,r,lift]of[[0,.04,0],[-.12,.21,.025],[-.075,.42,.065],[.075,.42,.065],[.12,.21,.025]]) {
        vertex(center.clone().addScaledVector(T,w).addScaledVector(R,r).addScaledVector(N,lift),r<.1?[.68,.74,.52]:[1,1,1]);
      }
      indices.push(start,start+1,start+2,start,start+2,start+3,start,start+3,start+4);
    }
    const disk=positions.length/3;
    for(const[x,y]of[[-.065,-.065],[.065,-.065],[.065,.065],[-.065,.065]])vertex(center.clone().addScaledVector(X,x).addScaledVector(Y,y).addScaledVector(N,.025),[.65,.51,.15]);
    indices.push(disk,disk+1,disk+2,disk,disk+2,disk+3);
    const stem=positions.length/3;
    for(const[p,side]of[[new THREE.Vector3(0,-.12,0),-1],[new THREE.Vector3(0,-.12,0),1],[center,-1],[center,1]])vertex(p.clone().addScaledVector(X,side*.018),[.13,.28,.12]);
    indices.push(stem,stem+1,stem+2,stem+1,stem+3,stem+2);
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));geometry.setIndex(indices);geometry.computeVertexNormals();return geometry;
}


export function raiseCrown(skeleton, base, floor = 3.55, plannedTop = null) {
  let lowest = Infinity, highest = -Infinity;
  for(const branch of skeleton.branches) for(const p of branch.pts) {
    highest=Math.max(highest,p.y-base.y);
    if(branch.level>0&&Math.hypot(p.x-base.x,p.z-base.z)>.5)lowest=Math.min(lowest,p.y-base.y);
  }
  const targetTop=plannedTop??highest,targetFloor=Math.max(floor,lowest);
  if(lowest>=floor&&targetTop===highest)return;
  // One affine crown transform preserves every branch curve and junction; clipping individual
  // vertices to a clearance plane previously turned drooping limbs into metre-long straight bars.
  // Optional design height corrects the inherited cherry generator's shorter
  // drooping crown instead of preserving that short top while raising its floor.
  const scale=(targetTop-targetFloor)/(highest-lowest),lift=y=>base.y+targetFloor+(y-base.y-lowest)*scale;
  const trunk=skeleton.branches[0],rootY=trunk.pts[0].y;
  const attachment=Math.min(...skeleton.branches.filter(b=>b.level===1).map(b=>b.pts[0].y))-.45;
  const raisedAttachment=lift(attachment);
  for(const branch of skeleton.branches) for(const p of branch.pts) {
    p.y=branch===trunk&&p.y<attachment
      ? rootY+(p.y-rootY)*(raisedAttachment-rootY)/(attachment-rootY)
      : lift(p.y);
  }
  skeleton.env.c.y=lift(skeleton.env.c.y);skeleton.env.r.y*=scale;
}

// Keep the shading field consistent with both height maps without moving foliage.
export function remappedCrownField(env,{ground,height,fork,newFork,rawCrownY,firstCrownY,firstRadiusY}) {
  const crownScale=env.r.y/firstRadiusY,crownY=y=>env.c.y+(y-firstCrownY)*crownScale;
  const lowerSlope=newFork/fork,upperSlope=(height-newFork)/(height-fork);
  const part=(centerY,slope)=>({c:env.c.clone().setY(crownY(centerY)),r:env.r.clone().setY(env.r.y*slope)});
  const lower=part(ground+(rawCrownY-ground)*lowerSlope,lowerSlope);
  const upper=part(ground+newFork+(rawCrownY-ground-fork)*upperSlope,upperSlope);
  const splitY=crownY(ground+newFork);
  return p=>p.y<splitY?lower:upper;
}

// Stage secondary growth after all original plants so their seeded shapes stay unchanged.
function planShrubGrowth(captures, originalStems) {
  const stems=[],flat=[],detailed=[],axes=[],up=new THREE.Vector3(0,1,0);
  const geometries=[shrubLeafGeometry(),curvedShrubLeafGeometry()];
  const tube=(a,b,r)=>({matrix:mat4(a.clone().add(b).multiplyScalar(.5).toArray(),null,[r,a.distanceTo(b),r],new THREE.Quaternion().setFromUnitVectors(up,b.clone().sub(a).normalize()))});
  const f32=matrix=>new THREE.Matrix4().fromArray(new Float32Array(matrix.elements));
  function inEnvelope(record,geometry,plant) {
    const matrix=f32(record.matrix),positions=geometry.attributes.position;
    for(let i=0;i<positions.count;i++) {
      const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix);
      if(!p.toArray().every(Number.isFinite)||p.y<=(plant.ground??0)||p.y>(plant.ground??0)+plant.height*1.12||Math.hypot(p.x-plant.x,p.z-plant.z)>plant.radius*1.06)return false;
    }
    return true;
  }
  try {
    for(const capture of captures) {
      const {plant}=capture,{x,z,radius,ground=0,height:h}=plant,random=rng(`shrub-growth-v1:${plant.shapeSeed??`${x}:${z}`}`);
      const geometry=geometries[plant.detail?1:0],target=plant.detail?detailed:flat;
      for(const leader of capture.leaders) {
        // Pick three existing lateral axes; their original branches and leaves remain untouched.
        const order=leader.twigs.map((_,i)=>i);
        for(let j=0;j<3;j++){const k=random.int(j,order.length-1);[order[j],order[k]]=[order[k],order[j]];}
        for(let j=0;j<3;j++) {
          const twig=leader.twigs[order[j]],f=random.float(.28,.68)*2,segment=Math.floor(f),t=THREE.MathUtils.clamp(f-segment,.12,.88);
          const parentId=twig.stemStart+segment,parent=f32(originalStems[parentId].matrix);
          const start=new THREE.Vector3(0,t-.5,0).applyMatrix4(parent),T=new THREE.Vector3().setFromMatrixColumn(parent,1).normalize();
          const side=new THREE.Vector3().crossVectors(T,up).normalize(),sign=random.chance(.5)?1:-1;
          const length=random.float(.12,.22),lift=random.float(.08,.25),phase=random.float(-.2,.2);
          const r=new THREE.Vector3().setFromMatrixColumn(parent,0).length()*(1-.36*t)*.35;
          let accepted;
          // Only a mirrored branch orientation is tried when the first would cross the original safety envelope.
          for(const handedness of [sign,-sign]) {
            const direction=T.clone().multiplyScalar(.35).addScaledVector(side,handedness*.86);direction.y=lift;direction.normalize();
            const end=start.clone().addScaledVector(direction,length),middle=start.clone().lerp(end,.5).addScaledVector(up,length*.045);
            const points=[start,middle,end],newStems=[tube(start,middle,r),tube(middle,end,r*.64)],newLeaves=[],bindings=[];
            for(let node=0;node<12;node++) {
              // Twelve distinct alternating nodes, not six pairs or four leaves sharing a tip.
              const u=.13+(node+.35+.16*Math.sin(node*2.4+phase))*.064,f=u*2,index=Math.min(1,Math.floor(f)),local=f-index;
              const p=points[index].clone().lerp(points[index+1],local),axis=points[index+1].clone().sub(points[index]).normalize();
              const lateral=new THREE.Vector3().crossVectors(axis,up).normalize();lateral.applyAxisAngle(axis,.23*Math.sin(node*1.7+phase));
              const Y=axis.clone().multiplyScalar(.25).addScaledVector(lateral,node%2?-.84:.84).addScaledVector(up,.28).normalize();
              const outward=new THREE.Vector3(p.x-x,.4*h,p.z-z).normalize(),normal=up.clone().multiplyScalar(.7).addScaledVector(outward,.3).normalize();
              const source=twig.leaves[Math.round(node*(twig.leaves.length-1)/11)],width=new THREE.Vector3().setFromMatrixColumn(source.matrix,0).length(),leafLength=new THREE.Vector3().setFromMatrixColumn(source.matrix,1).length();
              const Z=normal.clone().addScaledVector(Y,-normal.dot(Y)).normalize(),X=new THREE.Vector3().crossVectors(Y,Z).normalize();
              const matrix=new THREE.Matrix4().makeBasis(X.multiplyScalar(width),Y.multiplyScalar(leafLength),Z.multiplyScalar(leafLength));matrix.setPosition(p);
              newLeaves.push({matrix,color:source.color.clone(),normal,ao:.5+.4*THREE.MathUtils.smoothstep(Math.hypot(p.x-x,p.z-z)/radius,.15,.85)});
              bindings.push({segment:index,t:local});
            }
            if(newLeaves.every(record=>inEnvelope(record,geometry,{...plant,height:h}))&&points.every(p=>p.y>ground&&Math.hypot(p.x-x,p.z-z)<radius*1.06)) {accepted={points,newStems,newLeaves,bindings,handedness};break;}
          }
          if(!accepted)throw new Error(`Additional shrub growth exceeds safety envelope at ${x},${z}`);
          const stemStart=stems.length,leafStart=target.length;
          stems.push(...accepted.newStems);target.push(...accepted.newLeaves);
          axes.push({plant,parentId,parentT:t,stemStart,leafStart,detail:!!plant.detail,bindings:accepted.bindings,length,radius:r,mirrored:accepted.handedness!==sign});
        }
      }
    }
    return {stems,flat,detailed,axes,plants:captures.length};
  }finally{for(const geometry of geometries)geometry.dispose();}
}

function plantRecordWriters(branches=[],leaves=[]) {
  const up=new THREE.Vector3(0,1,0),q=new THREE.Quaternion();
  function branch(a,c,radius,target=branches) {
    const direction=c.clone().sub(a);q.setFromUnitVectors(up,direction.clone().normalize());
    target.push({matrix:mat4(a.clone().add(c).multiplyScalar(0.5).toArray(),null,[radius,direction.length(),radius],q)});
  }
  function leaf(position,direction,normal,width,length,tint,ao=1,target=leaves) {
    const Y=direction.clone().normalize(),Z=normal.clone().addScaledVector(Y,-normal.dot(Y)).normalize();
    const X=new THREE.Vector3().crossVectors(Y,Z).normalize();
    const matrix=new THREE.Matrix4().makeBasis(X.multiplyScalar(width),Y.multiplyScalar(length),Z.multiplyScalar(length));matrix.setPosition(position);
    target.push({matrix,color:tint.clone(),normal:normal.clone(),ao});
  }
  return {branch,leaf};
}

export function stageMatureBorder(plants) {
  const writers=plantRecordWriters();
  return plants.filter(p=>p.kind==='matureShrub').map(p=>planMatureShrub(p,writers));
}

export function buildVegetation(trees, contextTrees, shrubs, districtTrees = []) {
  return finishBuild(buildVegetationSteps(trees, contextTrees, shrubs, districtTrees));
}

export function* buildVegetationSteps(trees, contextTrees, shrubs, districtTrees = []) {
  const group=new THREE.Group();group.name='campus-vegetation';
  const random=rng('courtyard-canopies'),up=new THREE.Vector3(0,1,0);
  const trunks=new Map(),branches=[],flowerStems=[],clonalPetioles=[],shrubStems=[],matureStems=[],leaves=[],shrubLeaves=[],detailedShrubLeaves=[],groundLeaves=[],fill=[],distant=[],cores=[],flowers=[],tufts=[],shortTufts=[];
  let clonalGroundcoverPlants=0,detailedShrubs=0,treeJunctionsRestored=0,trunkCapTriangles=0,primaryRootSleeves=0,primaryRootSleeveTriangles=0,primaryRootSleeveFailures=0;
  const shrubGrowthCaptures=[];
  const {branch,leaf}=plantRecordWriters(branches,leaves);
  const maturePlants=shrubs.filter(p=>p.kind==='matureShrub');
  // Layout stages before surface commit. A stale cached plan here aborts construction after that commit.
  const maturePlans=maturePlants.every(p=>p.maturePlan)?maturePlants.map(p=>p.maturePlan):stageMatureBorder(maturePlants);
  const matureByPlant=new Map(maturePlants.map((p,i)=>[p,maturePlans[i]]));
  for(const plant of maturePlants) {
    const saved=matureByPlant.get(plant).plant;
    for(const key of ['x','z','height','radius','shapeSeed'])if(saved[key]!==plant[key])throw new Error('Stale mature border plan: '+key);
    if(saved.ground!==(plant.ground??0)||saved.detail!==!!plant.detail)throw new Error('Stale mature border ground/detail');
  }
  const box=b=>({min:b.min.toArray(),max:b.max.toArray()});
  group.userData.matureShrubs=maturePlans.map(p=>({shapeSeed:p.plant.shapeSeed,x:p.plant.x,z:p.plant.z,ground:p.plant.ground,
    bounds:box(p.bounds),leafBounds:box(p.leafBounds),woodBounds:box(p.woodBounds),stats:p.stats}));
  const districtBranches=[],districtFoliage=[],districtRandom=rng('neighbourhood-canopies');
  const treeForms={broadleaf:0,vase:0,upright:0};
  const color=new THREE.Color(),barkMaterial=yield* createBarkMaterialSteps();
  // Match the actual 64-segment island outline so short turf roots meet either island or terrain.
  const turfIslands=COURTYARDS.map(c=>Array.from({length:64},(_,i)=>{
    const a=i*Math.PI*2/64,phase=c.id==='garden'?1:0,k=1+.018*Math.sin(a*3+phase)+.012*Math.sin(a*5-phase);
    return{x:c.x+Math.cos(a)*c.rx*k,z:c.z+Math.sin(a)*c.rz*k};
  }));
  function turfHeight(x,z) {
    const onIsland=turfIslands.some(points=>{let inside=false;for(let i=0,j=points.length-1;i<points.length;j=i++){
      const a=points[i],b=points[j];if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }return inside;});
    return (onIsland?-.007:-.025)-.0015;
  }
  // shortcut: whole growth is visually calibrated only for these courtyard sites and the original ti6.
  const wholeTreeStats=[],wholeGrowthSites=new Set(['-7,-32','6,-33','-8,-19','4,-21','-8,38','9,41']);
  for(let ti=0;ti<trees.length;ti++) {
    yield '正在生成庭院树木…';
    const tree=trees[ti],{x,z,height:h,ground=0}=tree,treeRng=rng(`courtyard-tree-${ti}`),form=ti%3;
    const grownTree=tree.hero&&wholeGrowthSites.has(x+','+z);
    const wholeTree=grownTree||(ti===6&&x===-9&&z===19&&tree.hero);
    const wholeStart={leaves:leaves.length,cards:fill.length};
    let wholePlan=null;
    const base=new THREE.Vector3(x,ground,z),lean=new THREE.Vector3(treeRng.float(-0.45,0.45),0,treeRng.float(-0.45,0.45));
    // Reduce inherited droop before the clearance remap can stretch a low crown into a long bare trunk.
    const options={h,base,lean,spread:tree.radius/h,detail:tree.hero?0.25:0.16,shellDensity:1.35,leaders:form===2?2:3,scaffolds:4,clump:0.38,scaffoldWobble:.22,droopScale:.3};
    const skeleton=(form===1?genCherry:genMaple)(treeRng,options);treeForms[wholeTree?'broadleaf':['broadleaf','vase','upright'][form]]++;
    const junctions=captureTreeJunctions(skeleton.branches);
    const trunk=skeleton.branches[0],fork=trunk.pts.at(-1).y-ground,newFork=treeRng.float(3.15,3.55);
    const rawCrownY=skeleton.env.c.y;
    const lift=y=>ground+(y-ground<fork?(y-ground)*newFork/fork:newFork+(y-ground-fork)*(h-newFork)/(h-fork));
    for(const br of skeleton.branches) for(const p of br.pts) {
      p.y=lift(p.y);
    }
    skeleton.env.c.y=lift(skeleton.env.c.y);
    const firstCrownY=skeleton.env.c.y,firstRadiusY=skeleton.env.r.y;
    raiseCrown(skeleton,base,3.55,form===1?h:null);
    const crownEnv=remappedCrownField(skeleton.env,{ground,height:h,fork,newFork,rawCrownY,firstCrownY,firstRadiusY});
    treeJunctionsRestored+=restoreTreeJunctions(skeleton.branches,junctions);
    const cell=`${Math.floor(x/48)},${Math.floor(z/48)}`;
    if(!trunks.has(cell))trunks.set(cell,new BarkAccum());
    const accumulator=trunks.get(cell),displacement=campusBarkDisplacement(trunkDisp({seed:ti,bump:0.065,flare:0.25,flareH:0.3,flute:0.023}));
    function emitTreeBark() {
      let parentVolume;
      for(let bi=0;bi<skeleton.branches.length;bi++) {
        const br=skeleton.branches[bi];if(br.level===4&&bi%4!==0)continue;
        const rootStart=accumulator.vc,indexStart=accumulator.idx.length;
        accumulator.addBranch(br,{seed:ti,disp:displacement,radial:r=>r>0.14?9:r>0.05?6:3});
        if(br.level===0){
          trunkCapTriangles+=closeTrunkTerminal(accumulator,br).triangles;
          parentVolume=trunkVolume(accumulator,rootStart,indexStart,trunk);
        }else if(br.level===1&&junctions.some(link=>link.child===bi&&link.parent===0)){
          const repair=extendPrimaryRoot(accumulator,br,rootStart,parentVolume);
          if(repair.changed)primaryRootSleeves++;
          if(repair.failed)primaryRootSleeveFailures++;
          primaryRootSleeveTriangles+=repair.triangles;
        }
      }
    }
    if(!wholeTree)emitTreeBark();
    const palette=form===0?[0x365c2c,0x718849]:form===1?[0x426536,0x7e8d50]:[0x304f2b,0x647f42];
    const tip=new THREE.Color(palette[1]);
    const projectedArea=Math.PI*skeleton.env.r.x*skeleton.env.r.z,meanLeafArea=0.10*0.18*0.68;
    const count=Math.max(3,Math.round(projectedArea*(tree.hero?1.4:0.8)/meanLeafArea/skeleton.twigs.length));
    const sprayProbability=Math.min(0.95,projectedArea*(tree.hero?3.2:4.2)/(0.9*skeleton.twigs.length));
    for(const twig of skeleton.twigs) {
      const br=twig.br,from=twig.t0||0,center=sampleBranch(br,from+(1-from)*0.55).p;
      if(center.y<ground+3.7)continue;
      const inward=center.clone().lerp(skeleton.env.c,twig.shell?0.16:0.06);
      const bent=envNormal(inward,crownEnv(inward)).lerp(up,0.25).normalize();
      const ao=0.40+0.6*THREE.MathUtils.smoothstep(envRho(inward,crownEnv(inward)),0.25,1);
      // Card size now matches the real leaves: cap projected area instead of filling every twig.
      if(treeRng.next()<sprayProbability) {
        const [dx,dy,dz]=treeRng.sphere();
        fill.push({matrix:mat4([inward.x+dx*0.2,Math.max(ground+4.2,inward.y+dy*0.18),inward.z+dz*0.2],[treeRng.float(-1.4,1.4),treeRng.float(0,6.28),treeRng.float(-1,1)],treeRng.float(1.0,1.4)),color:new THREE.Color(0xe4e9d1).multiplyScalar(treeRng.float(0.86,1.06)),normal:bent,ao});
      }
      for(let li=0;li<count;li++) {
        const leafJitter=treeRng.next(),leafT=from+(1-from)*(li+leafJitter)/count,node=sampleBranch(br,leafT);if(node.p.y<ground+3.25)continue;
        const side=new THREE.Vector3().crossVectors(node.T,up);if(side.lengthSq()<0.001)side.set(1,0,0);else side.normalize();side.multiplyScalar(li%2?1:-1);
        const Y=node.T.clone().multiplyScalar(0.35).addScaledVector(side,0.8);Y.y-=treeRng.float(0.05,0.25);Y.normalize();
        const N=up.clone().add(new THREE.Vector3(treeRng.float(-0.7,0.7),treeRng.float(-0.1,0.2),treeRng.float(-0.7,0.7))).normalize();
        const depth=THREE.MathUtils.smoothstep(envRho(node.p,crownEnv(node.p)),0.2,1.05);
        color.set(palette[0]).lerp(tip,treeRng.float(0,0.72)).multiplyScalar(treeRng.float(0.87,1.1));
        const p=node.p.clone().addScaledVector(side,treeRng.float(0.025,0.075));
        leaf(p,Y,N,treeRng.float(0.075,0.125),treeRng.float(0.135,0.225),color,0.4+depth*0.6);
      }
    }
    if(wholeTree) {
      wholePlan=buildCampusBroadleaf(tree,crownEnv,grownTree?{seed:'campus-whole-tree:'+x+':'+z,height:h,radius:tree.radius,clearance:tree.clearance??3}:null);
      if(grownTree)tree.crownEnvelope=wholePlan.crownEnvelope;
      leaves.length=wholeStart.leaves;fill.length=wholeStart.cards;
      leaves.push(...wholePlan.leaves);
      for(const branch of wholePlan.branches) {
        accumulator.addBranch(branch,{seed:ti,radial:()=>branch.radial});
        if(branch.parent===null)trunkCapTriangles+=closeTrunkTerminal(accumulator,branch).triangles;
      }
      wholeTreeStats.push({tree:ti,...wholePlan.stats});
    }
  }
  group.userData.wholeTrees=wholeTreeStats;
  for(const tree of [...contextTrees,...districtTrees]) {
    yield '正在生成林地树木…';
    const distantDistrict=!!tree.district,treeRandom=distantDistrict?districtRandom:random;
    const near=!distantDistrict&&tree.near;
    const{x,z,height:h,ground=0}=tree;branch(new THREE.Vector3(x,ground,z),new THREE.Vector3(x,ground+h*0.65,z),h*0.026,distantDistrict?districtBranches:branches);
    for(let i=0;i<(near?7:5);i++) {
      const a=i*2.4,center=new THREE.Vector3(x+Math.cos(a)*h*0.19,ground+h*(0.48+(i%4)*0.11),z+Math.sin(a)*h*0.19);
      if(near&&i<3)branch(new THREE.Vector3(x,ground+h*(0.28+i*0.05),z),center,h*0.011);
      for(let j=0;j<(near?42:30);j++) {
        const[dx,dy,dz]=treeRandom.sphere(),r=treeRandom.float(0.55,1);
        const p=new THREE.Vector3(center.x+dx*h*0.19*r,center.y+dy*h*0.17*r,center.z+dz*h*0.19*r);
        // A continuous crown gradient carries the light across overlapping branch lobes.
        const n=new THREE.Vector3((p.x-x)/(.4*h)**2,(p.y-ground-h*.65)/(.34*h)**2,(p.z-z)/(.4*h)**2).normalize();
        n.lerp(new THREE.Vector3(dx,dy*.19/.17,dz).normalize(),.18).normalize();
        (distantDistrict?districtFoliage:distant).push({matrix:mat4(p.toArray(),[treeRandom.float(-1,1),treeRandom.float(0,6.28),treeRandom.float(-1,1)],treeRandom.float(2.5,3.4)),color:new THREE.Color(0xd8e2c4).multiplyScalar(treeRandom.float(0.82,1.12)),normal:n,ao:0.6+r*0.4});
      }
    }
  }
  // Opaque interiors remain only in the distant woodland representation.
  const coreGeo=mergeVertices(new THREE.IcosahedronGeometry(1,1)),corePos=coreGeo.getAttribute('position');
  for(let i=0;i<corePos.count;i++){const x=corePos.getX(i),y=corePos.getY(i),z=corePos.getZ(i),r=1+0.08*Math.sin(x*5+z*4)+0.04*Math.cos(y*8-z*3);corePos.setXYZ(i,x*r,y*r,z*r);}coreGeo.computeVertexNormals();
  for(const plant of shrubs) {
    yield '正在生成灌木与地被…';
    if(plant.kind==='matureShrub') {
      const plan=matureByPlant.get(plant),target=plant.detail?detailedShrubLeaves:shrubLeaves;
      matureStems.push(...plan.stems);target.push(...plan.leaves);if(plant.detail)detailedShrubs++;
      continue;
    }
    // Generate a moved border plant at its original coordinates, including its positional phases.
    const origin=plant.southBorderOrigin;
    const translated=origin?[flowerStems,shrubStems,leaves,shrubLeaves,detailedShrubLeaves,groundLeaves,flowers,tufts]:null;
    const starts=translated?.map(queue=>queue.length);
    try {
    const{x,z,height:h,ground=0,kind='shrub',radius=h*0.75}=origin?{...plant,x:origin[0],z:origin[1]}:plant;
    const random=rng(plant.shapeSeed ?? `campus-plant:${kind}:${x}:${z}`);
    if(kind==='shortGrass'||kind==='grass') {
      const list=kind==='shortGrass'?shortTufts:tufts,count=kind==='grass'?7:1;
      for(let i=0;i<count;i++) {
        const px=x+random.float(-radius*.6,radius*.6),pz=z+random.float(-radius*.6,radius*.6);
        list.push({matrix:mat4([px,kind==='shortGrass'?turfHeight(px,pz):ground+0.006,pz],[0,random.float(0,6.28),0],[kind==='shortGrass'?0.16:0.8,h,kind==='shortGrass'?0.16:0.8])});
      }
      continue;
    }
    if(kind==='clonalGroundcover') {
      clonalGroundcoverPlants++;
      const growth=rng(`clonal-shoots-v1:${plant.shapeSeed??`${x}:${z}`}`);
      const root=new THREE.Vector3(x,ground-.003,z),phase=growth.float(0,Math.PI*2);
      const mature=new THREE.Color(0x355c35),young=new THREE.Color(0x789254);
      const vigor=growth.float(.94,1.04);
      for(let runner=0;runner<4;runner++) {
        const az=phase+runner*Math.PI/2+growth.float(-.23,.23),reach=growth.float(.27,.31),bend=growth.float(.035,.065)*(runner%2?1:-1);
        let previous=root;
        for(let node=0;node<2;node++) {
          const t=node===0?growth.float(.39,.52):1,side=Math.sin(t*Math.PI/2)*bend;
          const junction=new THREE.Vector3(x+Math.cos(az)*reach*t-Math.sin(az)*side,ground+.006,z+Math.sin(az)*reach*t+Math.cos(az)*side);
          branch(previous,junction,.0017,flowerStems);previous=junction;
          const shootHeight=h*vigor*(node===0?growth.float(.98,1.08):growth.float(.78,.96));
          const lean=growth.float(.012,.025),tip=junction.clone().add(new THREE.Vector3(Math.cos(az+.4)*lean,0,Math.sin(az+.4)*lean));
          tip.y=ground+shootHeight;
          const middle=junction.clone().lerp(tip,.5);middle.x-=Math.sin(az)*.009;middle.z+=Math.cos(az)*.009;
          branch(junction,middle,.0018,flowerStems);branch(middle,tip,.0013,flowerStems);
          const shootPhase=az+growth.float(-Math.PI,Math.PI),bladeSize=growth.float(.086,.098);
          for(let order=0;order<9;order++) {
            const fresh=order>=7,s=fresh?.90+(order-7)*.075:.42+order*.065+growth.float(-.012,.012);
            const attachment=s<.5?junction.clone().lerp(middle,s*2):middle.clone().lerp(tip,(s-.5)*2);
            const angle=shootPhase+order*2.399963+growth.float(-.12,.12);
            const tilt=fresh?growth.float(.50,.75):growth.float(-.06,.19)+order*.016;
            const Y=new THREE.Vector3(Math.cos(angle)*Math.cos(tilt),Math.sin(tilt),Math.sin(angle)*Math.cos(tilt));
            const N=new THREE.Vector3(-Math.cos(angle)*Math.sin(tilt),Math.cos(tilt),-Math.sin(angle)*Math.sin(tilt));
            const petiole=growth.float(fresh?.004:.007,fresh?.008:.013),base=attachment.clone().addScaledVector(Y,petiole);
            branch(attachment,base,growth.float(.00075,.00105),clonalPetioles);
            const length=fresh?bladeSize*growth.float(.55,.73):Math.min(.102,bladeSize*(1-(order-3)*.025)+growth.float(-.002,.002));
            const width=length*growth.float(fresh?.41:.55,fresh?.47:.61);
            color.copy(mature).lerp(young,growth.float(fresh?.42:.22,fresh?.52:.34));
            leaf(base,Y,N,width,length,color,.76+.13*(order+1)/9);
          }
        }
      }
      continue;
    }
    if(kind==='groundcover'||kind==='flower') {
      const crown=new THREE.Vector3(x,ground-.003,z);
      const maturity=THREE.MathUtils.clamp((h-.18)/.14,0,1);
      for(let i=0;i<26;i++) {
        const layer=i<10?0:i<19?1:2;
        let petiole=random.float([.14,.10,.05][layer],[.23,.18,.12][layer])*Math.min(1.1,Math.max(.7,h/.3),radius/.48);
        const a=i*2.399963+x*.71+z*.43+random.float(-.13,.13);
        let tilt=random.float([.38,.70,1.02][layer],[.58,.92,1.24][layer]);
        color.set(0x355c35).lerp(new THREE.Color(0x789254),random.float(0,0.6));
        let width=random.float(.13,.20),length=random.float(.17,.25);
        if(kind==='groundcover') {
          // Mature outer blades retain area while the youngest central leaves remain small.
          const scale=.985*(.91+.19*maturity)*[1.16,1.08,.64][layer];
          width*=scale;length*=scale;
          petiole=Math.max(.025,petiole+(maturity-.5)*[.09,.12,.14][layer]);
          tilt+=[-.12,-.03,.06][layer];
          // This bound includes blade cup depth and half-width, not just its centreline.
          const extent=Math.hypot((petiole+length)*Math.cos(tilt)+length*.07*Math.sin(tilt),width*.5);
          const fit=Math.min(1,(Math.min(radius,.51)-.004)/extent);
          petiole*=fit;width*=fit;length*=fit;
        }
        const Y=new THREE.Vector3(Math.cos(a)*Math.cos(tilt),Math.sin(tilt),Math.sin(a)*Math.cos(tilt));
        const N=new THREE.Vector3(-Math.cos(a)*Math.sin(tilt),Math.cos(tilt),-Math.sin(a)*Math.sin(tilt));
        const p=crown.clone().addScaledVector(Y,petiole);
        branch(crown,p,.0022,flowerStems);
        leaf(p,Y,N,width,length,color,.75,groundLeaves);
      }
      if(kind==='flower')for(let i=0;i<9;i++) {
        const px=x+random.float(-radius*.5,radius*.5),pz=z+random.float(-radius*.5,radius*.5),top=ground+h*random.float(.8,1.25);
        const phase=i*2.4+x,mid=new THREE.Vector3(px+Math.sin(phase)*.018,ground+(top-ground)*.55,pz+Math.cos(phase)*.018),tip=new THREE.Vector3(px+Math.sin(phase)*.035,top,pz+Math.cos(phase)*.035);
        branch(new THREE.Vector3(px,ground,pz),mid,.004,flowerStems);branch(mid,tip,.0032,flowerStems);
        leaf(mid,new THREE.Vector3(Math.cos(phase),.2,Math.sin(phase)).normalize(),up,.028,.10,new THREE.Color(0x486b38),.85);
        flowers.push({matrix:mat4(tip.toArray(),[0,random.float(0,6.28),0],random.float(.045,.075)),color:new THREE.Color(random.chance(.7)?0xd4d4aa:0x9294ad)});
      }
      continue;
    }
    if(kind==='shrub') {
      const leafTarget=plant.detail?detailedShrubLeaves:shrubLeaves;
      // shortcut: growth is calibrated for these two beds; recheck clearance and cost before expanding.
      const growthCapture=!plant.skipExtraGrowth&&(Math.hypot((x-8.4)/3.8,(z-42)/3)<=1||Math.hypot((x-5.4)/3.3,(z+22.2)/4.2)<=1)?{plant,leaders:[]}:null;
      if(plant.detail)detailedShrubs++;
      const root=new THREE.Vector3(x,ground-.003,z),stemCount=random.int(4,6),phase=random.float(0,Math.PI*2);
      const mature=new THREE.Color(0x355a2f),young=new THREE.Color(0x6c8446);
      for(let stem=0;stem<stemCount;stem++) {
        // Low spreading leaders fill the planting bed; taller shoots retain an uneven crown.
        const spreading=stem%3===0,a=phase+stem*2.399963+random.float(-.22,.22),reach=radius*random.float(spreading?.62:.48,spreading?.78:.68);
        const tip=new THREE.Vector3(x+Math.cos(a)*reach,ground+h*random.float(spreading?.42:.76,spreading?.66:1.0),z+Math.sin(a)*reach);
        const control=root.clone().lerp(tip,.48);control.y+=h*(spreading?.04:.12);
        const leader=new THREE.QuadraticBezierCurve3(root,control,tip).getPoints(3),thickness=random.float(.008,.014);
        const growthLeader=growthCapture?{twigs:[]}:null;if(growthCapture)growthCapture.leaders.push(growthLeader);
        for(let segment=0;segment<3;segment++)branch(leader[segment],leader[segment+1],thickness*(1-segment*.22),shrubStems);
        for(let shoot=0;shoot<6;shoot++) {
          const t=.17+(shoot+random.float(.15,.85))*.13,f=t*3,index=Math.floor(f),start=leader[index].clone().lerp(leader[index+1],f-index);
          const az=a+(shoot%2?1:-1)*random.float(.45,.95),length=radius*random.float(.34,.55);
          const end=start.clone().add(new THREE.Vector3(Math.cos(az)*length,h*random.float(.06,.18),Math.sin(az)*length));
          const extent=Math.hypot(end.x-x,end.z-z),limit=radius*.89;
          if(extent>limit){end.x=x+(end.x-x)*limit/extent;end.z=z+(end.z-z)*limit/extent;}
          end.y=Math.min(end.y,ground+h*random.float(.87,1.02));
          const middle=start.clone().lerp(end,.5);middle.y+=h*.055;
          const twig=new THREE.QuadraticBezierCurve3(start,middle,end).getPoints(2);
          const growthTwig=growthCapture?{stemStart:shrubStems.length,leaves:[]}:null;if(growthCapture)growthLeader.twigs.push(growthTwig);
          for(let segment=0;segment<2;segment++)branch(twig[segment],twig[segment+1],(.0038-segment*.001)*(.7+.3*t),shrubStems);
          // Paired leaves share a real twig node; changing the envelope cannot leave leaves floating on a proxy shell.
          for(let node=0;node<8;node++) {
            const u=.12+(node+random.float(.15,.85))*.108,f=u*2,index=Math.floor(f),p=twig[index].clone().lerp(twig[index+1],f-index),T=twig[index+1].clone().sub(twig[index]).normalize();
            const side=new THREE.Vector3().crossVectors(T,up).normalize();side.applyAxisAngle(T,node*.72+random.float(-.15,.15));
            const outward=new THREE.Vector3(p.x-x,.4*h,p.z-z).normalize();
            for(const sign of [-1,1]) {
              const Y=T.clone().multiplyScalar(.24).addScaledVector(side,sign*.82).addScaledVector(up,.25);
              if(p.y-ground<.12)Y.y=Math.max(.12,Y.y);Y.normalize();
              const N=up.clone().multiplyScalar(.7).addScaledVector(outward,.3).normalize();
              color.copy(mature).lerp(young,random.float(.12,.48)+u*.15);
              leaf(p,Y,N,random.float(.035,.055)*1.1,random.float(.075,.105)*1.1,color,.5+.4*THREE.MathUtils.smoothstep(Math.hypot(p.x-x,p.z-z)/radius,.15,.85),leafTarget);
              if(growthCapture)growthTwig.leaves.push(leafTarget.at(-1));
            }
          }
        }
      }
      if(growthCapture)shrubGrowthCaptures.push(growthCapture);
      continue;
    }
    const lobes=[{x,z,r:radius,h}];
    for(let i=0;i<2;i++){const a=random.float(0,6.28);lobes.push({x:x+Math.cos(a)*radius*.55,z:z+Math.sin(a)*radius*.55,r:radius*.65,h:h*random.float(.65,.85)});}
    for(const lobe of lobes) {
      cores.push({matrix:mat4([lobe.x,ground+lobe.h*.35,lobe.z],[0,random.float(0,6.28),0],[lobe.r*.72,lobe.h*.43,lobe.r*.72]),color:new THREE.Color(0xffffff).multiplyScalar(random.float(.83,1.06))});
      const count=kind==='woodland'?16:Math.round(75*Math.PI*lobe.r*lobe.r);
      for(let i=0;i<count;i++) {
        const a=random.float(0,6.28),dy=random.float(-.2,1),s=Math.sqrt(1-dy*dy),dx=s*Math.cos(a),dz=s*Math.sin(a);
        const p=new THREE.Vector3(lobe.x+dx*lobe.r*.79,ground+lobe.h*(.35+dy*.46),lobe.z+dz*lobe.r*.79);
        if(lobes.some(o=>o!==lobe&&((p.x-o.x)/(o.r*.79))**2+((p.z-o.z)/(o.r*.79))**2+((p.y-ground-o.h*.35)/(o.h*.46))**2<.72))continue;
        const N=new THREE.Vector3(dx,dy+.3,dz).normalize();
        color.set(0x355a2f).lerp(new THREE.Color(0x6c8446),random.float(0,.65));
        if(kind==='woodland') {
          distant.push({matrix:mat4(p.toArray(),[random.float(-1,1),a,random.float(-1,1)],random.float(.75,1.1)),color:new THREE.Color(0xd7e2bf),normal:N,ao:.65+Math.max(0,dy)*.35});
        }else {
          const Y=new THREE.Vector3(-dz,random.float(.08,.3),dx).normalize();leaf(p,Y,N,random.float(.08,.115),random.float(.13,.18),color,.5+Math.max(0,dy)*.5);
        }
      }
    }
    } finally {
      if(translated)for(let queue=0;queue<translated.length;queue++)for(let i=starts[queue];i<translated[queue].length;i++) {
        const e=translated[queue][i].matrix.elements;
        e[12]+=plant.x-origin[0];e[14]+=plant.z-origin[1];
      }
    }
  }
  yield '正在组装植物网格…';
  let shrubGrowth=null;
  try {
    const plan=planShrubGrowth(shrubGrowthCaptures,shrubStems);
    // Commit only after the entire isolated addition succeeds. Original records are never modified.
    shrubStems.push(...plan.stems);shrubLeaves.push(...plan.flat);detailedShrubLeaves.push(...plan.detailed);
    shrubGrowth={plants:plan.plants,shoots:plan.axes.length,leaves:plan.flat.length+plan.detailed.length,addedTriangles:plan.stems.length*8+plan.flat.length*4+plan.detailed.length*12};
  }catch(error){console.warn('[campus] Additional shrub growth did not fit; keeping original plants.',error.message);}
  group.userData.shrubGrowth=shrubGrowth;
  let barkTriangles=0;
  for(const[cell,accumulator]of trunks) {
    const geo=accumulator.toGeometry(),a=geo.getAttribute('aBarkA'),bb=geo.getAttribute('aBarkB'),uv=[],maturity=[];
    for(let i=0;i<a.count;i++) {
      const repeats=Math.max(1,Math.round(bb.getX(i)*bb.getZ(i)/BARK_TILE.width)),seed=bb.getY(i);
      uv.push(a.getX(i)/bb.getX(i)*repeats+seed*.317,a.getY(i)/BARK_TILE.height+seed*.173);
      maturity.push(THREE.MathUtils.smoothstep(a.getZ(i),.018,.19));
    }
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));geo.setAttribute('barkMaturity',new THREE.Float32BufferAttribute(maturity,1));geo.deleteAttribute('aBarkA');geo.deleteAttribute('aBarkB');
    const mesh=new THREE.Mesh(geo,barkMaterial);mesh.name=`mature-trunks:${cell}`;mesh.castShadow=mesh.receiveShadow=true;group.add(mesh);barkTriangles+=accumulator.triCount;
    yield '正在组装植物网格…';
  }
  const woodlandStem=new THREE.CylinderGeometry(.64,1,1,6,1);
  woodlandStem.setAttribute('barkMaturity',new THREE.Float32BufferAttribute(new Float32Array(woodlandStem.getAttribute('position').count).fill(1),1));
  yield* addBatches(group,woodlandStem,barkMaterial,branches,'woodland-stems',{size:80});
  yield* addBatches(group,coreGeo,shrubSurface(),cores,'shrub-interiors');
  const shrubStemMaterial=new THREE.MeshStandardMaterial({color:0x514a34,roughness:.96});
  yield* addBatches(group,new THREE.CylinderGeometry(.64,1,1,4,1,true),shrubStemMaterial,shrubStems,'shrub-branches');
  if(matureStems.length)yield* addBatches(group,new THREE.CylinderGeometry(MATURE_STEM_TAPER,1,1,4,1,true),shrubStemMaterial,matureStems,'mature-shrub-branches');
  const shrubGeo=shrubLeafGeometry(),detailedShrubGeo=curvedShrubLeafGeometry(),shrubMaterial=foliageMaterial({veins:true});
  const extraShrubTriangles=detailedShrubLeaves.length*(detailedShrubGeo.index.count-shrubGeo.index.count)/3;
  yield* addBatches(group,shrubGeo,shrubMaterial,shrubLeaves,'shrub-foliage');
  yield* addBatches(group,detailedShrubGeo,shrubMaterial,detailedShrubLeaves,'shrub-foliage-detailed');
  const map=foliageTexture(),cardMat=foliageMaterial({map,bend:.62});
  const depth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,map,alphaTest:.36,side:THREE.DoubleSide});
  const card=new THREE.PlaneGeometry(1,1.25,1,2),cp=card.getAttribute('position');
  for(let i=0;i<cp.count;i++)cp.setZ(i,.06*Math.cos(cp.getY(i)*Math.PI/1.25));card.computeVertexNormals();
  yield* addBatches(group,card,cardMat,fill,'canopy-interior',{depth});
  yield* addBatches(group,card,foliageMaterial({map,bend:.92,canopyVolume:true}),distant,'woodland-canopy',{size:80,depth});
  // Distant neighbours use the separate ground visibility atlas, not the campus shadow volume.
  const districtStart=group.children.length;
  yield* addBatches(group,woodlandStem,barkMaterial,districtBranches,'district-stems',{size:320,castShadow:false,receiveShadow:false});
  yield* addBatches(group,card,foliageMaterial({map,bend:.92,canopyVolume:true}),districtFoliage,'district-canopy',{size:320,castShadow:false,receiveShadow:false});
  const districtBatches=group.children.length-districtStart;
  if(districtTrees.length>220||districtBatches>32)throw new Error('Neighbourhood vegetation budget exceeded');
  const leafGeo=new THREE.BufferGeometry();
  leafGeo.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,-.34,.18,-.02,-.5,.45,.015,-.31,.78,.10,0,1,.16,.31,.78,.13,.5,.45,.06,.34,.18,0],3));
  leafGeo.setAttribute('uv',new THREE.Float32BufferAttribute([.5,0,.16,.18,0,.45,.19,.78,.5,1,.81,.78,1,.45,.84,.18],2));
  leafGeo.setIndex([0,2,1,0,3,2,0,4,3,0,5,4,0,6,5,0,7,6]);leafGeo.computeVertexNormals();
  yield* addBatches(group,leafGeo,foliageMaterial({veins:true}),leaves,'individual-foliage');
  const groundLeafGeo=groundcoverLeafGeometry();
  yield* addBatches(group,groundLeafGeo,foliageMaterial({veins:true}),groundLeaves,'broadleaf-groundcover');
  yield* addBatches(group,flowerClusterGeometry(),new THREE.MeshStandardMaterial({color:0xffffff,vertexColors:true,roughness:.82,side:THREE.DoubleSide}),flowers,'perennial-flowers');
  const perennialStemMaterial=new THREE.MeshStandardMaterial({color:0x405a36,roughness:.94});
  yield* addBatches(group,new THREE.CylinderGeometry(.64,1,1,6,1,true),perennialStemMaterial,flowerStems,'perennial-stems');
  yield* addBatches(group,new THREE.CylinderGeometry(.64,1,1,3,1,true),perennialStemMaterial,clonalPetioles,'clonal-petioles');
  const positions=[],indices=[],shades=[];
  for(let blade=0;blade<12;blade++) {
    const a=random.float(0,6.28),height=random.float(.55,1),width=random.float(.016,.03),dx=Math.cos(a),dz=Math.sin(a),offset=positions.length/3;
    for(const[side,y,lean]of[[-1,0,0],[1,0,0],[-.8,height*.55,height*.2],[.8,height*.55,height*.2],[-.35,height*.88,height*.48],[.35,height*.88,height*.48],[0,height*.72,height*.8]]) {
      positions.push(dx*(.05+lean)-dz*width*side,y,dz*(.05+lean)+dx*width*side);
      color.set(0x2c502b).lerp(new THREE.Color(blade%8===0?0x79804a:0x638245),y/height*.7);shades.push(color.r,color.g,color.b);
    }
    indices.push(offset,offset+1,offset+2,offset+1,offset+3,offset+2,offset+2,offset+3,offset+4,offset+3,offset+5,offset+4,offset+4,offset+5,offset+6);
  }
  const tuftGeo=new THREE.BufferGeometry();tuftGeo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));tuftGeo.setAttribute('color',new THREE.Float32BufferAttribute(shades,3));tuftGeo.setIndex(indices);tuftGeo.computeVertexNormals();
  const grassMat=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93,side:THREE.DoubleSide});
  yield* addBatches(group,tuftGeo,grassMat,tufts,'ornamental-grass',{castShadow:true});
  const shortGeo=tuftGeo.clone();shortGeo.setIndex(indices.slice(0,6*15));
  yield* addBatches(group,shortGeo,grassMat,shortTufts,'lawn-edge',{castShadow:false});
  const shrubLeafCount=shrubLeaves.length+detailedShrubLeaves.length;
  group.userData.stats={matureShrubs:maturePlans.length,matureShrubTriangles:maturePlans.reduce((sum,p)=>sum+p.stats.triangles,0),clonalGroundcoverPlants,trees:trees.length,heroTrees:trees.filter(t=>t.hero).length,treeForms,contextTrees:contextTrees.length,nearForestTrees:contextTrees.filter(t=>t.near).length,detailedBarkTriangles:barkTriangles,treeJunctionsRestored,trunkCapTriangles,primaryRootSleeves,primaryRootSleeveTriangles,primaryRootSleeveFailures,individualLeaves:leaves.length+groundLeaves.length+shrubLeafCount,foliageCards:distant.length,districtTrees:districtTrees.length,districtFoliageCards:districtFoliage.length,districtBatches,canopyFillCards:fill.length,shrubLobes:cores.length,shrubLeaves:shrubLeafCount,detailedShrubs,detailedShrubLeaves:detailedShrubLeaves.length,extraShrubTriangles,shrubStemSegments:shrubStems.length+matureStems.length,matureStemSegments:matureStems.length,flowers:flowers.length,grassTufts:tufts.length,shortGrassTufts:shortTufts.length,vegetationBatches:group.children.length};
  return group;
}
