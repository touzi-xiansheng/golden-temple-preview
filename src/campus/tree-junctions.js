import * as THREE from 'three';

// Capture attachment parameters before the campus's piecewise height remaps.
// pd narrows the parent candidates; original position confirms the relationship.
// Shell twigs may attach to another level-4 twig. Maple leaders deliberately
// start 15 cm inside the trunk and retain that existing overlap.
export function captureTreeJunctions(branches){
 const links=[];
 for(let bi=1;bi<branches.length;bi++){
  const child=branches[bi],pd=child.pd[0];let best=null,bestDistance=Infinity;
  for(let pi=0;pi<bi;pi++){
   const parent=branches[pi];if((parent.level>=child.level&&!(child.level===4&&parent.level===4))||pd<parent.pd[0]-1e-8||pd>parent.pd.at(-1)+1e-8)continue;
   for(let segment=0;segment<parent.pts.length-1;segment++){
    if(pd<parent.pd[segment]-1e-8||pd>parent.pd[segment+1]+1e-8)continue;
    const t=THREE.MathUtils.clamp((pd-parent.pd[segment])/(parent.pd[segment+1]-parent.pd[segment]),0,1);
    const point=parent.pts[segment].clone().lerp(parent.pts[segment+1],t),distance=point.distanceTo(child.pts[0]);
    if(distance<bestDistance){bestDistance=distance;best={child:bi,parent:pi,segment,t,rawDistance:distance};}
   }
  }
  if(bestDistance<1e-7)links.push(best);
  else if(child.level===1&&best?.parent===0&&child.pts[0].clone().sub(branches[0].pts.at(-1)).distanceTo(new THREE.Vector3(0,-.15,0))<1e-7)continue;
  else throw new Error(`Unresolved original branch ${bi}, distance ${bestDistance}`);
 }
 return links;
}


// Work in parent-before-child order: a corrected root may itself carry a twig.
// Preserve every other point and sample parameter, including intentional maple
// leader overlap. Leaf placement then follows the repaired physical branches.
// shortcut: intersecting tubes can leave partial root openings; join their surfaces for close-up trunks.
export function restoreTreeJunctions(branches,junctions) {
  let changed=0;
  for(const link of junctions) {
    const parent=branches[link.parent],point=parent.pts[link.segment].clone().lerp(parent.pts[link.segment+1],link.t);
    const root=branches[link.child].pts[0];
    if(root.distanceTo(point)>1e-7)changed++;
    root.copy(point);
  }
  return changed;
}

// Leave rads intact: the shared mesher also uses them for tessellation, bark
// repeat and maturity. s is the remapped branch's actual arc length in metres.
export function campusBarkDisplacement(displacement) {
  return (theta,s,radius,branch,direction) => {
    const gain=branch.level===0?.68:branch.level===1
      ?.68*THREE.MathUtils.lerp(1,.68,THREE.MathUtils.smoothstep(s,.35,1.10)):.4624;
    return displacement(theta,s,radius,branch,direction)*gain;
  };
}

// Campus bark only. Call immediately after addBranch(trunk) so the current
// terminal ring is the accumulator's last S+1 vertices. No branch origins move.
export function closeTrunkTerminal(accumulator,branch){
 const S=branch.rads[0]>.14?9:branch.rads[0]>.05?6:3;
 const start=accumulator.vc-S-1,center=branch.pts.at(-1),axis=center.clone().sub(branch.pts.at(-2)).normalize();
 const rings=[];let sumRadius=0;
 for(let j=0;j<S;j++){
  const vertex=start+j,radial=new THREE.Vector3().fromArray(accumulator.pos,vertex*3).sub(center);
  rings.push({vertex,radial,radius:radial.length()});sumRadius+=radial.length();
 }
 const rise=sumRadius/S*.25,innerRadius=.55,innerHeight=rise*Math.sqrt(1-innerRadius**2),innerStart=accumulator.vc;
 function vertex(position,normal,original,u,v){
  const index=accumulator.vc++,a=original*4,b=original*3;
  accumulator.pos.push(...position.toArray());accumulator.nrm.push(...normal.toArray());
  accumulator.a.push(u,v,accumulator.a[a+2],accumulator.a[a+3]);
  accumulator.b.push(...accumulator.b.slice(b,b+3));return index;
 }
 for(let j=0;j<=S;j++){
  const ring=rings[j%S],outer=start+j,position=center.clone().addScaledVector(ring.radial,innerRadius).addScaledVector(axis,innerHeight);
  const normal=ring.radial.clone().multiplyScalar(innerRadius/(ring.radius**2)).addScaledVector(axis,innerHeight/(rise**2)).normalize();
  const arc=Math.hypot(ring.radius*(1-innerRadius),innerHeight);
  vertex(position,normal,outer,accumulator.a[outer*4],accumulator.a[outer*4+1]+arc);
 }
 for(let j=0;j<S;j++){
  const outer=start+j,inner=innerStart+j;
  accumulator.idx.push(outer,outer+1,inner+1,outer,inner+1,inner);
  // One center vertex per sector keeps cylindrical U interpolation local at
  // the pole; all positions/normals coincide, without a texture seam across U=0.
  const r=(rings[j].radius+rings[(j+1)%S].radius)/2;
  const arc=Math.hypot(r*(1-innerRadius),innerHeight)+Math.hypot(r*innerRadius,rise-innerHeight);
  const pole=vertex(center.clone().addScaledVector(axis,rise),axis,outer,
   (accumulator.a[outer*4]+accumulator.a[(outer+1)*4])*.5,accumulator.a[outer*4+1]+arc);
  accumulator.idx.push(inner,inner+1,pole);
 }
 return{segments:S,triangles:3*S,vertices:2*S+1,rise,originalRingStart:start,innerStart};
}

