import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { compareMotionBaseline, installMotionProbe, summarizeMotion, waitForStableCampus } from './lib/webgpu-checks.mjs';

test('CPU probe includes lighting and reflections, and retains stalls across sample resets',()=>{
  let now=0;
  const app={lighting:{update(){now+=4;}},view:{frame(){now+=10;}},renderer:{info:{render:{drawCalls:7,triangles:30}}}};
  const context=vm.createContext({window:{__campus:app},performance:{now:()=>now}});
  vm.runInContext(`(${installMotionProbe.toString()})()`,context);
  const draw=()=>{app.lighting.update({}, {shot:3});now+=6;app.view.frame();};
  draw();now+=16;draw();
  const probe=context.window.__motionProbe;
  assert.equal(probe.samples[0].cpu,20);assert.equal(probe.samples[0].interval,36);assert.equal(probe.samples[0].shot,3);
  probe.reset();now+=100;draw();
  assert.equal(probe.samples.length,1);assert.equal(probe.samples[0].interval,120);assert.equal(probe.samples[0].cpu,20);
  assert.throws(()=>app.view.frame(),/lighting.update/);
});

test('summary keeps an isolated stall visible even when p95 remains smooth',()=>{
  const rows=Array.from({length:100},(_,i)=>({interval:i===99?200:16,cpu:3,drawCalls:10,triangles:100}));
  const result=summarizeMotion(rows);
  assert.equal(result.intervalMs.p95,16);assert.equal(result.intervalMs.max,200);
  assert.equal(result.frames,100);assert.throws(()=>summarizeMotion([]),/Missing/);
});

function report(p95=20) {
  return {schemaVersion:2,browser:'reference',capabilities:{adapter:{vendor:'apple',architecture:'metal-3',device:'',isFallbackAdapter:false}},
    cases:[{time:2,intervalMs:{p95},renderSize:{width:1920,height:1080},quality:'balanced',aa:'msaa',shadowMode:'cached',reflectionMode:'parallax-probes'}]};
}
test('relative gate uses max(2ms,10%) and rejects incomparable baseline settings',()=>{
  assert.equal(compareMotionBaseline(report(22),report(20))[0].passed,true);
  assert.equal(compareMotionBaseline(report(22.1),report(20))[0].passed,false);
  assert.equal(compareMotionBaseline(report(33),report(30))[0].allowanceMs,3);
  assert.equal(compareMotionBaseline(report(12),report(10))[0].allowanceMs,2);
  const low=report();low.cases[0].renderSize.width=1280;
  assert.throws(()=>compareMotionBaseline(low,report()),/renderSize differs/);
  const temporal=report();temporal.cases[0].aa='traa';
  assert.throws(()=>compareMotionBaseline(temporal,report()),/aa differs/);
  assert.throws(()=>compareMotionBaseline(report(),{...report(),schemaVersion:1}),/Re-run/);
  const portal=report();portal.cases[0].reflectionMode='portal';
  assert.throws(()=>compareMotionBaseline(portal,report()),/reflectionMode differs/);
  assert.equal(compareMotionBaseline(portal,report(),{reflectionUpgrade:true})[0].passed,true);
  portal.cases[0].aa='traa';
  assert.throws(()=>compareMotionBaseline(portal,report(),{reflectionUpgrade:true}),/aa differs/);
  assert.throws(()=>compareMotionBaseline(report(),report(),{reflectionUpgrade:true}),/portal reflection upgrade/);
});

test('snapshot waits for loading opacity, rendered frames, stable pose and GPU completion',async()=>{
  for(const aa of ['msaa','traa']) {
    let now=0,queueWaits=0,paused=false;
    const style={display:'grid',visibility:'hidden',opacity:'.5'};
    const app={pause(){paused=true;},view:{stats:{aa,frames:0}},scene:{environmentIntensity:.45},
      camera:{matrixWorld:{elements:[1,0,0,1]},projectionMatrix:{elements:[1,0,0,1]},fov:46},
      getState:()=>({errors:[]}),renderer:{toneMappingExposure:1,toneMapping:7,backend:{device:{queue:{async onSubmittedWorkDone(){
        assert.ok(app.view.stats.frames>=(aa==='traa'?32:3));queueWaits++;
      }}}}}};
    const context=vm.createContext({window:{__campus:app},document:{getElementById:()=>({})},getComputedStyle:()=>style,
      performance:{now:()=>now},requestAnimationFrame:callback=>{app.view.stats.frames++;now+=16;queueMicrotask(callback);}});
    const page={async waitForFunction(fn){
      assert.equal(vm.runInContext(`(${fn.toString()})()`,context),false);
      style.opacity='0';assert.equal(vm.runInContext(`(${fn.toString()})()`,context),true);
    },evaluate:fn=>vm.runInContext(`(${fn.toString()})(false)`,context)};
    const state=await waitForStableCampus(page);
    assert.equal(paused,true);assert.equal(queueWaits,1);assert.ok(state.snapshot.stableCameraFrames>=3);
    assert.equal(state.snapshot.minimumFrames,aa==='traa'?32:3);
  }
});
