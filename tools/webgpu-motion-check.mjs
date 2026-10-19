// Continuous playback on the reference device. Unlike snapshot checks, this
// catches expensive work repeated on every camera move; it does not measure GPU time.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';

const base=process.env.WEBGPU_URL || 'http://localhost:5173/campus-webgpu.html';
const label=process.env.PROFILE_LABEL || 'current';
assert.match(label,/^[a-z0-9-]+$/);
const budget=Number(process.env.FRAME_BUDGET_MS || 25);
const browser=await puppeteer.launch({executablePath:findChrome(),headless:true,args:['--enable-gpu','--no-proxy-server'],defaultViewport:{width:1920,height:1080,deviceScaleFactor:1},protocolTimeout:180000});
const report={url:base,at:new Date().toISOString(),budgetMs:budget,cases:[],errors:[]};
try {
  const page=await browser.newPage();
  page.on('pageerror',error=>report.errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error'&&!message.text().includes('404'))report.errors.push(message.text());});
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__READY||window.__ERROR,{timeout:180000});
  assert.equal(await page.evaluate(()=>window.__ERROR??null),null);
  report.browser=await browser.version();
  report.capabilities=await page.evaluate(()=>window.__campus.getState().capabilities);
  assert.equal(report.capabilities.backend,'webgpu');
  await page.evaluate(()=>{
    const app=window.__campus;app.pause();window.__motionSamples=[];
    const viewFrame=app.view.frame.bind(app.view),reflect=app.reflections?.update.bind(app.reflections);
    let reflectionMs=0,previous=null;
    if(reflect)app.reflections.update=(...args)=>{const before=performance.now();reflect(...args);reflectionMs=performance.now()-before;};
    app.view.frame=()=>{
      const before=performance.now();viewFrame();const end=performance.now();
      if(previous!==null)window.__motionSamples.push({interval:end-previous,cpu:end-before+reflectionMs,drawCalls:app.renderer.info.render.drawCalls,triangles:app.renderer.info.render.triangles});
      previous=end;reflectionMs=0;
    };
  });
  for(const time of [2,12,22,32,42,52]) {
    await page.evaluate(time=>{const app=window.__campus;app.pause();app.setTime(time);document.getElementById('play').click();},time);
    await new Promise(resolve=>setTimeout(resolve,1200));
    await page.evaluate(()=>{window.__motionSamples=[];});
    await new Promise(resolve=>setTimeout(resolve,2000));
    const sample=await page.evaluate(()=>{
      const app=window.__campus;app.pause();const data=window.__motionSamples,state=app.getState();
      const stats=key=>{const v=data.map(row=>row[key]).sort((a,b)=>a-b);return {p50:v[Math.floor(v.length*.5)],p95:v[Math.floor(v.length*.95)]};};
      return {frames:data.length,intervalMs:stats('interval'),cpuSubmitMs:stats('cpu'),drawCalls:stats('drawCalls'),triangles:stats('triangles'),renderSize:state.renderSize,quality:state.quality,shadowMode:state.lighting.shadowMode,reflectionMode:state.reflections?.mode,errors:state.errors};
    });
    report.cases.push({time,...sample});console.log('MOTION',JSON.stringify(report.cases.at(-1)));
  }
  const output=`out/webgpu/motion-${label}.json`;fs.mkdirSync('out/webgpu',{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2));
  assert.deepEqual(report.errors,[]);
  for(const sample of report.cases) {
    assert.deepEqual(sample.errors,[]);
    assert.ok(sample.frames>=40,`t=${sample.time}: insufficient frames: ${sample.frames}`);
    assert.ok(sample.intervalMs.p95<=budget,`t=${sample.time}: movement p95 ${sample.intervalMs.p95.toFixed(1)}ms exceeds ${budget}ms`);
  }
  console.log('PASS',output);
} finally {await browser.close();}
