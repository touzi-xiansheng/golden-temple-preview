import test from 'node:test';
import assert from 'node:assert/strict';
import { Line3, Matrix4, Vector3 } from 'three';
import { planNorthGrove } from '../src/campus/north-grove.js';
import { buildVegetation } from '../src/campus/vegetation.js';

function plantingSite() {
  const shrubs=Array.from({length:213},(_,i)=>({
    kind:'shrub',x:-8+i%17,z:-28+Math.floor(i/17),
    height:.52+(i%24)*.02,radius:.8,ground:-.005,
  }));
  const cover=Array.from({length:89},(_,i)=>{
    const angle=i*2.399963,r=.82+((i%5)/5)*.08;
    return {kind:'groundcover',x:Math.cos(angle)*13*r,z:-22+Math.sin(angle)*17*r,height:.24,radius:.55,ground:-.005};
  });
  shrubs[0].shapeSeed='existing-shrub-shape';cover[0].shapeSeed='existing-cover-shape';
  const retained=[{kind:'groundcover',x:2,z:29},{kind:'grass',x:4,z:-23},{kind:'shrub',x:-30,z:28}];
  const plants=[retained[0],...shrubs.slice(0,100),retained[1],...shrubs.slice(100),...cover,retained[2]];
  const outline=Array.from({length:64},(_,i)=>{
    const angle=i*Math.PI/32,k=1+.018*Math.sin(angle*3)+.012*Math.sin(angle*5);
    return {x:Math.cos(angle)*13*k,z:-22+Math.sin(angle)*17*k};
  });
  const trees=[{x:6,z:-33},{x:-7,z:-32},{x:0,z:-18}];
  const freePlant=(x,z,r)=>Math.abs(x)+r<14&&z-r>-40&&z+r<-4;
  return {plants,retained,outline,trees,freePlant};
}

