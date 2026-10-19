import { NoToneMapping, PMREMGenerator, Vector3 } from 'three/webgpu';
import { float, Fn, If, max, min, mix, pmremTexture, positionWorld, uniform, vec3 } from 'three/tsl';

const FACE_SIZE=32;
const SOFFIT_NAME=/^Jointed thermally treated ash soffit(?: \/ WebGPU)?$/;

// The two long, rough soffits need a local low-frequency radiance field, not a
// scalar darkness multiplier derived from diffuse SH. No per-frame capture runs.
export function soffitCaptureRegions(architecture,regions) {
  if(!architecture)return [];
  architecture.updateWorldMatrix(true,false);
  return (architecture.userData.arcadeSoffit?.surfaces || []).map(surface=>{
    const region=regions.find(value=>value.id===`arcade-${surface.id}`);
    if(!region)throw new Error(`Missing GI region for soffit ${surface.id}`);
    const [u0,u1,v0,v1]=surface.bounds,u=(u0+u1)/2,v=(v0+v1)/2;
    const position=new Vector3(surface.origin[0]+surface.tangent[0]*u+surface.normal[0]*v,surface.bottom-.35,
      surface.origin[1]+surface.tangent[1]*u+surface.normal[1]*v).applyMatrix4(architecture.matrixWorld);
    return {id:region.id,position,bounds:region.coverageBounds.clone(),blendDistance:region.blendDistance.clone()};
  });
}

function localEnvironmentNode(material,original,entries) {
  return Fn(builder=>{
    const direction=builder.context.getUV(),level=builder.context.getTextureLevel();
    const sky=original || pmremTexture(material.envMap || builder.scene.environment,direction,level);
    const sum=vec3(0).toVar(),total=float(0).toVar(),coverage=float(0).toVar(),result=vec3(0).toVar();
    for(const entry of entries) {
      const inside=positionWorld.sub(uniform(entry.bounds.min)).min(uniform(entry.bounds.max).sub(positionWorld)).div(uniform(entry.blendDistance));
      const weight=min(inside.x,min(inside.y,inside.z)).smoothstep(0,1).toVar();
      // EnvironmentNode also evaluates envNode at level 1 for diffuse. Keep that
      // lookup on the sky; CampusEnvironmentNode owns the separate SH diffuse.
      If(weight.greaterThan(0).and(level.lessThan(.99)),()=>{
        // Explicit PMREM roughness level is safe inside a spatial branch.
        sum.addAssign(pmremTexture(entry.target.texture,direction,level).mul(weight));
        total.addAssign(weight);coverage.assign(max(coverage,weight));
      });
    }
    If(total.greaterThan(0),()=>{result.assign(sum.div(total.max(1e-6)));});
    If(coverage.lessThan(1),()=>{result.assign(mix(sky,result,coverage));});
    return result;
  })();
}

export function createProbeEnvironmentHandle(entries,architecture=null) {
  const bindings=new Map();let disposed=false;
  const stats={captures:entries.length,faceSize:FACE_SIZE,cubeViews:entries.length*6,
    colorBytes:entries.reduce((sum,entry)=>sum+entry.target.width*entry.target.height*8,0),boundMaterials:0};
  return {stats,
    bind(root=architecture) {
      if(disposed)throw new Error('Probe environment is disposed');
      if(!root || !entries.length)return;
      root.traverse(object=>{
        for(const material of (Array.isArray(object.material)?object.material:[object.material])) {
          if(!material?.isMeshStandardNodeMaterial || !SOFFIT_NAME.test(material.name) || bindings.has(material))continue;
          const original=material.envNode,node=localEnvironmentNode(material,original,entries);
          bindings.set(material,{original,node});material.envNode=node;material.needsUpdate=true;
        }
      });
      stats.boundMaterials=bindings.size;
    },
    dispose() {
      if(disposed)return;disposed=true;
      for(const [material,{original,node}] of bindings) {
        if(material.envNode===node){material.envNode=original;material.needsUpdate=true;}
      }
      bindings.clear();stats.boundMaterials=0;
      for(const entry of entries)entry.target.dispose();
    },
  };
}

export function captureProbeEnvironment({renderer,scene,architecture,regions}) {
  const layouts=soffitCaptureRegions(architecture,regions),entries=[];
  if(!layouts.length)return createProbeEnvironmentHandle(entries,architecture);
  if(!renderer?.isWebGPURenderer || !renderer.backend?.isWebGPUBackend)throw new Error('Local soffit capture requires the initialized WebGPU renderer');
  const previous={target:renderer.getRenderTarget(),face:renderer.getActiveCubeFace(),mip:renderer.getActiveMipmapLevel(),
    mrt:renderer.getMRT(),tone:renderer.toneMapping,autoClear:renderer.autoClear};
  const pmrem=new PMREMGenerator(renderer),started=performance.now();
  try {
    renderer.setMRT(null);renderer.toneMapping=NoToneMapping;renderer.autoClear=true;
    for(const layout of layouts) {
      const target=pmrem.fromScene(scene,0,.05,650,{size:FACE_SIZE,position:layout.position});
      entries.push({...layout,target});
    }
    const handle=createProbeEnvironmentHandle(entries,architecture);
    handle.stats.captureMs=performance.now()-started;
    return handle;
  } catch(error) {for(const entry of entries)entry.target.dispose();throw error;}
  finally {
    renderer.setRenderTarget(previous.target,previous.face,previous.mip);renderer.setMRT(previous.mrt);
    renderer.toneMapping=previous.tone;renderer.autoClear=previous.autoClear;pmrem.dispose();
  }
}
