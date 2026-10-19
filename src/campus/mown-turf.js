import * as THREE from 'three';
import { rng } from '../core/rng.js';
import { finishBuild } from './loading.js';
import { sampleTour, SHOT_SECONDS } from './tour.js';

export function mownTurfGeometry() {
  const random=rng('campus-mown-blades'),positions=[],colors=[],indices=[];
  for(let blade=0;blade<12;blade++) {
    const x=((blade%4+random.next())/4-.5)*.12,z=((Math.floor(blade/4)+random.next())/3-.5)*.12,angle=random.float(0,Math.PI*2);
    const dx=Math.cos(angle),dz=Math.sin(angle),height=random.float(.025,.045),width=random.float(.0015,.003),bend=random.float(.003,.012);
    const offset=positions.length/3;
    for(const [side,t,lean] of [[-1,0,0],[1,0,0],[-.7,.65,.35],[.7,.65,.35],[0,1,1]]) {
      positions.push(x+dx*bend*lean-dz*width*.5*side,height*t,z+dz*bend*lean+dx*width*.5*side);
      // shortcut: root darkening approximates unresolved self-shadow; replace if blade shadows become resolved.
      const shade=.7+.3*t;colors.push(shade,shade,shade);
    }
    indices.push(offset,offset+1,offset+2,offset+1,offset+3,offset+2,offset+2,offset+3,offset+4);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));
  geometry.setIndex(indices);geometry.computeVertexNormals();geometry.computeBoundingSphere();
  return geometry;
}

export function buildMownTurf(sampleSurface,turfMap) {
  return finishBuild(buildMownTurfSteps(sampleSurface,turfMap));
}

export function* buildMownTurfSteps(sampleSurface,turfMap) {
  const group=new THREE.Group();group.name='mown-turf';
  const geometry=mownTurfGeometry(),vertices=geometry.attributes.position;
  let radius=0;
  for(let i=0;i<vertices.count;i++)radius=Math.max(radius,Math.hypot(vertices.getX(i),vertices.getZ(i)));
  const views=[],bounds=new THREE.Box3();
  const viewCamera=new THREE.PerspectiveCamera(48,2.4,.1,14),viewMatrix=new THREE.Matrix4();
  // shortcut: detailed turf follows the arrival and garden tour; extend coverage when free exploration becomes primary.
  for(const shot of [1,2]) {
    for(let i=0;i<=40;i++) {
      const frame=sampleTour((shot+Math.min(i/40,1-1e-8))*SHOT_SECONDS),p=frame.position.clone();
      viewCamera.position.copy(p);viewCamera.lookAt(frame.target);viewCamera.fov=frame.fov;
      viewCamera.updateProjectionMatrix();viewCamera.updateMatrixWorld(true);
      const view=new THREE.Frustum().setFromProjectionMatrix(viewMatrix.multiplyMatrices(viewCamera.projectionMatrix,viewCamera.matrixWorldInverse));
      // Wide-aspect views and 65 cm padding cover movement between quarter-second tour samples.
      for(const plane of view.planes)plane.constant+=.65;
      views.push({frustum:view,position:p.clone()});p.y=0;bounds.expandByPoint(p);
    }
  }
  bounds.expandByScalar(12);
  const random=rng('campus-mown-turf'),cells=new Map(),point=new THREE.Vector3();
  const rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),scale=new THREE.Vector3(1,1,1),matrix=new THREE.Matrix4();
  for(let ix=Math.floor(bounds.min.x*10);ix<=Math.ceil(bounds.max.x*10);ix++) {
    for(let iz=Math.floor(bounds.min.z*10);iz<=Math.ceil(bounds.max.z*10);iz++) {
      const x=(ix+random.float(.08,.92))*.1,z=(iz+random.float(.08,.92))*.1;
      point.set(x,0,z);let distance2=Infinity;
      for(const view of views)if(view.frustum.containsPoint(point))distance2=Math.min(distance2,point.distanceToSquared(view.position));
      const density=1-THREE.MathUtils.smoothstep(Math.sqrt(distance2),3,12);
      if(random.next()>=density)continue;
      const ground=sampleSurface(x,z,radius);if(ground===null)continue;
      point.set(x,ground-.001,z);rotation.setFromAxisAngle(axis,random.float(0,Math.PI*2));
      matrix.compose(point,rotation,scale);
      const key=`${Math.floor(x/16)},${Math.floor(z/16)}`;
      if(!cells.has(key))cells.set(key,[]);cells.get(key).push(matrix.clone());
    }
    yield '正在生成草坪细节…';
  }
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.95,side:THREE.DoubleSide});
  material.name='campus-mown-turf';
  material.onBeforeCompile=shader=>{
    shader.uniforms.uMownTurfMap={value:turfMap};
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vTurfWorld;')
      .replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
        vec4 turfPosition=vec4(transformed,1.0);
        #ifdef USE_INSTANCING
          turfPosition=instanceMatrix*turfPosition;
        #endif
        vTurfWorld=(modelMatrix*turfPosition).xz;
      `);
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vTurfWorld; uniform sampler2D uMownTurfMap;')
      .replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb*=texture2D(uMownTurfMap,vTurfWorld/1.6).rgb;');
  };
  material.customProgramCacheKey=()=> 'campus-mown-turf-v1';
  let count=0;
  for(const [cell,matrices] of cells) {
    const mesh=new THREE.InstancedMesh(geometry,material,matrices.length);
    matrices.forEach((m,i)=>mesh.setMatrixAt(i,m));mesh.instanceMatrix.needsUpdate=true;
    mesh.name=`mown-turf:${cell}`;mesh.receiveShadow=true;mesh.castShadow=false;
    mesh.computeBoundingSphere();group.add(mesh);count+=matrices.length;
    yield '正在组装草坪网格…';
  }
  group.userData.stats={mownTurfTufts:count,mownTurfBlades:count*12,mownTurfTriangles:count*geometry.index.count/3,mownTurfBatches:group.children.length};
  return group;
}
