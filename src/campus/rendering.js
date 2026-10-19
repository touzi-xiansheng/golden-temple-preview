import * as THREE from 'three';
import { createSky } from '../core/sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { createCampusShadows, SUN_ANGULAR_RADIUS } from './soft-shadows.js';

const SKY_IRRADIANCE = 7;
// shortcut: transmittance matches this fixed sky at 60m; recompute if its atmosphere or sun elevation changes.
const SUN_TRANSMITTANCE = [0.9013991766, 0.8007643477, 0.6656584172];
export const DAYLIGHT = Object.freeze({
  direction: [0.35, 0.72, 0.6684309986827361],
  color: new THREE.Color(1, SUN_TRANSMITTANCE[1] / SUN_TRANSMITTANCE[0], SUN_TRANSMITTANCE[2] / SUN_TRANSMITTANCE[0]),
  intensity: SKY_IRRADIANCE * SUN_TRANSMITTANCE[0],
  skyIntensity: SKY_IRRADIANCE, environmentIntensity: 1, hemisphereIntensity: 0,
  angularRadius: SUN_ANGULAR_RADIUS,
});

export function daylight(scene, renderer) {
  const direction = new THREE.Vector3(...DAYLIGHT.direction).normalize();
  const sky = createSky();
  sky.material.uniforms = THREE.UniformsUtils.clone(sky.material.uniforms);
  const u = sky.material.uniforms;
  u.uCampusSolarRadius = { value: DAYLIGHT.angularRadius };
  // Keep the disc's integrated energy while using the same angular radius as the shadows.
  sky.material.fragmentShader = sky.material.fragmentShader
    .replace('uniform float uSunI;', 'uniform float uSunI;\nuniform float uCampusSolarRadius;')
    .replace('float R = 0.0095;', 'float R = uCampusSolarRadius;')
    .replace('sunI * 700.0 * disc', 'sunI * 700.0 * pow(0.0095 / uCampusSolarRadius, 2.0) * disc');
  u.uSunDir.value.copy(direction); u.uSunI.value = DAYLIGHT.skyIntensity;
  u.uCloudCover.value = 0.39; u.uCloudOpacity.value = 0.85;
  scene.fog = new THREE.FogExp2('#c8d6d7', 0.00062);
  const sun = new THREE.DirectionalLight(DAYLIGHT.color, DAYLIGHT.intensity);
  sun.userData.direction = direction;
  const overviewBounds = new THREE.Box3(new THREE.Vector3(-130, -1, -115), new THREE.Vector3(130, 40, 115));
  for (const tree of scene.getObjectByName('campus-landscape')?.userData.contextTreePositions || []) {
    const radius = tree.height * 0.42 + 3, ground = tree.ground || 0;
    overviewBounds.expandByPoint(new THREE.Vector3(tree.x - radius, ground, tree.z - radius));
    overviewBounds.expandByPoint(new THREE.Vector3(tree.x + radius, ground + tree.height * 1.1 + 3, tree.z + radius));
  }
  sun.userData.campusOverviewBounds = overviewBounds;
  sun.position.copy(direction).multiplyScalar(220); sun.target.position.set(0, 0, 0);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -170, right: 170, top: 170, bottom: -170, near: 20, far: 480 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.00004; sun.shadow.normalBias = 0.018; sun.shadow.radius = 1.8;
  scene.add(sun, sun.target);
  const hemisphere = new THREE.HemisphereLight('#c5dced', '#aaa18a', DAYLIGHT.hemisphereIntensity);
  scene.add(hemisphere);
  // Bake the existing atmospheric shader once; the moving camera samples the cube cheaply.
  const environmentScene = new THREE.Scene(); environmentScene.add(sky);
  const backgroundTarget = new THREE.WebGLCubeRenderTarget(1024, { type: THREE.HalfFloatType });
  const probeBackground = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const previousTarget = renderer.getRenderTarget();
  let skyTarget;
  try {
    new THREE.CubeCamera(0.1, 5000, backgroundTarget).update(renderer, environmentScene);
    // Direct sunlight is supplied by the light, not counted again in environment probes.
    u.uSunDisc.value = 0;
    new THREE.CubeCamera(0.1, 5000, probeBackground).update(renderer, environmentScene);
    skyTarget = pmrem.fromCubemap(probeBackground.texture);
  } catch (error) {
    backgroundTarget.dispose(); probeBackground.dispose(); throw error;
  } finally {
    renderer.setRenderTarget(previousTarget); pmrem.dispose();
    sky.geometry.dispose(); sky.material.dispose();
  }
  scene.background = backgroundTarget.texture;
  scene.backgroundIntensity = 1;
  scene.environment = skyTarget.texture;
  scene.environmentIntensity = DAYLIGHT.environmentIntensity;
  // Match haze to the actual viewing direction so the distant terrain joins the sky without a seam.
  const materials = new Set();
  scene.traverse(object => { if (object.material?.isMeshStandardMaterial) materials.add(object.material); });
  const fogFragment = THREE.ShaderChunk.fog_fragment.replace('fogColor, fogFactor',
    'textureCube(uCampusFogSky, inverseTransformDirection(-vViewPosition, viewMatrix)).rgb, fogFactor');
  for (const material of materials) {
    const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
    material.onBeforeCompile = function(shader, activeRenderer) {
      compile.call(this, shader, activeRenderer);
      shader.uniforms.uCampusFogSky = { value: backgroundTarget.texture };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform samplerCube uCampusFogSky;')
        .replace('#include <fog_fragment>', fogFragment);
    };
    material.customProgramCacheKey = () => `${key}-campus-sky-haze`;
    material.needsUpdate = true;
  }
  const shadows = createCampusShadows(scene, renderer, sun);
  return { sun, hemisphere, shadows, skyTarget, backgroundTarget, probeBackground };
}

