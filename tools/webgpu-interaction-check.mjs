// Exercise hidden objects across shadow reallocations and the actual camera UI.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { findChrome } from './lib/chrome.mjs';
import { waitForStableCampus } from './lib/webgpu-checks.mjs';

const url = new URL(process.env.WEBGPU_URL || 'http://localhost:5173/campus-webgpu.html');
url.searchParams.set('paused', '1');
const label = process.env.PROFILE_LABEL || 'current';
assert.match(label, /^[a-z0-9-]+$/);
const cycles = Number(process.env.QUALITY_CYCLES || 10);
assert.ok(Number.isInteger(cycles) && cycles > 0 && cycles <= 100);
const report = { url: url.href, camera: [], quality: [], errors: [], cycles };
const output = `out/webgpu/interaction-${label}.json`;
fs.mkdirSync('out/webgpu', { recursive: true });
const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true,
  args: ['--enable-gpu', '--no-proxy-server'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 }, protocolTimeout: 180000 });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => report.errors.push(error.message));
  await page.goto(url.href, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__READY || window.__ERROR, { timeout: 180000 });
  const initial = await waitForStableCampus(page);
  assert.equal(initial.capabilities.backend, 'webgpu');
  assert.notEqual(initial.capabilities.adapter.isFallbackAdapter, true);
  report.browser = await browser.version();
  report.capabilities = initial.capabilities;
  // Returning immediately after a drag also tests residual damping on re-entry.
  for (const time of [5, 15, 25, 35, 45, 55]) {
    await page.evaluate(time => window.__campus.setTime(time), time);
    await waitForStableCampus(page);
    for (const repeat of [false, true]) {
      const change = await page.evaluate(() => {
        const app = window.__campus, p = app.camera.position.clone(), q = app.camera.quaternion.clone();
        document.getElementById('free-camera').click();
        return { position: p.toArray(), quaternion: q.toArray(),
          fov: app.camera.fov, positionMetres: p.distanceTo(app.camera.position), angleRadians: q.angleTo(app.camera.quaternion) };
      });
      const settled = await waitForStableCampus(page);
      const drift = await page.evaluate(before => {
        const {camera} = window.__campus;
        return { settledPositionMetres: camera.position.distanceTo(camera.position.clone().fromArray(before.position)),
          settledAngleRadians: camera.quaternion.angleTo(camera.quaternion.clone().fromArray(before.quaternion)) };
      }, change);
      report.camera.push({ time, repeat, ...change, ...drift, height: settled.camera[1] });
      await page.mouse.move(960, 540);
      await page.mouse.down();
      await page.mouse.move(1010, 565, { steps: 3 });
      await page.mouse.up();
      const dragged = await page.evaluate(before => window.__campus.camera.position.distanceTo(
        window.__campus.camera.position.clone().fromArray(before.position)), change);
      assert.ok(dragged > .01, 'Dragging must actually move the camera');
      await page.click('#free-camera');
      const returned = await page.evaluate(before => {
        const app = window.__campus, {camera} = app;
        return { free: app.getState().free, position: camera.position.distanceTo(camera.position.clone().fromArray(before.position)),
          angle: camera.quaternion.angleTo(camera.quaternion.clone().fromArray(before.quaternion)), fov: camera.fov };
      }, change);
      assert.equal(returned.free, false);
      assert.ok(returned.position < .001 && returned.angle < Math.PI / 18000, 'Return must restore the tour pose');
      assert.equal(returned.fov, change.fov);
    }
  }
  // All objects have been seen. Resize while only arcade objects are visible,
  // then revisit the render objects which skipped the intermediate dimensions.
  for (let cycle = 0; cycle < cycles; cycle++) {
    await page.evaluate(() => window.__campus.setTime(45));
    await waitForStableCampus(page);
    for (const quality of ['performance', 'quality', 'balanced']) {
      await page.click(`[data-quality="${quality}"]`);
      const state = await waitForStableCampus(page);
      assert.equal(state.quality, quality);
      assert.equal(await page.evaluate(() => window.__campus.lighting.sun.shadow.mapSize.x),
        quality === 'performance' ? 1024 : 4096);
    }
    for (const time of [5, 15, 25, 35, 45, 55]) {
      await page.evaluate(time => window.__campus.setTime(time), time);
      const state = await waitForStableCampus(page);
      assert.deepEqual(state.errors, []);
      report.quality.push({ cycle, time, memory: state.memory });
    }
    console.log('QUALITY CYCLE', cycle + 1, 'passed');
  }
  const first = report.quality[5].memory, last = report.quality.at(-1).memory;
  for (const key of ['programs', 'textures', 'renderTargets', 'geometries']) {
    assert.equal(last[key], first[key], `${key} grew after the first complete quality round trip`);
  }
  for (const change of report.camera) {
    assert.ok(change.positionMetres < .001, `t=${change.time}: free camera jumped ${change.positionMetres}m`);
    assert.ok(change.angleRadians < Math.PI / 18000, `t=${change.time}: free camera rotated`);
    assert.ok(change.settledPositionMetres < .001, `t=${change.time}: free camera drifted`);
    assert.ok(change.settledAngleRadians < Math.PI / 18000, `t=${change.time}: free camera kept rotating`);
  }
  await page.evaluate(() => { window.__campus.setTime(35); document.getElementById('free-camera').click(); });
  await page.mouse.move(960, 540); await page.mouse.down();
  await page.mouse.move(960, 20, {steps: 8}); await page.mouse.up();
  const floor = await waitForStableCampus(page);
  report.floorHeight = floor.camera[1];
  assert.ok(floor.camera[1] >= .3 - 1e-6 && floor.camera[1] < .31, `Ground limit must use world height: ${floor.camera[1]}`);
  await page.click('#free-camera');
  // A fatal device error must stop submission instead of flooding the same error.
  report.fatal = await page.evaluate(async () => {
    const app = window.__campus;
    app.renderer.backend.device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror',
      { error: new GPUValidationError('interaction-check: intentional fatal error') }));
    const frames = app.view.stats.frames;
    await new Promise(resolve => setTimeout(resolve, 150));
    return { framesBefore: frames, framesAfter: app.view.stats.frames, ready: window.__READY,
      error: window.__ERROR, overlay: document.getElementById('loading').classList.contains('done') };
  });
  assert.equal(report.fatal.framesAfter, report.fatal.framesBefore);
  assert.equal(report.fatal.ready, false);
  assert.equal(report.fatal.overlay, false);
  assert.deepEqual(report.errors, []);
  await page.close();
  // Interrupt startup at its asynchronous prewarm boundary, before __campus exists.
  const startupPage = await browser.newPage();
  await startupPage.evaluateOnNewDocument(() => {
    const listen = GPUDevice.prototype.addEventListener, submit = GPUQueue.prototype.submit;
    window.__startupProbe = { submissions: 0, fired: false };
    GPUQueue.prototype.submit = function(...args) {
      window.__startupProbe.submissions++;
      return submit.apply(this, args);
    };
    GPUDevice.prototype.addEventListener = function(type, ...args) {
      if (type === 'uncapturederror') {
        const device = this, timer = setInterval(() => {
          if (!document.getElementById('loading-status')?.textContent.includes('准备近景玻璃')) return;
          clearInterval(timer);
          window.__startupProbe.fired = true;
          window.__startupProbe.atFailure = window.__startupProbe.submissions;
          device.dispatchEvent(new GPUUncapturedErrorEvent('uncapturederror',
            {error: new GPUValidationError('interaction-check: startup interruption')}));
        }, 0);
      }
      return listen.call(this, type, ...args);
    };
  });
  await startupPage.goto(url.href, {waitUntil: 'domcontentloaded'});
  await startupPage.waitForFunction(() => window.__startupProbe.fired, {timeout: 180000});
  report.startupFatal = await startupPage.evaluate(async () => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return {...window.__startupProbe, ready: !!window.__READY, error: window.__ERROR};
  });
  assert.equal(report.startupFatal.ready, false);
  assert.equal(report.startupFatal.error, 'interaction-check: startup interruption');
  assert.equal(report.startupFatal.submissions, report.startupFatal.atFailure);
  report.passed = true;
  console.log('PASS', output);
} catch (error) {
  report.passed = false; report.failure = error.stack;
  console.error(error.message); process.exitCode = 1;
} finally {
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  await browser.close();
}
