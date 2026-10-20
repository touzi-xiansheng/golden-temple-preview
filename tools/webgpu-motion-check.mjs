// Continuous application playback: frame delivery/CPU submission, never pure GPU time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
import { compareMotionBaseline, installMotionProbe, summarizeMotion, waitForStableCampus } from './lib/webgpu-checks.mjs';

const base=process.env.WEBGPU_URL || 'http://localhost:5173/campus-webgpu.html';
const label=process.env.PROFILE_LABEL || 'current';
assert.match(label,/^[a-z0-9-]+$/);
const budget=Number(process.env.FRAME_BUDGET_MS || 25);
assert.ok(Number.isFinite(budget)&&budget>0,'FRAME_BUDGET_MS must be positive');
const baselinePath=process.env.BASELINE_REPORT;
const reflectionUpgrade=process.env.REFLECTION_UPGRADE==='1';
const baseline=baselinePath?JSON.parse(fs.readFileSync(baselinePath,'utf8')):null;
if(baseline)assert.equal(baseline.schemaVersion,2,'Re-run BASELINE_REPORT with this version of the motion tool');
const output=`out/webgpu/motion-${label}.json`;
fs.mkdirSync('out/webgpu',{recursive:true});
const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:['--enable-gpu','--no-proxy-server'],defaultViewport:{width:1920,height:1080,deviceScaleFactor:1},protocolTimeout:180000});
const report={schemaVersion:2,url:base,at:new Date().toISOString(),budgetMs:budget,
  method:{interval:'unclamped render-end to render-end wall time',cpu:'lighting.update entry through view.frame return; includes reflections',steadyGate:'p95 <= budget; optional paired baseline + max(2ms, 10%)',transitions:'reported separately; no steady-state FPS gate',gpuTime:false},
  cases:[],transitions:[],errors:[]};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try {
  const page=await browser.newPage();
  process.once('SIGTERM',()=>browser.close().finally(()=>process.exit(143)));
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))report.errors.push(message.text());});
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__READY||window.__ERROR,{timeout:180000});
  assert.equal(await page.evaluate(()=>window.__ERROR??null),null);
  const initial=await waitForStableCampus(page);
  report.browser=await browser.version();report.capabilities=initial.capabilities;
  report.startupTimings=initial.stats.timings;
  report.initialSnapshot=initial.snapshot;
  assert.equal(report.capabilities.backend,'webgpu');
  assert.notEqual(report.capabilities.adapter.isFallbackAdapter,true);
  await page.evaluate(installMotionProbe);

  async function collect() {
    const {samples,...state}=await page.evaluate(()=>{
      const app=window.__campus;app.pause();const state=app.getState();
      return {samples:window.__motionProbe.samples,renderSize:state.renderSize,quality:state.quality,aa:state.rendering.aa,
        shadowMode:state.lighting.shadowMode,reflectionMode:state.reflections?.mode??'disabled',
        shadowInvalidations:state.lighting.shadowCache?.invalidations??null,
        timeEnd:state.time,free:state.free,errors:state.errors};
    });
    const events=[];
    for(let i=1;i<samples.length;i++)if(samples[i].shot!==samples[i-1].shot)events.push({
      from:samples[i-1].shot,to:samples[i].shot,index:i,
      firstIntervalMs:samples[i].interval,firstCpuSubmitMs:samples[i].cpu,
      nearbyFrames:samples.slice(Math.max(0,i-2),i+3),
    });
    return {...summarizeMotion(samples),...state,firstFrame:samples[0],observedShots:[...new Set(samples.map(row=>row.shot))],events};
  }

  // Both entrances must be measured before steady windows can warm their materials.
  for(const [at,kind] of [[10,'first-entrance-cut'],[40,'first-reflection-cut']]) {
    await page.evaluate(time=>{window.__campus.pause();window.__campus.setTime(time);},at-.4);
    await waitForStableCampus(page);
    await page.evaluate(()=>{window.__motionProbe.reset();document.getElementById('play').click();});
    const afterShot=at/10;
    await page.waitForFunction(shot=>window.__motionProbe.samples.filter(row=>row.shot===shot).length>=18,{timeout:15000},afterShot);
    const sample={kind,at,...await collect()};
    report.transitions.push(sample);console.log('FIRST CUT',JSON.stringify(sample));
    assert.ok(sample.events.some(event=>event.from===afterShot-1&&event.to===afterShot),`First cut at ${at}s was not sampled on both sides`);
  }

  for(const time of [2,12,22,32,42,52]) {
    await page.evaluate(time=>{const app=window.__campus;app.pause();app.setTime(time);document.getElementById('play').click();},time);
    await delay(1200);
    await page.evaluate(()=>window.__motionProbe.reset());
    await delay(2000);
    const sample={time,...await collect()};
    report.cases.push(sample);console.log('MOTION',JSON.stringify(sample));
  }

  // Seek and settle BEFORE recording; cross the boundary using the application's own clock.
  for(const at of [10,40]) {
    await page.evaluate(time=>{const app=window.__campus;app.pause();app.setTime(time);},at-.4);
    await waitForStableCampus(page);
    await page.evaluate(()=>{window.__motionProbe.reset();document.getElementById('play').click();});
    const afterShot=at/10;
    await page.waitForFunction(shot=>window.__motionProbe.samples.filter(row=>row.shot===shot).length>=18,{timeout:15000},afterShot);
    const sample={kind:'natural-cut',at,...await collect()};
    report.transitions.push(sample);console.log('TRANSITION',JSON.stringify(sample));
    assert.ok(sample.events.some(event=>event.from===afterShot-1&&event.to===afterShot),`Natural cut at ${at}s was not sampled on both sides`);
  }

  await page.evaluate(()=>{window.__campus.pause();window.__campus.setTime(35);});
  await waitForStableCampus(page);
  for(const enabled of [true,false]) {
    const switchJsMs=await page.evaluate(enabled=>{
      window.__motionProbe.reset();const before=performance.now();window.__campus.setFree(enabled);
      return performance.now()-before;
    },enabled);
    // A paused camera switch needs one visible frame; continuous sampling would
    // incorrectly require a stationary scene to waste GPU work.
    await page.waitForFunction(()=>window.__motionProbe.samples.length>=1,{timeout:15000});
    const sample={kind:enabled?'enter-free-camera':'return-to-tour',switchJsMs,...await collect()};
    report.transitions.push(sample);console.log('TRANSITION',JSON.stringify(sample));
    assert.equal(sample.free,enabled);assert.ok(sample.observedShots.includes(enabled?-1:3));
    await waitForStableCampus(page);
  }

  if(baseline) {
    report.baselineReport=baselinePath;
    report.reflectionUpgrade=reflectionUpgrade ? {from:'parallax-probes',to:'portal'} : null;
    report.relativeComparisons=compareMotionBaseline(report,baseline,{reflectionUpgrade});
  }
  assert.deepEqual(report.errors,[]);
  for(const sample of [...report.cases,...report.transitions])assert.deepEqual(sample.errors,[]);
  for(const sample of report.cases) {
    assert.ok(sample.frames>=40,`t=${sample.time}: insufficient frames: ${sample.frames}`);
    assert.deepEqual(sample.observedShots,[Math.floor(sample.time/10)],`Steady window crossed a shot at t=${sample.time}`);
    assert.ok(sample.intervalMs.p95<=budget,`t=${sample.time}: movement p95 ${sample.intervalMs.p95.toFixed(1)}ms exceeds ${budget}ms`);
  }
  for(const comparison of report.relativeComparisons||[])assert.ok(comparison.passed,
    `t=${comparison.time}: p95 ${comparison.actualMs.toFixed(1)}ms exceeds baseline allowance ${comparison.limitMs.toFixed(1)}ms`);
  report.passed=true;console.log('PASS',output);
} catch(error) {
  report.passed=false;report.failure=error.stack||error.message;throw error;
} finally {
  fs.writeFileSync(output,JSON.stringify(report,null,2));
  await browser.close();
}
