import test from 'node:test';
import assert from 'node:assert/strict';
import { BoxGeometry, InstancedMesh, InstancedBufferAttribute, MeshPhysicalNodeMaterial, Matrix4, Vector3 } from 'three/webgpu';
import { createReflections, glassPlanes } from '../src/campus-webgpu/reflections.js';
import { probeRegions } from '../src/campus-webgpu/probes.js';
import { BUILDINGS } from '../src/campus/layout.js';

test('probe-only reflection mode never binds or renders the unused planar captures',()=>{
  const reflection=createReflections({renderer:{},scene:{},lighting:{},planar:false,
    materials:{glass:[{objects:[],material:{}}],setGlassReflection(){assert.fail('planar shader must not be installed');}}});
  try {
    reflection.update({});reflection.setEnabled(true);reflection.update({});
    assert.equal(reflection.stats.enabled,false);
    assert.equal(reflection.stats.updates,0);
    assert.equal(reflection.stats.mode,'parallax-probes');
  } finally {reflection.dispose();}
});

test('planar domains merge coplanar vision panes, exclude spandrels and point outside the building',()=>{
  const geometry=new BoxGeometry();
  geometry.setAttribute('paneType',new InstancedBufferAttribute(new Float32Array([0,0,1,0]),1));
  const material=new MeshPhysicalNodeMaterial(),mesh=new InstancedMesh(geometry,material,4);
  const m=new Matrix4();
  mesh.setMatrixAt(0,m.makeScale(.04,2,3).setPosition(-21,2,-20));
  mesh.setMatrixAt(1,m.makeScale(.04,2,3).setPosition(-21,2,-24));
  mesh.setMatrixAt(2,m.makeScale(.04,2,3).setPosition(-21,10,-24));
  mesh.setMatrixAt(3,m.makeScale(.04,2,3).setPosition(-41,2,-24));
  const planes=glassPlanes([{objects:[mesh]}]);
  assert.equal(planes.length,2);
  const east=planes.find(p=>p.normal.x>0),west=planes.find(p=>p.normal.x<0);
  assert.ok(east && west);
  assert.ok(Math.abs(east.point.x+20.98)<1e-5);assert.equal(east.bounds.max.y,3);
  assert.ok(east.plane.distanceToPoint(new Vector3(0,2,-24))>0);
  assert.ok(west.plane.distanceToPoint(new Vector3(-50,2,-24))>0);
  mesh.dispose();geometry.dispose();material.dispose();
});

test('baked probes stay above surfaces while coverage reaches paving and includes all planned regions',()=>{
  const plans=probeRegions();
  assert.deepEqual(plans.map(p=>p.id),['courtyards','arcade-a','arcade-c','cafe']);
  assert.equal(plans.reduce((sum,p)=>sum+p.resolution.reduce((a,b)=>a*b),0),907);
  for(const p of plans) {
    assert.ok(p.bounds.min.y>=.4);
    assert.ok(p.coverageBounds.min.y<0);
    assert.ok(p.coverageBounds.containsBox(p.bounds));
  }
  const courtyard=plans[0],point=new Vector3();
  for(let y=0;y<courtyard.resolution[1];y++)for(let z=0;z<courtyard.resolution[2];z++)for(let x=0;x<courtyard.resolution[0];x++) {
    const indices=[x,y,z];point.fromArray(courtyard.bounds.min.toArray().map((low,i)=>low+(courtyard.bounds.max.getComponent(i)-low)*indices[i]/(courtyard.resolution[i]-1)));
    assert.ok(!BUILDINGS.some(b=>Math.abs(point.x-b.x)<b.w/2 && Math.abs(point.z-b.z)<b.d/2 && point.y<b.floors*b.floorHeight),'courtyard probe intersects a building');
  }
});