function soilClearance(outline,x,z) {
  let inside=false,distance=Infinity;
  for(let i=0,j=outline.length-1;i<outline.length;j=i++) {
    const a=outline[j],b=outline[i],dx=b.x-a.x,dz=b.z-a.z;
    const t=Math.max(0,Math.min(1,((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz)));
    distance=Math.min(distance,Math.hypot(x-a.x-dx*t,z-a.z-dz*t));
    if((a.z>z)!==(b.z>z)&&x<(b.x-a.x)*(z-a.z)/(b.z-a.z)+a.x)inside=!inside;
  }
  return inside?distance:-distance;
}

test('north planting is deterministic, clears the site, and commits atomically without replacing unrelated records', () => {
  const site=plantingSite(),repeat=plantingSite(),unchanged=structuredClone(site.retained);
  const originalNorth=site.plants.filter(p=>!site.retained.includes(p));
  const originalSeed=p=>p.shapeSeed??`campus-plant:${p.kind}:${p.x}:${p.z}`;
  const shrubSeeds=new Map(originalNorth.filter(p=>p.kind==='shrub').map(p=>[p,originalSeed(p)]));
  const coverSeeds=originalNorth.filter(p=>p.kind==='groundcover').slice(0,48).map(originalSeed);
  const plan=s=>planNorthGrove(s.plants,s.trees,s.freePlant,s.outline);
  assert.equal(plan(site),true);assert.equal(plan(repeat),true);
  assert.deepEqual(site.plants,repeat.plants);
  const retained=site.plants.filter(p=>site.retained.includes(p));
  assert.equal(retained.length,site.retained.length);
  retained.forEach((p,i)=>assert.equal(p,site.retained[i],'unrelated identity/order changed'));
  assert.deepEqual(retained,unchanged);
  const added=site.plants.filter(p=>!site.retained.includes(p));
  for(const [plant,seed] of shrubSeeds) {
    assert.ok(site.plants.includes(plant),'relocated shrub identity changed');
    assert.equal(plant.shapeSeed,seed,'relocation changed a shrub shape seed');
  }
  assert.deepEqual(added.filter(p=>p.kind==='groundcover').map(p=>p.shapeSeed),coverSeeds,'relocation changed retained broadleaf shape seeds');
  for(const [kind,count] of [['shrub',213],['groundcover',48],['clonalGroundcover',750]])
    assert.equal(added.filter(p=>p.kind===kind).length,count);
  for(const plant of added) {
    const radius=plant.kind==='shrub'?plant.radius*1.06:plant.kind==='groundcover'?.51:plant.radius;
    assert.ok([plant.x,plant.z,plant.height,radius].every(Number.isFinite));
    assert.ok(soilClearance(site.outline,plant.x,plant.z)>=radius-1e-8,'full planting footprint crosses soil edge');
    assert.ok(site.freePlant(plant.x,plant.z,radius),'full planting footprint enters a path');
    assert.ok(site.trees.every(t=>Math.hypot(t.x-plant.x,t.z-plant.z)>=.72),'plant root enters tree well');
    assert.equal(typeof plant.shapeSeed,'string');
  }
  for(const stage of ['early','clonal','accent']) {
    const blocked=plantingSite(),references=[...blocked.plants],snapshot=structuredClone(blocked.plants);
    let clonalAttempts=0,accentAttempts=0;
    const free=(x,z,r)=>{
      if(r===.455)clonalAttempts++;
      if(r===.51)accentAttempts++;
      if(stage==='early'||(stage==='clonal'&&r===.455)||(stage==='accent'&&r===.51))return false;
      return blocked.freePlant(x,z,r);
    };
    assert.equal(planNorthGrove(blocked.plants,blocked.trees,free,blocked.outline),false);
    assert.deepEqual(blocked.plants,snapshot,'failed planning partially mutated records');
    blocked.plants.forEach((p,i)=>assert.equal(p,references[i],'failed planning changed array identity/order'));
    if(stage==='early')assert.equal(clonalAttempts+accentAttempts,0);
    if(stage==='clonal'){assert.ok(clonalAttempts>0);assert.equal(accentAttempts,0);}
    if(stage==='accent'){assert.ok(clonalAttempts>0);assert.ok(accentAttempts>0,'failure must occur after clonal placement reaches the accent stage');}
  }
});

test('clonal groundcover has grounded connected shoots, attached alternate leaves, and reproducible bounded geometry', () => {
  const previousDocument=globalThis.document;
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'
    ? (x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}) : ()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  const groups=[];
  try {
    // Straddle spatial batch boundaries so joins are checked across meshes too.
    const plant={kind:'clonalGroundcover',x:47.95,z:-48.05,height:.17,radius:.455,ground:-.005,shapeSeed:'clonal-regression'};
    const build=p=>{const group=buildVegetation([],[],[p]);groups.push(group);return group;};
    const group=build(plant);
    assert.equal(group.userData.stats.clonalGroundcoverPlants,1);
    const stems=[],petioles=[],leaves=[],matrix=new Matrix4(),vertex=new Vector3();
    let stemMaterial,triangles=0;
    for(const mesh of group.children) {
      const main=mesh.name.startsWith('perennial-stems:'),petiole=mesh.name.startsWith('clonal-petioles:');
      assert.ok(main||petiole||mesh.name.startsWith('individual-foliage:'),'clonal plant fell through to a proxy/core');
      assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
      triangles+=mesh.geometry.index.count/3*mesh.count;
      if(main||petiole) {
        stemMaterial??=mesh.material;
        assert.equal(mesh.material,stemMaterial,'petioles and shoots must share the same material');
      }
      for(let i=0;i<mesh.count;i++) {
        mesh.getMatrixAt(i,matrix);assert.ok(matrix.elements.every(Number.isFinite));
        if(main||petiole) {
          (main?stems:petioles).push(new Line3(new Vector3(0,-.5,0).applyMatrix4(matrix),new Vector3(0,.5,0).applyMatrix4(matrix)));
          const radius=new Vector3().setFromMatrixColumn(matrix,0).length();
          assert.ok(radius>=.0007&&radius<=.002,'stems must retain millimetre scale');
        } else {
          leaves.push(new Vector3().setFromMatrixPosition(matrix));
          const width=new Vector3().setFromMatrixColumn(matrix,0).length(),length=new Vector3().setFromMatrixColumn(matrix,1).length();
          assert.ok(width>=.018&&width<=.063&&length>=.045&&length<=.103,'blades must retain natural centimetre scale');
          const positions=mesh.geometry.attributes.position;
          for(let j=0;j<positions.count;j++) {
            vertex.fromBufferAttribute(positions,j).applyMatrix4(matrix);
            assert.ok(vertex.toArray().every(Number.isFinite));
            assert.ok(vertex.y>plant.ground&&vertex.y<plant.ground+.29,'leaf leaves the low planting layer');
            assert.ok(Math.hypot(vertex.x-plant.x,vertex.z-plant.z)<plant.radius,'leaf exits the planting footprint');
          }
        }
      }
    }
    assert.equal(leaves.length,72);assert.equal(stems.length,24);assert.equal(petioles.length,72);
    assert.equal(triangles,1152,'growth must stay within its accepted geometry budget');
    for(const prefix of ['individual-foliage:','perennial-stems:','clonal-petioles:'])
      assert.ok(group.children.filter(mesh=>mesh.name.startsWith(prefix)).length>1,'fixture must exercise spatial batch boundaries');
    const root=new Vector3(plant.x,plant.ground-.003,plant.z),epsilon=1e-5;
    assert.equal(stems.filter(s=>s.start.distanceTo(root)<epsilon).length,4,'four runners must originate in the grounded plant centre');
    for(const stem of stems) {
      assert.ok(stem.start.y>=root.y-epsilon&&stem.end.y>root.y,'root/stem elevation is invalid');
      assert.ok(stem.start.distanceTo(root)<epsilon||stems.some(other=>other!==stem&&other.end.distanceTo(stem.start)<epsilon),'detached runner or shoot');
    }
    for(const petiole of petioles) {
      assert.ok(stems.some(stem=>stem.closestPointToPoint(petiole.start,true,vertex).distanceTo(petiole.start)<epsilon),'petiole is detached from its actual shoot segment');
      assert.equal(leaves.filter(base=>base.distanceTo(petiole.end)<epsilon).length,1,'petiole must terminate at one real leaf base');
    }
    for(const base of leaves) {
      assert.equal(petioles.filter(p=>p.end.distanceTo(base)<epsilon).length,1,'leaf base is not attached to its petiole');
      assert.equal(leaves.filter(other=>other.distanceTo(base)<epsilon).length,1,'several leaves share an umbrella endpoint');
    }

    const repeat=build(plant);
    assert.deepEqual(group.children.map(mesh=>mesh.name),repeat.children.map(mesh=>mesh.name));
    group.children.forEach((mesh,i)=>{
      assert.deepEqual(mesh.instanceMatrix.array,repeat.children[i].instanceMatrix.array,'same seed changed an instance transform');
      assert.deepEqual(mesh.instanceColor?.array,repeat.children[i].instanceColor?.array,'same seed changed a leaf color');
    });
    // A relocated record retains its shape even when it crosses into different batch cells.
    const dx=2,dz=-3,moved=build({...plant,x:plant.x+dx,z:plant.z+dz});
    const leafInstances=g=>g.children.filter(mesh=>mesh.name.startsWith('individual-foliage:')).flatMap(mesh=>
      Array.from({length:mesh.count},(_,i)=>({matrix:Array.from(mesh.instanceMatrix.array.slice(i*16,i*16+16)),color:Array.from(mesh.instanceColor.array.slice(i*3,i*3+3))})))
      .sort((a,b)=>a.matrix[13]-b.matrix[13]);
    const originalLeaves=leafInstances(group),movedLeaves=leafInstances(moved);
    assert.equal(movedLeaves.length,originalLeaves.length);
    originalLeaves.forEach((leaf,i)=>{
      leaf.matrix.forEach((value,j)=>assert.ok(Math.abs(movedLeaves[i].matrix[j]-value-(j===12?dx:j===14?dz:0))<epsilon,'shapeSeed relocation changed leaf shape'));
      assert.deepEqual(movedLeaves[i].color,leaf.color,'shapeSeed relocation changed leaf color');
    });
  } finally {
    for(const group of groups)group.traverse(o=>{if(o.isMesh){o.geometry.dispose();o.material.dispose();}});
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});


test('broadleaf maturity changes attached blades and crown height within the planted footprint', () => {
  const previousDocument=globalThis.document;
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'
    ? (x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}) : ()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try {
    const measurements=[];
    // North-bed records retain radius .55, but the planner reserves only .51 metres.
    for(const [height,radius] of [[.18,.48],[.32,.48],[.32,.55]]){
      const plant={kind:'groundcover',x:47.95,z:-48.05,ground:-.005,radius,height,shapeSeed:'rosette-height-response'};
      const group=buildVegetation([],[],[plant]),leaves=[],stems=[];
      let triangles=0,maxHeight=0,maxRadius=0,meanLength=0;
      try {
        for(const mesh of group.children){
          const isLeaf=mesh.name.startsWith('broadleaf-groundcover:'),isStem=mesh.name.startsWith('perennial-stems:');
          assert.ok(isLeaf||isStem);triangles+=mesh.geometry.index.count/3*mesh.count;
          for(let i=0;i<mesh.count;i++){
            const matrix=new Matrix4();mesh.getMatrixAt(i,matrix);
            if(isStem){stems.push({start:new Vector3(0,-.5,0).applyMatrix4(matrix),end:new Vector3(0,.5,0).applyMatrix4(matrix)});continue;}
            const length=new Vector3().setFromMatrixColumn(matrix,1).length(),tilt=Math.asin(matrix.elements[5]/length);
            leaves.push({base:new Vector3().setFromMatrixPosition(matrix),length,tilt});meanLength+=length/26;
            for(let j=0;j<mesh.geometry.attributes.position.count;j++){
              const p=new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,j).applyMatrix4(matrix);
              assert.ok(p.toArray().every(Number.isFinite));
              maxHeight=Math.max(maxHeight,p.y-plant.ground);maxRadius=Math.max(maxRadius,Math.hypot(p.x-plant.x,p.z-plant.z));
              assert.ok(p.y>plant.ground,'leaf penetrates soil');
            }
          }
        }
        assert.equal(leaves.length,26);assert.equal(stems.length,26);assert.equal(triangles,832);assert.ok(group.children.length<=8);
        const root=new Vector3(plant.x,plant.ground-.003,plant.z);
        for(const stem of stems)assert.ok(stem.start.distanceTo(root)<1e-5);
        for(const leaf of leaves)assert.ok(Math.min(...stems.map(s=>s.end.distanceTo(leaf.base)))<1e-5,'blade misses real petiole tip across spatial batches');
        assert.ok(maxRadius<Math.min(plant.radius,.51));
        const mean=list=>list.reduce((s,r)=>s+r.length,0)/list.length;
        const young=leaves.filter(l=>l.tilt>1.05),outer=leaves.filter(l=>l.tilt<.5);
        assert.equal(young.length,7);assert.equal(outer.length,10);assert.ok(mean(young)<mean(outer)*.7,'young leaves are as large as mature outer leaves');
        measurements.push({height,maxHeight,maxRadius,meanLength});
      } finally {
        const materials=new Set();group.traverse(m=>{if(m.isMesh){m.geometry.dispose();materials.add(m.material);}});for(const material of materials)material.dispose();
      }
    }
    assert.ok(measurements[1].maxHeight-measurements[0].maxHeight>.1,'height only changes a short petiole');
    assert.ok(measurements[1].meanLength>measurements[0].meanLength*1.15,'maturity does not change actual blade dimensions');
  } finally {
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
});

