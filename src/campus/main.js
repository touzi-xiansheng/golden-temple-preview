import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBuildings } from './buildings.js';
import { buildLandscapeSteps } from './landscape.js';
import { runBuild } from './loading.js';
import { buildCampusProps } from './props.js';
import { QUALITY, renderSize } from './quality.js';
import { TOUR, DURATION, SHOT_SECONDS, sampleTour } from './tour.js';
import { daylight, fitCampusShadow, captureCampusEnvironment, createPost } from './rendering.js';
import { captureBuildingReflectionSteps } from './reflections.js';
import { createCampusPlanarReflections } from './planar-reflections.js';
import { createCourtyardIndirect } from './indirect-light.js';
import { createContextVisibility } from './context-visibility.js';

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search);
const loading = $('loading');
const stage = (message, progress) => { $('loading-status').textContent = message; $('loading-progress').style.width = `${progress}%`; };
const yieldPaint = () => new Promise(resolve => {
  if (document.hidden) setTimeout(resolve, 0);
  else requestAnimationFrame(() => setTimeout(resolve, 0));
});
let noticeTimeout;
function notice(message) {
  $('notice').textContent = message; $('notice').classList.add('visible');
  clearTimeout(noticeTimeout); noticeTimeout = setTimeout(() => $('notice').classList.remove('visible'), 2800);
}
function failed(error) {
  console.error('[campus] initialization failed', error);
  window.__ERROR = String(error?.message || error); window.__READY = false;
  loading.classList.remove('done');
  stage(`未能完成渲染：${error?.message || error}`, 100);
  $('retry').hidden = false;
}
$('retry').addEventListener('click', () => location.reload());
if (query.has('clean')) document.body.classList.add('clean');

