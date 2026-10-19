import { rng } from '../core/rng.js';

// Stage changes so a clearance failure leaves the original planting intact.
export function planNorthGrove(plants, trees, freePlant, soilOutline) {
  if(!soilOutline||soilOutline.length<3)return false;
  const north=p=>Math.hypot(p.x/13,(p.z+22)/17)<1;
  const originalShrubs=plants.filter(p=>p.kind==='shrub'&&north(p));
  const originalCover=plants.filter(p=>p.kind==='groundcover'&&north(p));
  const shrubs=originalShrubs.map(p=>({...p}));
  const random=rng('grove-layered-drift-2026-10-16-v1');
  const westCount=Math.round(shrubs.length*.39),eastCount=Math.round(shrubs.length*.29);
  const groups=[
    {count:westCount,lobes:[[-5.4,-28,3.4,6.7],[-3.9,-22.1,3.8,5.4]],heightBias:.27},
    {count:eastCount,lobes:[[4.4,-27.2,3.2,5.8],[5.4,-22.2,3.3,4.2]],heightBias:.04},
    {count:shrubs.length-westCount-eastCount,lobes:[[-2.6,-14.3,5.3,3.9],[3.5,-13.6,3.6,3.3]],heightBias:-.03},
  ];
  const spots=[];
  for(const group of groups) {
    const minX=Math.min(...group.lobes.map(l=>l[0]-l[2])),maxX=Math.max(...group.lobes.map(l=>l[0]+l[2]));
    const minZ=Math.min(...group.lobes.map(l=>l[1]-l[3])),maxZ=Math.max(...group.lobes.map(l=>l[1]+l[3]));
    let count=0,attempts=0;
    while(count<group.count&&attempts++<150000) {
      const x=random.float(minX,maxX),z=random.float(minZ,maxZ);
      const depth=Math.min(...group.lobes.map(([cx,cz,rx,rz])=>Math.hypot((x-cx)/rx,(z-cz)/rz)));
      if(depth>1||Math.hypot(x/13,(z+22)/17)>.81)continue;
      if(!freePlant(x,z,.96)||trees.some(t=>Math.hypot(t.x-x,t.z-z)<.76))continue;
      if(spots.some(p=>Math.hypot(x-p.x,z-p.z)<.97))continue;
      spots.push({x,z,score:group.heightBias+(1-depth)*.7+random.float(-.045,.045)});count++;
    }
    // Keep the unchanged planting if later site constraints prevent all groups from fitting.
    if(count!==group.count)return false;
  }
  const rankedPlants=[...shrubs].sort((a,b)=>a.height-b.height);
  spots.sort((a,b)=>a.score-b.score);
  // Validate the final whole-plant footprint before mutating any input record.
  for(let i=0;i<rankedPlants.length;i++) {
    const p=rankedPlants[i],spot=spots[i],r=p.radius*1.06;
    if(!freePlant(spot.x,spot.z,r))return false;
    for(let step=0;step<32;step++) {
      const a=step*Math.PI/16;
      if(Math.hypot((spot.x+Math.cos(a)*r)/13,(spot.z+Math.sin(a)*r+22)/17)>=.97)return false;
    }
  }
  for(let i=0;i<rankedPlants.length;i++) {
    const plant=rankedPlants[i];
    plant.shapeSeed??=`campus-plant:${plant.kind}:${plant.x}:${plant.z}`;
    plant.x=spots[i].x;plant.z=spots[i].z;
  }

  const lowRandom=rng('grove-clonal-understory-v3b'),coverSpots=[];
  function soilClearance(x,z) {
    let inside=false,distance=Infinity;
    for(let i=0,j=soilOutline.length-1;i<soilOutline.length;j=i++) {
      const a=soilOutline[j],b=soilOutline[i],dx=b.x-a.x,dz=b.z-a.z;
      const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
      distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
      if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
    }
    return inside?distance:-distance;
  }
  const inside=(x,z,r)=>soilClearance(x,z)>=r&&freePlant(x,z,r)&&!trees.some(t=>Math.hypot(t.x-x,t.z-z)<.72);
  // Continuous planting beds. Farthest-point selection distributes the same leaf area across each bed,
  // instead of growing disconnected random colonies and leaving large accidental soil openings.
  const drifts=[
    {count:360,lobes:[[10.2,-17.5,2.8,5.8],[9.3,-23.8,3.6,4],[8.5,-13.5,2.7,2.9]]},
    {count:140,lobes:[[-7.4,-33.1,2.7,2.5],[-9.3,-29.6,2.2,3.3]]},
    {count:150,lobes:[[-3.6,-10.6,5.4,2.4],[3.6,-12.3,3.1,2.9]]},
    {count:70,lobes:[[-10,-21.5,1.4,6.5]]},
    {count:30,lobes:[[-.5,-21,1.8,2.5]]},
  ];
  for(const drift of drifts) {
    const minX=Math.min(...drift.lobes.map(l=>l[0]-l[2])),maxX=Math.max(...drift.lobes.map(l=>l[0]+l[2]));
    const minZ=Math.min(...drift.lobes.map(l=>l[1]-l[3])),maxZ=Math.max(...drift.lobes.map(l=>l[1]+l[3]));
    const pool=[];
    for(let attempt=0;pool.length<drift.count*12&&attempt<drift.count*240;attempt++) {
      const x=lowRandom.float(minX,maxX),z=lowRandom.float(minZ,maxZ);
      if(!drift.lobes.some(([cx,cz,rx,rz])=>Math.hypot((x-cx)/rx,(z-cz)/rz)<1)||!inside(x,z,.455))continue;
      if(shrubs.some(p=>Math.hypot(p.x-x,p.z-z)<.19))continue;
      if(Math.hypot((x+1.4)/.8,(z+22.4)/1.1)<1||Math.hypot((x-6.7)/.7,(z+27.6)/.85)<1)continue;
      const d=coverSpots.length?Math.min(...coverSpots.map(p=>(p.x-x)**2+(p.z-z)**2)):Infinity;
      pool.push({x,z,d});
    }
    if(pool.length<drift.count)return false;
    for(let count=0;count<drift.count;count++) {
      let best=0;
      for(let i=1;i<pool.length;i++)if(pool[i].d>pool[best].d)best=i;
      const next=pool[best];
      if(next.d<.28*.28)return false;
      coverSpots.push({x:next.x,z:next.z});next.d=-1;
      for(const candidate of pool)if(candidate.d>=0)candidate.d=Math.min(candidate.d,(candidate.x-next.x)**2+(candidate.z-next.z)**2);
    }
  }
  // Move concealed under-shrub cover into the north bed tail without thinning the east and west edges.
  const donors=coverSpots.map((p,index)=>({index,depth:Math.min(...shrubs.map(s=>Math.hypot(s.x-p.x,s.z-p.z)/s.radius))}))
    .filter(({index,depth})=>{const p=coverSpots[index];return depth<.8&&!(p.x>8&&p.z>-25)&&!(p.x<0&&p.z<-28);})
    .sort((a,b)=>a.depth-b.depth).slice(0,150);
  if(donors.length!==150)return false;
  const donorIndices=new Set(donors.map(p=>p.index)),retainedCover=coverSpots.filter((p,i)=>!donorIndices.has(i));
  const tailRandom=rng('grove-clonal-bedtail-v3c'),tailPool=[];
  const tailLobes=[[10.9,-27.9,1.8,4],[7.5,-32.7,3,2.7],[3.7,-35.6,3.8,2.1]];
  for(let attempt=0;tailPool.length<1800&&attempt<36000;attempt++) {
    const x=tailRandom.float(-.1,12.7),z=tailRandom.float(-37.7,-23.9);
    if(!tailLobes.some(([cx,cz,rx,rz])=>Math.hypot((x-cx)/rx,(z-cz)/rz)<1)||!inside(x,z,.455))continue;
    if(shrubs.some(p=>Math.hypot(p.x-x,p.z-z)<.19))continue;
    tailPool.push({x,z,d:Math.min(...retainedCover.map(p=>(p.x-x)**2+(p.z-z)**2))});
  }
  if(tailPool.length<donors.length)return false;
  for(const donor of donors) {
    let best=0;
    for(let i=1;i<tailPool.length;i++)if(tailPool[i].d>tailPool[best].d)best=i;
    const next=tailPool[best];if(next.d<.28*.28)return false;
    coverSpots[donor.index]={x:next.x,z:next.z};next.d=-1;
    for(const candidate of tailPool)if(candidate.d>=0)candidate.d=Math.min(candidate.d,(candidate.x-next.x)**2+(candidate.z-next.z)**2);
  }
  // Broad leaves are small accents at the back of the low cover, not a perimeter crop.
  const accentRandom=rng('grove-broadleaf-accents-v3'),accents=[];
  const accentLobes=[[-6.5,-16.6,2.2,2.8],[5.5,-18.1,1.8,2.5],[-7.1,-27.3,2.2,3],[5.5,-29.5,2.3,2.8]];
  for(const [cx,cz,rx,rz]of accentLobes) {
    let count=0,attempts=0;
    while(count<12&&attempts++<10000) {
      const [dx,dz]=accentRandom.disc(),x=cx+dx*rx,z=cz+dz*rz;
      if(!inside(x,z,.51)||accents.some(p=>Math.hypot(p.x-x,p.z-z)<.46)||shrubs.some(p=>Math.hypot(p.x-x,p.z-z)<.35))continue;
      accents.push({x,z});count++;
    }
    if(count!==12)return false;
  }
  const heightRandom=rng('grove-clonal-height-v3');
  if(originalCover.length<accents.length)return false;
  const cover=accents.map((spot,i)=>({...originalCover[i],...spot,shapeSeed:originalCover[i]?.shapeSeed??`campus-plant:groundcover:${originalCover[i]?.x}:${originalCover[i]?.z}`}));
  for(let i=0;i<coverSpots.length;i++)cover.push({...coverSpots[i],height:heightRandom.float(.13,.19),radius:.455,kind:'clonalGroundcover',ground:-.005,shapeSeed:`grove-clonal-plant-v3:${i}`});
  for(let i=0;i<shrubs.length;i++)Object.assign(originalShrubs[i],shrubs[i]);
  const oldCover=new Set(originalCover);
  const retained=plants.filter(p=>!oldCover.has(p));
  plants.splice(0,plants.length,...retained,...cover);
  return true;
}
