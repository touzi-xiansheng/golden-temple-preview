import assert from 'node:assert/strict';

export async function waitForStableCampus(page, laboratory = false) {
  await page.waitForFunction(() => {
    if (window.__ERROR) throw new Error(window.__ERROR);
    const loading = document.getElementById('loading');
    if (!loading) return true;
    const style = getComputedStyle(loading);
    return style.display === 'none' || (style.visibility === 'hidden' && Number(style.opacity) === 0);
  }, { timeout: 30000 });
  return page.evaluate(async lab => {
    const app = lab ? window.__lab : window.__campus;
    if (lab) {
      await app.render();
      return { capabilities: app.runtime.capabilities, errors: app.runtime.errors };
    }
    app.pause();
    const start = app.view.stats.frames, minimumFrames = app.view.stats.aa === 'traa' ? 32 : 3;
    const deadline = performance.now() + 30000;
    let previous = null, stable = 0;
    while (app.view.stats.frames - start < minimumFrames || stable < 3) {
      await new Promise(requestAnimationFrame);
      if (window.__ERROR) throw new Error(window.__ERROR);
      if (performance.now() > deadline) throw new Error('Camera/render frames did not settle');
      // The application intentionally stops drawing stationary MSAA views.
      // Explicit draws also capture diagnostic camera/material changes.
      app.renderOnce();
      const pose = [...app.camera.matrixWorld.elements, ...app.camera.projectionMatrix.elements];
      stable = previous && pose.every((value, i) => Math.abs(value - previous[i]) < 1e-6) ? stable + 1 : 0;
      previous = pose;
    }
    await app.renderer.backend.device.queue.onSubmittedWorkDone();
    return { ...app.getState(), snapshot: {
      minimumFrames, framesWaited: app.view.stats.frames - start, stableCameraFrames: stable,
      exposure: app.renderer.toneMappingExposure, toneMapping: app.renderer.toneMapping,
      environmentIntensity: app.scene.environmentIntensity, fov: app.camera.fov,
      cameraWorld: [...app.camera.matrixWorld.elements], projection: [...app.camera.projectionMatrix.elements],
    } };
  }, laboratory);
}

// Serialized by Puppeteer. Start before lighting.update, finish after the final scene pipeline.
// The interval also includes tour/history work outside this CPU submission scope.
export function installMotionProbe() {
  const app = window.__campus;
  const update = app.lighting.update, frame = app.view.frame;
  let start = null, previous = null, shot = null;
  const probe = { samples: [], reset() { this.samples = []; } };
  app.lighting.update = function(...args) {
    start = performance.now(); shot = args[1]?.shot ?? null;
    return update.apply(this, args);
  };
  app.view.frame = function(...args) {
    if (start === null) throw new Error('Motion probe expected lighting.update before view.frame');
    const result = frame.apply(this, args), end = performance.now();
    if (previous !== null) probe.samples.push({
      interval: end - previous, cpu: end - start, shot,
      drawCalls: app.renderer.info.render.drawCalls, triangles: app.renderer.info.render.triangles,
    });
    previous = end; start = null;
    return result;
  };
  window.__motionProbe = probe;
}

export function summarizeMotion(samples) {
  const summarize = key => {
    const values = samples.map(sample => sample[key]).sort((a, b) => a - b);
    assert.ok(values.length && values.every(Number.isFinite), `Missing/invalid ${key} samples`);
    return { p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1], max: values.at(-1) };
  };
  return { frames: samples.length, intervalMs: summarize('interval'), cpuSubmitMs: summarize('cpu'), drawCalls: summarize('drawCalls'), triangles: summarize('triangles') };
}

export function compareMotionBaseline(report, baseline, { reflectionUpgrade = false } = {}) {
  assert.equal(baseline.schemaVersion, 2, 'Re-run BASELINE_REPORT with this version of the motion tool');
  assert.equal(report.browser, baseline.browser, 'Baseline browser differs');
  for (const key of ['vendor', 'architecture', 'device', 'isFallbackAdapter']) {
    assert.equal(report.capabilities.adapter[key], baseline.capabilities.adapter[key], `Baseline adapter ${key} differs`);
  }
  assert.equal(report.cases.length, baseline.cases.length, 'Baseline shot count differs');
  return report.cases.map(current => {
    const before = baseline.cases.find(sample => sample.time === current.time);
    assert.ok(before, `Baseline is missing t=${current.time}`);
    for (const key of ['renderSize', 'quality', 'aa', 'shadowMode']) {
      assert.deepEqual(current[key], before[key], `Baseline ${key} differs at t=${current.time}`);
    }
    if (reflectionUpgrade) {
      assert.equal(before.reflectionMode, 'parallax-probes', 'Expected a probe-only baseline');
      assert.equal(current.reflectionMode, 'portal', 'Expected the portal reflection upgrade');
    } else assert.equal(current.reflectionMode, before.reflectionMode, `Baseline reflectionMode differs at t=${current.time}`);
    const baselineMs = before.intervalMs.p95, actualMs = current.intervalMs.p95;
    assert.ok(Number.isFinite(baselineMs) && baselineMs > 0 && Number.isFinite(actualMs), 'Invalid baseline p95');
    const allowanceMs = Math.max(2, baselineMs * .1);
    return { time: current.time, baselineMs, actualMs, allowanceMs, limitMs: baselineMs + allowanceMs, passed: actualMs <= baselineMs + allowanceMs };
  });
}
