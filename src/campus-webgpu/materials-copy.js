// Keep accessor-backed properties (alphaTest, clearcoat, transmission, …) while
// excluding legacy userData, which contains texture/uniform graphs, from JSON copy.
export function copyMaterialProperties(target, source) {
  const properties = Object.create(source);
  properties.userData = {};
  target.copy(properties);
  // Three's NodeMaterial.copy only inspects setters on the immediate prototype.
  // Material.alphaTest and setters inherited by our glass subclass need copying too.
  const copied = new Set(['type']);
  for (let prototype = Object.getPrototypeOf(target); prototype !== Object.prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if (copied.has(key) || !descriptor.get || !descriptor.set) continue;
      copied.add(key);
      if (source[key] !== undefined) target[key] = source[key];
    }
  }
  return target;
}