async function start() {
  const started = performance.now();
  const timings = {};
  const canvas = $('scene');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.8;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.info.autoReset = false;
  const gl = renderer.getContext(), debug = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  console.info('[campus] GPU:', gpu);
  const shaderErrors = [];
  renderer.debug.onShaderError = (context, program, vs, fs) => {
    const error = [context.getProgramInfoLog(program), context.getShaderInfoLog(vs), context.getShaderInfoLog(fs)].filter(Boolean).join('\n');
    shaderErrors.push(error); console.error('[campus] shader error', error);
  };
  let contextLost = false;
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); contextLost = true;
    failed(new Error('显卡渲染上下文已中断，请关闭其他重负载网页后重新加载。'));
  });
  const yieldLoading = async () => {
    await yieldPaint();
    if (contextLost) throw new Error('显卡渲染上下文已中断，请重新加载。');
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.25, 9000);
  const initialTime = Number(query.get('t'));
  let time = Number.isFinite(initialTime) && initialTime >= 0 ? initialTime % DURATION : 0;
  let playing = !query.has('paused') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let free = false, currentShot = -1;
  let quality = Object.hasOwn(QUALITY, query.get('quality')) ? query.get('quality') : 'balanced';
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false; controls.enableDamping = true; controls.dampingFactor = 0.075;
  controls.minDistance = 3; controls.maxDistance = 520;
  controls.maxPolarAngle = Math.PI / 2 - 0.035;
  controls.target.set(0, 12, -5);
  let lighting, environment, buildingReflections, planarReflections, indirect, contextVisibility, post, architecture, landscape, props;
  let renderDimensions = { width: 1, height: 1 };

  function renderFrame() {
    planarReflections?.update(camera,{scale:QUALITY[quality].planarScale});
    post.render();
  }

  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    renderDimensions = renderSize(w, h, quality);
    const { width, height } = renderDimensions;
    renderer.setSize(width, height, false);
    post?.resize(width, height, QUALITY[quality]);
    $('performance').textContent = `${width} × ${height} · 采样帧率…`;
  }
  function configureQuality(value, announce = true) {
    if (!Object.hasOwn(QUALITY, value)) return;
    quality = value;
    const preset = QUALITY[value];
    lighting?.shadows?.setQuality(preset);
    indirect?.setEnabled(preset.indirect);
    if (lighting && lighting.sun.shadow.mapSize.x !== preset.shadow) {
      lighting.sun.shadow.mapSize.setScalar(preset.shadow);
      lighting.sun.shadow.map?.dispose(); lighting.sun.shadow.map = null;
      lighting.sun.shadow.mapPass?.dispose(); lighting.sun.shadow.mapPass = null;
      fitCampusShadow(lighting.sun, free ? -1 : currentShot);
      renderer.shadowMap.needsUpdate = true;
    }
    resize();
    for (const button of document.querySelectorAll('[data-quality]')) button.setAttribute('aria-pressed', String(button.dataset.quality === value));
    if (announce) notice(`已切换至${preset.label}模式`);
  }
  function applyTour() {
    const frame = sampleTour(time);
    camera.position.copy(frame.position); camera.lookAt(frame.target);
    camera.fov = frame.fov; camera.updateProjectionMatrix();
    controls.target.copy(frame.target);
    if (currentShot !== frame.index) {
      currentShot = frame.index;
      if (lighting) { fitCampusShadow(lighting.sun, currentShot); renderer.shadowMap.needsUpdate = true; }
      $('chapter-number').textContent = `${String(frame.index + 1).padStart(2, '0')} / 06`;
      $('chapter-title').textContent = TOUR[frame.index].name;
      $('chapter-detail').textContent = TOUR[frame.index].detail;
      for (const button of document.querySelectorAll('[data-shot]')) button.setAttribute('aria-current', String(+button.dataset.shot === frame.index));
    }
  }
  function playbackUI() {
    $('play').textContent = playing && !free ? 'Ⅱ' : '▶';
    $('play').setAttribute('aria-label', playing && !free ? '暂停漫游' : '播放漫游');
    $('mode-label').textContent = free ? '自由探索' : playing ? '自动漫游' : '漫游已暂停';
    $('free-camera').setAttribute('aria-pressed', String(free));
    $('free-camera').innerHTML = free ? '返回漫游 <span aria-hidden="true">↙</span>' : '自由探索 <span aria-hidden="true">↗</span>';
    $('hint').innerHTML = free ? '拖动 旋转 <span>·</span> 滚轮 缩放 <span>·</span> 右键 平移 <span>·</span> F 返回漫游' : '空格 暂停 / 播放 <span>·</span> F 自由探索';
  }
  function setFree(value) {
    free = value; controls.enabled = value;
    if (lighting && free) { fitCampusShadow(lighting.sun); renderer.shadowMap.needsUpdate = true; }
    if (free) { controls.update(); $('chapter-title').textContent = '探索 · 你的视角'; $('chapter-detail').textContent = '旋转、靠近，发现建筑的细节'; }
    else { currentShot = -1; applyTour(); }
    playbackUI();
  }
  function seek(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    time = Math.max(0, Math.min(DURATION - 0.001, number));
    if (free) setFree(false);
    applyTour();
  }

  stage('正在构建建筑与立面细节…', 12); await yieldLoading();
  let tick = performance.now(); architecture = buildBuildings(); scene.add(architecture);
  timings.architectureMs = performance.now() - tick;
  stage('正在种植树木，铺设道路与花园…', 35); await yieldLoading();
  tick = performance.now();
  const landscapeProgress = [
    ['地形',36], ['道路',38], ['种植区域',40], ['树皮',42], ['庭院树木',45],
    ['林地树木',48], ['灌木',51], ['植物网格',54], ['草坪细节',57],
  ];
  let progress = 35;
  landscape = await runBuild(buildLandscapeSteps(), { yieldControl: yieldLoading, onProgress: message => {
    if (!message) return;
    progress = Math.max(progress, landscapeProgress.find(([label]) => message.includes(label))?.[1] ?? progress);
    stage(message, progress);
  } });
  scene.add(landscape);
  props = buildCampusProps(); scene.add(props);
  timings.landscapeMs = performance.now() - tick;
  stage('正在计算晴日光照…', 61); await yieldLoading();
  applyTour(); resize();
  tick = performance.now(); lighting = daylight(scene, renderer);
  environment = lighting.skyTarget;
  contextVisibility = createContextVisibility(landscape, lighting.sun.userData.direction);
  timings.contextShadowMs = contextVisibility.stats.bakeMs;
  post = createPost(renderer, scene, camera);
  configureQuality(quality, false);
  fitCampusShadow(lighting.sun);
  renderer.shadowMap.needsUpdate = true;
  timings.lightSetupMs = performance.now() - tick;
  await yieldLoading();
  if (query.get('gi') !== '0') {
    try {
      indirect = createCourtyardIndirect(scene, renderer, lighting, {
        trees: landscape.userData.treePositions, paths: landscape.userData.courtyardPaths,
        shrubs: landscape.userData.matureShrubs,
      });
      await indirect.bake({
        onProgress: value => stage('正在计算庭院与廊下的漫反射光…', 62 + value * 11),
        yieldControl: yieldLoading,
      });
      indirect.setEnabled(QUALITY[quality].indirect);
      timings.indirectMs = indirect.stats.bakeMs;
    } catch (error) {
      indirect?.dispose(); indirect = null;
      if (contextLost) throw error;
      console.warn('[campus] courtyard indirect light uses fallback', error);
    }
  }
  stage('正在编译建筑与植物材质…', 74); await yieldLoading();
  tick = performance.now(); await renderer.compileAsync(scene, camera);
  if (shaderErrors.length) throw new Error('材质编译失败，请查看控制台中的 shader error。');
  timings.compileMs = performance.now() - tick;
  stage('正在生成玻璃反射…', 88); await yieldLoading();
  tick = performance.now();
  scene.background = lighting.probeBackground.texture;
  // Static reflection captures should not depend on the startup quality selection.
  indirect?.setEnabled(true);
  try {
    environment = captureCampusEnvironment(scene, renderer, environment);
    await yieldLoading();
    architecture.traverse(object => {
      if (!object.material?.isMeshPhysicalMaterial) return;
      object.material.envMap = scene.environment;
      object.material.needsUpdate = true;
    });
    buildingReflections = await runBuild(captureBuildingReflectionSteps(scene, renderer, architecture), {
      yieldControl: yieldLoading, onProgress: message => stage(message, 90),
    });
  } catch (error) {
    if (contextLost) throw error;
    console.warn('[campus] reflection capture uses fallback', error);
  }
  finally {
    indirect?.setEnabled(QUALITY[quality].indirect);
    scene.background = lighting.backgroundTarget.texture;
  }
  planarReflections = createCampusPlanarReflections(scene,renderer,architecture,lighting.probeBackground.texture);
  timings.reflectionMs = performance.now() - tick;
  fitCampusShadow(lighting.sun, currentShot);
  renderer.shadowMap.needsUpdate = true;
  stage('准备开始漫游…', 97); await yieldLoading();
  if (contextLost) return;
  renderFrame();
  if (shaderErrors.length) throw new Error('画面渲染失败，请查看控制台中的 shader error。');
  timings.firstFrameMs = performance.now() - started;
  let triangles = 0, meshes = 0;
  for (const root of [architecture, landscape, props]) root.traverse(object => {
    if (!object.isMesh) return;
    meshes++;
    triangles += (object.geometry.index?.count || object.geometry.attributes.position.count) / 3 * (object.isInstancedMesh ? object.count : 1);
  });
  const stats = { gpu, triangles, meshes, timings, buildings: architecture.userData.buildingCount, landscape: landscape.userData.stats, contextShadow: contextVisibility.stats };
  stats.planarReflection = planarReflections.stats;
  console.info('[campus] ready', JSON.stringify(stats));
  $('loading-progress').style.width = '100%'; loading.classList.add('done');
  window.__READY = true; window.__ERROR = null;
  playbackUI();

  for (const button of document.querySelectorAll('[data-quality]')) button.addEventListener('click', () => configureQuality(button.dataset.quality));
  for (const button of document.querySelectorAll('[data-shot]')) button.addEventListener('click', () => seek(+button.dataset.shot * SHOT_SECONDS));
  $('play').addEventListener('click', () => { if (free) { setFree(false); playing = true; } else playing = !playing; playbackUI(); });
  $('restart').addEventListener('click', () => { seek(0); playing = true; playbackUI(); });
  $('free-camera').addEventListener('click', () => setFree(!free));
  $('timeline').addEventListener('input', event => seek(event.target.value));
  $('fullscreen').addEventListener('click', async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('experience').requestFullscreen(); }
    catch { notice('此浏览器未允许全屏，请使用浏览器的全屏功能。'); }
  });
  document.addEventListener('fullscreenchange', () => $('fullscreen').setAttribute('aria-label', document.fullscreenElement ? '退出全屏' : '进入全屏'));
  window.addEventListener('keydown', event => {
    if (/INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName) || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.code === 'Space') { event.preventDefault(); $('play').click(); }
    if (event.key.toLowerCase() === 'f') { event.preventDefault(); setFree(!free); }
    if (/^[1-6]$/.test(event.key)) seek((+event.key - 1) * SHOT_SECONDS);
  });
  const observer = new ResizeObserver(resize); observer.observe(canvas);
  let previous = performance.now(), sampleStart = previous, rendered = 0, fps = 0, frameTimes = [];
  let drawCalls = 0;
  document.addEventListener('visibilitychange', () => { previous = performance.now(); sampleStart = previous; rendered = 0; frameTimes = []; });
  function loop(now) {
    if (contextLost) return;
    const delta = Math.max(0, now - previous); previous = now;
    if (!document.hidden) {
      if (playing && !free) time = (time + Math.min(delta / 1000, 0.1)) % DURATION;
      if (free) { controls.update(); camera.position.y = Math.max(1.5, camera.position.y); }
      else applyTour();
      renderer.info.reset();
      try {
        renderFrame();
        if (shaderErrors.length) throw new Error('材质渲染失败，请重新加载或尝试其他画质档位。');
      } catch (error) { failed(error); return; }
      drawCalls = renderer.info.render.calls;
      rendered++; frameTimes.push(delta); if (frameTimes.length > 300) frameTimes.shift();
      if (now - sampleStart >= 700) {
        fps = rendered * 1000 / (now - sampleStart);
        $('performance').textContent = `${fps.toFixed(0)} FPS · ${renderDimensions.width} × ${renderDimensions.height}`;
        rendered = 0; sampleStart = now;
      }
      $('timeline').value = String(time);
      $('elapsed').textContent = `00:${String(Math.floor(time)).padStart(2, '0')}`;
    }
    requestAnimationFrame(loop);
  }
  window.__campus = {
    stats, scene, camera, renderer, lighting, indirect, planarReflections,
    renderOnce: renderFrame,
    setTime: seek, setQuality: value => configureQuality(value, false), setFree,
    pause: () => { playing = false; playbackUI(); },
    getState: () => ({ quality, time, playing, free, shot: currentShot, renderSize: renderDimensions, fps, frameTimes: [...frameTimes], drawCalls, contextLost, shaderErrors: [...shaderErrors], camera: camera.position.toArray(), target: controls.target.toArray(), indirect: indirect?.getState() || null, stats }),
  };
  window.addEventListener('pagehide', event => {
    if (event.persisted) return;
    buildingReflections?.dispose(); planarReflections?.dispose();
    environment.dispose(); lighting.backgroundTarget.dispose(); lighting.probeBackground.dispose();
    indirect?.dispose(); contextVisibility?.dispose(); lighting.shadows?.dispose();
    landscape.userData.contextDistricts.landuse.texture.dispose();
  }, { once: true });
  requestAnimationFrame(loop);
}

start().catch(failed);
