import { PerspectiveCamera, Node } from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TOUR, DURATION, SHOT_SECONDS, sampleTour } from '../campus/tour.js';
import { QUALITY, renderSize } from '../campus/quality.js';
import { createRenderer } from './capabilities.js';
import { createCampusScene } from './scene.js';
import { createLighting, applyCampusLighting } from './lighting.js';
import { createView } from './render.js';
import { bakeCampusProbes } from './probes.js';
import { createReflections } from './reflections.js';

const $ = id => document.getElementById(id), query = new URLSearchParams(location.search);
if(query.has('debug'))Node.captureStackTrace=true;
const stage = (message, progress) => { $('loading-status').textContent = message; $('loading-progress').style.width = `${progress}%`; };
const yieldControl = () => new Promise(resolve => setTimeout(resolve, 0));
if (query.has('clean')) document.body.classList.add('clean');
let stopped = false;
function failed(error) {
  if (stopped) return;
  stopped = true;
  window.__ERROR = error?.message || String(error); window.__READY = false;
  console.error('[webgpu]', error); stage(window.__ERROR, 100);
  $('loading').classList.remove('done'); $('retry').hidden = false; $('original-version').hidden = false;
}
$('retry').onclick = () => location.reload();

async function start() {
  const started = performance.now(), canvas = $('scene');
  stage('正在连接 WebGPU…', 5);
  const runtime = await createRenderer(canvas, { onError: failed, onLost: info => failed(new Error(`图形设备连接已中断：${info.message}。请重新加载。`)) });
  const rendererInitMs = performance.now()-started;
  const { renderer } = runtime;
  const camera = new PerspectiveCamera(46, 1, .2, 9000);
  let time = Math.max(0, Number(query.get('t')) || 0) % DURATION;
  let playing = !query.has('paused') && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  let free = false, currentShot = -1;
  let quality = Object.hasOwn(QUALITY, query.get('quality')) ? query.get('quality') : 'balanced';
  let dimensions, view, lighting, world, reflections, indirect;
  const controls = new OrbitControls(camera, canvas); controls.enabled = false;
  controls.enableDamping = true; controls.dampingFactor = .075;
  controls.minDistance = .3; controls.maxDistance = 650;
  // Tour cameras look upward; constrain world height instead of the target plane.
  function updateControls() {
    controls.update();
    if (camera.position.y < .3) { camera.position.y = .3; camera.lookAt(controls.target); }
  }
  function playbackUI() {
    $('play').textContent = playing && !free ? 'Ⅱ' : '▶';
    $('play').setAttribute('aria-label', playing && !free ? '暂停漫游' : '播放漫游');
    $('mode-label').textContent = free ? '自由探索' : playing ? '自动漫游' : '漫游已暂停';
    $('free-camera').setAttribute('aria-pressed', String(free));
    $('free-camera').textContent = free ? '返回漫游 ↙' : '自由探索 ↗';
    $('hint').textContent = free ? '拖动旋转 · 滚轮缩放 · 右键平移 · F 返回漫游' : '空格 暂停 / 播放 · F 自由探索';
  }
  function applyTour() {
    const frame = sampleTour(time); camera.position.copy(frame.position); camera.lookAt(frame.target); camera.fov = frame.fov; camera.updateProjectionMatrix(); controls.target.copy(frame.target);
    if (frame.index !== currentShot) {
      currentShot = frame.index; view?.resetHistory();
      $('chapter-number').textContent = `${String(currentShot+1).padStart(2,'0')} / 06`;
      $('chapter-title').textContent = TOUR[currentShot].name; $('chapter-detail').textContent = TOUR[currentShot].detail;
      document.querySelectorAll('[data-shot]').forEach(button => button.setAttribute('aria-current', String(+button.dataset.shot===currentShot)));
    }
    $('timeline').value = time; $('elapsed').textContent = `00:${String(Math.floor(time)).padStart(2,'0')}`;
  }
  function resize() {
    const width = Math.max(1,canvas.clientWidth), height = Math.max(1,canvas.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix(); dimensions = renderSize(width,height,quality);
    renderer.setSize(dimensions.width,dimensions.height,false); view?.resetHistory();
  }
  function setQuality(value) {
    if (!Object.hasOwn(QUALITY,value)) return;
    quality = value; lighting?.setQuality?.(value); reflections?.setQuality(value); resize();
    document.querySelectorAll('[data-quality]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.quality===value)));
  }
  function setFree(value) {
    free = !!value; controls.enabled = free; view?.resetHistory();
    if (free) { updateControls(); $('chapter-title').textContent='探索 · 你的视角'; $('chapter-detail').textContent='旋转、靠近，发现建筑的细节'; }
    else {
      // Drain pending drag/pan damping before the tour takes ownership.
      controls.enableDamping=false; controls.update(); controls.enableDamping=true;
      currentShot=-1; applyTour();
    }
    playbackUI();
  }
  function seek(value) {
    const number=Number(value); if (!Number.isFinite(number)) return;
    time=Math.max(0,Math.min(DURATION-.001,number)); if(free)setFree(false); applyTour(); view?.resetHistory();
  }
  applyTour(); resize();
  world = await createCampusScene({stage,yieldControl,contacts:query.get('contacts')!=='0',refined:query.get('aesthetics')!=='0'});
  world.stats.timings.rendererInitMs=rendererInitMs;
  stage('正在建立日光、阴影与程序天空…',60); await yieldControl();
  let tick = performance.now();
  lighting = createLighting({renderer,scene:world.scene,camera,quality,cacheShadows:query.get('shadows')!=='dynamic',groundBounce:query.get('groundBounce')!=='0'}); await lighting.ready;
  if(query.get('gi')!=='0') {
    indirect=await bakeCampusProbes(lighting,world.landscape,{renderer,architecture:world.architecture,roughSpecular:query.get('roughSpecular')!=='0',onProgress:fraction=>stage('正在计算庭院与廊下的间接光…',60+fraction*14)});
    world.stats.indirect=indirect.stats;
  }
  const materials = new Set(); world.scene.traverse(object=>{ for(const material of Array.isArray(object.material)?object.material:[object.material])if(material)materials.add(material); });
  world.materials.bindLighting(lighting);
  for(const material of materials)if(material.isMeshStandardNodeMaterial || material.isMeshPhysicalNodeMaterial)applyCampusLighting(material,lighting);
  indirect?.bindRoughEnvironment();
  world.stats.timings.lightingMs = performance.now()-tick;
  if(query.get('reflections')!=='0') {
    tick=performance.now();reflections=createReflections({renderer,scene:world.scene,materials:world.materials,lighting,planar:query.get('reflections')!=='probes',mode:query.get('reflectionMode')==='reference'?'reference':'portal'});
    await reflections.captureProbes({yieldControl,onProgress:(current,total)=>stage(`正在捕获园区反射（${current}/${total}）…`,75+current/total*8)});
    world.stats.timings.reflectionsMs=performance.now()-tick;
  }
  view = createView(renderer,world.scene,camera,{aa:query.get('aa')==='traa'?'traa':'msaa'});
  setQuality(quality);
  stage('正在准备 WebGPU 材质与渲染管线…',85); await yieldControl(); tick=performance.now();
  // Keep precompilation: interleaved complete-startup measurements found no
  // benefit from removing it. The opt-out is retained for diagnostics.
  const startupCompilation=world.stats.startupCompilation={defaultPrecompile:query.get('precompile')!=='0',
    programCountSource:'renderer.info.memory.programs',programsBefore:renderer.info.memory.programs,warmup:[]};
  const precompileStarted=performance.now();
  if(startupCompilation.defaultPrecompile)await renderer.compileAsync(world.scene,camera);
  world.stats.timings.defaultPrecompileMs=startupCompilation.defaultPrecompile?performance.now()-precompileStarted:0;
  startupCompilation.programsAfterDefaultPrecompile=renderer.info.memory.programs;
  const renderOnce = () => {
    if (stopped) return;
    renderer.info.reset();
    const shadowRevision=lighting.stats.shadowCache?.invalidations;
    lighting.update?.(camera,{shot:free?-1:currentShot});
    if(lighting.stats.shadowCache?.invalidations!==shadowRevision)reflections?.invalidate();
    reflections?.update(camera);view.frame();
  };
  if(reflections?.stats.enabled) {
    stage('正在准备近景玻璃反射…',92);await yieldControl();
    const warmupStarted=performance.now(),initialCamera=camera.clone();
    // These three views cover the measured first-entry pipeline misses.
    for(const warmupTime of [SHOT_SECONDS,4*SHOT_SECONDS,4.5*SHOT_SECONDS]) {
      if(stopped)throw new Error(window.__ERROR || 'WebGPU startup stopped');
      const pointStarted=performance.now(),programsBefore=renderer.info.memory.programs;
      const frame=sampleTour(warmupTime);
      camera.position.copy(frame.position);camera.lookAt(frame.target);camera.fov=frame.fov;camera.updateProjectionMatrix();
      lighting.update(camera,{shot:frame.index});reflections.update(camera,{force:true});view.frame();
      const submitMs=performance.now()-pointStarted,queueStarted=performance.now();
      await renderer.backend.device.queue.onSubmittedWorkDone();
      const queueWaitMs=performance.now()-queueStarted;
      await new Promise(requestAnimationFrame);
      startupCompilation.warmup.push({time:warmupTime,submitMs,queueWaitMs,totalMs:performance.now()-pointStarted,
        programsBefore,programsAfter:renderer.info.memory.programs});
    }
    camera.copy(initialCamera);
    view.resetHistory();
    reflections.invalidate();world.stats.timings.reflectionWarmupMs=performance.now()-warmupStarted;
  }
  const initialViewStarted=performance.now();
  renderOnce();
  world.stats.timings.initialViewSubmitMs=performance.now()-initialViewStarted;
  const initialQueueStarted=performance.now();
  await renderer.backend.device.queue.onSubmittedWorkDone();
  world.stats.timings.initialViewQueueWaitMs=performance.now()-initialQueueStarted;
  startupCompilation.programsAtReady=renderer.info.memory.programs;
  // Retain the original aggregate for comparisons; this includes warmup and
  // initial-view rendering/GPU completion, not just shader compilation.
  world.stats.timings.compileMs=performance.now()-tick;
  if(runtime.errors.length)throw new Error(runtime.errors[0]);
  if(stopped)throw new Error(window.__ERROR || 'WebGPU startup stopped');
  world.stats.timings.firstFrameMs=performance.now()-started;
  let previous=performance.now(), sampleStart=previous, frameCount=0, fps=0, frameTimes=[];
  const pause=()=>{playing=false;playbackUI();};
  let disposed=false;
  function dispose() { if(disposed)return;disposed=true;stopped=true;controls.dispose();view.dispose();reflections?.dispose();indirect?.dispose();lighting.dispose();world.dispose();runtime.dispose(); }
  window.__campus={renderer,scene:world.scene,camera,lighting,reflections,world,view,stats:world.stats,capabilities:runtime.capabilities,renderOnce,setTime:seek,setQuality,setFree,pause,dispose,
    setAA:value=>view.setAA(value),
    getState:()=>({capabilities:runtime.capabilities,errors:[...runtime.errors],quality,time,playing,free,shot:currentShot,renderSize:dimensions,fps,frameTimes:[...frameTimes],stats:world.stats,materials:world.materials.stats,lighting:lighting.stats,reflections:reflections?.stats,rendering:view.stats,memory:{...renderer.info.memory},camera:camera.position.toArray(),target:controls.target.toArray()})};
  document.querySelectorAll('[data-quality]').forEach(button=>button.onclick=()=>setQuality(button.dataset.quality));
  document.querySelectorAll('[data-shot]').forEach(button=>button.onclick=()=>seek(+button.dataset.shot*SHOT_SECONDS));
  $('play').onclick=()=>{if(free){setFree(false);playing=true;}else playing=!playing;playbackUI();};
  $('restart').onclick=()=>{seek(0);playing=true;playbackUI();}; $('free-camera').onclick=()=>setFree(!free);
  $('timeline').oninput=event=>seek(event.target.value);
  $('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('experience').requestFullscreen();}catch{ $('notice').textContent='请使用浏览器全屏功能'; }};
  $('snapshot').onclick=()=>{renderOnce();const link=document.createElement('a');link.download=`verdant-webgpu-${Math.floor(time)}.png`;link.href=canvas.toDataURL('image/png');link.click();};
  window.addEventListener('keydown',event=>{
    if(/INPUT|SELECT|BUTTON|TEXTAREA/.test(event.target.tagName)||event.ctrlKey||event.altKey||event.metaKey)return;
    if(event.code==='Space'){event.preventDefault();$('play').click();}else if(event.code==='KeyF')setFree(!free);
  });
  window.addEventListener('resize',resize); window.addEventListener('pagehide',event=>{if(!event.persisted)dispose();},{once:true});
  document.addEventListener('visibilitychange',()=>{previous=performance.now();sampleStart=previous;frameCount=0;view.resetHistory();});
  function loop(now) {
    if(stopped)return;
    const dt=Math.min(.1,(now-previous)/1000);previous=now;
    if(!document.hidden){
      if(playing&&!free){time=(time+dt)%DURATION;applyTour();}else if(free)updateControls();
      renderOnce();frameTimes.push(dt*1000);if(frameTimes.length>180)frameTimes.shift();frameCount++;
      if(now-sampleStart>=1000){fps=Math.round(frameCount*1000/(now-sampleStart));frameCount=0;sampleStart=now;$('performance').textContent=`${dimensions.width} × ${dimensions.height} · ${fps} FPS`;}
    }
    requestAnimationFrame(loop);
  }
  playbackUI();stage('园区已准备就绪',100);$('loading').classList.add('done');window.__ERROR=null;window.__READY=true;
  world.stats.timings.fullReadyMs=performance.now()-started;
  const firstVisible=()=>{
    if(stopped || window.__ERROR)return;
    const overlay=getComputedStyle($('loading'));
    if(overlay.visibility==='hidden' && Number(overlay.opacity)<=.01)world.stats.timings.firstVisibleMs=performance.now()-started;
    else requestAnimationFrame(firstVisible);
  };
  requestAnimationFrame(firstVisible);
  console.info('[webgpu] ready',JSON.stringify({capabilities:runtime.capabilities,stats:world.stats}));requestAnimationFrame(loop);
}
start().catch(failed);