// Actual north-bed records, with explicit seeds so a translated control keeps its shape.
const growthShrubs=[
  {kind:'shrub',x:6.833254292188212,z:-22.470843009185046,height:.8505661265132949,radius:.7494770287070424,ground:-.005,detail:false,shapeSeed:'campus-plant:shrub:-7.916902024429293:-27.295557739157218'},
  {kind:'shrub',x:8.320611128630116,z:-23.671304538846016,height:.6271486922400072,radius:.807037059252616,ground:-.005,detail:true,shapeSeed:'campus-plant:shrub:0.29553439423441746:-29.87112440703436'},
];

function withShrubGeometry(run) {
  const previousDocument=globalThis.document,groups=[];
  const context=new Proxy({}, {get:(_,key)=>key==='getImageData'
    ? (x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}) : ()=>{}});
  globalThis.document={createElement:()=>({getContext:()=>context})};
  try {return run(plants=>{const group=buildVegetation([],[],plants);groups.push(group);return group;});}
  finally {
    const materials=new Set();
    for(const group of groups)group.traverse(mesh=>{if(mesh.isMesh){mesh.geometry.dispose();materials.add(mesh.material);mesh.dispose?.();}});
    for(const material of materials)material.dispose();
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
  }
}

function compareShrubPrefixes(actual,control,dx=0,exact=false) {
  assert.deepEqual(actual.children.map(m=>m.name),control.children.map(m=>m.name),'growth changed spatial batches');
  actual.children.forEach((mesh,i)=>{
    const old=control.children[i];assert.ok(mesh.count>=old.count);
    if(exact)assert.equal(mesh.count,old.count);
    assert.deepEqual(mesh.geometry.index.array,old.geometry.index.array);
    for(const [name,attribute] of Object.entries(old.geometry.attributes)) {
      const values=mesh.geometry.attributes[name].array;
      assert.deepEqual(attribute.isInstancedBufferAttribute?values.slice(0,attribute.array.length):values,attribute.array,`old ${name} changed`);
    }
    if(old.instanceColor)assert.deepEqual(mesh.instanceColor.array.slice(0,old.count*3),old.instanceColor.array);
    for(let j=0;j<old.count*16;j++)
      assert.ok(Math.abs(mesh.instanceMatrix.array[j]-old.instanceMatrix.array[j]+(j%16===12?dx:0))<1e-5,'old instance changed beyond the control translation');
  });
}