// Static tour shots need one shadow update per cut, with pixels concentrated on their subject.
export function fitCampusShadow(sun, shot = -1) {
  // Align the arcade's long Z-axis eave with texel rows to avoid diagonal stair steps.
  sun.shadow.camera.up.set(0, shot === 4 ? 0 : 1, shot === 4 ? 1 : 0);
  const bounds = [
    [0, 12, 5, 140], [0, 10, 35, 105], [0, 12, 26, 60],
    [0, 12, -23, 68], [-18, 12, -43, 52], [0, 12, 5, 140],
  ];
  let [x, y, z, radius] = bounds[shot] || [0, 12, 0, 170];
  let distance = 400, near = 100, far = 700;
  if ((shot < 0 || shot === 0 || shot === 5) && sun.userData.campusOverviewBounds) {
    // Unshadowed outer crowns turn into bright cards; fit the whole woodland in light space.
    const box = sun.userData.campusOverviewBounds;
    [x, y, z] = box.getCenter(new THREE.Vector3()).toArray();
    const viewRotation = new THREE.Matrix4().lookAt(sun.userData.direction, new THREE.Vector3(), sun.up).invert();
    const size = box.clone().applyMatrix4(viewRotation).getSize(new THREE.Vector3());
    radius = Math.max(size.x, size.y) * 0.5 + 4;
    distance = size.z * 0.5 + 100; near = 50; far = size.z + 200;
  }
  sun.target.position.set(x, y, z); sun.target.updateMatrixWorld();
  sun.position.copy(sun.target.position).addScaledVector(sun.userData.direction, distance); sun.updateMatrixWorld();
  Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near, far });
  const texelMetres = radius * 2 / sun.shadow.mapSize.x;
  // The filter handles receiver slope; a millimetre-scale offset preserves foot contacts.
  sun.shadow.bias = -0.002 / (sun.shadow.camera.far - sun.shadow.camera.near);
  sun.shadow.normalBias = Math.min(0.008, texelMetres * 0.2);
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.needsUpdate = true;
  sun.userData.campusShadows?.update();
}

export function captureCampusEnvironment(scene, renderer, previous) {
  // Broad indirect fill; close glazing receives separate local probes.
  const cube = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
  const probe = new THREE.CubeCamera(1, 1800, cube);
  probe.position.set(0, 16, 9);
  const prior = renderer.getRenderTarget();
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    probe.update(renderer, scene);
    const target = pmrem.fromCubemap(cube.texture);
    scene.environment = target.texture;
    previous.dispose();
    return target;
  } finally {
    renderer.setRenderTarget(prior); cube.dispose(); pmrem.dispose();
  }
}

