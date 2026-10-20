import { Color, MeshPhysicalNodeMaterial, Vector3 } from 'three/webgpu';
import { copyMaterialProperties } from './materials-copy.js';
import {
  Fn, If, attribute, float, getGeometryRoughness, materialRoughness, max, min, mix, normalViewGeometry, pmremTexture,
  positionView, positionViewDirection, positionWorld, roughness, smoothstep, uniform, uv, vec2, vec3, vec4,
} from 'three/tsl';

const transmission = cosine => float(.957).mul(float(1).sub(float(1).sub(cosine.clamp()).pow(5)));
export const roomDaylightGain = uniform(.65);
export const spandrelBackingStrength = uniform(1);
// Source Insulated spandrel backing: linear #50646b diffuse share, metalness .3.
// Only the diffuse backing is approximated; the outer glass owns the reflection.
const spandrelDiffuse = uniform(new Color('#50646b').multiplyScalar(1 - .3));

const periodicBand = (coordinate, inner, outer) => {
  const footprint = coordinate.fwidth().max(1e-5), halfPixel = footprint.mul(.5);
  const band = smoothstep(float(inner).sub(halfPixel), float(outer).add(halfPixel), coordinate.fract().sub(.5).abs()).oneMinus();
  return mix(inner + outer, band, smoothstep(.25, .75, footprint).oneMinus());
};
const periodicSine = phase => phase.mul(Math.PI * 2).sin().mul(smoothstep(.25, .5, phase.fwidth()).oneMinus());

class CampusGlassMaterial extends MeshPhysicalNodeMaterial {
  setupVariants(builder) {
    super.setupVariants(builder);
    // Local probes are at least 512px; retain the legacy floor and geometric filtering.
    const surface = this.roughnessNode ? float(this.roughnessNode) : materialRoughness;
    roughness.assign(surface.max(.038).add(getGeometryRoughness()).min(1));
  }

