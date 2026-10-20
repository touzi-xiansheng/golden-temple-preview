// CPU-only full-geometry comparison; no renderer, browser or GPU is created.
// node --expose-gc tools/webgpu-landscape-bench.mjs out/webgpu/landscape-before-loading.js
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildLandscapeSteps } from '../src/campus/landscape.js';
import { finishBuild } from '../src/campus/loading.js';

const baselinePath=process.argv[2],output=process.argv[3]||'out/webgpu/landscape-cpu-compare.json';
assert.ok(baselinePath,'Pass a saved, pre-optimization src/campus/landscape.js as the first argument');
assert.equal(typeof globalThis.gc,'function','Run with node --expose-gc to collect each completed scene before the next run');
const baselineSource=fs.readFileSync(baselinePath,'utf8'),sourceURL=new URL('../src/campus/landscape.js',import.meta.url);
const resolved=baselineSource.replace(/from (['"])([^'"]+)\1/g,(_,quote,specifier)=>
  `from '${specifier.startsWith('.')?new URL(specifier,sourceURL).href:import.meta.resolve(specifier)}'`);
const {buildLandscapeSteps:baseline}=await import('data:text/javascript;base64,'+Buffer.from(resolved).toString('base64'));
const hashBytes=value=>createHash('sha256').update(value).digest('hex');
const report={schemaVersion:1,at:new Date().toISOString(),node:process.version,
  sources:{baseline:path.resolve(baselinePath),baselineHash:hashBytes(baselineSource),currentHash:hashBytes(fs.readFileSync(sourceURL))},
  method:{order:['before','after','after','before'],refined:true,scope:'Full synchronous landscape generation; every geometry/index/instance attribute hashed',
    limitations:'Canvas calls are stubbed; excludes browser scheduling, GPU work, and complete application startup. Four runs are a diagnostic, not a confidence interval.'},cases:[]};
fs.mkdirSync(path.dirname(output),{recursive:true});
const save=()=>fs.writeFileSync(output,JSON.stringify(report,null,2));
const previousDocument=globalThis.document,previousInfo=console.info;
const context=new Proxy({}, {get:(_,key)=>key==='getImageData'
  ?(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)})
  :key==='createLinearGradient'?()=>({addColorStop(){}}):()=>{}});
globalThis.document={createElement:()=>({getContext:()=>context})};console.info=()=>{};

function run(mode) {
  let group;
  try {
    const started=performance.now();
    group=finishBuild((mode==='before'?baseline:buildLandscapeSteps)({refined:true}));
    const elapsedMs=performance.now()-started,hash=createHash('sha256');
    let meshes=0,instances=0,triangles=0;
    const addAttribute=attribute=>{
      if(!attribute){hash.update('null');return;}
      hash.update(JSON.stringify([attribute.itemSize,attribute.normalized,attribute.array.constructor.name]));
      hash.update(Buffer.from(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength));
    };
    group.traverse(mesh=>{
      if(!mesh.isMesh)return;
      const count=mesh.isInstancedMesh?mesh.count:1;meshes++;instances+=count;
      triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3*count;
      hash.update(JSON.stringify([mesh.name,mesh.type,count,mesh.castShadow,mesh.receiveShadow]));
      for(const name of Object.keys(mesh.geometry.attributes).sort()){hash.update(name);addAttribute(mesh.geometry.attributes[name]);}
      for(const attribute of [mesh.geometry.index,mesh.instanceMatrix,mesh.instanceColor])addAttribute(attribute);
    });
    return {mode,elapsedMs,meshes,instances,triangles,geometryHash:hash.digest('hex'),stats:structuredClone(group.userData.stats),
      removedGrass:{south:[group.userData.southBorder?.shortGrassRemoved,group.userData.southBorder?.mownTurfRemoved],
        southeast:[group.userData.southeastSample?.shortGrassRemoved,group.userData.southeastSample?.mownTurfRemoved]}};
  } finally {
    const resources=new Set();
    group?.traverse(mesh=>{
      if(!mesh.isMesh)return;
      resources.add(mesh.geometry);resources.add(mesh.material);
      if(mesh.isInstancedMesh)mesh.dispose();mesh.customDepthMaterial?.dispose();
    });
    for(const resource of resources){if(resource.isMaterial)for(const value of Object.values(resource))if(value?.isTexture)resources.add(value);resource.dispose();}
    group?.userData.contextDistricts.landuse.texture.dispose();
  }
}

try {
  for(const mode of report.method.order) {
    globalThis.gc();
    const row=run(mode);report.cases.push(row);save();
    console.log('LANDSCAPE_CPU',JSON.stringify({mode,elapsedMs:row.elapsedMs,geometryHash:row.geometryHash}));
    const first=report.cases[0];
    for(const field of ['meshes','instances','triangles','geometryHash','stats','removedGrass'])assert.deepEqual(row[field],first[field],`Generated output differs: ${field}`);
  }
  const mean=mode=>{const values=report.cases.filter(row=>row.mode===mode);return values.reduce((sum,row)=>sum+row.elapsedMs,0)/values.length;};
  report.summary={beforeMeanMs:mean('before'),afterMeanMs:mean('after'),savedMs:mean('before')-mean('after'),geometryEqual:true};
  report.passed=true;console.log('LANDSCAPE_CPU_COMPARISON',JSON.stringify(report.summary));
} catch(error) {
  report.passed=false;report.failure=error.stack;process.exitCode=1;console.error(error.message);
} finally {
  globalThis.document=previousDocument;console.info=previousInfo;save();
}
