import * as THREE from 'three';
import { instanced, mat4 } from '../core/geom.js';
import { rng } from '../core/rng.js';
import { shrubLeafGeometry } from './shrub-leaf.js';
import { foliageMaterial } from './foliage-material.js';

// A low shrub has nine connected, outward-growing stems. The old planting matrices
// still define its position, orientation and envelope; its roots meet the actual soil.
export function buildTerracePlanting(matrices, sites) {
  if(matrices.length!==sites.length)throw new Error('Terrace planting requires one soil site per original matrix');
  const group=new THREE.Group();group.name='Terrace planting';
  const leafGeometry=shrubLeafGeometry(),stemGeometry=new THREE.CylinderGeometry(.64,1,1,3,1,true);
  const leafMatrices=[],stemMatrices=[],normals=[],ao=[],colors=[],records=[];
  const up=new THREE.Vector3(0,1,0),stemQuaternion=new THREE.Quaternion();
  const pale=new THREE.Color(0x6c8446);
  for(let plant=0;plant<matrices.length;plant++) {
    const matrix=matrices[plant],site=sites[plant],position=new THREE.Vector3(),rotation=new THREE.Quaternion(),scale=new THREE.Vector3();
    matrix.decompose(position,rotation,scale);
    const seed=site.shapeSeed??`terrace-shrub-${position.x},${position.y},${position.z}`,random=rng(seed);
    const height=position.y-site.ground+scale.y*.5,rx=scale.x*.5,rz=scale.z*.5;
    if(!(height>.2&&rx>.2&&rz>.2&&Number.isFinite(site.ground)))throw new Error('Invalid terrace shrub envelope');
    const root=new THREE.Vector3(position.x,site.ground-.003,position.z),firstStem=stemMatrices.length,firstLeaf=leafMatrices.length;
    for(let stem=0;stem<9;stem++) {
      const angle=stem*Math.PI*2/9+random.float(-.22,.22),reach=random.float(.75,.83),rise=random.float(.82,.90);
      const local=new THREE.Vector3(Math.cos(angle)*rx*reach,0,Math.sin(angle)*rz*reach);
      const bend=random.float(-.19,.19),points=[root];
      for(const [fraction,elevation]of [[.21,.25],[.68,.56],[1,rise]]) {
        const offset=local.clone().multiplyScalar(fraction).applyAxisAngle(up,bend*Math.sin(fraction*Math.PI)).applyQuaternion(rotation);
        points.push(new THREE.Vector3(position.x+offset.x,site.ground+height*elevation,position.z+offset.z));
      }
      const radius=random.float(.0032,.0042);
      for(let segment=0;segment<3;segment++) {
        const a=points[segment],b=points[segment+1],direction=b.clone().sub(a),r=radius*Math.pow(.64,segment);
        stemQuaternion.setFromUnitVectors(up,direction.clone().normalize());
        stemMatrices.push(mat4(a.clone().add(b).multiplyScalar(.5).toArray(),null,[r,direction.length(),r],stemQuaternion));
      }
      // Eight successive opposite nodes, with their two leaves slightly separated
      // along the real stem; there is no four-leaf umbrella or detached leaf cloud.
      for(let node=0;node<8;node++)for(const side of [-1,1]) {
        const progress=(node+.8+side*.07)/8.1,along=progress*3,segment=Math.min(2,Math.floor(along)),t=along-segment;
        const base=points[segment].clone().lerp(points[segment+1],t);
        const leafAngle=angle+side*random.float(.75,1.45)+node*.17;
        const tilt=random.float(.12,.38)+(node/7)*.16;
        const Y=new THREE.Vector3(Math.cos(leafAngle),tilt,Math.sin(leafAngle)).applyQuaternion(rotation).normalize();
        const Z=up.clone().addScaledVector(Y,-up.dot(Y)).normalize(),X=new THREE.Vector3().crossVectors(Y,Z).normalize();
        const age=.86+.14*Math.sin(progress*Math.PI),length=random.float(.082,.108)*age,width=length*random.float(.49,.61);
        const leafMatrix=new THREE.Matrix4().makeBasis(X.multiplyScalar(width),Y.multiplyScalar(length),Z.clone().multiplyScalar(length));leafMatrix.setPosition(base);
        leafMatrices.push(leafMatrix);normals.push(...Z.toArray());ao.push(.9+.1*progress);
        colors.push(new THREE.Color(0x355a2f).lerp(pale,random.float(.08,.48)).multiplyScalar(random.float(.92,1.04)));
      }
    }
    records.push({matrix:matrix.toArray(),ground:site.ground,soilBounds:site.bounds,seed,rootOffsetX:site.rootOffsetX??0,firstStem,stemCount:stemMatrices.length-firstStem,firstLeaf,leafCount:leafMatrices.length-firstLeaf,height});
  }
  leafGeometry.setAttribute('canopyNormal',new THREE.InstancedBufferAttribute(new Float32Array(normals),3));
  leafGeometry.setAttribute('canopyAO',new THREE.InstancedBufferAttribute(new Float32Array(ao),1));
  const leaves=instanced(leafGeometry,foliageMaterial({veins:true}),leafMatrices);leaves.name='Terrace shrub leaves';
  colors.forEach((color,i)=>leaves.setColorAt(i,color));leaves.instanceColor.needsUpdate=true;
  const stems=instanced(stemGeometry,new THREE.MeshStandardMaterial({color:0x514a34,roughness:.96}),stemMatrices);stems.name='Terrace shrub stems';
  group.add(stems,leaves);
  group.userData={records,plants:matrices.length,leaves:leafMatrices.length,stemSegments:stemMatrices.length,
    triangles:(leafGeometry.index.count/3)*leafMatrices.length+(stemGeometry.index.count/3)*stemMatrices.length};
  return group;
}
