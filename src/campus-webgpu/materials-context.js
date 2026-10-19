import { Fn, attribute, cameraWorldMatrix, float, max, min, modelWorldMatrix, smoothstep, vec2, vec3, vec4 } from 'three/tsl';

const interval = (point, ray, center, halfHeight) => {
  const safe = ray.add(1e-7).sign().mul(max(ray.abs(), vec3(.00001)));
  const a = vec3(float(center).sub(.04), halfHeight.negate(), -.45).sub(point).div(safe);
  const b = vec3(float(center).add(.04), halfHeight, -.33).sub(point).div(safe);
  const near = min(a, b), far = max(a, b);
  return min(min(far.x, far.y), far.z).sub(max(max(max(near.x, near.y), near.z), .001));
};

export function applyRecessVisibility(material, object) {
  if (object && !['openingPoint', 'openingNormal', 'openingSize'].every(name => object.geometry.hasAttribute(name))) {
    throw new Error('Context recess is missing aperture attributes');
  }
  const visibility = Fn(([lightDirection]) => {
    const n = modelWorldMatrix.mul(vec4(attribute('openingNormal', 'vec3'), 0)).xyz.normalize();
    const tangent = vec3(0, 1, 0).cross(n).normalize();
    const world = lightDirection.transformDirection(cameraWorldMatrix);
    const ray = vec3(world.dot(tangent), world.y, world.dot(n));
    const point = attribute('openingPoint', 'vec3'), size = attribute('openingSize', 'vec2');
    const distance = point.z.negate().div(max(ray.z, .00001)), hit = point.xy.add(ray.xy.mul(distance));
    const margin = size.mul(.5).sub(hit.abs()), aa = max(hit.fwidth().mul(.5), vec2(.0001));
    const aperture = smoothstep(aa.x.negate(), aa.x, margin.x).mul(smoothstep(aa.y.negate(), aa.y, margin.y));
    const center = size.x.add(.08).div(6), halfHeight = size.y.mul(.5);
    const a = interval(point, ray, center.negate(), halfHeight), b = interval(point, ray, center, halfHeight);
    const aaA = max(a.fwidth().mul(.5), .0001), aaB = max(b.fwidth().mul(.5), .0001);
    const bars = smoothstep(aaA.negate(), aaA, a).oneMinus().mul(smoothstep(aaB.negate(), aaB, b).oneMinus());
    return point.z.greaterThanEqual(-.0001).select(1, ray.z.lessThanEqual(0).select(0, aperture.mul(bars)));
  });
  const setup = material.setupLightingModel.bind(material);
  material.setupLightingModel = (...args) => {
    const model = setup(...args), direct = model.direct.bind(model);
    model.direct = (input, builder) => direct({...input, lightColor: input.lightColor.mul(visibility(input.lightDirection))}, builder);
    return model;
  };
}
