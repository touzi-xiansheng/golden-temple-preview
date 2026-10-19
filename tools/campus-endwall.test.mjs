import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Raycaster, Vector3 } from 'three';
import { buildBuildings } from '../src/campus/buildings.js';
import { BUILDINGS } from '../src/campus/layout.js';

test('office end elevations have open reveals, held glazing and shared two-light rooms', () => {
  const architecture=buildBuildings(); architecture.updateMatrixWorld(true);
  const wallGroup=architecture.getObjectByName('Office end elevations');
  assert.equal(wallGroup?.children.length,1);
  const wallMesh=wallGroup.children[0], panes=[];
  architecture.traverse(mesh=>{
    if(!mesh.material?.userData.campusGlass)return;
    for(let i=0;i<mesh.count;i++) {
      const matrix=new Matrix4();mesh.getMatrixAt(i,matrix);
      panes.push({mesh,i,position:new Vector3().setFromMatrixPosition(matrix)});
    }
  });
  const eps=7e-6,near=(a,b)=>assert.ok(Math.abs(a-b)<eps,`${a} != ${b}`);
  const ray=new Raycaster(),read=(p,name)=>{
    const a=p.mesh.geometry.getAttribute(name);
    return Array.from(a.array.slice(p.i*a.itemSize,(p.i+1)*a.itemSize));
  };
  const cast=(origin,direction,far=.9)=>{
    ray.set(new Vector3(...origin),new Vector3(...direction));ray.far=far;
    return ray.intersectObject(architecture,true)[0];
  };
  let storeys=0,openings=0,glassChecks=0,reveals=0;
  try {
    for(const id of ['a','d']) {
      const b=BUILDINGS.find(b=>b.id===id),bay=b.w/4,z=b.z+b.d/2;
      for(let floor=1;floor<=3;floor++) {
        const base=.16+floor*b.floorHeight;storeys++;
        const floorPanes=panes.filter(p=>Math.abs(p.position.z-(z-.19))<eps&&p.position.x>b.x-b.w/2&&p.position.x<b.x+b.w/2&&p.position.y>base&&p.position.y<base+b.floorHeight);
        assert.equal(floorPanes.length,7,'expected three paired office windows and one service light');
        for(let col=0;col<4;col++) {
          const service=col===(id==='a'?0:3),x=b.x-b.w/2+(col+.5)*bay;
          const w=service?1.15:3.2,h=service?b.floorHeight-1.12:2.05,sill=service?.6:.85;
          const y=base+sill+h/2,lo=x-w/2,hi=x+w/2;
          const windowPanes=floorPanes.filter(p=>p.position.x>lo&&p.position.x<hi);
          assert.equal(windowPanes.length,service?1:2);openings++;
          for(const p of windowPanes) {
            const first=cast([p.position.x,y,z+.4],[0,0,-1]);
            assert.equal(first?.object,p.mesh,'opaque geometry covers a window opening');
            assert.equal(first.instanceId,p.i);near(first.point.z,z-.1675);glassChecks++;
            const [pw,ph]=read(p,'paneSize'),room=read(p,'paneRoom');
            near(ph,h-.098);near(room[1],bay);
            near(p.position.x-room[0],x);near(p.position.y-room[2],base);
            near(p.position.y+room[3],base+b.floorHeight-.28);
            assert.equal(read(p,'paneType')[0],0,'office lights must retain interior mapping');
            // The actual glass edge lies 6mm under a pressure frame, on all four sides.
            for(const [ex,ey]of [[p.position.x-pw/2,y],[p.position.x+pw/2,y],[p.position.x,y-ph/2],[p.position.x,y+ph/2]]) {
              const held=cast([ex,ey,z+.4],[0,0,-1]);
              assert.equal(held?.object.material.name,'Charcoal powder coated metal');near(held.point.z,z-.125);
            }
            const back=cast([p.position.x,y,z-.213],[0,0,-1],.1);
            assert.equal(back?.object.material.name,'Recessed entrance interior');near(back.point.z,z-.23);
          }
          if(!service) {
            assert.deepEqual(read(windowPanes[0],'paneDetail').slice(1),read(windowPanes[1],'paneDetail').slice(1));
            const mullion=cast([x,y,z+.4],[0,0,-1]);
            assert.equal(mullion?.object.material.name,'Charcoal powder coated metal');near(mullion.point.z,z-.125);
          }
          for(const [direction,target]of [
            [[1,0,0],[hi,y,z+.04]],[[-1,0,0],[lo,y,z+.04]],
            [[0,1,0],[x,base+sill+h,z+.04]],[[0,-1,0],[x,base+sill,z+.04]],
          ]) {
            const hit=cast([x,y,z+.04],direction,4);
            assert.equal(hit?.object,wallMesh,'missing stone reveal');
            assert.ok(hit.point.distanceTo(new Vector3(...target))<eps);
            const normal=hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
            near(normal.dot(new Vector3(...direction)),-1);reveals++;
          }
          const solid=cast([x,base+.2,z+.4],[0,0,-1]);
          assert.equal(solid?.object,wallMesh);near(solid.point.z,z+.21);
        }
      }
    }
    assert.deepEqual({storeys,openings,glassChecks,reveals},{storeys:6,openings:24,glassChecks:42,reveals:96});
  } finally {
    const geometries=new Set(),materials=new Set();
    architecture.traverse(o=>{if(o.isMesh){geometries.add(o.geometry);materials.add(o.material);}});
    for(const g of geometries)g.dispose();for(const m of materials)m.dispose();
  }
});
