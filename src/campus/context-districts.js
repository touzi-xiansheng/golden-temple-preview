import * as THREE from 'three';
import { Builder, mat4 } from '../core/geom.js';
import { rng, fbm2 } from '../core/rng.js';
import { createGroundSampler } from './context-visibility.js';

// Fixed neighbours, with their own frontages and access, outside the existing woodland.
export const CONTEXT_DISTRICTS = [
  {id:'research',bounds:[-230,210,-620,-350],shadow:[-620,260,-680,-25],buildings:[
    ['a1',-155,-425,64,36,16],['a2',-45,-425,64,36,16],['a3',-355,-235,72,40,20],['a4',-355,-125,72,40,18],
  ]},
  {id:'engineering',bounds:[390,690,-620,-330],shadow:[398,665,-550,-320],buildings:[
    ['b1',455,-370,80,48,10],['b2',590,-365,90,54,12],['b3',455,-510,80,52,12],['b4',595,-510,90,54,10],
  ]},
  {id:'amenities',bounds:[390,650,-105,110],shadow:[400,620,-75,5],buildings:[
    ['c1',455,-35,68,38,10],['c2',565,-35,70,38,8],
  ]},
];
export const CONTEXT_JUNCTION = {x:350,z:151,halfWidth:11};

function tint(geometry, color, roof = null) {
  const c=new THREE.Color(color),top=roof?new THREE.Color(roof):c;
  const p=geometry.attributes.position,n=geometry.attributes.normal,colors=[];
  for(let i=0;i<p.count;i++){const v=n.getY(i)>.9?top:c;colors.push(v.r,v.g,v.b);}
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));return geometry;
}

