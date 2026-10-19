import * as THREE from 'three';

const NEAR_DISTANCE = 12, CLIP_OFFSET = .002;
const BIAS = new THREE.Matrix4().set(.5,0,0,.5,0,.5,0,.5,0,0,.5,.5,0,0,0,1);

export function createCampusPlanarReflections(scene, renderer, architecture, backgroundTexture) {
  const uniforms = architecture.getObjectByName('Solar control glass / west')?.material.userData.campusGlass?.planarUniforms;
  if (!uniforms || !backgroundTexture?.isTexture) throw new Error('Planar reflections require glazing hooks and the sun-free sky texture');
  scene.updateMatrixWorld(true);
  const transform = architecture.matrixWorld, normalMatrix = new THREE.Matrix3().getNormalMatrix(transform);
  for (const i of [1,2,4,6,8,9]) if (Math.abs(transform.elements[i])>1e-6) {
    throw new Error('Planar reflection domains require axis-aligned architecture');
  }
  const surfaces = (architecture.userData.arcadePlanarSurfaces || []).map(surface=>{
    const point = new THREE.Vector3(...surface.point).applyMatrix4(transform);
    const normal = new THREE.Vector3(...surface.normal).applyMatrix3(normalMatrix).normalize();
    const bounds = new THREE.Box3(new THREE.Vector3(...surface.min),new THREE.Vector3(...surface.max)).applyMatrix4(transform);
    return {id:surface.id,point,normal,bounds,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(normal,point)};
  });
  if (surfaces.length !== 2) throw new Error('Planar reflections require the two generated arcade glass planes');
  const hooks = new Set();
  scene.traverse(object=>{
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material?.userData.campusGlass) hooks.add(material.userData.campusGlass);
    }
  });
  const stats = {enabled:true,activeSurface:null,updates:0,reuses:0,width:0,height:0,lastUpdateMs:0,error:null};
  const eye = new THREE.Vector3(), nearest = new THREE.Vector3(), look = new THREE.Vector3(), up = new THREE.Vector3();
  const frustum = new THREE.Frustum(), viewProjection = new THREE.Matrix4(), textureMatrix = new THREE.Matrix4();
  const lastWorld = new THREE.Matrix4(), lastProjection = new THREE.Matrix4(), size = new THREE.Vector2();
  let target = null, mirror = null, lastSurface = null, lastLayers = -1, enabled = true, valid = false, disposed = false;

  function inactive() { uniforms.uCampusPlanarEnabled.value=0; stats.activeSurface=null; valid=false; }

  return {
    stats,
    update(camera,{scale=1}={}) {
      if (disposed || !enabled || !(scale>0) || !Number.isFinite(scale)) { inactive(); return false; }
      camera.updateWorldMatrix(true,false);
      eye.setFromMatrixPosition(camera.matrixWorld);
      viewProjection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(viewProjection,camera.coordinateSystem);
      let selected = null, distance = NEAR_DISTANCE;
      for (const surface of surfaces) {
        if (surface.plane.distanceToPoint(eye)<=.05 || !frustum.intersectsBox(surface.bounds)) continue;
        surface.bounds.clampPoint(eye,nearest);
        const candidateDistance = nearest.distanceTo(eye);
        if (candidateDistance<distance) { selected=surface; distance=candidateDistance; }
      }
      if (!selected) { inactive(); return false; }
      const weight = 1-THREE.MathUtils.smoothstep(distance,8,NEAR_DISTANCE);
      renderer.getDrawingBufferSize(size);
      const factor = Math.min(scale,1,2048/Math.max(size.x,size.y));
      const width = Math.max(1,Math.round(size.x*factor)), height = Math.max(1,Math.round(size.y*factor));
      if (valid && selected.id===lastSurface && width===stats.width && height===stats.height &&
          camera.layers.mask===lastLayers && camera.matrixWorld.equals(lastWorld) && camera.projectionMatrix.equals(lastProjection) &&
          !renderer.shadowMap.needsUpdate) {
        uniforms.uCampusPlanarEnabled.value=weight; stats.activeSurface=selected.id; stats.reuses++; return false;
      }
      // Resolve subpixel board joints before mip filtering to avoid dotted reflections.
      if (!target) {
        const gl=renderer.getContext(),supported=gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES);
        const samples=Math.max(0,...Array.from(supported || []).filter(count=>count<=4));
        target = new THREE.WebGLRenderTarget(width,height,{
          type:THREE.HalfFloatType,format:THREE.RGBAFormat,colorSpace:THREE.LinearSRGBColorSpace,
          minFilter:THREE.LinearMipmapLinearFilter,magFilter:THREE.LinearFilter,generateMipmaps:true,
          depthBuffer:true,stencilBuffer:false,samples,
        });
      }
      else if (target.width!==width || target.height!==height) target.setSize(width,height);
      target.texture.name = 'Nearest arcade planar radiance';
      if (!mirror || mirror.type!==camera.type) mirror=camera.clone(false);
      const reflectPoint = point=>point.addScaledVector(selected.normal,-2*selected.plane.distanceToPoint(point));
      mirror.position.copy(reflectPoint(eye.clone()));
      camera.getWorldDirection(look); look.add(eye); reflectPoint(look);
      up.setFromMatrixColumn(camera.matrixWorld,1).normalize().reflect(selected.normal);
      mirror.up.copy(up); mirror.lookAt(look);
      mirror.near=camera.near; mirror.far=camera.far; mirror.layers.mask=camera.layers.mask;
      mirror.updateMatrixWorld(true);
      mirror.projectionMatrix.copy(camera.projectionMatrix);
      mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
      textureMatrix.copy(BIAS).multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);

      // Reflector.js's oblique near plane, expressed as row3 = scaledPlane - row4.
      const clip = new THREE.Plane().setFromNormalAndCoplanarPoint(selected.normal,
        selected.point.clone().addScaledVector(selected.normal,CLIP_OFFSET)).applyMatrix4(mirror.matrixWorldInverse);
      const plane = new THREE.Vector4(clip.normal.x,clip.normal.y,clip.normal.z,clip.constant);
      const opposite = new THREE.Vector4(Math.sign(plane.x),Math.sign(plane.y),1,1).applyMatrix4(mirror.projectionMatrixInverse);
      const denominator = plane.dot(opposite);
      if (Math.abs(denominator)<1e-7) { inactive(); return false; }
      plane.multiplyScalar(2/denominator);
      const projection = mirror.projectionMatrix.elements;
      projection[2]=plane.x-projection[3]; projection[6]=plane.y-projection[7];
      projection[10]=plane.z-projection[11]; projection[14]=plane.w-projection[15];
      mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();

      const previous = {
        target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
        viewport:renderer.getViewport(new THREE.Vector4()),scissor:renderer.getScissor(new THREE.Vector4()),scissorTest:renderer.getScissorTest(),
        toneMapping:renderer.toneMapping,outputColorSpace:renderer.outputColorSpace,autoClear:renderer.autoClear,
        xr:renderer.xr.enabled,shadowAuto:renderer.shadowMap.autoUpdate,shadowNeeds:renderer.shadowMap.needsUpdate,background:scene.background,
      };
      const previousHooks = [];
      const started = performance.now();
      let rendered = false;
      try {
        for (const hook of hooks) {
          const planar=hook.planarUniforms;
          previousHooks.push({planar,enabled:planar?.uCampusPlanarEnabled.value,map:planar?.uCampusPlanarMap.value});
          // An inactive shader branch still binds its sampler: detach the attachment as well.
          if (planar) { planar.uCampusPlanarEnabled.value=0; planar.uCampusPlanarMap.value=null; }
        }
        scene.background=backgroundTexture;
        renderer.xr.enabled=false; renderer.shadowMap.autoUpdate=false;
        // Preserve needsUpdate: the complete reflected scene consumes a pending shadow refresh once.
        renderer.toneMapping=THREE.NoToneMapping; renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
        renderer.autoClear=false;
        renderer.setRenderTarget(target);
        renderer.state.buffers.depth.setMask(true);
        renderer.clear(true,true,true);
        renderer.render(scene,mirror);
        rendered=true;
      } catch (error) {
        stats.error=error instanceof Error ? error.message : String(error);
      } finally {
        for (const saved of previousHooks) {
          if (saved.planar) { saved.planar.uCampusPlanarEnabled.value=saved.enabled; saved.planar.uCampusPlanarMap.value=saved.map; }
        }
        scene.background=previous.background;
        renderer.xr.enabled=previous.xr; renderer.shadowMap.autoUpdate=previous.shadowAuto;
        if (!rendered) renderer.shadowMap.needsUpdate=previous.shadowNeeds || renderer.shadowMap.needsUpdate;
        renderer.toneMapping=previous.toneMapping; renderer.outputColorSpace=previous.outputColorSpace;
        renderer.autoClear=previous.autoClear;
        renderer.setViewport(previous.viewport); renderer.setScissor(previous.scissor); renderer.setScissorTest(previous.scissorTest);
        renderer.setRenderTarget(previous.target,previous.face,previous.mip);
      }
      if (!rendered) { inactive(); return false; }
      uniforms.uCampusPlanarMap.value=target.texture;
      uniforms.uCampusPlanarMatrix.value.copy(textureMatrix);
      uniforms.uCampusPlanarGlassMin.value.copy(selected.bounds.min).addScaledVector(selected.normal,-.003);
      uniforms.uCampusPlanarGlassMax.value.copy(selected.bounds.max).addScaledVector(selected.normal,.003);
      uniforms.uCampusPlanarEnabled.value=weight;
      lastWorld.copy(camera.matrixWorld); lastProjection.copy(camera.projectionMatrix); lastLayers=camera.layers.mask;
      lastSurface=selected.id; valid=true;
      stats.activeSurface=selected.id; stats.width=width; stats.height=height;
      stats.lastUpdateMs=performance.now()-started; stats.updates++; stats.error=null;
      return true;
    },
    setEnabled(value) {
      if (disposed) return;
      enabled=!!value; stats.enabled=enabled;
      if (!enabled) inactive();
    },
    dispose() {
      if (disposed) return;
      disposed=true; stats.enabled=false; inactive();
      if (uniforms.uCampusPlanarMap.value===target?.texture) uniforms.uCampusPlanarMap.value=null;
      target?.dispose(); target=null;
    },
  };
}
