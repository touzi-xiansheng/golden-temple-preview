import { Scene, PerspectiveCamera, Mesh, BoxGeometry, PlaneGeometry, SphereGeometry, MeshStandardNodeMaterial, DirectionalLight, Color, TSL } from 'three/webgpu';
import { Fn } from 'three/tsl';
import { createRenderer } from './capabilities.js';

async function start() {
  if (TSL.Fn !== Fn) throw new Error('Three.js/TSL loaded twice; dependency bundling must share one node runtime.');
  const runtime = await createRenderer(document.getElementById('scene'), { onError: message => { window.__ERROR = message; } });
  const { renderer } = runtime;
  renderer.setSize(960, 640);
  const scene = new Scene(); scene.background = new Color('#a5bdca');
  const camera = new PerspectiveCamera(45, 1.5, .1, 100); camera.position.set(5, 3, 7); camera.lookAt(0, 1, 0);
  const light = new DirectionalLight(0xffffff, 3); light.position.set(3, 6, 4); scene.add(light);
  const ground = new Mesh(new PlaneGeometry(20, 20), new MeshStandardNodeMaterial({color:'#97958e', roughness:.8})); ground.rotation.x = -Math.PI/2; scene.add(ground);
  const box = new Mesh(new BoxGeometry(1.4, 1.4, 1.4), new MeshStandardNodeMaterial({color:'#b9b3a9', roughness:.6})); box.position.set(-1, .7, 0); scene.add(box);
  const sphere = new Mesh(new SphereGeometry(.7, 32, 24), new MeshStandardNodeMaterial({color:'#8b9194', metalness:.8, roughness:.25})); sphere.position.set(1, .7, 0); scene.add(sphere);
  await renderer.compileAsync(scene, camera);
  renderer.render(scene, camera);
  await renderer.backend.device.queue.onSubmittedWorkDone();
  window.__lab = { runtime, renderer, scene, camera, async render() { renderer.render(scene,camera); await renderer.backend.device.queue.onSubmittedWorkDone(); } };
  window.__READY = true;
  document.getElementById('status').textContent = JSON.stringify(runtime.capabilities, null, 2);
}
start().catch(error => { console.error(error); window.__ERROR = String(error.stack || error); document.getElementById('status').textContent = error.message; });
