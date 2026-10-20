import * as THREE from 'three';
import {rng} from '../core/rng.js';
import {sampleBranch,envRho} from '../world/vegetation-tree.js';

// Whole growth graph. Radii and leaf spacing are metres; cohorts are a design hypothesis, not measured botanical age.
export function buildCampusBroadleaf(tree,crownField,space=null,{refined=false}={}) {
  const random=rng(space?space.seed:'campus-whole-tree-ti6-v1'),base=new THREE.Vector3(tree.x,tree.ground||0,tree.z);
  // The no-options call deliberately preserves the accepted ti6 graph and AO.
  const form=space?rng(space.seed+':form'):null;
  const aspect=form?form.float(.93,1.07):1,phase=form?form.float(0,Math.PI*2):0,dominant=form?form.float(0,Math.PI*2):0;
  const up=new THREE.Vector3(0,1,0),branches=[],leaves=[],bindings=[];
  const top=space?space.height-.35:11.65,clearance=space?space.clearance+.30:3.20;
  const rx=space?space.radius*1.08*aspect:5.25,rz=space?space.radius*1.08/aspect:5.10;
  const lower=space?clearance+.26*(top-clearance):5.3,middleHeight=space?clearance+.58*(top-clearance):8.2;
  const ceiling=space?space.height-.08:11.98,capHeight=space?space.height-middleHeight+.10:3.85;
  const stages={primary:0,middle:0,shoot:0,petiole:0,seasonalAxis:0,matureMiddle:0,dormantMiddle:0,dormantShoot:0,boundaryStops:0};
  const domain=p=>{
    const y=p.y-base.y;
    if(y<clearance||y>ceiling)return false;
    const crownWidth=y<lower?.74+.26*(y-clearance)/(lower-clearance):y<middleHeight?1:Math.max(.12,Math.sqrt(Math.max(0,1-((y-middleHeight)/capHeight)**2)));
    // Broad crown lobes constrain connected growth, rather than moving leaves
    // after generation and separating them from their petioles. Never expand
    // the accepted clearance envelope towards buildings or pedestrian paths.
    const azimuth=Math.atan2(p.z-base.z,p.x-base.x);
    const lobe=refined?.92+.08*Math.cos(3*azimuth+tree.x*.31+tree.z*.17):1;
    return ((p.x-base.x)/rx)**2+((p.z-base.z)/rz)**2<(crownWidth*lobe)**2;
  };
  const frame=tangent=>{
    const Z=up.clone().addScaledVector(tangent,-up.dot(tangent));
    if(Z.lengthSq()<1e-6)Z.set(1,0,0).addScaledVector(tangent,-tangent.x);
    Z.normalize();return {X:new THREE.Vector3().crossVectors(tangent,Z).normalize(),Z};
  };
  function addBranch(parent,t,direction,length,radius,tipRadius,level,{bend=0,upward=0,segment=.18,vigour=1,leafy=false}={}) {
    const anchor=parent===null?{p:base.clone().add(new THREE.Vector3(0,-.20,0)),T:up,r:.19,pd:0}:sampleBranch(branches[parent],t);
    const rootRadius=parent===null?radius:Math.min(radius,anchor.r*.34),pts=[anchor.p.clone()],rads=[],pd=[anchor.pd];
    const d=direction.clone().normalize(),side=frame(d).X,phase=random.float(0,Math.PI*2),steps=Math.max(1,Math.ceil(length/segment)),step=length/steps;
    for(let i=1;i<=steps;i++) {
      const u=i/steps,next=d.clone().addScaledVector(side,bend*Math.sin(u*Math.PI+phase));next.y+=upward*u;next.normalize();
      const p=pts.at(-1).clone().addScaledVector(next,step);
      if(level>0&&!domain(p)){stages.boundaryStops++;break;}
      pts.push(p);pd.push(pd.at(-1)+step);
    }
    if(pts.length<2)return null;
    for(let i=0;i<pts.length;i++)rads.push(THREE.MathUtils.lerp(rootRadius,Math.min(tipRadius,rootRadius*.22),(i/(pts.length-1))**.85));
    const branch={pts,rads,pd,level,parent,t,vigour,leafy,radial:level===0?9:level===1?7:level===2?5:3};
    branches.push(branch);return branches.length-1;
  }
  const trunkDirection=space?new THREE.Vector3(form.float(-.024,.024),1,form.float(-.024,.024)):new THREE.Vector3(.014,1,-.011);
  const trunk=addBranch(null,0,trunkDirection,top+.2,space?.19*(space.height/12)**.8:.19,.003,0,{bend:.018,segment:.25});
  const primary=[],births=[];
  if(space)for(let y=clearance+.35+form.float(0,.10);y<clearance+.78*(top-clearance);y+=form.float(.42,.62))births.push(y);
  for(let i=0;i<(space?births.length:14);i++) {
    const fraction=space?i/Math.max(1,births.length-1):i/13;
    const y=space?births[i]:3.62+i*.475+random.float(-.09,.09),t=(y+.2)/(top+.2),age=space?1-.765*fraction:1-i/17;
    const angle=(space?phase:.43)+i*2.39996323+random.float(-.21,.21),vigour=random.float(.78,1.16);
    const d=new THREE.Vector3(Math.cos(angle),.20+(space?.46*fraction:.035*i)+random.float(-.11,.12),Math.sin(angle)).normalize();
    const length=space?space.radius*(.94-.31*fraction)*(.86+.18*vigour)*(1+.10*Math.cos(angle-dominant)):(4.55-.105*i)*(.90+.10*vigour);
    const id=addBranch(trunk,t,d,length,.082*age,.005,1,{bend:random.float(-.16,.16),upward:.025,vigour,segment:.24});
    if(id!==null){branches[id].age=age;primary.push(id);stages.primary++;}
  }
  // The youngest trunk growth participates in the same lateral rule at the top.
  const parents=[...primary,trunk],middle=[];
  for(const parent of parents) {
    const branch=branches[parent],length=branch.pd.at(-1)-branch.pd[0],isTrunk=parent===trunk;
    const start=isTrunk?(space?clearance+.78*(top-clearance):9.5):.50,end=length-(isTrunk?.32:.20),spacing=.32;
    let ordinal=0;
    for(let distance=start;distance<end;distance+=spacing*random.float(.92,1.12),ordinal++) {
      const t=distance/length,node=sampleBranch(branch,t),f=frame(node.T);
      const family=branch.vigour||1;
      if(!isTrunk&&ordinal%6===4&&family<1){stages.dormantMiddle++;continue;}
      const az=.65+ordinal*2.39996323+random.float(-.26,.26);
      const side=f.X.clone().multiplyScalar(Math.cos(az)).addScaledVector(f.Z,Math.sin(az));
      // Older branch families carry longer, outward-reaching intermediate axes.
      // The leader/primary centre lines and all physical leaf dimensions stay fixed.
      const age=isTrunk?0:branch.age*(1-.22*t),maturity=THREE.MathUtils.clamp((age-.24)/.65,0,1);
      const d=node.T.clone().multiplyScalar(.70).addScaledVector(side,.71);d.y+=.07;d.normalize();
      const len=(isTrunk?.77:1.10+random.float(-.16,.24))*family*(.95-.12*t)*(1+.62*maturity);
      const id=addBranch(parent,t,d,len,.021,.0019,2,{bend:random.float(-.22,.22),upward:.10,vigour:family*(.90+random.float(-.14,.14)),segment:.18});
      if(id!==null){branches[id].age=age;branches[id].maturity=maturity;middle.push(id);stages.middle++;if(maturity>.35)stages.matureMiddle++;}
    }
  }
  // A surviving older middle axis has one or two subsequent lateral growth axes.
  // They share its vigour and occupy neighbouring, unequal volumes rather than
  // increasing leaves per node everywhere or placing independent foliage balls.
  const seasonal=[];
  for(const parent of middle) {
    const branch=branches[parent],length=branch.pd.at(-1)-branch.pd[0];
    if(branch.age<.50||branch.vigour<.86||length<.8)continue;
    const count=branch.age>.72?2:1;
    for(let i=0;i<count;i++) {
      const t=count===2?(i===0?.43:.72):.59,node=sampleBranch(branch,t),f=frame(node.T);
      const az=.55+parent*.63+i*2.39996323;
      const side=f.X.clone().multiplyScalar(Math.cos(az)).addScaledVector(f.Z,Math.sin(az));
      const d=node.T.clone().multiplyScalar(.64).addScaledVector(side,.77);d.y+=.10;d.normalize();
      const extension=(.62+.35*branch.maturity)*branch.vigour*(i===0?1:.78);
      const id=addBranch(parent,t,d,extension,.006,.0012,3,{bend:random.float(-.16,.16),upward:.08,vigour:branch.vigour*(i===0?1:.88),segment:.18});
      if(id!==null){branches[id].age=0;branches[id].maturity=0;seasonal.push(id);stages.seasonalAxis++;}
    }
  }
  const shoots=[];
  for(const parent of [...middle,...seasonal]) {
    const branch=branches[parent],length=branch.pd.at(-1)-branch.pd[0];let ordinal=0;
    // Older proximal wood is no longer leafy; adjacent recent axes supply the mass.
    const start=branch.level===2?.10+.12*branch.maturity:.08;
    for(let distance=start;distance<length-.07;distance+=.17*random.float(.91,1.12),ordinal++) {
      if(ordinal%7===5&&branch.vigour<.94){stages.dormantShoot++;continue;}
      const t=distance/length,node=sampleBranch(branch,t),f=frame(node.T),az=ordinal*2.39996323+parent*.63;
      const lateral=f.X.clone().multiplyScalar(Math.cos(az)).addScaledVector(f.Z,Math.sin(az));
      const d=node.T.clone().multiplyScalar(.48).addScaledVector(lateral,.88);d.y+=.12;d.normalize();
      const shootLength=(.49+random.float(-.10,.17))*Math.sqrt(branch.vigour);
      const id=addBranch(parent,t,d,shootLength,.0039,.00065,branch.level+1,{bend:random.float(-.24,.24),upward:.10,vigour:branch.vigour,leafy:true,segment:.17});
      if(id!==null){shoots.push(id);stages.shoot++;}
    }
    // A living continuation at the end overlaps neighbouring laterals instead of a terminal cap.
    if(length>.32) {
      const node=sampleBranch(branch,.89),id=addBranch(parent,.89,node.T.clone().addScaledVector(up,.24).normalize(),.40*branch.vigour,.0023,.00055,branch.level+1,{upward:.12,leafy:true,segment:.17});
      if(id!==null){shoots.push(id);stages.shoot++;}
    }
  }
  for(const parent of shoots) {
    const branch=branches[parent],length=branch.pd.at(-1)-branch.pd[0],pitch=random.float(.035,.045),phase=random.float(0,.7);let ordinal=0;
    for(let distance=.035+phase*pitch;distance<length-.025;distance+=pitch,ordinal++) {
      const t=distance/length,node=sampleBranch(branch,t),f=frame(node.T),az=ordinal*2.39996323+parent*.31;
      const side=f.X.clone().multiplyScalar(Math.cos(az)).addScaledVector(f.Z,Math.sin(az));
      const Y=node.T.clone().multiplyScalar(.28).addScaledVector(side,.87);Y.y-=random.float(.05,.25);Y.normalize();
      const normal=up.clone().add(new THREE.Vector3(random.float(-.7,.7),random.float(-.1,.2),random.float(-.7,.7))).normalize();
      const Z=normal.clone().addScaledVector(Y,-normal.dot(Y)).normalize(),X=new THREE.Vector3().crossVectors(Y,Z).normalize();
      const petioleDirection=Y.clone().multiplyScalar(.85).addScaledVector(normal,.15).normalize(),petioleLength=random.float(.025,.045),p=node.p.clone().addScaledVector(petioleDirection,petioleLength);
      const w=random.float(.075,.125),l=random.float(.135,.225),matrix=new THREE.Matrix4().makeBasis(X.multiplyScalar(w),Y.clone().multiplyScalar(l),Z.multiplyScalar(l));matrix.setPosition(p);
      const petiole=branches.length;
      branches.push({pts:[node.p,p],rads:[Math.min(.0005,node.r*.28),Math.min(.00022,node.r*.15)],pd:[node.pd,node.pd+petioleLength],level:branch.level+1,parent,t,radial:3,petiole:true});stages.petiole++;
      const tint=random.float(0,.72),value=random.float(.87,1.1);
      const origin=branch.pts[0],cohort=.36+.24*Math.sin(origin.x*.81+origin.y*.65+origin.z*.73);
      const color=new THREE.Color(0x365c2c).lerp(new THREE.Color(0x718849),refined?cohort*.75+tint*.25:tint).multiplyScalar(refined?1+(value-1)*.4:value);
      const ao=space?1:.4+.6*THREE.MathUtils.smoothstep(envRho(p,crownField(p)),.2,1.05);
      leaves.push({matrix,color,normal,ao});bindings.push({parent,segment:t*(branch.pts.length-1),t,petiole});
    }
  }
  const result={branches,leaves,cards:[],bindings,stats:{stages,branches:branches.length,leaves:leaves.length,cards:0,root:base.toArray(),physicalRadii:true}};
  if(space) {
    // One measured envelope supplies both the existing AO formula and GI proxy.
    // The .24 m padding includes the longest unscaled physical blade and petiole.
    const bounds=new THREE.Box3(),point=new THREE.Vector3();
    for(const leaf of leaves)bounds.expandByPoint(point.setFromMatrixPosition(leaf.matrix));
    bounds.expandByScalar(.24);
    const envelope={c:bounds.getCenter(new THREE.Vector3()),r:bounds.getSize(new THREE.Vector3()).multiplyScalar(.5)};
    for(const leaf of leaves)leaf.ao=.4+.6*THREE.MathUtils.smoothstep(envRho(point.setFromMatrixPosition(leaf.matrix),envelope),.2,1.05);
    result.crownEnvelope={center:envelope.c.toArray(),radii:envelope.r.toArray()};
    result.stats.crownEnvelope=result.crownEnvelope;
  }
  return result;
}
