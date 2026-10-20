import { rng, fbm2 } from '../core/rng.js';

// Most trees stay close to the north/west edge; overlapping rear copses add
// depth without dispersing the same canopy over an oversized meadow.
const GROVES = [
  [-170,-35,40,133,-.04,90], [0,-155,158,40,-.02,110], [174,-46,42,112,.12,70],
  [-171,100,45,75,.20,43], [-207,-157,56,63,-.12,51], [0,-215,145,40,.02,55],
  [200,-173,62,57,.25,39], [184,197,60,52,-.20,16],
];
export const CONTEXT_EXTENT = { minX:-370,maxX:370,minZ:-405,maxZ:310 };
const clamp = v => Math.max(0,Math.min(1,v));
const smooth = (a,b,v) => {const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};

export function contextTerrainHeight(x,z) {
  // Road and campus bases stay exactly level. Beyond them, only low rolling
  // landforms (single-digit metres) break the model-table silhouette.
  const edge=smooth(160,300,Math.hypot(x,z));
  const broad=fbm2(x*.0026,z*.0026,3,37),local=fbm2(x*.008,z*.008,3,91);
  return -.025+edge*(1.2+broad*6+(local-.5)*3+Math.sin(x*.008+z*.003)*.9);
}

export function woodlandDensity(x,z) {
  const outside=Math.max(Math.abs(x)-132,Math.abs(z-4)-112);
  const arrival=Math.abs(x)-(64+Math.max(0,z-115)*.20);
  if(outside<=0 || (z>115&&arrival<=0))return 0;
  let density=0;
  for(const [cx,cz,rx,rz,angle] of GROVES) {
    const dx=x-cx,dz=z-cz,c=Math.cos(angle),s=Math.sin(angle);
    const q=((dx*c+dz*s)/rx)**2+((-dx*s+dz*c)/rz)**2;
    density=Math.max(density,1-smooth(.16,1.0,q));
  }
  const edge=outside+(fbm2(x*.035,z*.035,2,196)-.5)*10;
  return density*smooth(0,10,edge)*(z>115?smooth(0,24,arrival):1);
}

export function planContextWoodland(accessDistance,groundAt=contextTerrainHeight) {
  const random=rng('campus-woodland-copses'),trees=[],shrubs=[],cells=new Map(),cellSize=12;
  for(const [cx,cz,rx,rz,angle,count] of GROVES) {
    let accepted=0;
    for(let attempt=0;attempt<count*100&&accepted<count;attempt++) {
      const [u,v]=random.disc(),c=Math.cos(angle),s=Math.sin(angle);
      const x=cx+u*rx*c-v*rz*s,z=cz+u*rx*s+v*rz*c,density=woodlandDensity(x,z);
      if(random.next()>density*.9+.03||density<.08)continue;
      const distance=Math.hypot(x,z),height=10+random.float(0,5)+density*5;
      // Include crown reach, not just the trunk, in the road setback.
      const crownRadius=height*.4+2.8;
      if(accessDistance(x,z)<5+crownRadius)continue;
      const spacing=6.5+Math.max(0,distance-200)*.010;
      const ix=Math.floor(x/cellSize),iz=Math.floor(z/cellSize);
      let crowded=false;
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const other of cells.get(`${ix+dx},${iz+dz}`)||[]) {
        if(Math.hypot(other.x-x,other.z-z)<Math.max(spacing,other.spacing))crowded=true;
      }
      if(crowded)continue;
      const ground=groundAt(x,z);
      const record={x,z,height,ground,near:distance<192,spacing,crownRadius,crownTop:ground+height+2.8};
      trees.push(record);accepted++;
      const key=`${ix},${iz}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(record);
      if(record.near&&shrubs.length<80&&random.chance(.58)) {
        const sx=x+random.float(-2.3,2.3),sz=z+random.float(-2.3,2.3);
        if(accessDistance(sx,sz)>9)shrubs.push({x:sx,z:sz,height:random.float(1.2,2.2),radius:random.float(1.3,2.1),kind:'woodland',ground:groundAt(sx,sz)});
      }
    }
  }
  // One broad canopy saddle on the western front edge. Apply only after the
  // legacy sampler finishes so roots, near flags, shrubs and its RNG stay fixed.
  for(const tree of trees) {
    const wx=smooth(-215,-190,tree.x)*(1-smooth(-145,-132,tree.x));
    const wz=smooth(-145,-90,tree.z)*(1-smooth(-40,25,tree.z)),weight=wx*wz;
    if(weight<=0)continue;
    tree.height+=(5.4+.42*tree.height-tree.height)*weight;
    tree.crownRadius=tree.height*.4+2.8;
    tree.crownTop=tree.ground+tree.height+2.8;
  }
  return {trees,shrubs};
}

export function woodlandGroundMask(accessDistance,size=128) {
  const data=new Uint8Array(size*size),e=CONTEXT_EXTENT;
  for(let z=0;z<size;z++)for(let x=0;x<size;x++) {
    const px=e.minX+(x+.5)/size*(e.maxX-e.minX),pz=e.minZ+(z+.5)/size*(e.maxZ-e.minZ);
    const density=woodlandDensity(px,pz);
    if(density===0)continue; // Empty woodland texels stay zero without scanning the access road.
    data[z*size+x]=Math.round(255*density*smooth(5,15,accessDistance(px,pz)));
  }
  return {data,size};
}