// A finite distant-window approximation: a dielectric surface over a matte
// backing. Keep the existing scene probe; no transparent wall or new capture.
function createResearchGlazing() {
  const material=new THREE.MeshStandardMaterial({color:0x000000,vertexColors:true,
    roughness:.09,metalness:0,envMapIntensity:1,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  material.name='context-dielectric-backed-glazing';
  const uniforms={
    uContextBackingAlbedo:{value:new THREE.Vector3(.09,.095,.09)},
    uContextBulkTransmission:{value:.86},
  };
  material.userData.contextGlazing={targetIds:['a1','a2','a3','a4'],uniforms};
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.fragmentShader=shader.fragmentShader
      .replace('#include <common>',`#include <common>
        uniform float uContextBulkTransmission;
        uniform vec3 uContextBackingAlbedo;`)
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
        // Standard supplies neutral dielectric F0=.04. Black base color removes
        // the old exterior-painted diffuse lobe, leaving one backing contribution.
        float windowNV=clamp(abs(dot(normalize(vViewPosition),nonPerturbedNormal)),0.0,1.0);
        float exitTransmission=.96*(1.0-pow(1.0-windowNV,5.0));
        vec3 backingIncident=vec3(0.0);
        #if defined(RE_IndirectDiffuse)
          // Read the existing post-GI / PMREM mixture once. The entry estimate
          // is the cosine-weighted Schlick transmission for diffuse illumination.
          backingIncident=max(irradiance+iblIrradiance,vec3(0.0))*(.96*20.0/21.0);
        #endif
        #if NUM_DIR_LIGHTS > 0
          // shortcut: one sun. Distant panes do not receive real-time object
          // shadows; the separate neighbourhood atlas shades their ground only.
          float windowNL=max(dot(nonPerturbedNormal,directLight.direction),0.0);
          float sunEntry=.96*(1.0-pow(1.0-windowNL,5.0));
          backingIncident+=directLight.color*windowNL*sunEntry;
        #endif
        // Received backing radiance, not a constant emissive light. Neutral
        // albedo and bulk transmission are explicit distant-window assumptions.
        totalEmissiveRadiance=uContextBackingAlbedo*backingIncident*RECIPROCAL_PI
          *uContextBulkTransmission*uContextBulkTransmission*exitTransmission;`);
  };
  material.customProgramCacheKey=()=> 'context-dielectric-backed-glazing-v1';
  return material;
}

// The four research offices share the same real opening geometry.
// Geometry carries explicit aperture coordinates; the shared Builder is unchanged.
function createResearchRecess(glass) {
  const reveal=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.84});
  const frame=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.48,metalness:0});
  reveal.name='context-recess-stone';frame.name='context-recess-frames';
  const openingDepth=.45,glassThickness=.024,mullionWidth=.08,mullionFront=-.33;
  const pools=new Map([glass,reveal,frame].map(m=>[m,{position:[],normal:[],uv:[],color:[],openingPoint:[],openingSize:[],openingNormal:[]}])) ,openings=[];
  function visibility(material) {
    const previous=material.onBeforeCompile,key=material.customProgramCacheKey();
    material.onBeforeCompile=function(shader,renderer) {
      previous.call(this,shader,renderer);
      shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
        attribute vec3 openingPoint,openingNormal;
        attribute vec2 openingSize;
        varying vec3 vOpeningPoint,vOpeningNormal;
        varying vec2 vOpeningSize;`)
        .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
          vOpeningPoint=openingPoint;vOpeningSize=openingSize;
          vOpeningNormal=normalize(mat3(modelMatrix)*openingNormal);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
        varying vec3 vOpeningPoint,vOpeningNormal;
        varying vec2 vOpeningSize;
        float contextBarInterval(vec3 p,vec3 ray,float center,float halfHeight) {
          vec3 safeRay=mix(vec3(-1.0),vec3(1.0),step(vec3(0.0),ray))*max(abs(ray),vec3(0.00001));
          vec3 a=(vec3(center-${mullionWidth/2},-halfHeight,-${openingDepth})-p)/safeRay;
          vec3 b=(vec3(center+${mullionWidth/2},halfHeight,${mullionFront})-p)/safeRay;
          vec3 nearHit=min(a,b),farHit=max(a,b);
          return min(min(farHit.x,farHit.y),farHit.z)-max(max(max(nearHit.x,nearHit.y),nearHit.z),.001);
        }
        float contextOpeningVisibility(vec3 lightView) {
          vec3 N=normalize(vOpeningNormal),T=normalize(cross(vec3(0.0,1.0,0.0),N));
          vec3 lightWorld=transformDirectionByInverseViewMatrix(lightView,viewMatrix);
          vec3 ray=vec3(dot(lightWorld,T),lightWorld.y,dot(lightWorld,N));
          vec3 p=vOpeningPoint;
          float frontDistance=-p.z/max(ray.z,.00001);
          vec2 hit=p.xy+frontDistance*ray.xy,margin=vOpeningSize*.5-abs(hit);
          // All derivatives are evaluated before the depth/direction decisions.
          vec2 edgeAA=max(fwidth(hit)*.5,vec2(.0001));
          float aperture=smoothstep(-edgeAA.x,edgeAA.x,margin.x)*smoothstep(-edgeAA.y,edgeAA.y,margin.y);
          float center=(vOpeningSize.x+${mullionWidth})/6.0;
          float barA=contextBarInterval(p,ray,-center,vOpeningSize.y*.5);
          float barB=contextBarInterval(p,ray,center,vOpeningSize.y*.5);
          float aaA=max(fwidth(barA)*.5,.0001),aaB=max(fwidth(barB)*.5,.0001);
          float bars=(1.0-smoothstep(-aaA,aaA,barA))*(1.0-smoothstep(-aaB,aaB,barB));
          if(p.z>=-.0001)return 1.0;
          if(ray.z<=0.0)return 0.0;
          return aperture*bars;
        }`);
      const marker='getDirectionalLightInfo( directionalLight, directLight );';
      const lights=THREE.ShaderChunk.lights_fragment_begin;
      if(!lights.includes(marker))throw new Error('Context recess: directional-light chunk changed');
      shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_begin>',lights.replace(marker,`${marker}
        #if UNROLLED_LOOP_INDEX == 0
          directLight.color*=contextOpeningVisibility(directLight.direction);
        #endif`));
    };
    material.customProgramCacheKey=()=>`${key}-context-recess-sun-v1`;
  }
  for(const material of [glass,reveal,frame])visibility(material);
  const vector=p=>new THREE.Vector3(...p);
  function world(record,p) {return record.center.map((v,i)=>v+record.tangent[i]*p[0]+(i===1?p[1]:0)+record.normal[i]*p[2]);}
  function quad(pool,record,points,normal,color) {
    let order=[0,1,2,0,2,3];
    if(vector(points[1]).sub(vector(points[0])).cross(vector(points[2]).sub(vector(points[0]))).dot(vector(normal))<0)order=[0,2,1,0,3,2];
    const shade=new THREE.Color(color),n=world({...record,center:[0,0,0]},normal);
    for(const i of order) {
      const p=points[i];pool.position.push(...world(record,p));pool.normal.push(...n);pool.uv.push(i===0||i===3?0:1,i<2?0:1);pool.color.push(shade.r,shade.g,shade.b);
      if(pool.openingPoint){pool.openingPoint.push(...p);pool.openingSize.push(record.width,record.height);pool.openingNormal.push(...record.normal);}
    }
  }
  function box(pool,record,center,size,color) {
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
      const a=(axis+1)%3,b=(axis+2)%3,normal=[0,0,0];normal[axis]=sign;
      const points=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>{const p=[...center];p[axis]+=sign*size[axis]/2;p[a]+=u*size[a]/2;p[b]+=v*size[b]/2;return p;});
      quad(pool,record,points,normal,color);
    }
  }
  function geometry(pool) {
    const g=new THREE.BufferGeometry();
    for(const[key,size]of [['position',3],['normal',3],['uv',2],['color',3],['openingPoint',3],['openingSize',2],['openingNormal',3]])if(pool[key])g.setAttribute(key,new THREE.Float32BufferAttribute(pool[key],size));
    g.computeBoundingBox();g.computeBoundingSphere();return g;
  }
  function addBuilding(builder,wallMaterial,building) {
    const {id,x,z,w,d,h,base}=building,floors=Math.round(h/3.8),spacing=h/floors,windowHeight=spacing*.73;
    const opaque={position:[],normal:[],uv:[],color:[]};
    for(const axis of ['x','z'])for(const side of [-1,1]) {
      const horizontal=axis==='x',span=horizontal?w:d,bays=Math.max(3,Math.round((span-4)/8.5)),pitch=(span-4)/bays;
      const normal=horizontal?[0,0,side]:[side,0,0],tangent=[normal[2],0,-normal[0]];
      const origin=horizontal?[x,base,z+side*d/2]:[x+side*w/2,base,z];
      const face={center:origin,normal,tangent};
      const facadeQuad=(u0,u1,v0,v1)=>{if(u1-u0<1e-8||v1-v0<1e-8)return;quad(opaque,face,[[u0,v0,0],[u1,v0,0],[u1,v1,0],[u0,v1,0]],[0,0,1],'#b9bcb4');};
      let low=0;
      for(let floor=0;floor<floors;floor++) {
        const cy=(floor+.53)*spacing,bottom=cy-windowHeight/2,top=cy+windowHeight/2;
        facadeQuad(-span/2,span/2,low,bottom);low=top;
        const floorWindows=[];
        for(let bay=0;bay<bays;bay++) {
          if(horizontal&&bay===(span>68?bays-2:1))continue;
          const offset=-span/2+2+(bay+.5)*pitch,u=offset*(horizontal?side:-side),width=pitch-1.35;
          floorWindows.push({u,width});
          const record={id:`${id}-${axis}-${side}-${floor}-${bay}`,building:id,axis,side,floor,bay,center:world(face,[u,cy,0]),normal:[...normal],tangent:[...tangent],width,height:windowHeight};
          openings.push(record);
          const hw=width/2,hh=windowHeight/2;
          quad(pools.get(reveal),record,[[-hw,-hh,0],[-hw,hh,0],[-hw,hh,-openingDepth],[-hw,-hh,-openingDepth]],[1,0,0],'#b9bcb4');
          quad(pools.get(reveal),record,[[hw,-hh,0],[hw,hh,0],[hw,hh,-openingDepth],[hw,-hh,-openingDepth]],[-1,0,0],'#b9bcb4');
          quad(pools.get(reveal),record,[[-hw,hh,0],[hw,hh,0],[hw,hh,-openingDepth],[-hw,hh,-openingDepth]],[0,-1,0],'#b9bcb4');
          quad(pools.get(reveal),record,[[-hw,-hh,0],[hw,-hh,0],[hw,-hh,-openingDepth],[-hw,-hh,-openingDepth]],[0,1,0],'#b9bcb4');
          const paneWidth=(width-2*mullionWidth)/3;
          for(let pane=0;pane<3;pane++) {
            const centerU=-hw+paneWidth/2+pane*(paneWidth+mullionWidth);
            box(pools.get(glass),record,[centerU,0,-openingDepth-glassThickness/2],[paneWidth,windowHeight,glassThickness],'#456772');
          }
          for(const sign of [-1,1])box(pools.get(frame),record,[sign*(width+mullionWidth)/6,0,(mullionFront-openingDepth)/2],[mullionWidth,windowHeight,openingDepth+mullionFront],'#626967');
        }
        floorWindows.sort((a,b)=>a.u-b.u);let left=-span/2;
        for(const aperture of floorWindows){facadeQuad(left,aperture.u-aperture.width/2,bottom,top);left=aperture.u+aperture.width/2;}
        facadeQuad(left,span/2,bottom,top);
      }
      facadeQuad(-span/2,span/2,low,h);
    }
    // The original core is inset .55m; a continuous roof ring retains the old roof outline.
    const roof={center:[x,base+h,z],normal:[0,0,1],tangent:[1,0,0]};
    for(const r of [[-w/2,w/2,-d/2,-d/2+.55],[-w/2,w/2,d/2-.55,d/2],[-w/2,-w/2+.55,-d/2+.55,d/2-.55],[w/2-.55,w/2,-d/2+.55,d/2-.55]])
      quad(opaque,roof,[[r[0],0,r[2]],[r[1],0,r[2]],[r[1],0,r[3]],[r[0],0,r[3]]],[0,1,0],'#9ca29b');
    const g=geometry(opaque);builder.add(g,wallMaterial);g.dispose();
  }
  function emit(group) {
    for(const [material,pool]of pools) {
      const mesh=new THREE.Mesh(geometry(pool),material);mesh.name=`context-recess-${material===glass?'glazing':material===reveal?'reveals':'mullions'}`;
      mesh.castShadow=mesh.receiveShadow=false;group.add(mesh);
    }
    group.userData.recessOpenings=openings;
  }
  return {addBuilding,emit};
}

