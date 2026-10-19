import { MeshPhysicalNodeMaterial, Vector3 } from 'three/webgpu';
import { copyMaterialProperties } from './materials-copy.js';
import {
  Fn, If, attribute, float, getGeometryRoughness, materialRoughness, max, min, mix, normalViewGeometry, pmremTexture,
  positionView, positionViewDirection, positionWorld, roughness, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

const transmission = cosine => float(.957).mul(float(1).sub(float(1).sub(cosine.clamp()).pow(5)));

class CampusGlassMaterial extends MeshPhysicalNodeMaterial {
  setupVariants(builder) {
    super.setupVariants(builder);
    // These 512px probes support the legacy .038 floor; retain geometric filtering.
    const surface = this.roughnessNode ? float(this.roughnessNode) : materialRoughness;
    roughness.assign(surface.max(.038).add(getGeometryRoughness()).min(1));
  }

  setupLightingModel() {
    const model = super.setupLightingModel(), room = this.campusRoomNode;
    const direct = model.direct.bind(model), indirect = model.indirect.bind(model);
    const exit = transmission(normalViewGeometry.dot(positionViewDirection).abs());
    const bulk = this.campusBulkTransmission ?? .65;
    model.direct = (input, builder) => {
      direct(input, builder);
      const cosine = normalViewGeometry.dot(input.lightDirection).max(0);
      const backing = room.rgb.mul(room.a).mul(exit).mul(transmission(cosine)).mul(bulk * bulk / Math.PI);
      input.reflectedLight.directDiffuse.addAssign(backing.mul(input.lightColor).mul(cosine));
    };
    model.indirect = builder => {
      indirect(builder);
      const incident = builder.context.irradiance.add(builder.context.iblIrradiance).max(0);
      builder.context.reflectedLight.indirectDiffuse.addAssign(room.rgb.mul(room.a).mul(incident).mul(exit).mul(bulk * bulk * .957 * 20 / 21 / Math.PI));
    };
    return model;
  }
}

export function createGlassMaterial(source, context = false) {
  const material = new CampusGlassMaterial();
  copyMaterialProperties(material, source);
  material.color.set(0x000000);
  material.metalness = 0;
  material.ior = 1.52;
  material.emissive.set(0x000000);
  // A single dielectric interface avoids an unexplained second varnish coat.
  material.clearcoat = 0;
  if (context) {
    material.campusBulkTransmission = .86;
    material.campusRoomNode = vec4(.09, .095, .09, 1);
    return material;
  }
  const detail = attribute('paneDetail', 'vec4'), size = attribute('paneSize', 'vec2');
  const layout = attribute('paneRoom', 'vec4'), vision = attribute('paneType', 'float').lessThan(.5);
  const dx = positionView.dFdx(), dy = positionView.dFdy(), ux = uv().dFdx(), uy = uv().dFdy();
  const orientation = ux.x.mul(uy.y).sub(ux.y.mul(uy.x)).sign();
  const tangent = dx.mul(uy.y).sub(dy.mul(ux.y)).mul(orientation).normalize();
  const vertical = dy.mul(ux.x).sub(dx.mul(uy.x)).mul(orientation).normalize();
  const incident = positionView.normalize();
  const ray = vec3(incident.dot(tangent), incident.dot(vertical), max(.03, incident.dot(normalViewGeometry).abs()).negate()).normalize();
  const room = Fn(() => {
    const depth = detail.z.mul(2.8).add(3.8);
    const low = vec3(layout.y.mul(-.5), layout.z.negate(), depth.negate());
    const high = vec3(layout.y.mul(.5), layout.w, 0);
    const origin = vec3(uv().sub(.5).mul(size).add(vec2(layout.x, 0)), -.01);
    const safeRay = ray.add(1e-7).sign().mul(max(ray.abs(), vec3(1e-4)));
    const exit = max(low.sub(origin).div(safeRay), high.sub(origin).div(safeRay));
    const distance = min(exit.x, min(exit.y, exit.z)), hit = origin.add(ray.mul(distance));
    const result = vec4(mix(vec3(.17, .18, .17), vec3(.23, .20, .16), detail.y).mul(detail.w.mul(.15).add(.43)), 0).toVar();
    If(exit.y.lessThan(min(exit.x, exit.z)), () => {
      If(ray.y.greaterThan(0), () => {
        const grid = hit.xz.div(.6).fract().sub(.5).abs();
        result.rgb.assign(vec3(.145, .15, .142).mul(float(1).sub(smoothstep(.47, .5, max(grid.x, grid.y)).mul(.12))));
        const lightCell = hit.xz.div(vec2(1.8, 2.4)).fract().sub(.5).abs();
        const panel = smoothstep(.12, .15, lightCell.x).oneMinus().mul(smoothstep(.2, .23, lightCell.y).oneMinus());
        result.rgb.addAssign(vec3(.2, .19, .16).mul(panel).mul(detail.w.greaterThan(.86).select(1, 0)));
      }).Else(() => {
        result.rgb.assign(mix(vec3(.045, .052, .048), vec3(.085, .070, .048), detail.y));
        const floorTile = hit.xz.div(.8).fract().sub(.5).abs();
        result.rgb.mulAssign(float(1).sub(smoothstep(.47, .5, max(floorTile.x, floorTile.y)).mul(.08)));
      });
    }).ElseIf(exit.z.lessThanEqual(exit.x), () => {
      const door = hit.x.sub(detail.z.sub(.5).mul(layout.y)).abs().lessThan(.38).and(hit.y.lessThan(low.y.add(2.15)));
      result.rgb.mulAssign(door.select(.4, 1));
      result.rgb.mulAssign(float(1).sub(smoothstep(low.y.add(.1), low.y.add(.16), hit.y).oneMinus().mul(.45)));
    }).Else(() => { result.rgb.mulAssign(.74); });
    const deskDistance = low.y.add(.74).sub(origin.y).div(safeRay.y), desk = origin.add(ray.mul(deskDistance));
    If(deskDistance.greaterThan(0).and(deskDistance.lessThan(distance)).and(desk.x.abs().lessThan(layout.y.mul(.37)))
      .and(desk.z.lessThan(-1.6)).and(desk.z.greaterThan(-2.5)), () => { result.rgb.assign(vec3(.18, .145, .095)); });
    result.rgb.mulAssign(max(hit.z.negate().sub(.4), 0).mul(-.18).exp().mul(.82).add(.18));
    const blindDistance = float(-.18).sub(origin.z).div(safeRay.z), blindHit = origin.add(ray.mul(blindDistance));
    const coverage = max(detail.x.sub(.68), 0).mul(2.5), blindY = blindHit.y.div(size.y).add(.5);
    const phase = blindHit.y.div(.035), aa = smoothstep(.25, .8, phase.fwidth()).oneMinus();
    If(blindDistance.greaterThan(0).and(blindDistance.lessThan(distance)).and(blindHit.x.sub(layout.x).abs().lessThan(size.x.mul(.5)))
      .and(blindY.greaterThan(coverage.oneMinus())).and(blindY.lessThan(1)), () => {
      result.rgb.assign(mix(vec3(.22, .23, .21), vec3(.28, .265, .22), detail.y).mul(phase.mul(Math.PI * 2).sin().mul(aa).mul(.14).add(.86)));
      result.a.assign(1);
    });
    result.rgb.mulAssign(detail.w.mul(.36).add(.56));
    return vision.select(result, vec4(0));
  })();
  material.campusRoomNode = room;
  // Art-directed room bounce: keep normal-facing rooms legible without brightening blinds or spandrels.
  material.emissiveNode = room.rgb.mul(room.a.oneMinus()).mul(transmission(incident.dot(normalViewGeometry).abs())).mul(vec3(.90, .97, .94)).mul(.18);
  material.roughnessNode = float(source.roughness).mul(detail.x.mul(.2).add(.9));
  const bow = uv().mul(Math.PI * 2).add(detail.xy.mul(4)).sin().mul(vec2(.0012, .0018)).add(detail.xy.sub(.5).mul(.0008));
  const visible = smoothstep(.15, .45, max(uv().x.fwidth(), uv().y.fwidth())).oneMinus();
  material.normalNode = normalViewGeometry.add(tangent.mul(bow.x).add(vertical.mul(bow.y)).mul(visible)).normalize();
  material.userData.webgpuPending = ['Room interiors retain the calibrated ray-box lighting approximation; geometric interior refraction is not simulated.'];
  return material;
}

export function glassEnvironment(material, source, reflection = null) {
  const metadata = source.userData.campusGlass;
  const probe = metadata ? uniform(new Vector3(...metadata.probe.position)) : null;
  const low = metadata ? uniform(metadata.uniforms.uCampusProbeMin.value.clone()) : null;
  const high = metadata ? uniform(metadata.uniforms.uCampusProbeMax.value.clone()) : null;
  return Fn(builder => {
    const image = material.envMap || builder.scene.environment;
    if (!image) return vec3(0);
    const direction = builder.context.getUV(), level = builder.context.getTextureLevel();
    let lookup = direction;
    if (probe && material.envMap) {
      const safe = direction.add(1e-7).sign().mul(max(direction.abs(), vec3(1e-4)));
      const distance = max(low.sub(positionWorld).div(safe), high.sub(positionWorld).div(safe));
      const hit = positionWorld.add(direction.mul(max(0, min(distance.x, min(distance.y, distance.z)))));
      const finite = smoothstep(.1, .45, direction.y).oneMinus().mul(level.lessThan(.99).select(1, 0));
      lookup = mix(direction, hit.sub(probe).normalize(), finite).normalize();
    }
    const base = pmremTexture(image, lookup, level);
    if (!reflection) return base;
    const weight = float(reflection.weight ?? 1).mul(level.lessThan(.99).select(1, 0));
    return mix(base, reflection.node.rgb, weight.clamp());
  })();
}
