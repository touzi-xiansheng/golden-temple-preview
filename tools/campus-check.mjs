import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { findChrome } from './lib/chrome.mjs';

const base = process.env.CAMPUS_URL || 'http://localhost:5173/campus.html';
const directory = 'out/campus';
fs.mkdirSync(directory, { recursive: true });
const errors = [], external = [], failedRequests = [];
const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: true,
  args: ['--enable-gpu', '--no-proxy-server'],
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 },
  protocolTimeout: 30000,
});
try {
  const page = await browser.newPage();
  page.on('console', message => {
    if (message.type() === 'error' && !message.text().includes('404')) errors.push(message.text());
    if (/\[campus\]|shader|THREE/.test(message.text())) console.log(message.type(), message.text().slice(0, 3000));
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => failedRequests.push(`${request.url()}: ${request.failure()?.errorText}`));
  page.on('request', request => { const url = request.url(); if (/^https?:/.test(url) && new URL(url).origin !== new URL(base).origin) external.push(url); });
  const url = new URL(base); url.searchParams.set('paused', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__READY || window.__ERROR, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__ERROR), null);
  const waitFrames = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await waitFrames();
  const visible = await page.evaluate(() => {
    window.__campus.renderOnce();
    const sample = document.createElement('canvas'); sample.width = sample.height = 32;
    const context = sample.getContext('2d'); context.drawImage(document.getElementById('scene'), 0, 0, 32, 32);
    const data = context.getImageData(0, 0, 32, 32).data; let lit = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] + data[i+1] + data[i+2] > 40) lit++;
    return lit;
  });
  assert.ok(visible > 200, `blank frame: ${visible}/1024 visible pixels`);
  const baseline = await page.evaluate(() => window.__campus.getState());
  assert.equal(baseline.indirect.shrubProxies,6);
  assert.equal(baseline.stats.landscape.matureShrubs,6);
  assert.equal(baseline.stats.landscape.shrubs,638);
  const stemIntegration = await page.evaluate(() => {
    const {scene,renderer}=window.__campus,old=[],mature=[];
    scene.traverse(o=>{if(o.name.startsWith('mature-shrub-branches:'))mature.push(o);else if(o.name.startsWith('shrub-branches:'))old.push(o);});
    const material=mature[0]?.material,uniforms=material&&renderer.properties.get(material).uniforms;
    const radius=(mesh,y)=>{const p=mesh.geometry.attributes.position,values=[];for(let i=0;i<p.count;i++)if(Math.abs(p.getY(i)-y)<1e-7)values.push(Math.hypot(p.getX(i),p.getZ(i)));return values;};
    return {batches:mature.length,instances:mature.reduce((sum,m)=>sum+m.count,0),sharedMaterial:old.length>0&&mature.every(m=>m.material===old[0].material),
      sunlight:!!uniforms?.uCampusSunRadius,indirect:!!uniforms?.uCampusGIEnabled,
      shadows:mature.length>0&&mature.every(m=>m.castShadow&&m.receiveShadow),
      actualTaper:mature.length>0&&mature.every(m=>{const top=radius(m,.5),bottom=radius(m,-.5);return top.length>=4&&bottom.length>=4&&top.every(r=>Math.abs(r-.9)<1e-6)&&bottom.every(r=>Math.abs(r-1)<1e-6);})};
  });
  assert.ok(stemIntegration.batches>0);
  assert.equal(stemIntegration.instances,9576);
  for(const field of ['sharedMaterial','sunlight','indirect','shadows','actualTaper'])assert.equal(stemIntegration[field],true,field);
  assert.equal(baseline.indirect.probes,907);
  assert.equal(baseline.indirect.courtyardProbes,315);
  assert.equal(baseline.indirect.arcadeProbes,432);
  assert.equal(baseline.indirect.cafeProbes,160);
  assert.equal(await page.evaluate(()=>{
    const {scene,renderer}=window.__campus,atlases=new Set();
    scene.traverse(o=>{
      if(o.material?.isMeshStandardMaterial){const uniforms=renderer.properties.get(o.material).uniforms;
        if(uniforms?.uCampusArcadeAtlas2)atlases.add(uniforms.uCampusArcadeAtlas2.value);}
    });
    return atlases.size===1&&[...atlases].every(t=>t.isData3DTexture&&t.image.width===4&&t.image.height===4&&t.image.depth===84);
  }),true,'compiled surfaces must bind the baked4x4x10 cafe SH atlas');
  assert.equal(baseline.indirect.arcadeEnabled,true);
  assert.equal(baseline.stats.landscape.clonalGroundcoverPlants,750);
  assert.equal(await page.evaluate(()=>{
    const {scene,renderer}=window.__campus,petioles=[],stems=[];
    scene.traverse(o=>{if(o.name.startsWith('clonal-petioles:'))petioles.push(o);if(o.name.startsWith('perennial-stems:'))stems.push(o);});
    const material=stems[0]?.material,uniforms=material&&renderer.properties.get(material).uniforms;
    return petioles.length>0&&petioles.every(o=>o.material===material&&o.castShadow&&o.receiveShadow)&&
      !!uniforms?.uCampusSunRadius&&!!uniforms?.uCampusGIEnabled;
  }),true,'new groundcover petioles must share the lit stem material and retain sun shadows and GI');
  assert.equal(baseline.stats.landscape.primaryRootSleeves,4);
  assert.equal(baseline.stats.landscape.primaryRootSleeveTriangles,72);
  assert.equal(baseline.stats.landscape.primaryRootSleeveFailures,0);
  assert.equal(await page.evaluate(()=>{
    const {scene}=window.__campus,whole=scene.getObjectByName('campus-vegetation').userData.wholeTrees;
    const landscape=scene.getObjectByName('campus-landscape'),trees=landscape?.userData.treePositions;
    if(!trees||whole.map(tree=>tree.tree).join(',')!=='0,1,2,3,6,7,8')return false;
    const retained=whole.find(tree=>tree.tree===6),selected=[0,1,2,3,7,8];
    if(retained.leaves!==13814||retained.cards!==0||retained.stages.seasonalAxis!==73||retained.crownEnvelope||trees[6].crownEnvelope)return false;
    return whole.every(tree=>tree.physicalRadii===true&&tree.cards===0&&tree.leaves>0)&&
      trees.filter(tree=>tree.crownEnvelope).length===6&&selected.every(index=>{
        const envelope=trees[index].crownEnvelope,record=whole.find(tree=>tree.tree===index);
        return envelope&&envelope.center.every(Number.isFinite)&&envelope.radii.every(v=>Number.isFinite(v)&&v>0)&&
          JSON.stringify(envelope)===JSON.stringify(record.crownEnvelope);
      });
  }),true,'seven calibrated trees must use connected growth; only the six additions update their GI envelope');
  assert.deepEqual(baseline.stats.landscape.treeForms,{broadleaf:26,vase:19,upright:19});
  assert.equal(await page.evaluate(()=>{
    const {scene,renderer}=window.__campus,group=scene.getObjectByName('Gallery limestone cladding');
    if(group?.userData.panels!==228||group.children.length!==1)return false;
    const material=group.children[0].material,uniforms=renderer.properties.get(material).uniforms;
    return material.vertexColors&&!!uniforms.uMaterialGrain&&!!uniforms.uCampusSunRadius&&!!uniforms.uCampusGIEnabled;
  }),true,'gallery panels must retain mineral detail, shadows and indirect lighting after shader composition');
  assert.equal(await page.evaluate(()=>{
    const {scene,stats}=window.__campus,materials=new Set();let leaves=0;
    scene.traverse(o=>{
      if(!o.name.startsWith('shrub-foliage'))return;
      materials.add(o.material);
      if(o.name.startsWith('shrub-foliage-detailed:')){if(o.geometry.index.count!==36)return;leaves+=o.count;}
    });
    return materials.size===1&&leaves===stats.landscape.detailedShrubLeaves&&leaves>0&&
      stats.landscape.extraShrubTriangles===leaves*8&&stats.landscape.extraShrubTriangles<300000;
  }),true,'near shrub leaves must retain one shared material and a bounded geometry budget');
  assert.equal(await page.evaluate(()=>{
    const {scene,renderer,stats}=window.__campus,group=scene.getObjectByName('mown-turf');
    const materials=new Set(group.children.map(mesh=>mesh.material));
    const material=group.children[0].material,uniforms=renderer.properties.get(material).uniforms;
    const lawn=scene.getObjectByName('continuous-meadow-and-low-rolling-ground').material;
    return materials.size===1&&group.children.every(mesh=>mesh.receiveShadow&&!mesh.castShadow)&&
      stats.landscape.mownTurfBlades>100000&&stats.landscape.mownTurfTriangles<1200000&&
      stats.landscape.mownTurfBatches<=20&&uniforms.uMownTurfMap.value===lawn.userData.turfMap&&
      !!uniforms.uCampusGIEnabled&&!!uniforms.uCampusSunRadius;
  }),true,'mown grass must share the procedural turf colour and receive scene lighting within its geometry budget');
  assert.equal(await page.evaluate(()=>{
    const {scene,renderer}=window.__campus,gl=renderer.getContext(),materials=new Set();
    scene.traverse(o=>{if(o.material?.userData.campusGlass)materials.add(o.material);});
    return materials.size>0&&[...materials].every(m=>{
      const program=renderer.properties.get(m).currentProgram;
      return program&&gl.getShaderSource(program.fragmentShader).includes('blindIncident = max(irradiance + iblIrradiance');
    });
  }),true,'visible glazing must compile the daylight-responsive blind shader');
  const contextShadow = await page.evaluate(() => {
    const { scene,renderer } = window.__campus;
    const ground = scene.getObjectByName('continuous-meadow-and-low-rolling-ground');
    const uniforms = renderer.properties.get(ground.material).uniforms;
    const texture = uniforms.uDistrictVisibility.value;
    const data = texture.image.data;
    return { regions: uniforms.uDistrictBounds.value.length, size:texture.image.width,
      linear:texture.colorSpace === '', shadow:data.some(v=>v<128), lit:data.some(v=>v===255) };
  });
  assert.deepEqual(contextShadow,{regions:3,size:1024,linear:true,shadow:true,lit:true},'compiled terrain must sample the populated linear district shadow atlas');
  assert.equal(await page.evaluate(() => {
    const {scene}=window.__campus,landscape=scene.getObjectByName('campus-landscape');
    let triangles=0,batches=0,valid=true;
    scene.traverse(o=>{
      if(!o.isMesh||!/^district-(canopy|stems):/.test(o.name))return;
      batches++;triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3*o.count;
      valid&&=!o.castShadow&&!o.receiveShadow;
    });
    const district=landscape.userData.contextDistricts,trees=district.trees;
    const ground=scene.getObjectByName('continuous-meadow-and-low-rolling-ground');
    const uniforms=window.__campus.renderer.properties.get(ground.material).uniforms;
    return valid&&trees.length>=100&&trees.length<=220&&batches>0&&batches<=32&&triangles>0&&triangles<150000&&
      uniforms.uCampusDistrictLanduse.value===district.landuse.texture&&district.landuse.texture.colorSpace===''&&
      landscape.userData.contextTreePositions.every(t=>!t.district);
  }),true,'neighbourhood foliage must stay within its own budget and outside the campus shadow volume');
  assert.equal(await page.evaluate(() => {
    const { scene, renderer } = window.__campus; const materials = new Set(),gl=renderer.getContext();
    scene.traverse(o => { for (const m of (Array.isArray(o.material) ? o.material : [o.material]))
      if (m?.userData.leafSkyTransmission) materials.add(m); });
    return materials.size > 0 && [...materials].every(m =>
      m.userData.leafSkyTransmission.value === .25 &&
      renderer.properties.get(m).uniforms?.uCampusLeafSkyTransmission === m.userData.leafSkyTransmission &&
      gl.getShaderSource(renderer.properties.get(m).currentProgram.fragmentShader).includes('visibility += campusShadowTapVisibility('));
  }), true, 'compiled real-leaf materials must retain diffuse transmission and comparison filtering');
  assert.equal(await page.evaluate(() => {
    const { scene, renderer } = window.__campus, gl = renderer.getContext();
    return ['Honed mineral facade','Flamed warm grey arcade stone'].every(name => {
      let material;
      scene.traverse(o => { if(o.material?.name === name) material = o.material; });
      const program = material && renderer.properties.get(material).currentProgram;
      return !!program && gl.getShaderSource(program.fragmentShader).includes('visibility += campusShadowTapVisibility(');
    });
  }), true, 'compiled opaque wall and paving receivers must use comparison filtering too');
  assert.equal(await page.evaluate(() => {
    const { scene, camera, lighting } = window.__campus, p = camera.position.clone();
    let valid = true, batches = 0;
    scene.traverse(o => {
      if (!o.name.startsWith('woodland-canopy:')) return;
      o.computeBoundingBox(); const box = o.boundingBox; batches++;
      for (const x of [box.min.x,box.max.x]) for (const y of [box.min.y,box.max.y]) for (const z of [box.min.z,box.max.z]) {
        p.set(x,y,z).applyMatrix4(o.matrixWorld).applyMatrix4(lighting.sun.shadow.matrix);
        valid &&= p.toArray().every(v => v >= 0 && v <= 1);
      }
    });
    return valid && batches > 0;
  }), true, 'overview shadow volume must cover the actual outer foliage batches');
  assert.equal(await page.evaluate(() => {
    const { scene, renderer } = window.__campus; const maps = new Set(); let valid = true;
    scene.traverse(o => {
      const m = o.material;
      if (!m?.userData.campusGlass) return;
      maps.add(m.envMap?.uuid);
      valid &&= !!m.envMap && m.envMap !== scene.environment && m.envMapIntensity === 1 &&
        renderer.properties.get(m).uniforms.envMapIntensity.value === 1 && m.userData.campusGlass.uniforms.uCampusProbeEnabled.value === 1;
    });
    const upper=scene.getObjectByName('Solar control glass / c-upper-east');
    const west=scene.getObjectByName('Solar control glass / west');
    const hook=upper?.material.userData.campusGlass;
    return maps.size === 4 && valid && upper.count === 144 && !hook.planarUniforms &&
      upper.material.envMap !== west.material.envMap &&
      hook.uniforms.uCampusProbePosition.value.distanceTo({x:-21.8,y:9.16,z:29})<1e-8;
  }), true, 'glazing must retain four independently captured local reflections without amplifying their radiance');
  assert.equal(await page.evaluate(() => {
    const c=window.__campus,originalTime=c.getState().time;
    c.setTime(43);c.renderOnce();
    let material;c.scene.traverse(o=>{if(o.material?.userData.campusGlass?.planarUniforms)material=o.material;});
    const controls=material.userData.campusGlass.planarUniforms,compiled=c.renderer.properties.get(material).uniforms;
    const map=controls.uCampusPlanarMap.value,updates=c.planarReflections.stats.updates;
    const target=c.renderer.properties.get(map).__renderTarget;
    const gl=c.renderer.getContext(),supported=gl.getInternalformatParameter(gl.RENDERBUFFER,gl.RGBA16F,gl.SAMPLES);
    const samples=Math.max(0,...Array.from(supported).filter(count=>count<=4));
    const size=c.getState().renderSize,factor=Math.min(1,2048/Math.max(size.width,size.height));
    let valid=c.planarReflections.stats.activeSurface==='a'&&controls.uCampusPlanarEnabled.value===1&&
      compiled.uCampusPlanarEnabled===controls.uCampusPlanarEnabled&&map.isRenderTargetTexture&&map.generateMipmaps&&map.colorSpace==='srgb-linear'&&
      target.samples===samples&&target.width===Math.round(size.width*factor)&&target.height===Math.round(size.height*factor);
    c.renderOnce();valid&&=c.planarReflections.stats.updates===updates;
    c.setTime(43.1);c.renderOnce();valid&&=c.planarReflections.stats.updates===updates+1;
    c.setQuality('performance');const before=c.planarReflections.stats.updates;c.renderOnce();
    valid&&=controls.uCampusPlanarEnabled.value===0&&c.planarReflections.stats.updates===before;
    c.setQuality('balanced');c.renderOnce();valid&&=controls.uCampusPlanarEnabled.value===1&&c.planarReflections.stats.error===null;
    c.setTime(originalTime);c.renderOnce();return valid;
  }), true, 'near glazing must update a linear planar reflection, reuse still frames, and respect quality switching');
  const mulch = await page.evaluate(() => {
    const { scene, renderer } = window.__campus; let material;
    scene.traverse(o => { if (o.material?.name === 'campus-soil') material = o.material; });
    const uniforms = renderer.properties.get(material).uniforms;
    const map = uniforms.uCampusMulch.value, bump = uniforms.uCampusMulchHeight.value;
    const pixels = texture => texture.image.getContext('2d').getImageData(0,0,texture.image.width,texture.image.height).data;
    const color = pixels(map), height = pixels(bump); let opaque = true, grey = true, low = 255, high = 0;
    for (let i=0; i<height.length; i+=4) {
      opaque &&= color[i+3] === 255 && height[i+3] === 255;
      grey &&= height[i] === height[i+1] && height[i] === height[i+2];
      low = Math.min(low,height[i]); high = Math.max(high,height[i]);
    }
    return { opaque, grey, range: high-low, correctColorSpace: map.colorSpace === 'srgb' && bump.colorSpace === '' };
  });
  assert.ok(mulch.opaque && mulch.grey && mulch.correctColorSpace && mulch.range > 50, 'mulch must have opaque colour and independent non-flat linear relief');
  console.log('BASELINE', JSON.stringify(baseline.stats));
  const modes = [];
  for (const mode of ['performance', 'balanced', 'quality']) {
    await page.click(`[data-quality="${mode}"]`);
    await waitFrames();
    const state = await page.evaluate(() => window.__campus.getState());
    assert.equal(state.quality, mode); assert.equal(state.time, baseline.time);
    assert.ok(state.indirect?.ready, 'courtyard indirect light must finish baking');
    assert.equal(state.indirect.enabled, mode !== 'performance', 'quality switch must also switch indirect light');
    assert.equal(state.indirect.arcadeEnabled, mode !== 'performance', 'quality switch must also switch arcade indirect light');
    assert.deepEqual(state.camera, baseline.camera); assert.equal(state.stats.triangles, baseline.stats.triangles);
    assert.equal(await page.$eval(`[data-quality="${mode}"]`, el => el.getAttribute('aria-pressed')), 'true');
    assert.equal(await page.evaluate(() => {
      const {scene,renderer}=window.__campus,group=scene.getObjectByName('context-districts'),gl=renderer.getContext();
      const meshes=group.children.filter(o=>o.name.startsWith('context-recess-'));
      return group.userData.recessOpenings.length===380&&meshes.length===3&&meshes.every(o=>{
        const properties=renderer.properties.get(o.material),program=properties.currentProgram;
        const fragment=program&&gl.getShaderSource(program.fragmentShader),attributes=o.geometry.attributes;
        return fragment?.includes('directLight.color*=contextOpeningVisibility(directLight.direction)')&&
          ['openingPoint','openingSize','openingNormal'].every(k=>attributes[k]?.count===attributes.position.count)&&
          properties.uniforms.envMap.value===scene.environment&&
          (o.name!=='context-recess-glazing'||fragment.includes('backingIncident=max(irradiance+iblIrradiance'));
      });
    }),true,`${mode}: real context apertures must retain compiled local sun occlusion and the lit backing`);
    modes.push({ mode, renderSize: state.renderSize, drawCalls: state.drawCalls });
  }
  console.log('QUALITY', JSON.stringify(modes));
  await page.evaluate(() => window.__campus.setTime(24));
  await page.click('#play');
  for (const mode of ['performance', 'balanced', 'quality']) {
    await page.click(`[data-quality="${mode}"]`); await waitFrames();
    const state = await page.evaluate(() => window.__campus.getState());
    assert.ok(state.playing && state.time >= 24 && state.time < 29, 'live quality switch reset playback');
  }
  await page.evaluate(() => window.__campus.pause());
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#notice')).opacity === '0');
  const shadowSpans = [];
  for (let shot = 0; shot < 6; shot++) {
    await page.click(`[data-shot="${shot}"]`);
    await page.evaluate(t => window.__campus.setTime(t), shot * 10 + 3);
    await waitFrames();
    shadowSpans.push(await page.evaluate(() => {
      const sun = window.__campus.scene.children.find(o => o.isDirectionalLight);
      return sun.shadow.camera.right - sun.shadow.camera.left;
    }));
    await page.screenshot({ path: `${directory}/shot-${shot + 1}.png` });
  }
  assert.ok(shadowSpans[2] < shadowSpans[0] / 2, 'facade close-up must concentrate shadow resolution');
  await page.evaluate(() => { window.__campus.setTime(3); document.body.classList.add('clean'); });
  await waitFrames();
  await page.screenshot({ path: `${directory}/overview.png` });
  await page.evaluate(() => document.body.classList.remove('clean'));
  await page.click('#free-camera'); await waitFrames();
  assert.equal(await page.evaluate(() => window.__campus.getState().free), true);
  await page.mouse.move(700, 300); await page.mouse.down(); await page.mouse.move(810, 350, { steps: 8 }); await page.mouse.up();
  // Orbit damping decays per rendered frame; a fixed delay leaves motion on slower GPUs.
  await page.waitForFunction(() => {
    const position=window.__campus.getState().camera,previous=window.__freeCameraSettle;
    const stable=previous&&position.every((v,i)=>Math.abs(v-previous.position[i])<.0005)?previous.stable+1:0;
    window.__freeCameraSettle={position,stable};return stable>=8;
  },{polling:'raf',timeout:15000});
  await page.evaluate(() => {delete window.__freeCameraSettle;});
  const freeBefore = await page.evaluate(() => window.__campus.getState());
  await page.click('[data-quality="balanced"]'); await waitFrames();
  const freeAfter = await page.evaluate(() => window.__campus.getState());
  assert.ok(freeAfter.free && !freeAfter.playing);
  assert.equal(freeAfter.time, freeBefore.time);
  assert.ok(freeAfter.camera.every((value, i) => Math.abs(value - freeBefore.camera[i]) < .02), 'quality switch reset free camera');
  await page.click('#free-camera');
  assert.equal(await page.evaluate(() => window.__campus.getState().free), false);
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#notice')).opacity === '0');
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 }); await waitFrames();
  const portrait = await page.evaluate(() => ({ aspect: window.__campus.camera.aspect, width: document.querySelector('canvas').clientWidth, height: document.querySelector('canvas').clientHeight }));
  assert.equal(portrait.width, 390); assert.equal(portrait.height, 844);
  assert.ok(Math.abs(portrait.aspect - 390/844) < .001);
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('button:not([hidden])')].filter(el => el.getClientRects().length && !el.closest('#loading')).every(el => {
    const r = el.getBoundingClientRect(); return r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
  })), true, 'portrait controls overflow viewport');
  await page.screenshot({ path: `${directory}/portrait.png` });
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.evaluate(() => { window.__campus.setQuality('balanced'); window.__campus.setTime(0); });
  await waitFrames();
  await page.click('#play');
  const tourSamples = [];
  for (let second = 0; second < 60; second += 5) {
    await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 5000)));
    const state = await page.evaluate(() => window.__campus.getState());
    assert.equal(state.contextLost, false); assert.deepEqual(state.shaderErrors, []);
    assert.ok(state.frameTimes.every(t => Number.isFinite(t) && t >= 0));
    const frames = state.frameTimes.slice().sort((a,b) => a-b);
    const sample = { time: state.time, shot: state.shot, fps: state.fps, p95FrameMs: frames[Math.floor(frames.length * .95)], drawCalls: state.drawCalls };
    tourSamples.push(sample);
    console.log('TOUR', JSON.stringify(sample));
  }
  const performance = await page.evaluate(() => window.__campus.getState());
  assert.ok(performance.playing);
  assert.equal(new Set(tourSamples.map(s => s.shot)).size, 6, 'tour must reach all six shots');
  const sorted = performance.frameTimes.slice().sort((a,b) => a-b);
  const summary = { gpu: performance.stats.gpu, fps: performance.fps, p95FrameMs: sorted[Math.floor(sorted.length * .95)], triangles: performance.stats.triangles, meshes: performance.stats.meshes, firstFrameMs: performance.stats.timings.firstFrameMs, drawCalls: performance.drawCalls, renderSize: performance.renderSize };
  assert.equal(performance.contextLost, false);
  assert.deepEqual(errors, []); assert.deepEqual(external, []); assert.deepEqual(failedRequests, []);
  await page.close();
  const lossPage = await browser.newPage();
  await lossPage.evaluateOnNewDocument(() => {
    new MutationObserver(() => {
      if (document.querySelector('#loading-status')?.textContent === '准备开始漫游…' && !window.lossInjected) {
        const gl = document.querySelector('canvas').getContext('webgl2');
        const extension = gl?.getExtension('WEBGL_lose_context');
        if (extension) { window.lossInjected = true; extension.loseContext(); }
      }
    }).observe(document, { childList: true, subtree: true, characterData: true });
  });
  await lossPage.goto(url.href);
  await lossPage.waitForFunction(() => window.lossInjected && window.__ERROR, { timeout: 120000 });
  await lossPage.evaluate(() => new Promise(resolve => setTimeout(resolve, 500)));
  assert.equal(await lossPage.evaluate(() => window.__READY), false);
  assert.equal(await lossPage.$eval('#retry', el => !el.hidden && !el.closest('#loading').classList.contains('done')), true);
  fs.writeFileSync(`${directory}/check.json`, JSON.stringify({ summary, modes, tourSamples, contextLossRetry: true, errors, external, failedRequests }, null, 2));
  console.log('PASS', JSON.stringify(summary));
} finally { await browser.close(); }
