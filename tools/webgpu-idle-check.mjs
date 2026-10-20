// Real browser regression: stationary scenes submit no frames; UI changes wake them.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
import { waitForStableCampus } from './lib/webgpu-checks.mjs';

const url = new URL(process.env.WEBGPU_URL || 'http://127.0.0.1:5173/campus-webgpu.html');
url.searchParams.set('paused', '1');
const label = process.env.PROFILE_LABEL || 'current';
assert.match(label, /^[a-z0-9-]+$/);
const output = `out/webgpu/idle-${label}.json`;
fs.mkdirSync('out/webgpu', {recursive: true});
const report = {url: url.href, idle: [], actions: [], errors: []};
const browser = await puppeteer.launch({executablePath: findChrome(), headless: true,
  args: ['--enable-gpu', '--no-proxy-server'], defaultViewport: {width: 1920, height: 1080, deviceScaleFactor: 1},
  protocolTimeout: 180000});
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    const submit = GPUQueue.prototype.submit;
    window.__submissions = 0;
    GPUQueue.prototype.submit = function(...args) { window.__submissions++; return submit.apply(this, args); };
  });
  await page.goto(url.href, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => window.__READY || window.__ERROR, {timeout: 180000});
  const initial = await waitForStableCampus(page);
  assert.equal(initial.capabilities.backend, 'webgpu');
  assert.notEqual(initial.capabilities.adapter.isFallbackAdapter, true);
  report.browser = await browser.version();
  report.startup = initial.stats.timings;
  await page.evaluate(() => {
    const app = window.__campus, frame = app.view.frame;
    window.__lastDrawnCamera = null;
    app.view.frame = function(...args) {
      const result = frame.apply(this, args);
      window.__lastDrawnCamera = {position: app.camera.position.toArray(), quaternion: app.camera.quaternion.toArray()};
      return result;
    };
  });
  const settle = () => page.evaluate(async () => {
    const app = window.__campus, deadline = performance.now() + 30000;
    let previous = null, stable = 0;
    while (stable < 12) {
      await new Promise(requestAnimationFrame);
      if (window.__ERROR) throw new Error(window.__ERROR);
      if (performance.now() > deadline) throw new Error('Natural camera damping did not settle');
      const pose = [...app.camera.position, ...app.camera.quaternion, ...app.camera.projectionMatrix.elements];
      stable = previous && pose.every((v, i) => Math.abs(v - previous[i]) < 1e-8) ? stable + 1 : 0;
      previous = pose;
    }
    const drawn = window.__lastDrawnCamera;
    if (drawn) {
      const p = app.camera.position.clone().fromArray(drawn.position);
      const q = app.camera.quaternion.clone().fromArray(drawn.quaternion);
      // OrbitControls emits change above its own 1e-6 squared-pose threshold.
      if (app.camera.position.distanceTo(p) > .0011 || app.camera.quaternion.angleTo(q) > .0011)
        throw new Error('Final natural render missed the settled camera pose');
    }
    await app.renderer.backend.device.queue.onSubmittedWorkDone();
    return app.getState();
  });
  async function idle(kind) {
    const sample = await page.evaluate(async () => {
      const app = window.__campus, frames = app.view.stats.frames, submissions = window.__submissions;
      const camera = app.camera.position.toArray(), started = performance.now();
      await new Promise(resolve => setTimeout(resolve, 2000));
      return {elapsedMs: performance.now() - started, frames: app.view.stats.frames - frames,
        submissions: window.__submissions - submissions, cameraBefore: camera, cameraAfter: app.camera.position.toArray(),
        ready: window.__READY, error: window.__ERROR, errors: app.getState().errors};
    });
    report.idle.push({kind, ...sample});
    assert.equal(sample.ready, true); assert.equal(sample.error, null); assert.deepEqual(sample.errors, []);
    assert.equal(sample.frames, 0, `${kind}: stationary view submitted ${sample.frames} redundant frames`);
    assert.equal(sample.submissions, 0, `${kind}: GPU work continued while stationary`);
    assert.ok(Math.hypot(...sample.cameraAfter.map((v, i) => v - sample.cameraBefore[i])) < .0001,
      `${kind}: camera kept moving after settling`);
  }
  async function action(kind, change) {
    const before = await page.evaluate(() => window.__campus.view.stats.frames);
    await change();
    await page.waitForFunction(before => window.__campus.view.stats.frames > before, {timeout: 5000}, before);
    const state = await settle();
    report.actions.push({kind, frames: state.rendering.frames - before, camera: state.camera,
      time: state.time, quality: state.quality, renderSize: state.renderSize});
    assert.deepEqual(state.errors, []);
    return state;
  }
  await idle('paused-tour');
  const seek = await action('timeline', () => page.evaluate(() => {
    const input = document.getElementById('timeline'); input.value = '35'; input.dispatchEvent(new Event('input'));
  }));
  assert.equal(seek.time, 35);
  await idle('after-seek');
  await action('free-camera', () => page.click('#free-camera'));
  await idle('free-camera-at-rest');
  const beforeDrag = await page.evaluate(() => window.__campus.camera.position.toArray());
  await action('drag-and-damping', async () => {
    await page.mouse.move(960, 540); await page.mouse.down();
    await page.mouse.move(1040, 575, {steps: 6}); await page.mouse.up();
  });
  const afterDrag = await page.evaluate(() => window.__campus.camera.position.toArray());
  assert.ok(Math.hypot(...afterDrag.map((v, i) => v - beforeDrag[i])) > .01);
  await idle('after-damping');
  const zoom = await action('wheel', () => page.mouse.wheel({deltaY: -120}));
  assert.ok(Math.hypot(...zoom.camera.map((v, i) => v - afterDrag[i])) > .01);
  await idle('after-wheel');
  await action('return-tour', () => page.click('#free-camera'));
  for (const quality of ['performance', 'quality', 'balanced']) {
    const state = await action(`quality-${quality}`, () => page.click(`[data-quality="${quality}"]`));
    assert.equal(state.quality, quality);
  }
  for (const [width, height] of [[1366, 768], [1920, 1080]]) {
    await action(`resize-${width}`, () => page.setViewport({width, height, deviceScaleFactor: 1}));
    assert.equal(await page.evaluate(() => window.__campus.camera.aspect), width / height);
  }
  await page.evaluate(() => {
    HTMLAnchorElement.prototype.click = function() { window.__download = {name: this.download, href: this.href}; };
  });
  await action('snapshot', () => page.click('#snapshot'));
  const download = await page.evaluate(() => ({name: window.__download.name,
    png: window.__download.href.startsWith('data:image/png;base64,'), bytes: window.__download.href.length}));
  report.download = download;
  assert.ok(download.png && download.bytes > 100000);
  await idle('after-snapshot');
  const otherTab = await browser.newPage();
  await otherTab.bringToFront();
  await page.waitForFunction(() => document.hidden, {timeout: 5000});
  report.visibility = {hidden: await page.evaluate(() => document.visibilityState)};
  await idle('hidden-tab');
  await action('return-to-visible-tab', () => page.bringToFront());
  report.visibility.restored = await page.evaluate(() => document.visibilityState);
  assert.equal(report.visibility.restored, 'visible');
  await otherTab.close();
  await idle('visible-again');
  await page.click('#play');
  const playback = await page.evaluate(async () => {
    const app = window.__campus, frames = app.view.stats.frames, time = app.getState().time;
    await new Promise(resolve => setTimeout(resolve, 1000));
    return {frames: app.view.stats.frames - frames, elapsed: app.getState().time - time};
  });
  report.playback = playback;
  assert.ok(playback.frames > 20 && playback.elapsed > .5);
  await page.click('#play'); await settle();
  await idle('paused-again');
  assert.deepEqual(report.errors, []);
  report.passed = true;
  console.log('PASS', output);
} catch (error) {
  report.passed = false; report.failure = error.stack;
  console.error(error.message); process.exitCode = 1;
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  await browser.close();
}
