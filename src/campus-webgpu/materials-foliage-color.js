import { BufferAttribute } from 'three/webgpu';
import { uniform } from 'three/tsl';

// Keep 82% of the original within-batch variation; the RGB mean stays unchanged.
export const foliageColorContrast = uniform(.82);

export function prepareFoliageColors(object, source) {
  if (source.map || !object?.isInstancedMesh || !object.instanceColor || !object.count) return;
  const geometry = object.geometry;
  if (geometry.hasAttribute('campusFoliageMean')) return;
  const mean = [0, 0, 0], colors = object.instanceColor;
  for (let i = 0; i < object.count; i++) {
    mean[0] += colors.getX(i); mean[1] += colors.getY(i); mean[2] += colors.getZ(i);
  }
  for (let channel = 0; channel < 3; channel++) mean[channel] /= object.count;
  // Source batches already own their geometry. A tiny vertex attribute also survives
  // the GPU visibility geometry clone, without another per-instance gather stream.
  const data = new Float32Array(geometry.attributes.position.count * 3);
  for (let i = 0; i < data.length; i += 3) data.set(mean, i);
  geometry.setAttribute('campusFoliageMean', new BufferAttribute(data, 3));
}
