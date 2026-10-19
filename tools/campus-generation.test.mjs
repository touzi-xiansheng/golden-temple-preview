import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createBarkMaterial, createBarkMaterialSteps } from '../src/campus/bark-material.js';
import { buildVegetation, buildVegetationSteps } from '../src/campus/vegetation.js';
import { buildMownTurf, buildMownTurfSteps } from '../src/campus/mown-turf.js';

function drain(steps) {
  const labels=[];
  for (;;) { const step=steps.next(); if(step.done)return {result:step.value,labels}; labels.push(step.value); }
}

function bytes(array) { return Buffer.from(array.buffer,array.byteOffset,array.byteLength); }
function barkHash(material) {
  const hash=createHash('sha256');
  for(const name of ['map','normalMap','roughnessMap'])hash.update(bytes(material[name].image.data));
  return hash.digest('hex');
}
function geometryHash(group) {
  const hash=createHash('sha256');
  for(const mesh of group.children) {
    hash.update(JSON.stringify([mesh.name,mesh.count??1,mesh.castShadow,mesh.receiveShadow]));
    for(const [name,attribute] of Object.entries(mesh.geometry.attributes).sort(([a],[b])=>a.localeCompare(b))) {
      hash.update(JSON.stringify([name,attribute.itemSize,attribute.normalized]));hash.update(bytes(attribute.array));
    }
    for(const attribute of [mesh.geometry.index,mesh.instanceMatrix,mesh.instanceColor])if(attribute)hash.update(bytes(attribute.array));
    const m=mesh.material;
    hash.update(JSON.stringify([m.type,m.name,m.color?.toArray(),m.roughness,m.side,m.alphaTest,m.customProgramCacheKey(),!!mesh.customDepthMaterial]));
  }
  hash.update(JSON.stringify(group.userData));
  return hash.digest('hex');
}
function dispose(...objects) {
  const resources=new Set();
  for(const object of objects) {
    if(object.isMaterial)resources.add(object);
    object.traverse?.(mesh=>{if(mesh.isMesh){resources.add(mesh);resources.add(mesh.geometry);resources.add(mesh.material);if(mesh.customDepthMaterial)resources.add(mesh.customDepthMaterial);}});
  }
  for(const resource of resources)if(resource.isMaterial)for(const value of Object.values(resource))if(value?.isTexture)resources.add(value);
  for(const resource of resources)resource.dispose?.();
}
function withCanvas(callback) {
  const previous=globalThis.document;
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'?(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}):()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try{return callback();}finally{globalThis.document=previous;}
}
function vegetationFixture() {
  const trees=[{x:51,z:52,height:9,radius:4,ground:-.025,hero:false}];
  const context=[{x:81,z:0,height:12,ground:-.025,near:true},{x:-81,z:80,height:15,ground:.2,near:false}];
  const shrubs=['shrub','clonalGroundcover','groundcover','flower','grass','shortGrass','woodland'].map((kind,i)=>({
    kind,x:47.95+i*2,z:-48.05,height:kind==='shrub'?.7:.2,radius:kind==='shrub'?.7:.455,
    ground:-.005,shapeSeed:`generation-${kind}`,detail:kind==='shrub',
    ...(kind==='groundcover'||kind==='flower'?{southBorderOrigin:[i+2,10]}:{}),
  }));
  return [trees,context,shrubs,[{x:340,z:-340,height:14,ground:.4,district:true}]];
}
const turfSurface=(x,z)=>x>5&&x<12&&z>60&&z<72?-.025:null;

// Golden digests were captured from the synchronous sources before adding checkpoints.
// The Canvas stub verifies geometry/RNG, not browser-rendered foliage texture pixels.
test('bark yields between image rows without changing the three deterministic texture buffers', () => {
  const stepped=drain(createBarkMaterialSteps()),sync=createBarkMaterial();
  try {
    assert.equal(stepped.labels.length,128);
    assert.ok(stepped.labels.every(label=>label==='正在生成树皮纹理…'));
    assert.equal(barkHash(stepped.result),barkHash(sync));
    assert.equal(barkHash(sync),'6a1aa26f4dc958aa1ad1c1701a98eabb07def064b7e4103daba171b5aa02cd2d');
  } finally {dispose(sync,stepped.result);}
});

test('vegetation steps preserve seeded geometry, attributes, batch order and translated plants', () => withCanvas(() => {
  const input=vegetationFixture(),before=structuredClone(input),sync=buildVegetation(...input);
  const stepped=drain(buildVegetationSteps(...input));
  try {
    assert.deepEqual(input,before);
    assert.equal(geometryHash(sync),geometryHash(stepped.result));
    assert.equal(geometryHash(sync),'6304ef1817aeffe64169b37ce3c3ddb5aa22de9fb7ce33124ad64c0e262f6088');
    assert.equal(stepped.labels.filter(x=>x==='正在生成庭院树木…').length,1);
    assert.equal(stepped.labels.filter(x=>x==='正在生成林地树木…').length,3);
    assert.equal(stepped.labels.filter(x=>x==='正在生成灌木与地被…').length,7);
    assert.ok(stepped.labels.filter(x=>x==='正在组装植物网格…').length>=sync.children.length);
  } finally {dispose(sync,stepped.result);}
}));

test('mown turf yields by row, preserves surface-dependent random consumption and propagates errors', () => {
  const sync=buildMownTurf(turfSurface,null),stepped=drain(buildMownTurfSteps(turfSurface,null));
  try {
    assert.ok(sync.userData.stats.mownTurfTufts>0);
    assert.equal(geometryHash(sync),geometryHash(stepped.result));
    assert.equal(geometryHash(sync),'2a011f0d4df41ee0ec814ed6d7bdceffedaa4cbdd1f3c02112833d63a3dc1e52');
    assert.ok(stepped.labels.filter(x=>x==='正在生成草坪细节…').length>100);
    assert.equal(stepped.labels.filter(x=>x==='正在组装草坪网格…').length,sync.children.length);
    const error=new Error('surface unavailable'),fail=()=>{throw error;};
    assert.throws(()=>buildMownTurf(fail,null),e=>e===error);
    assert.throws(()=>drain(buildMownTurfSteps(fail,null)),e=>e===error);
  } finally {dispose(sync,stepped.result);}
});
