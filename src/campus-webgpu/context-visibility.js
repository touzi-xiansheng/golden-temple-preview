import { Vector4 } from 'three/webgpu';
import { Fn, If, float, mix, positionWorld, texture, uniform, vec2 } from 'three/tsl';
import { bakeContextVisibility } from '../campus/context-visibility.js';

export function createContextVisibility(landscape, lighting) {
  const context = landscape.userData.contextDistricts;
  const atlas = bakeContextVisibility(context, lighting.sunDirectionNode.value.toArray());
  const regions = atlas.regions.map(region => ({
    bounds: uniform(new Vector4(region.bounds[0], region.bounds[2],
      region.bounds[1] - region.bounds[0], region.bounds[3] - region.bounds[2])),
    tile: uniform(new Vector4(...region.atlas)),
  }));
  const visibility = Fn(() => {
    const lookup = vec2(0).toVar(), covered = float(0).toVar();
    for (const {bounds, tile} of regions) {
      const uv = positionWorld.xz.sub(bounds.xy).div(bounds.zw);
      If(uv.x.greaterThanEqual(0).and(uv.y.greaterThanEqual(0))
        .and(uv.x.lessThanEqual(1)).and(uv.y.lessThanEqual(1)), () => {
        lookup.assign(tile.xy.add(uv.mul(tile.zw))); covered.assign(1);
      });
    }
    // Sample outside branches so mip derivatives remain defined; shared campus
    // materials outside the three districts retain full direct visibility.
    return mix(1, texture(atlas.texture, lookup).r, covered);
  })();
  const originals = new Map();
  for (const material of new Set(context.receivers.map(mesh => mesh.material))) {
    const original = material.setupLightingModel;
    material.setupLightingModel = function(...args) {
      const model = original.apply(this, args), direct = model.direct.bind(model);
      model.direct = (input, builder) => direct(input.lightNode.light === lighting.sun
        ? {...input, lightColor: input.lightColor.mul(visibility)} : input, builder);
      return model;
    };
    originals.set(material, {original, wrapper: material.setupLightingModel});
    material.needsUpdate = true;
  }
  let disposed = false;
  return {stats: atlas.stats, texture: atlas.texture, regions: atlas.regions,
    dispose() {
      if (disposed) return; disposed = true;
      for (const [material, {original, wrapper}] of originals) {
        if (material.setupLightingModel === wrapper) {
          material.setupLightingModel = original; material.needsUpdate = true;
        }
      }
      atlas.texture.dispose();
    }};
}
