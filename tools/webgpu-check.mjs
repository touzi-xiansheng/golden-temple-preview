import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome } from './lib/chrome.mjs';
import { waitForStableCampus } from './lib/webgpu-checks.mjs';

const laboratory = process.argv.includes('--lab');
const base = process.env.WEBGPU_URL || `http://localhost:5173/${laboratory ? 'webgpu-lab' : 'campus-webgpu'}.html`;
const output = 'out/webgpu';
fs.mkdirSync(output, { recursive: true });
const browser = await puppeteer.launch({ executablePath: findChrome(), headless:true, args:['--enable-gpu','--no-proxy-server'], defaultViewport:{width:1920,height:1080,deviceScaleFactor:1}, protocolTimeout:180000 });
const errors = [], warnings = [], external = [];
try {
  const page = await browser.newPage();
  process.once('SIGTERM',()=>browser.close().finally(()=>process.exit(143)));
  page.on('console', message => {
    if (message.type()==='error' && !message.text().includes('404')) {
      errors.push(message.text());
      if(errors.length===1)void page.evaluate(message=>{window.__ERROR=message;},message.text()).catch(()=>{});
    }
    if (message.type()==='warn') warnings.push(message.text());
    if (/webgpu|TSL|shader|Error/i.test(message.text())) console.log(message.type(), message.text().slice(0,2000));
  });
  page.on('pageerror', error=>{errors.push(error.stack || error.message);console.log('PAGEERROR',error.stack||error.message);void page.evaluate(message=>{window.__ERROR=message;},error.message).catch(()=>{});});
  page.on('request', request=>{ const url=request.url(); if(/^https?:/.test(url)&&new URL(url).origin!==new URL(base).origin)external.push(url); });
  const url=new URL(base); url.searchParams.set('paused','1');
  await page.goto(url.href, {waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForFunction(()=>window.__READY||window.__ERROR,{timeout:180000});
  assert.equal(await page.evaluate(()=>window.__ERROR ?? null),null);
  let state=await waitForStableCampus(page,laboratory);
  assert.equal(state.capabilities.backend,'webgpu');
  assert.notEqual(state.capabilities.adapter.isFallbackAdapter,true);
  const validations = {};
  for (const [flag, path, exported] of [
    ['--visibility', '/src/campus-webgpu/visibility.js', 'runValidation'],
    ['--lighting', '/src/campus-webgpu/lighting-calibration.js', 'runLightingCalibration'],
    ['--materials', '/src/campus-webgpu/material-calibration.js', 'runMaterialCalibration'],
  ]) {
    if (!process.argv.includes(flag)) continue;
    validations[flag.slice(2)] = await page.evaluate(async ({path,exported}) => {
      const module = await import(path);
      return module[exported]((window.__lab || window.__campus).renderer);
    }, {path,exported});
    console.log('VALIDATION',flag,JSON.stringify(validations[flag.slice(2)]));
    assert.equal(validations[flag.slice(2)].passed ?? validations[flag.slice(2)].ok, true, `${flag} calibration failed`);
  }
  state=await waitForStableCampus(page,laboratory);
  const shots=[],qualityChecks=[];
  let freeCamera=null;
  await page.screenshot({path:`${output}/${laboratory?'lab':'campus'}-initial.png`});
  if(!laboratory) {
    assert.equal(state.stats.buildings,7);
    for(const time of [5,15,25,35,45,55]) {
      await page.evaluate(time=>window.__campus.setTime(time),time);
      const shot=await waitForStableCampus(page),image=`${output}/shot-${Math.floor(time/10)+1}.png`;
      assert.equal(shot.time,time);assert.equal(shot.playing,false);assert.deepEqual(shot.errors,[]);
      await page.screenshot({path:image});
      shots.push({image,requestedTime:time,state:shot});
    }
    for(const quality of ['performance','quality','balanced']) {
      await page.evaluate(quality=>window.__campus.setQuality(quality),quality);
      const state=await waitForStableCampus(page);
      assert.equal(state.quality,quality);assert.deepEqual(state.errors,[]);
      qualityChecks.push(state);
    }
    await page.evaluate(()=>{const app=window.__campus;app.setFree(true);app.camera.position.set(60,30,80);});
    freeCamera=await waitForStableCampus(page);
    assert.equal(freeCamera.free,true);assert.deepEqual(freeCamera.errors,[]);
    await page.evaluate(()=>{window.__campus.setFree(false);window.__campus.setTime(55);});
  }
  const finalState=await waitForStableCampus(page,laboratory);
  state.errors=finalState.errors;
  fs.writeFileSync(`${output}/${laboratory?'lab':'check'}.json`,JSON.stringify({schemaVersion:2,url:url.href,at:new Date().toISOString(),browser:await browser.version(),state,shots,qualityChecks,freeCamera,finalState,validations,errors,warnings,external},null,2));
  assert.deepEqual(errors,[]); assert.deepEqual(state.errors,[]); assert.deepEqual(external,[]);
  console.log(JSON.stringify({success:true,backend:state.capabilities,stats:state.stats,warnings},null,2));
} finally { await browser.close(); }
