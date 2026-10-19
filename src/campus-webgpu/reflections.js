import { Box3, Vector2, Vector3, Vector4, Matrix4, Plane, Frustum, PerspectiveCamera, RenderTarget, CubeRenderTarget, CubeCamera, PMREMGenerator, HalfFloatType, DataTexture, RGBAFormat, FloatType, NoToneMapping } from 'three/webgpu';
import { texture, uniform, positionWorld, vec4, mix, float } from 'three/tsl';
import { BUILDINGS } from '../campus/layout.js';

// Each physical facade plane shares one capture, regardless of pane batching.
export function glassPlanes(glass) {
  const planes = new Map(), matrix = new Matrix4(), world = new Matrix4(), center = new Vector3();
  for (const object of new Set(glass.flatMap(record=>record.objects || [record.object]))) {
    if (!object?.isInstancedMesh) continue;
    object.updateWorldMatrix(true,false); object.geometry.computeBoundingBox();
    for (let index=0;index<object.count;index++) {
      if (object.geometry.getAttribute('paneType')?.getX(index) > .5) continue;
      object.getMatrixAt(index,matrix); world.multiplyMatrices(object.matrixWorld,matrix);
      center.setFromMatrixPosition(world);
      const axes = [0,1,2].map(axis=>new Vector3().setFromMatrixColumn(world,axis));
      const sizes = axes.map(axis=>axis.length());
      const thin = sizes.indexOf(Math.min(...sizes));
      if (thin===1 || sizes[thin]>.3) continue;
      const nearest = BUILDINGS.reduce((best,building)=>{
        const distance=Math.hypot(Math.max(0,Math.abs(center.x-building.x)-building.w/2),Math.max(0,Math.abs(center.z-building.z)-building.d/2));
        return !best || distance<best.distance ? {building,distance}:best;
      },null).building;
      const normal=axes[thin].normalize();
      if (normal.dot(new Vector3(center.x-nearest.x,0,center.z-nearest.z))<0) normal.negate();
      const point=center.clone().addScaledVector(normal,sizes[thin]/2);
      const plane=new Plane().setFromNormalAndCoplanarPoint(normal,point);
      const key=[...normal.toArray(),plane.constant].map(value=>value.toFixed(3)).join(',');
      const bounds=object.geometry.boundingBox.clone().applyMatrix4(world);
      if(planes.has(key))planes.get(key).bounds.union(bounds);
      else planes.set(key,{id:key,normal,point,plane,bounds});
    }
  }
  return [...planes.values()];
}