// Reconstruct normals from the actual depth buffer, preserving cut-out foliage.
const contactAO = {
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uResolution: { value: new THREE.Vector2() },
    uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uRadius: { value: 0.45 },
  },
  vertexShader: 'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
  fragmentShader: /* glsl */ `
    varying vec2 vUv;
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 uResolution;
    uniform mat4 uProj, uInvProj;
    uniform float uRadius;
    vec3 vp(vec2 uv){float d=texture2D(tDepth,uv).r;vec4 p=uInvProj*vec4(uv*2.-1.,d*2.-1.,1.);return p.xyz/p.w;}
    void main(){
      vec4 color=texture2D(tDiffuse,vUv);
      float d=texture2D(tDepth,vUv).r;
      if(d>=.99999){gl_FragColor=color;return;}
      vec2 px=1./uResolution;
      vec3 p=vp(vUv), pl=vp(vUv-vec2(px.x,0.)),pr=vp(vUv+vec2(px.x,0.));
      if(-p.z>65.){gl_FragColor=color;return;}
      vec3 pb=vp(vUv-vec2(0.,px.y)),pt=vp(vUv+vec2(0.,px.y));
      vec3 dx=abs(pr.z-p.z)<abs(p.z-pl.z)?pr-p:p-pl;
      vec3 dy=abs(pt.z-p.z)<abs(p.z-pb.z)?pt-p:p-pb;
      vec3 n=normalize(cross(dx,dy));
      float radius=min(64.,uRadius*uProj[1][1]*.5*uResolution.y/max(.1,-p.z));
      float angle=6.2831853*fract(dot(floor(gl_FragCoord.xy),vec2(.06711056,.00583715))*52.9829189);
      float occ=0.;
      for(int i=0;i<12;i++){
        float fi=(float(i)+.5)/12.,a=angle+float(i)*2.399963;
        vec2 sampleUV=vUv+vec2(cos(a),sin(a))*sqrt(fi)*radius*px;
        if(any(lessThan(sampleUV,vec2(0.)))||any(greaterThan(sampleUV,vec2(1.))))continue;
        vec3 v=vp(sampleUV)-p;
        float dist2=dot(v,v),falloff=max(0.,1.-dist2/(uRadius*uRadius));
        occ+=falloff*falloff*max(0.,dot(v,n)-max(.008,-p.z*.0003))/(dist2+.025);
      }
      // Distant depth precision cannot resolve centimetre-scale contact shadows.
      float fade=(1.-smoothstep(30.,65.,-p.z))*smoothstep(1.5,4.,radius);
      // shortcut: this post pass has no material separation; cap it at weak local contact only.
      float visibility=clamp(1.-occ*.065*fade,.88,1.);
      gl_FragColor=vec4(color.rgb*visibility,color.a);
    }`,
};

export function createPost(renderer, scene, camera) {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, samples: 2 });
  target.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const ao = new ShaderPass(contactAO); composer.addPass(ao);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.035, 0.18, 8.0); composer.addPass(bloom);
  composer.addPass(new OutputPass());
  const fxaa = new ShaderPass(FXAAShader); composer.addPass(fxaa);
  return {
    composer, ao, bloom,
    resize(w, h, preset) {
      ao.enabled = preset.ao; bloom.enabled = preset.bloom;
      for (const t of [composer.renderTarget1, composer.renderTarget2]) {
        if (t.samples !== preset.samples) { t.samples = preset.samples; t.dispose(); }
      }
      composer.setSize(w, h);
      ao.uniforms.uResolution.value.set(w, h);
      fxaa.uniforms.resolution.value.set(1 / w, 1 / h);
    },
    render() {
      ao.uniforms.tDepth.value = composer.readBuffer.depthTexture;
      ao.uniforms.uProj.value.copy(camera.projectionMatrix);
      ao.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
      composer.render();
    },
    dispose() {
      for (const pass of composer.passes) pass.dispose?.();
      composer.dispose();
    },
  };
}
