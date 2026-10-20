import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, DataTexture, DoubleSide, InstancedBufferAttribute, InstancedMesh, Matrix4, Mesh, MeshPhysicalMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { vec3, float } from 'three/tsl';
import { MeshSSSNodeMaterial } from 'three/webgpu';
import { buildBuildings } from '../src/campus/buildings.js';
import { buildingMaterials } from '../src/campus/building-materials.js';
import { createBarkMaterial } from '../src/campus/bark-material.js';
import { foliageMaterial } from '../src/campus/foliage-material.js';
import { createCampusMaterials } from '../src/campus-webgpu/materials.js';

test('the complete seven-building generator converts without mutating its source materials or geometry', () => {
  const root = buildBuildings(), factory = createCampusMaterials(), before = new Map();
  root.traverse(object => {
    if (object.material) before.set(object, {source: object.material, geometry: object.geometry, color: object.material.color.clone(), count: object.count});
  });
  factory.apply(root);
  assert.equal(root.userData.buildingCount, 7);
  for (const [object, original] of before) {
    assert.equal(object.geometry, original.geometry);
    assert.equal(object.count, original.count);
    assert.ok(object.material.isNodeMaterial);
    assert.notEqual(object.material, original.source);
    assert.ok(original.source.color.equals(original.color));
    assert.equal(object.material.vertexColors, original.source.vertexColors);
    assert.equal(object.material.map, original.source.map);
  }
  assert.equal(factory.glass.length, 4);
  assert.ok(factory.stats.categories.mineral > 0 && factory.stats.categories.foliage > 0);
  assert.ok([...before.keys()].some(object => object.material.name.startsWith('Jointed gallery limestone')));
  factory.dispose();
});

test('leaf cards retain alpha coverage, instance colour inputs, canopy normal and shadow-lit translucency', () => {
  const map = new DataTexture(new Uint8Array([80, 120, 40, 255]), 1, 1);
  const source = foliageMaterial({map, bend: .92, canopyVolume: true});
  const geometry = new PlaneGeometry();
  geometry.setAttribute('canopyNormal', new InstancedBufferAttribute(new Float32Array([0, 1, 0]), 3));
  geometry.setAttribute('canopyAO', new InstancedBufferAttribute(new Float32Array([.6]), 1));
  const object = new InstancedMesh(geometry, source, 1), factory = createCampusMaterials();
  object.setColorAt(0, new Color(.13, .21, .04));
  const instanceColor = object.instanceColor;
  const material = factory.convert(source, object);
  assert.equal(material.map, map);
  assert.equal(material.alphaTest, .36);
  assert.equal(material.side, DoubleSide);
  assert.ok(material instanceof MeshSSSNodeMaterial);
  assert.ok(material.thicknessColorNode.isNode && material.normalNode.isNode && material.aoNode.isNode);
  assert.equal(material.emissiveNode, null, 'thin leaves must not glow through emission');
  assert.equal(source.alphaTest, .36);
  assert.equal(object.instanceColor, instanceColor);
  assert.ok(Math.abs(instanceColor.array[1] - .21) < 1e-6);
  factory.dispose(); geometry.dispose(); map.dispose(); source.dispose();
});

test('bark preserves generated maps and derives per-instance UV repeats in metres', () => {
  const source = createBarkMaterial(), factory = createCampusMaterials();
  const make = (radius, length) => {
    const geometry = new PlaneGeometry();
    const mesh = new InstancedMesh(geometry, source, 1);
    mesh.setMatrixAt(0, new Matrix4().makeScale(radius, length, radius));
    return mesh;
  };
  const small = make(.3, 2.6), tall = make(.6, 5.2);
  const material = factory.convert(source, small), shared = factory.convert(source, tall);
  assert.equal(material, shared, 'same layout may share nodes while retaining distinct instance scales');
  assert.equal(material.map, source.map);
  assert.equal(material.normalMap, source.normalMap);
  assert.equal(material.roughnessMap, source.roughnessMap);
  for (const [mesh, expected] of [[small, [3, 2]], [tall, [6, 4]]]) {
    mesh.geometry.getAttribute('campusBarkRepeat').array.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-6));
  }
  assert.ok(material.normalNode.isNode && material.roughnessNode.isNode);
  factory.dispose(); small.geometry.dispose(); tall.geometry.dispose();
  for (const texture of [source.map, source.normalMap, source.roughnessMap]) texture.dispose();
  source.dispose();
});

