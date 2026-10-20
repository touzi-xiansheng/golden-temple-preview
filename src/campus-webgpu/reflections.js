import { Vector2, Vector3, Matrix4, Plane, PerspectiveCamera, RenderTarget, CubeRenderTarget, CubeCamera, PMREMGenerator, HalfFloatType, DataTexture, RGBAFormat, FloatType, NoToneMapping } from 'three/webgpu';
import { texture, uniform, positionWorld, vec4, float } from 'three/tsl';
import { BUILDINGS } from '../campus/layout.js';
import { configureReflectionCamera, projectReflectionPortal } from './reflection-camera.js';

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

export function createReflections({renderer,scene,materials,lighting,planar=true,mode='portal'}) {
  if (!['portal','reference'].includes(mode)) throw new RangeError('Unknown reflection mode');
  const planes=glassPlanes(materials.glass), size=new Vector2();
  const empty=new DataTexture(new Float32Array([0,0,0,1]),1,1,RGBAFormat,FloatType);empty.needsUpdate=true;
  const slot=(()=>{
    const target=new RenderTarget(1,1,{type:HalfFloatType,samples:4});
    const matrix=uniform(new Matrix4()), min=uniform(new Vector3()), max=uniform(new Vector3()), enabled=uniform(0),uvMax=uniform(new Vector2(1,1));
    const projected=matrix.mul(vec4(positionWorld,1));
    const coordinates=projected.xy.div(projected.w.max(.00001));
    const sample=texture(empty,coordinates);
    const inside=positionWorld.greaterThanEqual(min).all().and(positionWorld.lessThanEqual(max).all())
      .and(coordinates.greaterThanEqual(0).all()).and(coordinates.lessThanEqual(uvMax).all()).and(projected.w.greaterThan(0));
    return {target,matrix,min,max,enabled,uvMax,sample,weight:float(inside).mul(enabled),camera:new PerspectiveCamera(),plane:null};
  })();
  if(planar)for(const {material} of materials.glass)materials.setGlassReflection(material,{node:slot.sample.rgb,weight:slot.weight.clamp()});
  const captures=[], stats={planes:planes.length,active:[],updates:0,probeCount:0,enabled:planar,mode:planar?mode:'parallax-probes',
    capturesThisUpdate:0,cacheHits:0,captureSize:[0,0],allocatedSize:[0,0],selectedPlane:null,selectedAreaPixels:0,
    updateCpuMs:0,captureCpuMs:0,captureDrawCalls:0,captureTriangles:0,reason:'initial'};
  let disposed=false,scale=.5,dirty=true;
  const lastView=new Matrix4(),lastProjection=new Matrix4(),lastSize=new Vector2();

  function disable(reason) {
    slot.enabled.value=0;slot.sample.value=empty;
    stats.active=[];stats.selectedPlane=null;stats.selectedAreaPixels=0;stats.captureSize=[0,0];stats.reason=reason;
  }

  async function captureProbes({yieldControl=()=>Promise.resolve(),onProgress=()=>{}}={}) {
    const cube=new CubeRenderTarget(512,{type:HalfFloatType}), camera=new CubeCamera(.2,2500,cube), pmrem=new PMREMGenerator(renderer);
    // The HQ fills the garden shot; resolve its reflected foliage without enlarging every probe.
    const hqCube=new CubeRenderTarget(1024,{type:HalfFloatType}), hqCamera=new CubeCamera(.2,2500,hqCube);
    const previous=renderer.getRenderTarget(),background=scene.background;
    if(!lighting.backgroundNode)scene.background=lighting.captureBackground.texture;
    const assignments=[];
    try {
      const byProbe=new Map();
      for(const record of materials.glass) {
        const probe=record.probe;if(!probe?.position)continue;
        if(!byProbe.has(probe.id))byProbe.set(probe.id,{probe,records:[]});byProbe.get(probe.id).records.push(record);
      }
      for(const {probe,records} of byProbe.values()) {
        const captureCamera=probe.id==='headquarters'?hqCamera:camera;
        captureCamera.position.fromArray(probe.position);captureCamera.update(renderer,scene);
        const target=pmrem.fromCubemap(captureCamera.renderTarget.texture);captures.push(target);assignments.push({records,target});
        renderer.setRenderTarget(previous);stats.probeCount++;onProgress(stats.probeCount,byProbe.size);await yieldControl();
      }
      for(const {records,target} of assignments)for(const {material} of records){material.envMap=target.texture;material.needsUpdate=true;}
    } finally {renderer.setRenderTarget(previous);scene.background=background;cube.dispose();hqCube.dispose();pmrem.dispose();}
  }

  function update(camera,{force=false}={}) {
    if(disposed)return;
    const start=performance.now();
    stats.capturesThisUpdate=0;stats.captureCpuMs=0;stats.captureDrawCalls=0;stats.captureTriangles=0;
    try {
      if(!stats.enabled || scale<=0){disable('disabled');return;}
      camera.updateWorldMatrix(true,false);renderer.getDrawingBufferSize(size);
      if(!force&&!dirty&&size.equals(lastSize)&&camera.matrixWorld.equals(lastView)&&camera.projectionMatrix.equals(lastProjection)) {
        stats.cacheHits++;stats.reason='stationary';return;
      }
      // Keep a failed forced recapture retryable even when the viewer is still.
      dirty=true;
      const eye=new Vector3().setFromMatrixPosition(camera.matrixWorld),candidates=[];
      for(const plane of planes) {
        const distance=plane.bounds.distanceToPoint(eye);
        if(distance>=18 || plane.plane.distanceToPoint(eye)<=.03)continue;
        const portal=projectReflectionPortal(plane,camera,size.x,size.y);
        if(!portal || portal.areaPixels<64)continue;
        const weight=1-Math.max(0,Math.min(1,(distance-12)/6));
        candidates.push({plane,portal,weight,score:portal.areaPixels*weight});
      }
      candidates.sort((a,b)=>b.score-a.score);
      let selected=candidates[0];
      const previous=candidates.find(candidate=>candidate.plane===slot.plane);
      if(previous && selected && previous.score>=selected.score/1.2)selected=previous;
      const factor=Math.min(scale,1536/Math.max(size.x,size.y));
      const width=Math.max(1,Math.round(size.x*factor)),height=Math.max(1,Math.round(size.y*factor));
      const configured=selected && configureReflectionCamera(slot.camera,camera,selected.plane,selected.portal,{width,height,mode});
      disable(selected?'invalid-projection':'no-visible-facade');
      if(configured) {
        const previousTarget=renderer.getRenderTarget(),mrt=renderer.getMRT(),tone=renderer.toneMapping,autoClear=renderer.autoClear,background=scene.background;
        // Fixed allocation prevents moving portal edges from reallocating MSAA,
        // depth and colour textures each frame. The real projection and viewport
        // are cropped; scissoring a full camera alone would not cull any draws.
        slot.target.setSize(width,height);
        slot.target.viewport.set(0,0,configured.width,configured.height);
        slot.target.scissor.set(0,0,configured.width,configured.height);slot.target.scissorTest=true;
        const captureStart=performance.now(),beforeCalls=renderer.info?.render?.drawCalls||0,beforeTriangles=renderer.info?.render?.triangles||0;
        try {
          renderer.setMRT(null);renderer.toneMapping=NoToneMapping;renderer.autoClear=true;
          if(!lighting.backgroundNode)scene.background=lighting.captureBackground.texture;
          renderer.setRenderTarget(slot.target);renderer.render(scene,slot.camera);
          // Publish the texture, transform and domain atomically. A failed or
          // degenerate capture leaves only the static probe fallback enabled.
          slot.uvMax.value.set(configured.width/width,configured.height/height);
          slot.matrix.value.makeScale(slot.uvMax.value.x,slot.uvMax.value.y,1).multiply(configured.textureMatrix);
          slot.min.value.copy(selected.plane.bounds.min).addScalar(-.015);slot.max.value.copy(selected.plane.bounds.max).addScalar(.015);
          slot.plane=selected.plane;slot.sample.value=slot.target.texture;slot.enabled.value=selected.weight;
          stats.updates++;stats.capturesThisUpdate=1;stats.active=[selected.plane.id];stats.selectedPlane=selected.plane.id;
          stats.selectedAreaPixels=selected.portal.areaPixels;stats.captureSize=[configured.width,configured.height];stats.allocatedSize=[width,height];stats.reason='captured';
        } finally {
          stats.captureCpuMs=performance.now()-captureStart;
          stats.captureDrawCalls=(renderer.info?.render?.drawCalls||0)-beforeCalls;
          stats.captureTriangles=(renderer.info?.render?.triangles||0)-beforeTriangles;
          renderer.setRenderTarget(previousTarget);renderer.setMRT(mrt);renderer.toneMapping=tone;renderer.autoClear=autoClear;scene.background=background;
        }
      }
      lastView.copy(camera.matrixWorld);lastProjection.copy(camera.projectionMatrix);lastSize.copy(size);dirty=false;
    } finally {stats.updateCpuMs=performance.now()-start;}
  }
  return {stats,planes,captureProbes,update,
    setQuality(quality){scale=quality==='performance'?.35:quality==='quality'?1:.6;dirty=true;},
    setEnabled(value){stats.enabled=planar&&!!value;dirty=true;if(!stats.enabled)disable('disabled');},
    setMode(value){if(!['portal','reference'].includes(value))throw new RangeError('Unknown reflection mode');mode=value;stats.mode=planar?mode:'parallax-probes';dirty=true;},
    invalidate(){dirty=true;},
    dispose(){if(disposed)return;disposed=true;slot.target.dispose();captures.forEach(target=>target.dispose());empty.dispose();},
  };
}
