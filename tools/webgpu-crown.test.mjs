import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { buildCampusBroadleaf } from '../src/campus/whole-tree.js';
import { sampleBranch } from '../src/world/vegetation-tree.js';

const tree={x:4,z:-21,height:7,radius:2.8,ground:.15};
const space={seed:'refinement-connectivity',height:7,radius:2.8,clearance:2};
const field=()=>({c:new Vector3(4,4,-21),r:new Vector3(3,3,3)});

test('refined crowns keep leaf bases attached to living petioles and preserve clearance',()=>{
  const plan=buildCampusBroadleaf(tree,field,space,{refined:true});
  assert.ok(plan.leaves.length>100);
  assert.ok(plan.branches.length>100);
  const position=new Vector3();
  for(let i=0;i<plan.leaves.length;i++) {
    const binding=plan.bindings[i],petiole=plan.branches[binding.petiole];
    assert.ok(petiole.petiole);
    position.setFromMatrixPosition(plan.leaves[i].matrix);
    assert.ok(position.distanceTo(petiole.pts.at(-1))<1e-9);
    assert.ok(petiole.pts[0].distanceTo(sampleBranch(plan.branches[binding.parent],binding.t).p)<1e-9);
    assert.ok(position.y>tree.ground+space.clearance);
    assert.ok(position.toArray().every(Number.isFinite));
    assert.ok(Math.hypot(position.x-tree.x,position.z-tree.z)<tree.radius*1.3);
  }
});

test('crown refinement is deterministic and leaves the legacy default generation intact',()=>{
  const original=buildCampusBroadleaf(tree,field,space);
  const disabled=buildCampusBroadleaf(tree,field,space,{refined:false});
  assert.deepEqual(original.stats,disabled.stats);
  assert.deepEqual(original.leaves.map(l=>l.matrix.elements),disabled.leaves.map(l=>l.matrix.elements));
  const first=buildCampusBroadleaf(tree,field,space,{refined:true});
  const second=buildCampusBroadleaf(tree,field,space,{refined:true});
  assert.deepEqual(first.stats,second.stats);
  assert.deepEqual(first.leaves.map(l=>[l.matrix.elements,l.color.toArray()]),second.leaves.map(l=>[l.matrix.elements,l.color.toArray()]));
  assert.notDeepEqual(first.stats,original.stats);
});

test('varied neighbours keep their footprints and bake occluders aligned with every roof', async t=>{
  const { Mesh, PlaneGeometry, MeshStandardMaterial }=await import('three');
  const { buildContextDistricts, CONTEXT_DISTRICTS }=await import('../src/campus/context-districts.js');
  const terrain=new Mesh(new PlaneGeometry(4000,4000).rotateX(-Math.PI/2),new MeshStandardMaterial());
  const context=buildContextDistricts(terrain,{refined:true});
  t.after(()=>{
    const geometries=new Set([terrain.geometry]),materials=new Set([terrain.material]);
    context.object.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);materials.add(o.material);}});
    for(const value of [...geometries,...materials])value.dispose();context.landuse.texture.dispose();
  });
  assert.equal(context.buildings.length,10);
  assert.equal(new Set(context.buildings.filter(b=>b.district==='research').map(b=>b.height)).size,4);
  const source=CONTEXT_DISTRICTS.flatMap(d=>d.buildings);
  for(const building of context.buildings) {
    const original=source.find(b=>b[0]===building.id);
    assert.deepEqual([building.x,building.z,building.w,building.d],original.slice(1,5));
    const caster=context.casters.find(c=>c.id===building.id);
    assert.equal(caster.max[1],building.base+building.height);
    for(const opening of context.object.userData.recessOpenings.filter(o=>o.building===building.id)) {
      assert.ok(opening.center[1]+opening.height/2<caster.max[1]);
      assert.ok(opening.center[1]-opening.height/2>building.base);
    }
  }
});