function shrubInstances(mesh,start=0) {
  return Array.from({length:mesh.count-start},(_,i)=>{
    const matrix=new Matrix4();mesh.getMatrixAt(start+i,matrix);
    return {mesh,matrix,points:Array.from({length:mesh.geometry.attributes.position.count},(_,j)=>new Vector3().fromBufferAttribute(mesh.geometry.attributes.position,j).applyMatrix4(matrix))};
  });
}

// Derive the convex parent volume from its real indexed side triangles, plus its two open-end planes.
// This deliberately does not repeat the production taper/radius formula.
function actualShrubTube(record) {
  const {mesh,matrix,points}=record,indices=mesh.geometry.index.array,centre=new Vector3().setFromMatrixPosition(matrix),planes=[];
  for(let i=0;i<indices.length;i+=3) {
    const a=points[indices[i]],b=points[indices[i+1]],c=points[indices[i+2]];
    const normal=b.clone().sub(a).cross(c.clone().sub(a)).normalize();
    if(normal.dot(a.clone().sub(centre))<0)normal.negate();
    planes.push([normal,normal.dot(a)]);
  }
  const positions=mesh.geometry.attributes.position,ys=Array.from({length:positions.count},(_,i)=>positions.getY(i));
  const low=Math.min(...ys),high=Math.max(...ys),axis=new Vector3().setFromMatrixColumn(matrix,1).normalize();
  const start=new Vector3(0,low,0).applyMatrix4(matrix),end=new Vector3(0,high,0).applyMatrix4(matrix);
  planes.push([axis,axis.dot(end)],[axis.clone().negate(),-axis.dot(start)]);
  return {line:new Line3(start,end),root:points.filter((_,i)=>ys[i]===low),contains:p=>planes.every(([normal,d])=>normal.dot(p)-d<=1e-5)};
}

