import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findChrome } from './lib/chrome.mjs';

const output = process.env.LOADING_REPORT || 'out/campus/loading-check.json';
const browser = await puppeteer.launch({
  executablePath: findChrome(), headless: true,
  args: ['--enable-gpu', '--no-proxy-server'],
  defaultViewport: { width: 1920, height: 1080, deviceScaleFactor: 1 },
});
try {
  const page = await browser.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluateOnNewDocument(() => {
    const stages = [], tasks = [], frames = [];
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) tasks.push({ start: entry.startTime, duration: entry.duration });
    });
    observer.observe({ type: 'longtask', buffered: true });
    let previous = performance.now(), finished = false;
    function frame(now) {
      frames.push({ start: previous, duration: now - previous }); previous = now;
      if (!finished) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    document.addEventListener('DOMContentLoaded', () => {
      const status = document.getElementById('loading-status');
      const record = () => stages.push({ start: performance.now(), label: status.textContent });
      record(); new MutationObserver(record).observe(status, { childList: true });
    });
    window.__loadingCheck = { stages, tasks, frames, finish() { finished = true; } };
  });
  const url = new URL(process.env.CAMPUS_URL || 'http://localhost:5173/campus.html');
  url.searchParams.set('paused', '1');
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => window.__READY || window.__ERROR, { timeout: 120000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0))));
  const report = await page.evaluate(() => {
    const data = window.__loadingCheck; data.finish();
    const label = start => data.stages.findLast(stage => stage.start <= start + 2)?.label ?? '启动';
    return { error: window.__ERROR, stats: window.__campus?.stats,
      tasks: data.tasks.map(task => ({ ...task, stage: label(task.start) })),
      maxFrameGapMs: Math.max(0, ...data.frames.map(frame => frame.duration)), stages: data.stages };
  });
  report.errors = errors;
  report.maxTaskMs = Math.max(0, ...report.tasks.map(task => task.duration));
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, maxTaskMs: report.maxTaskMs, maxFrameGapMs: report.maxFrameGapMs,
    timings: report.stats?.timings, longest: report.tasks.sort((a,b) => b.duration-a.duration).slice(0,5) }, null, 2));
  if (process.env.LOADING_SNAPSHOT) {
    const snapshot = await page.evaluate(async () => {
      const meshes = []; window.__campus.scene.traverse(object => { if (object.isMesh) meshes.push(object); });
      const hashes = new Map();
      async function hash(array) {
        if (!array) return null;
        if (!hashes.has(array)) hashes.set(array, crypto.subtle.digest('SHA-256', new Uint8Array(array.buffer, array.byteOffset, array.byteLength))
          .then(bytes => Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('')));
        return hashes.get(array);
      }
      return Promise.all(meshes.map(async mesh => ({ name: mesh.name, count: mesh.count,
        transform: mesh.matrixWorld.toArray(), index: await hash(mesh.geometry.index?.array),
        attributes: Object.fromEntries(await Promise.all(Object.entries(mesh.geometry.attributes).map(async ([name,attribute]) => [name,await hash(attribute.array)]))),
        instances: await hash(mesh.instanceMatrix?.array), colors: await hash(mesh.instanceColor?.array),
      })));
    });
    fs.writeFileSync(process.env.LOADING_SNAPSHOT, JSON.stringify(snapshot, null, 2) + '\n');
    await page.evaluate(() => { window.__campus.setTime(13); window.__campus.renderOnce(); });
    await page.waitForFunction(() => getComputedStyle(document.getElementById('loading')).opacity === '0');
    await page.screenshot({ path: process.env.LOADING_SNAPSHOT.replace(/\.json$/, '.png') });
  }
  assert.equal(report.error, null); assert.deepEqual(errors, []);
  // A seconds-long main-thread stall can trigger the browser's unresponsive-page warning.
  assert.ok(report.maxTaskMs < 1000, `loading blocked the main thread for ${report.maxTaskMs} ms`);
} finally { await browser.close(); }
