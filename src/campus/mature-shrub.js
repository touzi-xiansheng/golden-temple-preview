import * as THREE from 'three';
import { rng } from '../core/rng.js';
import { shrubLeafGeometry, curvedShrubLeafGeometry } from './shrub-leaf.js';

// shortcut: taper and radius ratios are design assumptions; recheck tube diameters before extending this morphology to other scales.
export const MATURE_STEM_TAPER=.90;

// Species-informed node graph; exact bud activation and internode lengths are design assumptions.
export function planMatureShrub(plant, { branch, leaf }) {
  const { x, z, ground = 0, height: h, radius: r, shapeSeed, detail = false } = plant;
  if (![x,z,ground,h,r].every(Number.isFinite) || h < 1.3 || h > 1.9 || r < .9 || r > 1.25 || typeof shapeSeed !== 'string')
    throw new Error('Invalid mature border shrub');
  const random=rng(`paired-border-v1:${shapeSeed}`),up=new THREE.Vector3(0,1,0);
  const mature=new THREE.Color(0x355a2f),young=new THREE.Color(0x6c8446);
  const stems=[],leaves=[],axes=[],bindings=[],nodes=[],budNodes=[];
  const root=new THREE.Vector3(x,ground-.025,z),phase=random.float(0,Math.PI*2);
  const f32=m=>new THREE.Matrix4().fromArray(new Float32Array(m.elements));
  function axis(points,radius,parent=null,level=0,kind='wood') {
    const id=axes.length,stemStart=stems.length;
    for(let i=0;i<points.length-1;i++)branch(points[i],points[i+1],radius*Math.pow(MATURE_STEM_TAPER,i),stems);
    const matrices=stems.slice(stemStart).map(s=>f32(s.matrix));
    const lengths=matrices.map(m=>new THREE.Vector3().setFromMatrixColumn(m,1).length());
    const a={id,level,kind,points,radius,parent,stemStart,segments:points.length-1,lengths,length:lengths.reduce((s,v)=>s+v,0)};
    axes.push(a);return a;
  }
  function sample(a,u) {
    const f=u*a.segments,segment=Math.min(a.segments-1,Math.floor(f)),t=f-segment;
    const matrix=f32(stems[a.stemStart+segment].matrix);
    return {position:new THREE.Vector3(0,t-.5,0).applyMatrix4(matrix),direction:new THREE.Vector3().setFromMatrixColumn(matrix,1).normalize(),
      radius:new THREE.Vector3().setFromMatrixColumn(matrix,0).length()*(1-(1-MATURE_STEM_TAPER)*t),parent:{axis:a.id,segment,t}};
  }
  function atDistance(a,distance) {
    if(distance<0||distance>a.length)throw new Error('Paired node outside actual stem');
    let remaining=distance,segment=0;
    while(segment<a.segments-1&&remaining>a.lengths[segment])remaining-=a.lengths[segment++];
    return sample(a,(segment+remaining/a.lengths[segment])/a.segments);
  }
  function frame(tangent,preferred) {
    const X=preferred.clone().addScaledVector(tangent,-preferred.dot(tangent));
    if(X.lengthSq()<1e-8)X.set(1,0,0).addScaledVector(tangent,-tangent.x);
    if(X.lengthSq()<1e-8)X.set(0,0,1).addScaledVector(tangent,-tangent.z);
    X.normalize();return {X,Z:new THREE.Vector3().crossVectors(tangent,X).normalize()};
  }
  function curved(start,end,lift,segments) {
    const middle=start.clone().lerp(end,.5);middle.y+=lift;
    return new THREE.QuadraticBezierCurve3(start,middle,end).getPoints(segments);
  }
  function leafyAxis(start,direction,length,pairCount,preferred,parent,bud) {
    const end=start.position.clone().addScaledVector(direction,length);
    const current=axis([start.position,end],start.radius*.40,parent,3,'currentShoot');
    current.bud=bud;
    const inherited=frame(direction,preferred),first=(current.length-(pairCount-1)*.05)*.5;
    for(let n=0;n<pairCount;n++) {
      const distance=first+n*.05,point=atDistance(current,distance),angle=n*Math.PI*.5;
      const across=inherited.X.clone().multiplyScalar(Math.cos(angle)).addScaledVector(inherited.Z,Math.sin(angle));
      const node={id:nodes.length,axis:current.id,distance,parent:point.parent,position:point.position.clone(),leaves:[],petioles:[]};nodes.push(node);
      for(const side of [-1,1]) {
        const petioleEnd=point.position.clone().addScaledVector(across,side*.010);
        const petiole=axis([point.position,petioleEnd],Math.min(.0007,point.radius*.28),point.parent,4,'petiole');
        petiole.node=node.id;petiole.side=side;
        const actualEnd=sample(petiole,1).position;
        const Y=across.clone().multiplyScalar(side*.92).addScaledVector(direction,.20).addScaledVector(up,.15).normalize();
        const outward=new THREE.Vector3(actualEnd.x-x,.4*h,actualEnd.z-z).normalize();
        const normal=up.clone().multiplyScalar(.7).addScaledVector(outward,.3).normalize();
        const color=mature.clone().lerp(young,random.float(.12,.48)+(distance/current.length)*.15);
        leaf(actualEnd,Y,normal,random.float(.04,.06),random.float(.08,.10),color,
          .5+.4*THREE.MathUtils.smoothstep(Math.hypot(actualEnd.x-x,actualEnd.z-z)/r,.15,.85),leaves);
        node.leaves.push(leaves.length-1);node.petioles.push(petiole.id);
        bindings.push({axis:petiole.id,segment:0,t:1,node:node.id,side});
      }
    }
    return current;
  }
  for(let stool=0;stool<6;stool++) {
    const az=phase+stool*2.399963+random.float(-.12,.12);
    const base=root.clone().add(new THREE.Vector3(Math.cos(az)*.035,0,Math.sin(az)*.035));
    const fork=new THREE.Vector3(x+Math.cos(az)*r*.065,ground+h*.10,z+Math.sin(az)*r*.065);
    const basal=axis(curved(base,fork,h*.006,2),random.float(.022,.033),null,0,'basal');
    for(let arm=0;arm<2;arm++) {
      const role=(stool*2+arm)%3,hand=arm===0?-1:1;
      const attachment=sample(basal,arm===0?.82:.91),yaw=az+hand*.43;
      const radial=new THREE.Vector3(Math.cos(yaw),0,Math.sin(yaw)),side=new THREE.Vector3(-Math.sin(yaw),0,Math.cos(yaw));
      const reach=r*random.float([.48,.39,.19][role],[.56,.47,.29][role]);
      const end=root.clone().addScaledVector(radial,reach);end.y=ground+h*random.float([.18,.44,.66][role],[.24,.52,.70][role]);
      const terminal=radial.clone().multiplyScalar(.40).addScaledVector(side,hand*.88).addScaledVector(up,[-.12,.30,.95][role]).normalize();
      const span=attachment.position.distanceTo(end),middle=attachment.position.clone().lerp(end,.53);middle.y+=h*[.12,.08,.025][role];
      const support=axis([attachment.position,attachment.position.clone().lerp(middle,.58),middle,end.clone().addScaledVector(terminal,-span*.22),end],attachment.radius*.48,attachment.parent,1,'support');
      for(let shoot=0;shoot<4;shoot++) {
        const point=sample(support,[.20,.45,.70,.94][shoot]);
        const outward=new THREE.Vector3(point.position.x-x,0,point.position.z-z).normalize(),across=new THREE.Vector3(-outward.z,0,outward.x);
        const direction=shoot===3?point.direction.clone():outward.clone().multiplyScalar(.25).addScaledVector(across,(shoot%2?-1:1)*hand*.84).addScaledVector(up,[.06,.26,.62][role]+(shoot-1)*.10).normalize();
        // Reserve the terminal flush before generating wood, rather than adding beyond the old tip or clipping leaves.
        const carrierEnd=point.position.clone().addScaledVector(direction,.42*r-.22);
        const carrier=axis(curved(point.position,carrierEnd,h*.006,2),point.radius*.40,point.parent,2,'previousShoot');
        const carrierFrame=frame(direction,across);
        for(let n=0;n<2;n++) {
          const distance=carrier.length-(n===0?.08:.03),node=atDistance(carrier,distance);
          const bud={id:budNodes.length,axis:carrier.id,distance,parent:node.parent,position:node.position.clone(),activeSides:n===0?[-1,1]:[hand],shoots:[]};budNodes.push(bud);
          const pairSide=n===0?carrierFrame.X:carrierFrame.Z;
          for(const sign of bud.activeSides) {
            const lateral=pairSide.clone().multiplyScalar(sign);
            const growth=node.direction.clone().multiplyScalar(.35).addScaledVector(lateral,.85).addScaledVector(up,.15).normalize();
            bud.shoots.push(leafyAxis(node,growth,.16,3,lateral,node.parent,{node:bud.id,side:sign,terminal:false}).id);
          }
        }
        // A 2mm embedded root is a physical tube join at the terminal bud, not a new side node.
        const tip=atDistance(carrier,carrier.length-.002);
        leafyAxis(tip,tip.direction,.22,4,carrierFrame.X,tip.parent,{axis:carrier.id,terminal:true});
      }
    }
  }
  const stemGeometry=new THREE.CylinderGeometry(MATURE_STEM_TAPER,1,1,4,1,true),leafGeometry=detail?curvedShrubLeafGeometry():shrubLeafGeometry();
  const bounds=new THREE.Box3(),leafBounds=new THREE.Box3(),woodBounds=new THREE.Box3();let maxRadius=0,leafArea=0;
  try {
    for(const [records,geometry,isLeaf]of[[stems,stemGeometry,false],[leaves,leafGeometry,true]]) {
      const positions=geometry.attributes.position;
      for(const record of records) {
        const matrix=f32(record.matrix),vertices=[];
        for(let i=0;i<positions.count;i++) {
          const p=new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(matrix),radial=Math.hypot(p.x-x,p.z-z);vertices.push(p);
          if(!p.toArray().every(Number.isFinite)||radial>r||p.y>ground+h||p.y<ground-(isLeaf?0:.065))
            throw new Error(`Paired shrub exceeds physical envelope: ${shapeSeed} ${isLeaf?'leaf':'wood'} [${p.toArray()}] radius ${radial}/${r}`);
          bounds.expandByPoint(p);(isLeaf?leafBounds:woodBounds).expandByPoint(p);maxRadius=Math.max(maxRadius,radial);
        }
        if(isLeaf)for(let i=0;i<geometry.index.count;i+=3) {
          const a=vertices[geometry.index.getX(i)],b=vertices[geometry.index.getX(i+1)],c=vertices[geometry.index.getX(i+2)];
          leafArea+=new THREE.Vector3().subVectors(b,a).cross(new THREE.Vector3().subVectors(c,a)).length()*.5;
        }
      }
    }
  } finally {stemGeometry.dispose();leafGeometry.dispose();}
  return {plant:{x,z,ground,height:h,radius:r,shapeSeed,detail},stemTaper:MATURE_STEM_TAPER,stems,leaves,axes,bindings,nodes,budNodes,bounds,leafBounds,woodBounds,maxRadius,
    stats:{leaders:6,supports:12,carriers:48,currentShoots:192,leafNodes:nodes.length,petioles:axes.filter(a=>a.kind==='petiole').length,stemSegments:stems.length,leaves:leaves.length,leafArea,triangles:stems.length*8+leaves.length*(detail?12:4)}};
}