test('additional shrub growth preserves old instances and attaches bounded leaves to real tapered branches', () => withShrubGeometry(build=>{
  for(const plant of growthShrubs) {
    // Both positions stay in the same 48 m cell; only the second is outside the treatment bed.
    const control=build([{...plant,x:plant.x+16}]),group=build([plant]),repeat=build([plant]);
    assert.equal(control.userData.shrubGrowth?.plants??0,0);
    compareShrubPrefixes(group,control,16);compareShrubPrefixes(group,repeat,0,true);
    group.children.forEach((mesh,i)=>assert.deepEqual(mesh.instanceMatrix.array,repeat.children[i].instanceMatrix.array,'growth is not deterministic'));
    const stemMesh=group.children.find(m=>m.name.startsWith('shrub-branches:'));
    const oldStemMesh=control.children.find(m=>m.name.startsWith('shrub-branches:'));
    const leafMesh=group.children.find(m=>m!==stemMesh),oldLeafMesh=control.children.find(m=>m!==oldStemMesh);
    assert.equal(group.children.length,2,'one isolated shrub needs only its existing stem and leaf batches');
    const allStems=shrubInstances(stemMesh),oldTubes=allStems.slice(0,oldStemMesh.count).map(actualShrubTube);
    const newStems=allStems.slice(oldStemMesh.count),newTubes=newStems.map(actualShrubTube),newLeaves=shrubInstances(leafMesh,oldLeafMesh.count);
    const shoots=newTubes.length/2;
    assert.ok(shoots>=12&&shoots<=18);assert.equal(newLeaves.length,shoots*12);
    assert.equal(newLeaves.length,oldLeafMesh.count*3/8,'old leaf count or added-node budget changed');
    assert.equal(group.userData.shrubGrowth.shoots,shoots);assert.equal(group.userData.shrubGrowth.leaves,newLeaves.length);
    const addedTriangles=newStems.length*stemMesh.geometry.index.count/3+newLeaves.length*leafMesh.geometry.index.count/3;
    assert.equal(addedTriangles,shoots*(16+(plant.detail?144:48)));
    assert.equal(group.userData.shrubGrowth.addedTriangles,addedTriangles);
    for(let i=0;i<newTubes.length;i+=2) {
      const root=[newTubes[i].line.start,...newTubes[i].root];
      assert.ok(oldTubes.some(parent=>root.every(parent.contains)),'new root disk escapes every actual parent tube');
      assert.ok(newTubes[i].line.end.distanceTo(newTubes[i+1].line.start)<1e-5,'new short shoot has a detached second segment');
    }
    const nearest=new Vector3();
    for(const leaf of newLeaves) {
      const base=new Vector3().setFromMatrixPosition(leaf.matrix);
      assert.ok(newTubes.some(tube=>tube.contains(base)&&tube.line.closestPointToPoint(base,true,nearest).distanceTo(base)<1e-5),'new leaf base misses its rendered shoot');
    }
    for(const record of [...newStems,...newLeaves])for(const vertex of record.points) {
      assert.ok(vertex.toArray().every(Number.isFinite));
      assert.ok(vertex.y>plant.ground,'new growth enters soil');
      assert.ok(vertex.y<=plant.ground+plant.height*1.12+1e-5,'new growth exceeds the accepted height envelope');
      assert.ok(Math.hypot(vertex.x-plant.x,vertex.z-plant.z)<=plant.radius*1.06+1e-5,'new growth crosses the reserved planting footprint');
    }
  }
}));

test('a later shrub growth failure keeps the complete original group and warns once', () => withShrubGeometry(build=>{
  const good=growthShrubs[0],bad={...good,x:5,z:-22,radius:.001,shapeSeed:'shrub-growth-too-small'};
  const control=build([good,bad].map(p=>({...p,x:p.x+16})));
  const previousWarn=console.warn,warnings=[];let group;
  try {console.warn=(...args)=>warnings.push(args);group=build([good,bad]);}
  finally {console.warn=previousWarn;}
  assert.equal(warnings.length,1,'a failed addition must warn once without throwing');
  assert.match(String(warnings[0][0]),/keeping original plants/);
  assert.equal(group.userData.shrubGrowth,null,'a partially staged group was committed');
  compareShrubPrefixes(group,control,16,true);
}));
