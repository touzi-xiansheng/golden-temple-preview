import test from 'node:test';
import assert from 'node:assert/strict';
import { CylinderGeometry, Matrix4, Plane, Vector3 } from 'three';
import { stageMatureBorder } from '../src/campus/vegetation.js';
import { MATURE_STEM_TAPER } from '../src/campus/mature-shrub.js';
import { curvedShrubLeafGeometry } from '../src/campus/shrub-leaf.js';

// Fixed shortest and tallest plants of the six-plant cohort.
const plants = [
  [30,8.798093634555116,39.362234551385136,1.3600544014014304,.9350317341508344],
  [28,10.020665311536282,34.5030797999609,1.8648056063335388,1.2294699370278976],
].map(([id,x,z,height,radius])=>({kind:'matureShrub',x,z,height,radius,ground:-.007,detail:true,shapeSeed:`south-garden-clearing-v1:mature:${id}`}));
const f32 = matrix => new Matrix4().fromArray(new Float32Array(matrix.elements));
const end = (matrix,t) => new Vector3(0,t-.5,0).applyMatrix4(matrix);
const epsilon = 8e-6; // World-space Float32 joins, not a claim of watertight curved tubes.

test('mature shrub has supported wood, opposite attached leaves and physical dimensions', () => {
  assert.equal(MATURE_STEM_TAPER,.9);
  const wood=new CylinderGeometry(MATURE_STEM_TAPER,1,1,4,1,true),blade=curvedShrubLeafGeometry();
  const position=wood.attributes.position,vertex=i=>new Vector3().fromBufferAttribute(position,i),planes=[];
  // Use the actual primitive's side triangles, plus the two open end planes.
  for(let i=0;i<wood.index.count;i+=3)planes.push(new Plane().setFromCoplanarPoints(...[0,1,2].map(j=>vertex(wood.index.getX(i+j)))));
  planes.push(new Plane(new Vector3(0,1,0),-.5),new Plane(new Vector3(0,-1,0),-.5));
  try {
    for(const plan of stageMatureBorder(plants)) {
      const p=plan.plant,matrices=plan.stems.map(s=>f32(s.matrix)),nodesByAxis=new Map();
      assert.equal(plan.stemTaper,MATURE_STEM_TAPER);
      assert.ok(plan.nodes.length>0);
      assert.equal(new Set(plan.nodes.flatMap(node=>node.leaves)).size,plan.leaves.length,'every leaf belongs to a paired node');
      for(const axis of plan.axes) {
        const matrix=matrices[axis.stemStart];
        for(let s=1;s<axis.segments;s++)assert.ok(end(matrices[axis.stemStart+s-1],1).distanceTo(end(matrices[axis.stemStart+s],0))<epsilon);
        const link=axis.parent,parent=link&&matrices[plan.axes[link.axis].stemStart+link.segment],inverse=parent?.clone().invert();
        if(parent)assert.ok(end(matrix,0).distanceTo(end(parent,link.t))<epsilon,'child centre must use its recorded parent segment');
        for(let i=0;i<position.count;i++)if(position.getY(i)===-.5) {
          const root=vertex(i).applyMatrix4(matrix);
          if(inverse)assert.ok(planes.every(plane=>plane.distanceToPoint(root.clone().applyMatrix4(inverse))<2e-5),'child root ring leaves the actual parent tube');
          else assert.ok(root.y<=p.ground,'basal root must enter the soil');
        }
      }
      for(const node of plan.nodes) {
        assert.equal(node.leaves.length,2);assert.equal(node.petioles.length,2);
        const parent=matrices[plan.axes[node.parent.axis].stemStart+node.parent.segment],centre=end(parent,node.parent.t),vectors=[];
        if(!nodesByAxis.has(node.axis))nodesByAxis.set(node.axis,[]);
        nodesByAxis.get(node.axis).push(centre);
        for(let i=0;i<2;i++) {
          const petiole=plan.axes[node.petioles[i]],matrix=matrices[petiole.stemStart],start=end(matrix,0),tip=end(matrix,1);
          assert.deepEqual(petiole.parent,node.parent);assert.equal(petiole.side,i===0?-1:1);
          assert.ok(start.distanceTo(centre)<epsilon);vectors.push(tip.clone().sub(start));
          assert.ok(Math.abs(tip.distanceTo(start)-.01)<epsilon,'short physical petiole');
          const diameter=2*new Vector3().setFromMatrixColumn(matrix,0).length();
          assert.ok(diameter>=.0003&&diameter<=.0015,'taper must not collapse petioles to microscopic axes');
          const base=new Vector3().fromBufferAttribute(blade.attributes.position,0).applyMatrix4(f32(plan.leaves[node.leaves[i]].matrix));
          assert.ok(base.distanceTo(tip)<epsilon,'real leaf vertex zero must meet its petiole');
        }
        assert.ok(vectors[0].add(vectors[1]).length()<epsilon,'opposite leaves share one node');
      }
      for(const centres of nodesByAxis.values())for(let i=1;i<centres.length;i++)assert.ok(Math.abs(centres[i].distanceTo(centres[i-1])-.05)<epsilon,'internodes must have physical spacing');
      for(const bud of plan.budNodes) {
        assert.equal(bud.shoots.length,bud.activeSides.length);
        bud.shoots.forEach((id,i)=>{assert.deepEqual(plan.axes[id].parent,bud.parent);assert.equal(plan.axes[id].bud.side,bud.activeSides[i]);});
      }
      for(const carrier of plan.axes.filter(axis=>axis.kind==='previousShoot')) {
        const buds=plan.budNodes.filter(bud=>bud.axis===carrier.id).sort((a,b)=>a.distance-b.distance);
        const shoots=plan.axes.filter(axis=>axis.kind==='currentShoot'&&axis.parent.axis===carrier.id);
        assert.equal(buds.length,2);assert.deepEqual(buds.map(bud=>bud.activeSides.length),[2,1]);
        assert.deepEqual(buds.map(bud=>shoots.filter(axis=>axis.bud.node===bud.id).length),[2,1],'two distinct buds activate 2 + 1 real shoots');
        assert.equal(shoots.length,4);assert.equal(shoots.filter(axis=>axis.bud.terminal).length,1);
        for(const shoot of shoots)assert.equal(nodesByAxis.get(shoot.id)?.length,shoot.bud.terminal?4:3,'actual terminal/lateral leaf nodes');
      }
      for(const leaf of plan.leaves) {
        const matrix=f32(leaf.matrix),width=new Vector3().setFromMatrixColumn(matrix,0).length(),length=new Vector3().setFromMatrixColumn(matrix,1).length();
        assert.ok(width>=.04-epsilon&&width<=.06+epsilon&&length>=.08-epsilon&&length<=.10+epsilon);
        assert.ok(Math.abs(leaf.normal.length()-1)<epsilon&&leaf.ao>=.5&&leaf.ao<=.9);
      }
      for(const [records,geometry,isLeaf] of [[plan.stems,wood,false],[plan.leaves,blade,true]])for(const record of records) {
        const matrix=f32(record.matrix);assert.ok(matrix.elements.every(Number.isFinite));
        for(let i=0;i<geometry.attributes.position.count;i++) {
          const v=new Vector3().fromBufferAttribute(geometry.attributes.position,i).applyMatrix4(matrix);
          assert.ok(v.toArray().every(Number.isFinite));
          assert.ok(Math.hypot(v.x-p.x,v.z-p.z)<=p.radius&&v.y<=p.ground+p.height);
          assert.ok(v.y>=p.ground-(isLeaf?0:.065),'leaf above soil; only basal wood may be embedded');
        }
      }
      assert.equal(plan.stats.triangles,(plan.stems.length*wood.index.count+plan.leaves.length*blade.index.count)/3);
    }
  } finally { wood.dispose();blade.dispose(); }
});

test('mature staging is reproducible and a late invalid plant leaves inputs untouched', () => {
  const input=structuredClone(plants),references=[...input],before=structuredClone(input);
  const buffer=p=>new Float32Array([...p.stems,...p.leaves].flatMap(r=>[...r.matrix.elements,...(r.color?.toArray()??[]),...(r.normal?.toArray()??[]),r.ao??0]));
  const first=stageMatureBorder(input),second=stageMatureBorder(input);
  assert.equal(first.length,input.length);
  first.forEach((p,i)=>assert.deepEqual(buffer(p),buffer(second[i]),'all instance attributes must replay exactly'));
  assert.deepEqual(input,before);input.forEach((p,i)=>assert.equal(p,references[i]));
  const invalid=[...input,{...input.at(-1),height:NaN}],snapshot=structuredClone(invalid),identities=[...invalid];
  assert.throws(()=>stageMatureBorder(invalid),/Invalid mature border shrub/);
  assert.deepEqual(invalid,snapshot);invalid.forEach((p,i)=>assert.equal(p,identities[i]));
});
