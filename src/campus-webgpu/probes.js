import { Box3, BoxGeometry, PlaneGeometry, IcosahedronGeometry, Mesh, InstancedMesh, MeshStandardNodeMaterial, Matrix4, Vector3, DoubleSide } from 'three/webgpu';
import { BUILDINGS } from '../campus/layout.js';
import { captureProbeEnvironment } from './probe-environment.js';

export function probeRegions() {
  // Capture positions stay in free space. The modest receiver extension uses the
  // nearest atlas edge; it fixes sky-only facade strips without claiming new GI detail.
  const regions=[{id:'courtyards',kind:'base',bounds:new Box3(new Vector3(-20,.4,-50),new Vector3(20,14,54)),coverageBounds:new Box3(new Vector3(-26,-2,-56),new Vector3(26,16,62)),resolution:[7,3,15],blendDistance:2}];
  for(const b of BUILDINGS.filter(building=>building.arcade)) {
    const front=b.x+b.w/2,ceiling=.16+b.floorHeight-.35;
    regions.push({id:`arcade-${b.id}`,kind:'local',bounds:new Box3(new Vector3(front-1.72,.4,b.z-b.d/2+.9),new Vector3(front+.3,ceiling-.24,b.z+b.d/2-.9)),coverageBounds:new Box3(new Vector3(front-2.5275-.45,-.02,b.z-b.d/2-.6),new Vector3(front+.75,ceiling+.03,b.z+b.d/2+.6)),resolution:[3,4,18],blendDistance:new Vector3(.45,.02,.6)});
  }
  const b=BUILDINGS.find(building=>building.kind==='commons'),front=b.x+b.w/2;
  regions.push({id:'cafe',kind:'local',bounds:new Box3(new Vector3(front-4.7,.4,b.z-b.d/2+.45),new Vector3(front+.2,.16+b.floorHeight-.71,b.z+b.d/2-.45)),coverageBounds:new Box3(new Vector3(front-5.1275-.45,-.02,b.z-b.d/2-.7),new Vector3(front+.8,.16+b.floorHeight-.42,b.z+b.d/2+.7)),resolution:[4,4,10],blendDistance:new Vector3(.45,.02,.6)});
  return regions;
}

