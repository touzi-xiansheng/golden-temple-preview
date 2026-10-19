import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { finishBuild } from '../src/campus/loading.js';

const source=readFileSync(new URL('../src/campus/landscape.js',import.meta.url),'utf8');
function between(start,end) {
  const a=source.indexOf(start),b=source.indexOf(end,a);
  assert.ok(a>=0&&b>a,`missing landscape transaction seam: ${start}`);
  return source.slice(a,b);
}
// Exercise the production transaction, without rebuilding terrain or duplicating the planting planner.
const stage=between('    let southeastStage=null;','    const stagedBuilder=southeastStage');
const commit=between('    if(southeastStage){','    southBorder={outline:difference.soil');
const oldTargets=[
  {x:8.639229387049564,z:39.94239871850703,height:.7742429826525039,radius:.747939836315345,kind:'shrub',ground:-.005,detail:true},
  {x:9.771877899565736,z:40.15790835819673,height:.8138215403887443,radius:.7078952862299047,kind:'shrub',ground:-.005,detail:true},
];
function fixture(failure=null) {
  const targets=structuredClone(oldTargets),keep=[{kind:'shrub',x:2,z:3,shapeSeed:'retained'},{kind:'flower',x:4,z:5}];
  if(failure==='target-changed')targets[0].height+=.001;
  if(failure==='target-duplicated')targets.push({...targets[0]});
  const shrubs=[keep[0],targets[0],keep[1],...targets.slice(1)],before=structuredClone(shrubs),refs=[...shrubs],events=[];
  const additions=Array.from({length:50},(_,i)=>({kind:i<6?'matureShrub':'shrub',x:8+i*.03,z:33+i*.1,height:.4+i*.01,radius:.3,shapeSeed:`fixture:${i}`}));
  const outline=[{x:0,z:0},{x:1,z:0},{x:0,z:1}],region={points:outline};
  const args={shrubs,southeastDeferred:[{role:'southeast-bed',region}],turfSurfaces:[region],difference:{lawns:[outline],soil:outline},
    southeastBoundary:()=>outline,SOUTHEAST_EXTENSION:[],southBorderContour:()=>({inside:true}),trees:[],freePlant:()=>true,
    planSoutheastSample:(_outline,all)=>{events.push('plan');assert.deepEqual(all,before);return {plants:structuredClone(additions)};},
    markDetailedShrubs:plants=>{events.push('mark');for(const p of plants)p.detail=true;},
    stageMatureBorder:plants=>{
      events.push('stage');assert.equal(plants.length,6);assert.ok(plants.every(p=>p.detail));assert.deepEqual(shrubs,before);
      if(failure==='stage')throw Error('injected stage failure');
      return plants.map(p=>({shapeSeed:p.shapeSeed}));
    },
    Builder:class{},lawn:{},mulch:{},emitPolygon:()=>{if(failure==='surface')throw Error('injected surface failure');},console:{warn(){}}};
  const steps=new Function(...Object.keys(args),`return (function*(){let southeastSample=null;\n${stage}\n${commit}\nreturn {southeastStage,southeastSample};})();`)(...Object.values(args));
  assert.equal(steps.next().done,false);
  assert.deepEqual(shrubs,before,'yielding during planning must not partially commit the new planting');
  const result=finishBuild(steps);
  assert.deepEqual(events,['plan','mark','stage'],'all old plants must remain available until the new cohort stages');
  return {shrubs,before,refs,keep,additions,result,region,surfaces:args.turfSurfaces};
}

test('southeast renewal stages all new plants before replacing only the two exact old shrubs',()=>{
  const f=fixture();
  assert.ok(f.result.southeastStage);assert.equal(f.shrubs.length,52);
  f.keep.forEach((p,i)=>assert.strictEqual(f.shrubs[i],p,'retained plants changed order or identity'));
  assert.deepEqual(f.shrubs.slice(0,2),[f.before[0],f.before[2]],'retained plant fields changed');
  const added=f.shrubs.slice(2);
  assert.deepEqual(added.map(({maturePlan,...p})=>p),f.additions.map(p=>({...p,detail:true})),
    'replacement must not relocate, reshape, reseed or drop a new plant');
  for(const p of added.slice(0,6))assert.equal(p.maturePlan.shapeSeed,p.shapeSeed);
  assert.ok(added.slice(6).every(p=>!p.maturePlan));
  assert.equal(f.result.southeastSample.replaced2.length,2);
  for(const target of oldTargets)assert.ok(!f.shrubs.some(p=>p.x===target.x&&p.z===target.z));
  assert.ok(!f.surfaces.includes(f.region),'old southeast surface was not replaced');
});

test('failed southeast staging, surface emission or changed replacement records retain the complete old planting',()=>{
  for(const failure of ['stage','surface','target-changed','target-duplicated']) {
    const f=fixture(failure);
    assert.equal(f.result.southeastStage,null,failure);assert.equal(f.result.southeastSample,null,failure);
    assert.deepEqual(f.shrubs,f.before,`${failure} mutated the old planting`);
    f.refs.forEach((p,i)=>assert.strictEqual(f.shrubs[i],p));
    assert.deepEqual(f.surfaces,[f.region],`${failure} removed the old southeast surface`);
  }
});