export function buildContextDistricts(terrainMesh, { refined = false } = {}) {
  const started=performance.now(),group=new THREE.Group();group.name='context-districts';
  const ground=createGroundSampler([terrainMesh],[-1320,1520,-1520,1070]);
  const casters=[],receivers=[terrainMesh],buildings=[],roads=[],trees=[],plantingExclusions=[],forecourts=[];
  const walls=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.84});
  const glass=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.28,metalness:.18,envMapIntensity:.8,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const westernGlass=createResearchGlazing(),recess=createResearchRecess(westernGlass);
  const asphalt=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.94,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const concrete=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.9,polygonOffset:true,polygonOffsetFactor:-1,polygonOffsetUnits:-1});
  const paint=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.96,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
  walls.name='context-facades';glass.name='context-opaque-glazing';asphalt.name='context-ground';concrete.name='context-paving';paint.name='context-road-markings';
  const streets=new Builder(),markings=new Builder();
  const asphaltAreas=[],rampAreas=[],pendingPaving=new Map();
  function subtractRects(rect,cuts) {
    let pieces=[rect];
    for(const cut of cuts)pieces=pieces.flatMap(r=>{
      const x0=Math.max(r[0],cut[0]),x1=Math.min(r[1],cut[1]),z0=Math.max(r[2],cut[2]),z1=Math.min(r[3],cut[3]);
      if(x1<=x0+1e-7||z1<=z0+1e-7)return[r];
      return [[r[0],r[1],r[2],z0],[r[0],r[1],z1,r[3]],[r[0],x0,z0,z1],[x1,r[1],z0,z1]].filter(p=>p[1]-p[0]>1e-7&&p[3]-p[2]>1e-7);
    });
    return pieces;
  }
  function box(builder,material,w,h,d,x,y,z,color,roof) {
    const geo=tint(new THREE.BoxGeometry(w,h,d),color,roof);builder.add(geo,material,mat4([x,y,z]));geo.dispose();
  }
  // Clip the actual terrain triangles to a rectangle. Independent regular grids
  // can cut through the coarse outer terrain and produce flickering/floating lots.
  function terrainPolygons(rect) {
    const result=[];
    for(const triangle of ground.inRect(rect)) {
      let polygon=[triangle.a,triangle.b,triangle.c];
      for(const [axis,limit,sign] of [[0,rect[0],1],[0,rect[1],-1],[2,rect[2],1],[2,rect[3],-1]]) {
        const clipped=[];
        for(let i=0;i<polygon.length;i++) {
          const a=polygon[i],b=polygon[(i+1)%polygon.length],da=(a[axis]-limit)*sign,db=(b[axis]-limit)*sign;
          if(da>=-1e-7)clipped.push(a);
          if((da>0&&db<0)||(da<0&&db>0)){const t=da/(da-db);clipped.push(a.map((v,j)=>v+(b[j]-v)*t));}
        }
        polygon=clipped;if(polygon.length<3)break;
      }
      if(polygon.length>=3)result.push(polygon);
    }
    return result;
  }
  function addSurfaceGeometry(builder,material,positions,color) {
    if(!positions.length)return 0;
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.computeVertexNormals();
    geo.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(positions.length/3*2),2));tint(geo,color);builder.add(geo,material);geo.dispose();
    return positions.length/9;
  }
  function surface(builder,material,rect,color,lift=.035,flush=false) {
    // Wait until all entrances in this district are known so their ramps also
    // cut earlier footpaths. Paint retains its existing geometry and placement.
    if(material===concrete&&!flush){if(!pendingPaving.has(builder))pendingPaving.set(builder,[]);pendingPaving.get(builder).push([rect,color,lift]);return 0;}
    const pieces=subtractRects(rect,material===asphalt?asphaltAreas:material===concrete?rampAreas:[]),positions=[];
    if(material===asphalt)asphaltAreas.push(rect);
    for(const piece of pieces)for(const polygon of terrainPolygons(piece))
      for(let i=1;i<polygon.length-1;i++)for(const p of [polygon[0],polygon[i],polygon[i+1]])positions.push(p[0],p[1]+lift,p[2]);
    return addSurfaceGeometry(builder,material,positions,color);
  }
  function entranceRamp(builder,x,width,front,end,base,lift=.12) {
    const rect=[x-width/2,x+width/2,Math.min(front,end),Math.max(front,end)],positions=[];
    const top=p=>[p[0],THREE.MathUtils.lerp(base,p[1]+lift,(p[2]-front)/(end-front)),p[2]];
    for(const polygon of terrainPolygons(rect)) {
      for(let i=1;i<polygon.length-1;i++)for(const p of [polygon[0],polygon[i],polygon[i+1]])positions.push(...top(p));
      for(let i=0;i<polygon.length;i++) {
        const a=polygon[i],b=polygon[(i+1)%polygon.length];
        const boundary=[0,1].some(j=>Math.abs(a[0]-rect[j])<1e-6&&Math.abs(b[0]-rect[j])<1e-6)||Math.abs(a[2]-end)<1e-6&&Math.abs(b[2]-end)<1e-6;
        if(!boundary)continue;
        // The building foundation closes the entrance end; side/end fill runs
        // below the actual terrain, avoiding a paper-thin elevated ramp.
        const at=top(a),bt=top(b),ab=[a[0],a[1]-.04,a[2]],bb=[b[0],b[1]-.04,b[2]];
        for(const p of [at,ab,bt,ab,bb,bt])positions.push(...p);
      }
    }
    rampAreas.push(rect);plantingExclusions.push(rect);
    return addSurfaceGeometry(builder,concrete,positions,'#b1b2a6');
  }
  function lane(builder,axis,center,from,to,width=7) {
    const rect=axis==='z'?[center-width/2,center+width/2,from,to]:[from,to,center-width/2,center+width/2];
    surface(builder,asphalt,rect,'#4a5051',.038);roads.push({axis,center,from,to,width});plantingExclusions.push(rect);
  }
  function parking(builder,cx,cz,w,d,access='north') {
    plantingExclusions.push([cx-w/2,cx+w/2,cz-d/2,cz+d/2]);
    surface(builder,asphalt,[cx-w/2,cx+w/2,cz-d/2,cz+d/2],'#505656',.039);
    const rows=Math.max(1,Math.floor(d/16));
    for(let row=0;row<rows;row++) {
      const z=cz+(row-(rows-1)/2)*16;
      for(const side of [-1,1])for(let x=cx-w/2+5;x<cx+w/2-4;x+=2.65)surface(markings,paint,[x,x+.10,z+(side<0?-8:3),z+(side<0?-3:8)],'#c8c9bc',.045);
    }
    // Concrete end islands supply a physical border and pedestrian connection.
    for(const side of [-1,1]) {
      if(access==='east'&&side===1)continue;
      const runs=access==='through'?[[cz-d/2,cz-4.5],[cz+4.5,cz+d/2]]:[[cz-d/2,cz+d/2]];
      for(const [from,to] of runs)surface(builder,concrete,[cx+side*(w/2-2)-1,cx+side*(w/2-2)+1,from,to],'#aaa99c',.16);
    }
  }
  function emit(builder,name) {
    for(const [rect,color,lift] of pendingPaving.get(builder)||[])surface(builder,concrete,rect,color,lift,true);
    pendingPaving.delete(builder);
    const object=builder.build({name,castShadow:false,receiveShadow:false});
    for(const mesh of object.children)if([asphalt,concrete,paint].includes(mesh.material))receivers.push(mesh);
    group.add(object);
  }
  function street(axis,center,from,to,junctions) {
    lane(streets,axis,center,from,to,12);
    const cuts=[from,...junctions.flatMap(v=>[v-11,v+11]).filter(v=>v>from&&v<to),to].sort((a,b)=>a-b);
    for(let i=1;i<cuts.length;i++) {
      const a=cuts[i-1],b=cuts[i],middle=(a+b)/2;
      if(junctions.some(j=>Math.abs(middle-j)<11))continue;
      for(const side of [-1,1]) {
        const c=center+side*7.5;
        const rect=axis==='z'?[c-1.5,c+1.5,a,b]:[a,b,c-1.5,c+1.5];
        surface(streets,concrete,rect,'#a8a99f',.16);plantingExclusions.push(rect);
      }
    }
    for(let p=from+8;p<to-8;p+=12)if(!junctions.some(j=>Math.abs(p-j)<16))surface(markings,paint,axis==='z'?[center-.07,center+.07,p,p+5]:[p,p+5,center-.07,center+.07],'#d1d0bb',.045);
  }
  street('z',350,-1500,1050,[-430,-315,62,151]);
  street('x',-315,-1300,1500,[-290,100,350]);
  for(const district of CONTEXT_DISTRICTS) {
    const b=new Builder(),research=district.id==='research',engineering=district.id==='engineering';
    // Unbuilt ground keeps the surrounding terrain material. Only occupied
    // road, parking and footpath areas receive a separate hard surface.
    // One continuous frontage makes each group a property, rather than isolated boxes.
    const [minX,maxX,minZ,maxZ]=district.bounds;
    const entrance=engineering?-430:62;
    const edges=[[maxX-.22,maxX,minZ,maxZ],[minX,maxX,minZ,minZ+.22]];
    if(research)edges.push([minX,minX+.22,minZ,maxZ],[minX,95,maxZ-.22,maxZ],[105,maxX,maxZ-.22,maxZ]);
    else edges.push([minX,minX+.22,minZ,entrance-5],[minX,minX+.22,entrance+5,maxZ],[minX,maxX,maxZ-.22,maxZ]);
    for(const rect of edges)surface(b,concrete,rect,'#9da094',.13);
    if(research) {
      lane(b,'z',100,-550,-315);parking(b,100,-425,116,68);
      // The second research parcel shares the existing east-west public street.
      // Keep the original woodland intact; this road stays west of its crowns.
      lane(b,'z',-290,-315,-70,8);
      lane(b,'x',-171,-365,-294,6);parking(b,-384,-179,38,44,'east');
      // A modest T-shaped turning head ends the cul-de-sac, not a road into grass.
      lane(b,'x',-76,-302,-278,12);
      for(const rect of [[-296,-294,-306,-82],[-286,-284,-306,-82],
        [-304,-302,-82,-68],[-278,-276,-82,-68],[-302,-278,-70,-68],
        [-302,-296,-84,-82],[-284,-278,-84,-82],
        [-301,-294,-309,-306],[-286,-279,-309,-306]]) {
        // Clip the parking access out of the west footpath; there is no raised
        // concrete strip across the vehicle entrance.
        for(const piece of subtractRects(rect,[[-365,-294,-174,-168]])) {
          surface(b,concrete,piece,'#aaa99c',.12);plantingExclusions.push(piece);
        }
      }
    }
    else if(engineering) {lane(b,'x',-430,350,675);lane(b,'z',675,-605,-430);parking(b,590,-580,174,44,'east');surface(b,asphalt,[402,665,-464,-403],'#616660',.04);plantingExclusions.push([402,665,-464,-403]);}
    else {lane(b,'x',62,350,630);parking(b,520,62,204,50,'through');}
    for(const [id,x,z,w,d,originalHeight] of district.buildings) {
      // Whole-building heights vary together with openings and shadow proxies;
      // footprints/access remain fixed so neighbours cannot invade the woodland.
      const h=refined?({a1:12,a2:20,a3:16,a4:22,b1:9,b2:13,b3:11,b4:9,c1:12,c2:8}[id]??originalHeight):originalHeight;
      const samples=[];
      for(let ix=0;ix<=4;ix++)for(let iz=0;iz<=4;iz++)samples.push(ground.heightAt(x-w/2+w*ix/4,z-d/2+d*iz/4));
      const base=Math.max(...samples)+.18,bottom=Math.min(...samples)-.2,roof=base+h;
      box(b,walls,w,base-bottom,d,x,(base+bottom)/2,z,'#8b8c80');
      const recessed=research;
      if(recessed) {
        box(b,walls,w-1.1,h,d-1.1,x,base+h/2,z,'#b9bcb4','#9ca29b');
        recess.addBuilding(b,walls,{id,x,z,w,d,h,base});
      } else box(b,walls,w,h,d,x,base+h/2,z,engineering?'#a2aaa6':research?'#b9bcb4':'#c2bbaa',engineering?'#8b9491':'#9ca29b');
      casters.push({id,district:district.id,min:[x-w/2,bottom,z-d/2],max:[x+w/2,roof,z+d/2],groundFootprint:true});
      buildings.push({id,district:district.id,x,z,w,d,height:h,base,bottom,terrainRange:Math.max(...samples)-Math.min(...samples)});
      plantingExclusions.push([x-w/2,x+w/2,z-d/2,z+d/2]);
      const paneMaterial=recessed?westernGlass:glass;
      const floors=engineering?2:Math.round(h/3.8),spacing=h/floors;
      if(!recessed)for(let floor=0;floor<floors;floor++) {
        const y=base+(floor+.53)*spacing,windowHeight=engineering?1.45:spacing*.73;
        for(const side of [-1,1]) {
          if(engineering) {
            box(b,paneMaterial,w-4,windowHeight,.09,x,y,z+side*(d/2+.045),'#536c70');
            box(b,paneMaterial,.09,windowHeight,d-4,x+side*(w/2+.045),y,z,'#536c70');
            continue;
          }
          // Metre-wide opaque piers remain legible from the fixed overview.
          // One solid service bay breaks the long frontage; short elevations
          // retain grouped windows rather than wrapping a continuous ribbon.
          for(const axis of ['x','z']) {
            const span=axis==='x'?w:d,bays=Math.max(3,Math.round((span-4)/8.5)),pitch=(span-4)/bays;
            const serviceBay=span>68?bays-2:1;
            for(let bay=0;bay<bays;bay++) {
              if(axis==='x'&&bay===serviceBay)continue;
              const offset=-span/2+2+(bay+.5)*pitch,clear=pitch-1.35;
              if(axis==='x')box(b,paneMaterial,clear,windowHeight,.09,x+offset,y,z+side*(d/2+.045),'#456772');
              else box(b,paneMaterial,.09,windowHeight,clear,x+side*(w/2+.045),y,z+offset,'#456772');
            }
          }
        }
      }
      if(engineering) {
        const side=z< -450?1:-1;
        for(let door=-1;door<=1;door++)box(b,walls,5,4.2,.12,x+door*14,base+2.1,z+side*(d/2+.07),'#5e6b69');
        // Join the loading doors to the existing yard, including the site's grade.
        entranceRamp(b,x,w-4,z+side*d/2,side>0?-464:-403,base,.04);
      } else {
        const front=z+d/2,doorGround=ground.heightAt(x,front+1),run=Math.max(14,Math.min(32,(base-doorGround)*22));
        entranceRamp(b,x,3.6,front,front+run,base);
        const target=research?(id==='a3'||id==='a4'?-297.8:100):520;
        const path=[Math.min(x,target)-1.8,Math.max(x,target)+1.8,front+run-1.8,front+run+1.8];
        surface(b,concrete,path,'#b1b2a6',.12);plantingExclusions.push(path);
        if(!research) {
          const link=[target-1.8,target+1.8,front+run,37];surface(b,concrete,link,'#b1b2a6',.12);plantingExclusions.push(link);
        } else {
          const end=front+run,rect=[x-9,x+9,end-6,end+6];
          // Widen the existing landing without overlaying the centre of its path.
          surface(b,concrete,[x-9,x+9,end-6,end-1.8],'#b1b2a6',.12);
          surface(b,concrete,[x-9,x+9,end+1.8,end+6],'#b1b2a6',.12);
          surface(b,concrete,[x-9,x-1.8,end-1.8,end+1.8],'#b1b2a6',.12);
          plantingExclusions.push(rect);forecourts.push({id,district:district.id,rect});
        }
      }
      if(!research&&!engineering) {
        box(b,walls,w*.64,.26,4,x,base+3.8,z+d/2+1.9,'#c3c1b1');
        casters.push({id:`${id}-canopy`,district:district.id,min:[x-w*.32,base+3.67,z+d/2-.1],max:[x+w*.32,base+3.93,z+d/2+3.9],groundFootprint:false});
        for(const side of [-1,1])box(b,walls,.24,3.67,.24,x+side*w*.29,base+1.835,z+d/2+3.6,'#b5b9ad');
      }
    }
    emit(b,`context-${district.id}`);
  }
  // Distinct managed frontage, woodland edge and rear shelter planting give the
  // neighbours a shared street and a managed edge, without another terrain skin.
  const groves=[
    {id:'south-west',x:-125,z:-272,rx:90,rz:17,angle:-.03,count:14,heights:[9,12]},
    {id:'south-east',x:110,z:-275,rx:90,rz:18,angle:.05,count:14,heights:[9,12]},
    {id:'front-west',x:-115,z:-359,rx:100,rz:17,angle:.03,count:14,heights:[7.5,10]},
    {id:'front-east',x:132,z:-363,rx:60,rz:15,angle:-.05,count:10,heights:[7.5,10]},
    {id:'west-verge',x:-430,z:-355,rx:120,rz:20,angle:-.05,count:12,heights:[9,13]},
    {id:'west-return',x:-245,z:-415,rx:45,rz:55,angle:.1,count:16,heights:[9,13]},
    {id:'rear-west',x:-165,z:-595,rx:125,rz:28,angle:-.04,count:18,heights:[10,14]},
    {id:'rear-east',x:60,z:-590,rx:95,rz:32,angle:.05,count:14,heights:[10,14]},
    {id:'court-west',x:-105,z:-470,rx:90,rz:24,angle:.05,count:6,heights:[7,9]},
    {id:'court-east',x:8,z:-489,rx:45,rz:25,angle:-.05,count:6,heights:[7,9]},
    {id:'western-front',x:-277,z:-180,rx:7,rz:88,angle:0,count:12,heights:[7,9]},
    {id:'western-rear',x:-430,z:-175,rx:20,rz:95,angle:.12,count:24,heights:[8,11]},
  ];
  const smooth=(a,b,v)=>{const t=THREE.MathUtils.clamp((v-a)/(b-a),0,1);return t*t*(3-2*t);};
  const groveDensity=(grove,x,z)=>{
    const dx=x-grove.x,dz=z-grove.z,c=Math.cos(grove.angle),s=Math.sin(grove.angle);
    const q=((dx*c+dz*s)/grove.rx)**2+((-dx*s+dz*c)/grove.rz)**2;
    return (1-smooth(.18,1,q))*(.65+.35*fbm2(x*.025,z*.025,2,612));
  };
  const distanceToRect=(x,z,r)=>Math.hypot(Math.max(r[0]-x,0,x-r[1]),Math.max(r[2]-z,0,z-r[3]));
  for(const grove of groves) {
    const random=rng(`campus-district-planting-${grove.id}`);let accepted=0;
    for(let attempt=0;attempt<grove.count*180 && accepted<grove.count;attempt++) {
      const [u,v]=random.disc(),c=Math.cos(grove.angle),s=Math.sin(grove.angle);
      const x=grove.x+u*grove.rx*c-v*grove.rz*s,z=grove.z+u*grove.rx*s+v*grove.rz*c;
      if(random.next()>groveDensity(grove,x,z))continue;
      const height=random.float(...grove.heights),crownRadius=.4*height+2.4;
      if(plantingExclusions.some(rect=>distanceToRect(x,z,rect)<crownRadius+.7))continue;
      if(trees.some(tree=>Math.hypot(tree.x-x,tree.z-z)<.72*(tree.crownRadius+crownRadius)))continue;
      const tree={district:'research',id:`research-${grove.id}-${accepted}`,zone:grove.id,x,z,height,ground:ground.heightAt(x,z)-.035,crownRadius};
      const center=[x,tree.ground+height*.65,z],radii=[height*.38,height*.34,height*.38];
      trees.push(tree);accepted++;
      casters.push({id:tree.id,district:tree.district,ellipsoid:{center,radii},opacity:.65,groundFootprint:false,
        min:center.map((p,i)=>p-radii[i]),max:center.map((p,i)=>p+radii[i])});
    }
    grove.accepted=accepted;
  }
  const landBounds=[-740,235,-675,-45];
  const rectangleWeight=(x,z,r,edge)=>smooth(r[0],r[0]+edge,x)*smooth(r[1],r[1]-edge,x)*smooth(r[2],r[2]+edge,z)*smooth(r[3],r[3]-edge,z);
  // Land management is a weight on the original meadow, never another surface.
  // R is managed grass; G is grove understory. Pixel centres map to world X/Z.
  const landWidth=512,landHeight=256,landData=new Uint8Array(landWidth*landHeight*2);
  for(let row=1;row<landHeight-1;row++)for(let col=1;col<landWidth-1;col++) {
    const x=landBounds[0]+(col+.5)/landWidth*(landBounds[1]-landBounds[0]);
    const z=landBounds[2]+(row+.5)/landHeight*(landBounds[3]-landBounds[2]);
    const envelope=rectangleWeight(x,z,landBounds,28);
    const grove=Math.max(...groves.map(g=>groveDensity(g,x,z)));
    const managed=Math.max(rectangleWeight(x,z,[-220,190,-615,-350],10),
      rectangleWeight(x,z,[-700,220,-336,-325],2),rectangleWeight(x,z,[-700,220,-305,-295],2),
      rectangleWeight(x,z,[-410,-301,-305,-65],14),
      rectangleWeight(x,z,[-303,-277,-306,-68],5));
    const index=(row*landWidth+col)*2;
    landData[index]=Math.round(managed*envelope*255);
    landData[index+1]=Math.round(grove*envelope*255);
  }
  const landTexture=new THREE.DataTexture(landData,landWidth,landHeight,THREE.RGFormat,THREE.UnsignedByteType);
  landTexture.name='context-landuse-weights';landTexture.colorSpace=THREE.NoColorSpace;
  landTexture.minFilter=THREE.LinearMipmapLinearFilter;landTexture.magFilter=THREE.LinearFilter;
  landTexture.generateMipmaps=true;landTexture.needsUpdate=true;
  emit(streets,'context-streets');emit(markings,'context-markings');recess.emit(group);
  let triangles=0,batches=0;
  group.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;batches++;}});
  const stats={buildings:buildings.length,trees:trees.length,forecourts:forecourts.length,landTriangles:0,triangles,batches,buildMs:Math.round(performance.now()-started)};
  if(triangles>=80000||batches>18)throw new Error(`Context district budget exceeded: ${triangles} triangles, ${batches} batches`);
  group.userData.stats=stats;
  return {object:group,casters,receivers,regions:CONTEXT_DISTRICTS.map(d=>({id:d.id,bounds:d.shadow})),buildings,roads,trees,plantingExclusions,forecourts,landuse:{bounds:landBounds,groves,texture:landTexture},stats};
}