test('physical coatings and inherited alpha-test accessors survive conversion', () => {
  const source = new MeshPhysicalMaterial({alphaTest: .27, clearcoat: .6, sheen: .3, transmission: .12, iridescence: .18, opacity: .7});
  const factory = createCampusMaterials(), material = factory.convert(source);
  for (const property of ['alphaTest', 'clearcoat', 'sheen', 'transmission', 'iridescence', 'opacity']) {
    assert.equal(material[property], source[property], property);
  }
  factory.dispose(); source.dispose();
});

test('glass reflection replaces its environment input without contaminating room radiance', () => {
  const source = buildingMaterials().glass, factory = createCampusMaterials();
  const material = factory.convert(source), room = material.emissiveNode, originalEnv = material.envNode;
  factory.setGlassReflection(material, {node: vec3(.3, .4, .5), weight: float(.5)});
  assert.notEqual(material.envNode, originalEnv);
  assert.equal(material.emissiveNode, room);
  assert.equal(material.metalness, 0);
  assert.equal(material.ior, 1.52);
  assert.equal(material.clearcoat, 0);
  assert.equal(source.clearcoat, .35, 'the old renderer material is untouched');
  assert.throws(() => factory.setGlassReflection(material, {node: null}), /radiance node/);
  factory.dispose();
});

test('room variation reuses shared room coordinates without rewriting legacy pane inputs', () => {
  const root = buildBuildings(), factory = createCampusMaterials(), snapshots = [], rooms = new Map();
  root.traverse(object => {
    if (!object.material?.userData.campusGlass) return;
    const attributes = object.geometry.attributes, detail = attributes.paneDetail, layout = attributes.paneRoom;
    snapshots.push({ object, attributes: Object.fromEntries(['paneDetail', 'paneRoom', 'paneSize', 'paneType']
      .map(name => [name, attributes[name].array.slice()])) });
    for (let index = 0; index < object.count; index++) {
      if (attributes.paneType.getX(index) !== 0) continue;
      const key = [detail.getY(index), detail.getZ(index), detail.getW(index), layout.getY(index), layout.getZ(index), layout.getW(index)].join(',');
      if (!rooms.has(key)) rooms.set(key, new Set());
      rooms.get(key).add(layout.getX(index));
    }
  });
  assert.ok([...rooms.values()].filter(panes => panes.size > 1).length > 100, 'production rooms span multiple panes');
  factory.apply(root);
  for (const { object, attributes } of snapshots) {
    for (const [name, values] of Object.entries(attributes)) assert.deepEqual(object.geometry.attributes[name].array, values);
    assert.ok(object.material.campusRoomNode.isNode);
    assert.equal(object.material.emissiveNode, null);
    assert.equal(object.material.emissive.getHex(), 0);
  }
  factory.dispose();
  root.traverse(object => { object.geometry?.dispose(); });
});

test('required glass attributes and unfamiliar shader hooks fail explicitly', () => {
  const source = buildingMaterials().glass, factory = createCampusMaterials();
  assert.throws(() => factory.convert(source, new Mesh(new PlaneGeometry(), source)), /missing paneDetail/);
  const unknown = new MeshStandardMaterial();
  unknown.name = 'new unsupported shader'; unknown.onBeforeCompile = shader => { shader.uniforms.extra = {value: 1}; };
  assert.throws(() => factory.convert(unknown), /Unmigrated material shader/);
  factory.dispose();
});

test('legacy closure textures are extracted once and shared without retaining shader hooks', () => {
  const source = new MeshStandardMaterial({vertexColors: true, roughness: .95, side: DoubleSide});
  const map = new DataTexture(new Uint8Array([80, 110, 30, 255]), 1, 1);
  source.name = 'campus-mown-turf'; let calls = 0;
  source.onBeforeCompile = shader => { calls++; shader.uniforms.uMownTurfMap = {value: map}; };
  const factory = createCampusMaterials(), material = factory.convert(source);
  assert.equal(factory.convert(source), material);
  assert.equal(calls, 1);
  assert.equal(factory.stats.extractedTextureUniforms, 1);
  assert.notEqual(material.onBeforeCompile, source.onBeforeCompile);
  assert.ok(material.colorNode.isNode);
  factory.dispose(); source.dispose();
});