// Snapshot the actual trunk after its terminal dome, before other branches append.
// The upward containment ray cannot exit through the buried, open basal ring.
export function trunkVolume(accumulator,vertexStart,indexStart,trunk){
 const points=[];for(let i=vertexStart;i<accumulator.vc;i++)points.push(new THREE.Vector3().fromArray(accumulator.pos,i*3));
 const index=accumulator.idx.slice(indexStart).map(i=>i-vertexStart);
 const bounds=new THREE.Box3().setFromPoints(points).expandByScalar(1e-8);
 // These high fork queries use upward rays; the trunk's buried bottom is open.
 const ray=new THREE.Ray(new THREE.Vector3(),new THREE.Vector3(.371,.597,.711).normalize()),hit=new THREE.Vector3();
 function inside(p){
  if(!bounds.containsPoint(p))return false;ray.origin.copy(p);const distances=[];
  for(let i=0;i<index.length;i+=3)if(ray.intersectTriangle(points[index[i]],points[index[i+1]],points[index[i+2]],false,hit)){
   const d=hit.distanceTo(p);if(d<1e-7)return true;if(!distances.some(v=>Math.abs(v-d)<1e-7))distances.push(d);
  }
  return distances.length%2===1;
 }
 return{points,index,bounds,inside,axis:trunk.pts.at(-1).clone().sub(trunk.pts.at(-2)).normalize()};
}
// Extend the real tube wall until its open boundary is buried inside the trunk.
// Apply only to captured primary attachments, preserving intentional Maple offsets.
// Positions and UVs of existing rings stay fixed; root normals include the new wall.
// The surfaces still intersect: this is not a Boolean union or whole-tree closure.
export function extendPrimaryRoot(accumulator,branch,rootStart,parent){
 const S=branch.rads[0]>.14?9:branch.rads[0]>.05?6:3;
 const ring=Array.from({length:S+1},(_,j)=>new THREE.Vector3().fromArray(accumulator.pos,(rootStart+j)*3));
 if(ring.every(parent.inside))return{changed:false,triangles:0,vertices:0};
 const axis=branch.pts[1].clone().sub(branch.pts[0]).normalize(),back=axis.clone().negate();
 const radius=Math.max(...ring.map(p=>p.distanceTo(branch.pts[0]))),samples=[];
 for(let edge=0;edge<S;edge++)for(let sub=0;sub<4;sub++)for(const r of[.25,.5,.75,1])samples.push(ring[edge].clone().lerp(ring[edge+1],sub/4).sub(branch.pts[0]).multiplyScalar(r).add(branch.pts[0]));
 samples.push(branch.pts[0].clone());
 let depth=null,direction=null,axisBlend=null;
 for(const blend of [0,.25,.5,.75,1]){
  const travel=back.clone().lerp(parent.axis.clone().negate(),blend).normalize();
  for(let d=.005;d<=radius*3;d+=.005){
   if(samples.every(p=>parent.inside(p.clone().addScaledVector(travel,d)))&&samples.every(p=>parent.inside(p.clone().addScaledVector(travel,d+.003)))){depth=d+.003;direction=travel;axisBlend=blend;break;}
  }
  if(depth!==null)break;
 }
 if(depth===null)return{changed:false,failed:true,radius,axis:axis.toArray(),triangles:0,vertices:0};
 const start=accumulator.vc;
 for(let j=0;j<=S;j++){
  const original=rootStart+j,position=ring[j].clone().addScaledVector(direction,depth);
  const tangent=ring[(j+1)%S].clone().sub(ring[(j+S-1)%S]),radial=ring[j].clone().sub(branch.pts[0]);
  const next=new THREE.Vector3().fromArray(accumulator.pos,(rootStart+S+1+j)*3);
  const seamNormal=tangent.clone().cross(next.clone().sub(position)).normalize(),innerNormal=tangent.clone().cross(direction.clone().negate()).normalize();
  if(seamNormal.dot(radial)<0)seamNormal.negate();if(innerNormal.dot(radial)<0)innerNormal.negate();
  seamNormal.toArray(accumulator.nrm,original*3);
  accumulator.pos.push(...position.toArray());accumulator.nrm.push(...innerNormal.toArray());
  accumulator.a.push(accumulator.a[original*4],accumulator.a[original*4+1]-depth,accumulator.a[original*4+2],accumulator.a[original*4+3]);
  accumulator.b.push(...accumulator.b.slice(original*3,original*3+3));accumulator.vc++;
 }
 for(let j=0;j<S;j++)accumulator.idx.push(start+j,start+j+1,rootStart+j,start+j+1,rootStart+j+1,rootStart+j);
 return{changed:true,depth,axisBlend,direction:direction.toArray(),radius,axis:axis.toArray(),rootStart,innerStart:start,triangles:S*2,vertices:S+1,diskSamples:samples.length,allInside:samples.every(p=>parent.inside(p.clone().addScaledVector(direction,depth)))};
}
