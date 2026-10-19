import * as THREE from 'three';

// Thin foliage shares the actual sun and shadow visibility with the rest of the scene.
export function foliageMaterial({ map = null, bend = 0.2, veins = false, canopyVolume = false } = {}) {
  const material = new THREE.MeshStandardMaterial({ color:0xffffff, map, roughness:0.76, side:THREE.DoubleSide, alphaTest:map?0.36:0, envMapIntensity:0.7 });
  // Thin leaf surfaces transmit opposite-side diffuse light; crown cards represent whole volumes.
  const leafSkyTransmission = !map && !canopyVolume ? { value: 0.25 } : null;
  if (leafSkyTransmission) material.userData.leafSkyTransmission = leafSkyTransmission;
  material.onBeforeCompile = shader => {
    if (leafSkyTransmission) shader.uniforms.uCampusLeafSkyTransmission = leafSkyTransmission;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',`#include <common>
        attribute vec3 canopyNormal; attribute float canopyAO;
        varying vec3 vCanopyNormal; varying float vCanopyAO; varying vec2 vFoliageUV;
      `)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
        vCanopyNormal=canopyNormal;vCanopyAO=canopyAO;vFoliageUV=uv;
      `);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',`#include <common>
        varying vec3 vCanopyNormal; varying float vCanopyAO; varying vec2 vFoliageUV;
        vec3 foliageFaceNormal;
        ${leafSkyTransmission ? 'uniform float uCampusLeafSkyTransmission;' : ''}
      `)
      .replace('#include <color_fragment>',`#include <color_fragment>
        ${veins?`float midrib=1.0-smoothstep(0.012,0.025+fwidth(vFoliageUV.x),abs(vFoliageUV.x-0.5));
        diffuseColor.rgb*=(0.95+vFoliageUV.y*0.08)*(1.0+midrib*0.11);`:''}
      `)
      .replace('#include <normal_fragment_maps>',`#include <normal_fragment_maps>
        ${veins?`// Sub-millimetre raised veins change reflected light without adding leaf triangles.
        vec2 leafFootprint=fwidth(vFoliageUV);
        float leafAcross=abs(vFoliageUV.x-0.5);
        float leafRib=exp2(-leafAcross*leafAcross*7500.0)*(1.0-smoothstep(0.006,0.035,leafFootprint.x));
        float leafVeinPhase=abs(fract(vFoliageUV.y*7.0-leafAcross*2.8)-0.5);
        float leafSideVeins=(1.0-smoothstep(0.025,0.09,leafVeinPhase))*smoothstep(0.015,0.10,leafAcross)*(1.0-smoothstep(0.37,0.5,leafAcross));
        float leafHeight=(leafRib*0.00020+leafSideVeins*0.000055)*(1.0-smoothstep(0.025,0.11,max(leafFootprint.x,leafFootprint.y)))*smoothstep(0.0,0.08,vFoliageUV.y)*(1.0-smoothstep(0.88,1.0,vFoliageUV.y));
        vec3 leafDx=dFdx(-vViewPosition),leafDy=dFdy(-vViewPosition);
        vec3 leafR1=cross(leafDy,normal),leafR2=cross(normal,leafDx);
        float leafDet=dot(leafDx,leafR1);vec2 leafDh=vec2(dFdx(leafHeight),dFdy(leafHeight));
        if(abs(leafDet)>1e-12)normal=normalize(abs(leafDet)*normal-sign(leafDet*faceDirection)*(leafDh.x*leafR1+leafDh.y*leafR2));`:''}
        foliageFaceNormal=normal;
        vec3 canopyViewNormal=normalize(mat3(viewMatrix)*vCanopyNormal);
        ${canopyVolume?`// Cards sample a crown volume: its outward normal must not follow a two-sided card or the camera.
        normal=normalize(mix(normal,canopyViewNormal,${bend.toFixed(2)}));
        foliageFaceNormal=canopyViewNormal;`:`if(dot(canopyViewNormal,normal)<0.0)canopyViewNormal=-canopyViewNormal;
        normal=normalize(mix(normal,canopyViewNormal,${bend.toFixed(2)}));
        ${leafSkyTransmission ? 'foliageFaceNormal=normal;' : ''}`}
      `)
      .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
        float foliageAO=clamp(vCanopyAO,0.32,1.0);
        reflectedLight.indirectDiffuse*=foliageAO;
        reflectedLight.indirectSpecular*=foliageAO*0.7;
        ${leafSkyTransmission ? `if(uCampusLeafSkyTransmission>0.0) {
          vec3 foliageBackIrradiance=vec3(0.0);
          #if defined(USE_ENVMAP) && defined(ENVMAP_TYPE_CUBE_UV)
            foliageBackIrradiance=getIBLIrradiance(-foliageFaceNormal);
          #endif
          // The optional courtyard GI wrapper replaces this fallback using its existing volume weight.
          /* CAMPUS_LEAF_BACK_IRRADIANCE */
          reflectedLight.indirectDiffuse+=foliageBackIrradiance*diffuseColor.rgb*vec3(1.05,1.12,0.7)*foliageAO*clamp(uCampusLeafSkyTransmission,0.0,1.0)*RECIPROCAL_PI;
        }` : ''}
        #if NUM_DIR_LIGHTS > 0
          vec3 foliageSun=directionalLights[0].color;
          vec3 foliageL=directionalLights[0].direction;
          float foliageVisible=clamp(dot(directLight.color,vec3(0.3333))/max(dot(foliageSun,vec3(0.3333)),0.0001),0.0,1.0);
          #if defined(CAMPUS_SOFT_SHADOWS) && defined(USE_SHADOWMAP) && NUM_DIR_LIGHT_SHADOWS > 0
            vec4 foliageShadowCoord=vDirectionalShadowCoord[0];
            foliageShadowCoord.z-=0.25/max(uCampusShadowDepthRange,1.0)*foliageShadowCoord.w;
            float foliageLeak=campusLeafTransmissionShadow(directionalShadowMap[0],directionalLightShadows[0].shadowMapSize,directionalLightShadows[0].shadowIntensity,directionalLightShadows[0].shadowBias,directionalLightShadows[0].shadowRadius,foliageShadowCoord);
            foliageVisible=max(foliageVisible,foliageLeak*0.28*foliageAO);
          #endif
          float foliageBack=max(dot(-foliageFaceNormal,foliageL),0.0);
          // A single leaf intercepts vanishing sunlight at grazing incidence.
          float foliageForward=pow(max(dot(-geometryViewDir,foliageL),0.0),6.0)*smoothstep(-0.2,0.25,dot(-foliageFaceNormal,foliageL))${leafSkyTransmission ? '*foliageBack' : ''};
          vec3 foliageTransmission=diffuseColor.rgb*vec3(1.05,1.12,0.7);
          reflectedLight.directDiffuse+=foliageSun*foliageTransmission*foliageVisible*(0.45*foliageBack+0.65*foliageForward)*RECIPROCAL_PI;
        #endif
      `);
  };
  material.customProgramCacheKey=()=>`campus-foliage-daylight-veins-sky-v5-${bend}-${veins}-${!!map}-${canopyVolume}`;
  return material;
}