  setupLightingModel() {
    const model = super.setupLightingModel(), room = this.campusRoomNode;
    const direct = model.direct.bind(model), indirect = model.indirect.bind(model);
    const exit = transmission(normalViewGeometry.dot(positionViewDirection).abs());
    const bulk = this.campusBulkTransmission ?? .65;
    // Ray-box surfaces approximate a room's aggregate diffuse response. Blinds
    // remain at the aperture; rooms retain their existing depth/material falloff.
    const response = room.rgb.mul(mix(roomDaylightGain, 1, room.a))
      .mul(mix(vec3(.90, .97, .94), vec3(1), room.a));
    model.direct = (input, builder) => {
      direct(input, builder);
      const cosine = normalViewGeometry.dot(input.lightDirection).max(0);
      const backing = response.mul(exit).mul(transmission(cosine)).mul(bulk * bulk / Math.PI);
      input.reflectedLight.directDiffuse.addAssign(backing.mul(input.lightColor).mul(cosine));
    };
    model.indirect = builder => {
      indirect(builder);
      const incident = builder.context.irradiance.add(builder.context.iblIrradiance).max(0);
      builder.context.reflectedLight.indirectDiffuse.addAssign(response.mul(incident).mul(exit).mul(bulk * bulk * .957 * 20 / 21 / Math.PI));
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
    // y/z/w are shared by a room's panes; x intentionally remains a per-pane blind.
    const office = detail.z.lessThan(.3933), meeting = detail.z.lessThan(.6067);
    const result = vec4(mix(vec3(.38, .40, .37), vec3(.46, .405, .33), detail.y), 0).toVar();
    const surfaceDistance = distance.toVar(), surfaceDepth = hit.z.negate().toVar();
    // Evaluate derivatives before divergent room-face branches; unresolved repeats converge to their coverage mean.
    const ceilingCell = hit.xz.div(.6), floorCell = hit.xz.div(.8), lightCell = hit.xz.div(vec2(1.8, 2.4));
    const ceilingJoint = periodicBand(ceilingCell.x, .47, .5).mul(periodicBand(ceilingCell.y, .47, .5)).oneMinus().toVar();
    const floorJoint = periodicBand(floorCell.x, .47, .5).mul(periodicBand(floorCell.y, .47, .5)).oneMinus().toVar();
    const ceilingPanel = periodicBand(lightCell.x, .12, .15).mul(periodicBand(lightCell.y, .2, .23)).toVar();
    If(exit.y.lessThan(min(exit.x, exit.z)), () => {
      If(ray.y.greaterThan(0), () => {
        result.rgb.assign(vec3(.43, .44, .415).mul(float(1).sub(ceilingJoint.mul(.07))));
        // An unlit diffuser is a pale reflecting surface, never an emissive lamp.
        result.rgb.assign(mix(result.rgb, vec3(.58, .57, .52), ceilingPanel.mul(detail.w.greaterThan(.86).select(1, 0))));
      }).Else(() => {
        result.rgb.assign(mix(vec3(.11, .125, .115), vec3(.19, .15, .10), detail.y));
        result.rgb.mulAssign(float(1).sub(floorJoint.mul(.08)));
      });
    }).ElseIf(exit.z.lessThanEqual(exit.x), () => {
      const doorX = layout.y.mul(detail.y.lessThan(.5).select(-.33, .33));
      const door = hit.x.sub(doorX).abs().lessThan(.38).and(hit.y.lessThan(low.y.add(2.15)));
      result.rgb.assign(mix(result.rgb, vec3(.12, .095, .065), door.select(1, 0)));
      const panel = hit.x.add(doorX.mul(.45)).abs().lessThan(layout.y.mul(.24))
        .and(hit.y.greaterThan(low.y.add(1.15))).and(hit.y.lessThan(low.y.add(2.05))).and(door.not());
      result.rgb.assign(mix(result.rgb, office.select(vec3(.21, .24, .21), meeting.select(vec3(.50, .51, .47), vec3(.18, .23, .20))), panel.select(1, 0)));
      result.rgb.mulAssign(float(1).sub(smoothstep(low.y.add(.1), low.y.add(.16), hit.y).oneMinus().mul(.45)));
    }).Else(() => { result.rgb.mulAssign(.74); });
    const deskHeight = meeting.select(.74, .43);
    const deskDistance = low.y.add(deskHeight).sub(origin.y).div(safeRay.y), desk = origin.add(ray.mul(deskDistance));
    const deskWidth = office.select(layout.y.mul(.38), meeting.select(min(layout.y.mul(.36), 1.5), min(layout.y.mul(.25), .65)));
    const deskNear = office.select(-1.6, meeting.select(-1.4, -1.25)), deskFar = office.select(-2.45, meeting.select(-3.15, -1.9));
    If(deskDistance.greaterThan(0).and(deskDistance.lessThan(surfaceDistance)).and(desk.x.abs().lessThan(deskWidth))
      .and(office.not().or(desk.x.abs().greaterThan(.12))).and(desk.z.lessThan(deskNear)).and(desk.z.greaterThan(deskFar)), () => {
      result.rgb.assign(office.select(vec3(.26, .205, .13), meeting.select(vec3(.31, .27, .20), vec3(.17, .13, .08))));
      surfaceDistance.assign(deskDistance); surfaceDepth.assign(desk.z.negate());
    });
    const seatZ = office.select(-2.7, meeting.select(-3.4, -2.35));
    const seatDistance = seatZ.sub(origin.z).div(safeRay.z), seat = origin.add(ray.mul(seatDistance));
    const seatX = office.select(seat.x.abs().sub(layout.y.mul(.22)).abs().lessThan(.23),
      meeting.select(seat.x.abs().lessThan(.28), seat.x.abs().lessThan(min(layout.y.mul(.35), 1.3))));
    If(seatDistance.greaterThan(0).and(seatDistance.lessThan(surfaceDistance)).and(seatX)
      .and(seat.y.greaterThan(low.y.add(.43))).and(seat.y.lessThan(low.y.add(meeting.select(1.12, .92)))), () => {
      result.rgb.assign(office.select(vec3(.075, .085, .08), meeting.select(vec3(.13, .11, .085), vec3(.15, .19, .165))));
      surfaceDepth.assign(seatZ.negate());
    });
    result.rgb.mulAssign(max(surfaceDepth.sub(.4), 0).mul(-.18).exp().mul(.82).add(.18));
    const curtainDistance = float(-.24).sub(origin.z).div(safeRay.z), curtain = origin.add(ray.mul(curtainDistance));
    const fold = periodicSine(curtain.x.div(.045)).toVar();
    If(detail.w.greaterThan(.72).and(curtainDistance.greaterThan(0)).and(curtainDistance.lessThan(distance))
      .and(curtain.x.abs().greaterThan(layout.y.mul(.5).sub(detail.z.mul(.35).add(.25))))
      .and(curtain.y.greaterThan(low.y.add(.04))).and(curtain.y.lessThan(high.y.sub(.08))), () => {
      result.rgb.assign(mix(vec3(.38, .40, .365), vec3(.45, .405, .32), detail.y)
        .mul(fold.mul(.08).add(.92)));
      result.a.assign(1);
    });
    const blindDistance = float(-.18).sub(origin.z).div(safeRay.z), blindHit = origin.add(ray.mul(blindDistance));
    const coverage = max(detail.x.sub(.68), 0).mul(2.5), blindY = blindHit.y.div(size.y).add(.5);
    const slat = periodicSine(blindHit.y.div(.035)).toVar();
    If(blindDistance.greaterThan(0).and(blindDistance.lessThan(distance)).and(blindHit.x.sub(layout.x).abs().lessThan(size.x.mul(.5)))
      .and(blindY.greaterThan(coverage.oneMinus())).and(blindY.lessThan(1)), () => {
      result.rgb.assign(mix(vec3(.22, .23, .21), vec3(.28, .265, .22), detail.y).mul(slat.mul(.035).add(.86)));
      result.a.assign(1);
    });
    result.rgb.mulAssign(mix(detail.w.mul(.12).add(.88), detail.w.mul(.36).add(.56), result.a));
    return vision.select(result, vec4(spandrelDiffuse.mul(spandrelBackingStrength.clamp()), 1));
  })();
  material.campusRoomNode = room;
  material.emissiveNode = null;
  material.roughnessNode = float(source.roughness).mul(detail.x.mul(.2).add(.9));
  const bow = uv().mul(Math.PI * 2).add(detail.xy.mul(4)).sin().mul(vec2(.0012, .0018)).add(detail.xy.sub(.5).mul(.0008));
  const visible = smoothstep(.15, .45, max(uv().x.fwidth(), uv().y.fwidth())).oneMinus();
  material.normalNode = normalViewGeometry.add(tangent.mul(bow.x).add(vertical.mul(bow.y)).mul(visible)).normalize();
  material.userData.webgpuPending = ['Room daylight uses an incident-light-driven ray-box diffuse approximation; geometric interior refraction and multi-bounce transport are not simulated.'];
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