export function createReflections({renderer,scene,materials,lighting}) {
  const planes=glassPlanes(materials.glass), size=new Vector2();
  const empty=new DataTexture(new Float32Array([0,0,0,1]),1,1,RGBAFormat,FloatType);empty.needsUpdate=true;
  const slots=Array.from({length:2},()=>{
    const target=new RenderTarget(1,1,{type:HalfFloatType,samples:4});
    const matrix=uniform(new Matrix4()), min=uniform(new Vector3()), max=uniform(new Vector3()), enabled=uniform(0);
    const projected=matrix.mul(vec4(positionWorld,1));
    const coordinates=projected.xy.div(projected.w.max(.00001));
    const sample=texture(empty,coordinates);
    const inside=positionWorld.greaterThanEqual(min).all().and(positionWorld.lessThanEqual(max).all())
      .and(coordinates.greaterThanEqual(0).all()).and(coordinates.lessThanEqual(1).all()).and(projected.w.greaterThan(0));
    return {target,matrix,min,max,enabled,sample,weight:float(inside).mul(enabled),camera:new PerspectiveCamera(),plane:null};
  });
  const weight=slots[0].weight.add(slots[1].weight);
  const radiance=slots[0].sample.rgb.mul(slots[0].weight).add(slots[1].sample.rgb.mul(slots[1].weight)).div(weight.max(.00001));
  for(const {material} of materials.glass)materials.setGlassReflection(material,{node:radiance,weight:weight.clamp()});
  const captures=[], stats={planes:planes.length,active:[],updates:0,probeCount:0,enabled:true};
  let disposed=false,scale=.5,dirty=true;
  const lastView=new Matrix4(),lastProjection=new Matrix4(),frustum=new Frustum(),viewProjection=new Matrix4();
  const bias=new Matrix4().set(.5,0,0,.5,0,-.5,0,.5,0,0,1,0,0,0,0,1);

  async function captureProbes({yieldControl=()=>Promise.resolve(),onProgress=()=>{}}={}) {
    const cube=new CubeRenderTarget(256,{type:HalfFloatType}), camera=new CubeCamera(.2,2500,cube), pmrem=new PMREMGenerator(renderer);
    const previous=renderer.getRenderTarget(),background=scene.background;
    scene.background=lighting.captureBackground.texture;
    const assignments=[];
    try {
      const byProbe=new Map();
      for(const record of materials.glass) {
        const probe=record.probe;if(!probe?.position)continue;
        if(!byProbe.has(probe.id))byProbe.set(probe.id,{probe,records:[]});byProbe.get(probe.id).records.push(record);
      }
      for(const {probe,records} of byProbe.values()) {
        camera.position.fromArray(probe.position);camera.update(renderer,scene);
        const target=pmrem.fromCubemap(cube.texture);captures.push(target);assignments.push({records,target});
        renderer.setRenderTarget(previous);stats.probeCount++;onProgress(stats.probeCount,byProbe.size);await yieldControl();
      }
      for(const {records,target} of assignments)for(const {material} of records){material.envMap=target.texture;material.needsUpdate=true;}
    } finally {renderer.setRenderTarget(previous);scene.background=background;cube.dispose();pmrem.dispose();}
  }

  function update(camera,{force=false}={}) {
    if(disposed)return;
    if(!stats.enabled || scale<=0){slots.forEach(slot=>slot.enabled.value=0);stats.active=[];return;}
    camera.updateWorldMatrix(true,false);renderer.getDrawingBufferSize(size);
    if(!force&&!dirty&&camera.matrixWorld.equals(lastView)&&camera.projectionMatrix.equals(lastProjection))return;
    viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProjection,camera.coordinateSystem);
    const eye=new Vector3().setFromMatrixPosition(camera.matrixWorld);
    const candidates=planes.map(plane=>({plane,distance:plane.bounds.distanceToPoint(eye)}))
      .filter(({plane,distance})=>distance<18&&plane.plane.distanceToPoint(eye)>.03&&frustum.intersectsBox(plane.bounds))
      .sort((a,b)=>a.distance-b.distance).slice(0,2);
    const previousTarget=renderer.getRenderTarget(),mrt=renderer.getMRT(),tone=renderer.toneMapping,autoClear=renderer.autoClear,background=scene.background;
    slots.forEach(slot=>{slot.enabled.value=0;slot.sample.value=empty;});
    try {
      renderer.setMRT(null);renderer.toneMapping=NoToneMapping;renderer.autoClear=true;scene.background=lighting.captureBackground.texture;
      for(let index=0;index<candidates.length;index++) {
        const {plane,distance}=candidates[index],slot=slots[index],mirror=slot.camera;
        const reflect=point=>point.addScaledVector(plane.normal,-2*plane.plane.distanceToPoint(point));
        mirror.position.copy(reflect(eye.clone()));
        const look=camera.getWorldDirection(new Vector3()).add(eye);reflect(look);
        mirror.up.setFromMatrixColumn(camera.matrixWorld,1).reflect(plane.normal);mirror.lookAt(look);
        mirror.coordinateSystem=camera.coordinateSystem;mirror.near=camera.near;mirror.far=camera.far;mirror.layers.mask=camera.layers.mask;
        mirror.updateMatrixWorld();mirror.projectionMatrix.copy(camera.projectionMatrix);mirror.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
        slot.matrix.value.copy(bias).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
        const clip=plane.plane.clone().applyMatrix4(mirror.matrixWorldInverse);
        const equation=new Vector4(...clip.normal.toArray(),clip.constant);
        const opposite=new Vector4(Math.sign(equation.x),Math.sign(equation.y),1,1).applyMatrix4(mirror.projectionMatrixInverse);
        const denominator=equation.dot(opposite);if(Math.abs(denominator)<1e-7)continue;
        equation.multiplyScalar(1/denominator);
        // WebGPU near clip is z=0, so replace row 3 directly (not GL's row3-row4).
        const p=mirror.projectionMatrix.elements;p[2]=equation.x;p[6]=equation.y;p[10]=equation.z;p[14]=equation.w;
        mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
        const factor=Math.min(scale,1536/Math.max(size.x,size.y));
        slot.target.setSize(Math.max(1,Math.round(size.x*factor)),Math.max(1,Math.round(size.y*factor)));
        renderer.setRenderTarget(slot.target);renderer.render(scene,mirror);
        slot.min.value.copy(plane.bounds.min).addScalar(-.015);slot.max.value.copy(plane.bounds.max).addScalar(.015);
        slot.plane=plane;slot.nextWeight=1-Math.max(0,Math.min(1,(distance-12)/6));stats.updates++;
      }
    } finally { renderer.setRenderTarget(previousTarget);renderer.setMRT(mrt);renderer.toneMapping=tone;renderer.autoClear=autoClear;scene.background=background; }
    for(let index=0;index<slots.length;index++){const slot=slots[index];slot.sample.value=slot.target.texture;slot.enabled.value=index<candidates.length?slot.nextWeight||0:0;}
    stats.active=candidates.map(({plane})=>plane.id);lastView.copy(camera.matrixWorld);lastProjection.copy(camera.projectionMatrix);dirty=false;
  }
  return {stats,planes,captureProbes,update,
    setQuality(quality){scale=quality==='performance'?.35:quality==='quality'?1:.6;dirty=true;},
    setEnabled(value){stats.enabled=!!value;dirty=true;if(!value)slots.forEach(slot=>slot.enabled.value=0);},
    invalidate(){dirty=true;},
    dispose(){if(disposed)return;disposed=true;slots.forEach(slot=>slot.target.dispose());captures.forEach(target=>target.dispose());empty.dispose();},
  };
}