export function createProbeCaptureScene(lighting, landscape) {
  const scene=lighting.createBakeScene(), geometries=new Set(),materials=new Set();
  const borrowedInstances=[],pavingStats={meshes:0,triangles:0};
  const cube=new BoxGeometry();geometries.add(cube);
  const material=color=>{const value=new MeshStandardNodeMaterial({color,roughness:.85});materials.add(value);return value;};
  const stone=material('#b5b0a2'),wood=material('#805b3d'),dark=material('#283236'),paving=material('#8d8b80');
  const addBox=(position,size,mat=stone)=>{const mesh=new Mesh(cube,mat);mesh.position.set(...position);mesh.scale.set(...size);mesh.castShadow=mesh.receiveShadow=true;scene.add(mesh);};
  for(const b of BUILDINGS) {
    const height=b.floors*b.floorHeight,front=b.x+b.w/2,slab=.16+b.floorHeight;
    if(b.arcade || b.kind==='commons') {
      const recess=b.arcade?2.4:5,wall=front-recess-.1275,left=b.x-b.w/2,ceiling=slab-(b.arcade?.35:.44);
      addBox([(left+wall)/2,slab/2,b.z],[wall-left,slab,b.d],dark);
      if(b.kind==='commons')addBox([b.x-3.5,slab+(height-b.floorHeight)/2,b.z+3.4],[b.w-8,height-b.floorHeight,b.d-7]);
      else addBox([b.x,(slab+height)/2,b.z],[b.w,height-slab,b.d]);
      addBox([front-recess/2,ceiling+.15,b.z],[recess+.6,.3,b.d+.5],wood);
      addBox([front-recess/2,.09,b.z],[recess+.2,.18,b.d+.2],paving);
      const bays=2*Math.ceil(b.d/12),step=(b.d-1.2)/bays;
      for(let index=0;index<=bays;index++){const offset=-(b.d-1.2)/2+index*step;if(Math.abs(offset)<3)continue;addBox([front-.28,(ceiling+.18)/2,b.z+offset],[.44,ceiling-.18,.44]);}
    } else addBox([b.x,height/2,b.z],[b.w,height,b.d]);
  }
  const groundGeometry=new PlaneGeometry(800,800);geometries.add(groundGeometry);
  const ground=new Mesh(groundGeometry,material('#54643b'));ground.rotation.x=-Math.PI/2;ground.position.y=-.025;ground.receiveShadow=true;scene.add(ground);
  // Reuse the actual path polygons, including courtyard holes and terrain joins.
  // Capture materials deliberately have no main-scene TSL hooks/probe feedback.
  landscape.updateWorldMatrix(true,true);
  landscape.traverse(object=>{
    if(!object.isMesh || Array.isArray(object.material) || !/^campus-paving(?: \/ WebGPU)?$/.test(object.material?.name || ''))return;
    const source=object.material,proxyMaterial=material(source.color);
    proxyMaterial.roughness=source.roughness;
    proxyMaterial.vertexColors=source.vertexColors;
    let proxy;
    if(object.isInstancedMesh) {
      proxy=new InstancedMesh(object.geometry,proxyMaterial,object.count);
      proxy.instanceMatrix.copy(object.instanceMatrix);
      if(object.instanceColor)proxy.instanceColor=object.instanceColor.clone();
      borrowedInstances.push(proxy);
    } else proxy=new Mesh(object.geometry,proxyMaterial);
    proxy.name='GI actual paving';proxy.matrixAutoUpdate=false;proxy.matrix.copy(object.matrixWorld);
    proxy.castShadow=proxy.receiveShadow=true;scene.add(proxy);
    pavingStats.meshes++;
    pavingStats.triangles+=(object.geometry.index?.count || object.geometry.attributes.position.count)/3*(object.isInstancedMesh?object.count:1);
  });
  const trees=landscape.userData.treePositions || [],canopyGeometry=new IcosahedronGeometry(1,2);geometries.add(canopyGeometry);
  const leaf=material('#365329');leaf.side=DoubleSide;leaf.transparent=false;leaf.alphaHash=true;leaf.opacity=.55;
  const canopies=new InstancedMesh(canopyGeometry,leaf,trees.length),matrix=new Matrix4();
  trees.forEach((tree,index)=>{
    if(tree.crownEnvelope)matrix.makeScale(...tree.crownEnvelope.radii).setPosition(...tree.crownEnvelope.center);
    else matrix.makeScale(tree.radius||tree.height*.36,tree.height*.29,tree.radius||tree.height*.36).setPosition(tree.x,(tree.ground||0)+tree.height*.71,tree.z);
    canopies.setMatrixAt(index,matrix);
  });
  canopies.castShadow=canopies.receiveShadow=true;scene.add(canopies);
  let disposed=false;
  return {scene,stats:{paving:pavingStats},dispose(){
    if(disposed)return;disposed=true;
    canopies.dispose();for(const instance of borrowedInstances)instance.dispose();
    // Borrowed paving geometry is owned by the visible landscape, never this capture.
    for(const geometry of geometries)geometry.dispose();for(const value of materials)value.dispose();
    scene.children.filter(child=>!child.isLight).forEach(child=>scene.remove(child));
    lighting.releaseBakeScene?.(scene);
  }};
}

export async function bakeCampusProbes(lighting, landscape, {renderer,architecture,roughSpecular=true,onProgress=()=>{}}={}) {
  const capture=createProbeCaptureScene(lighting,landscape),{scene}=capture;
  const regions=probeRegions(),handles=[];
  let environment;
  try {
    for(let index=0;index<regions.length;index++) {
      const region=regions[index];
      handles.push(await lighting.bakeProbe({...region,scene,batchSize:48,onProgress:fraction=>onProgress((index+fraction)/regions.length,region.id)}));
    }
    environment=captureProbeEnvironment({renderer,scene,architecture:roughSpecular?architecture:null,regions});
    const stats={regions:regions.map(region=>region.id),probes:handles.reduce((sum,probe)=>sum+probe.grid.resolution.x*probe.grid.resolution.y*probe.grid.resolution.z,0),...capture.stats,roughEnvironment:environment.stats};
    return {stats,bindRoughEnvironment:environment.bind,dispose:environment.dispose};
  } catch(error) {environment?.dispose();throw error;}
  finally {capture.dispose();}
}
