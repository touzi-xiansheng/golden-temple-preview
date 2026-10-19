import * as THREE from 'three';
import { Builder, mat4 } from '../core/geom.js';
import { BUILDINGS, entrancePoint } from './layout.js';

const Y = new THREE.Vector3(0, 1, 0);

// Car bodies use continuous rounded cross-sections instead of stacked boxes.
function bodyLoft(sections) {
  const vertices = [], indices = [], around = 24;
  for (const [z, width, bottom, top] of sections) for (let j = 0; j < around; j++) {
    const angle = j / around * Math.PI * 2, sn = Math.sin(angle), cs = Math.cos(angle);
    vertices.push(Math.sign(sn) * Math.pow(Math.abs(sn), 0.58) * width, (bottom + top) / 2 + Math.sign(cs) * Math.pow(Math.abs(cs), 0.7) * (top - bottom) / 2, z);
  }
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < around; j++) {
    const a = i * around + j, b = i * around + (j + 1) % around, c = a + around, d = b + around;
    indices.push(a, c, b, b, c, d);
  }
  for (const end of [0, sections.length - 1]) {
    const [z, , bottom, top] = sections[end], center = vertices.length / 3;
    vertices.push(0, (bottom + top) / 2, z);
    for (let j = 0; j < around; j++) {
      const a = end * around + j, b = end * around + (j + 1) % around;
      if (end === 0) indices.push(center, a, b); else indices.push(center, b, a);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function quad(points) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([points[0], points[1], points[2], points[0], points[2], points[3]].flat(), 3));
  geometry.computeVertexNormals(); return geometry;
}

function colored(geometry, color) {
  const c = new THREE.Color(color), data = [];
  for (let i = 0; i < geometry.attributes.position.count; i++) data.push(c.r, c.g, c.b);
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(data, 3));
  return geometry;
}

export function buildCampusProps() {
  const paint = ['#deded5', '#939da0', '#313b3e'].map(color => new THREE.MeshPhysicalMaterial({ color, metalness: 0.35, roughness: 0.24, clearcoat: 1, clearcoatRoughness: 0.11 }));
  const glass = new THREE.MeshPhysicalMaterial({ color: '#17292e', metalness: 0.15, roughness: 0.07, clearcoat: 1, clearcoatRoughness: 0.035, side: THREE.DoubleSide });
  const rubber = new THREE.MeshStandardMaterial({ color: '#15191a', roughness: 0.87 });
  const metal = new THREE.MeshStandardMaterial({ color: '#a5acac', metalness: 0.78, roughness: 0.28 });
  const lenses = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.24, metalness: 0.12, side: THREE.DoubleSide });
  const all = new Builder();
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  function tube(builder, material, a, b, radius = 0.018) {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), direction = end.clone().sub(start);
    const rotation = new THREE.Quaternion().setFromUnitVectors(Y, direction.clone().normalize());
    builder.add(cylinder, material, mat4(start.add(end).multiplyScalar(0.5).toArray(), [0, 0, 0], [radius, direction.length(), radius], rotation));
  }
  function lens(builder, points, color) {
    const geometry = colored(quad(points), color); builder.add(geometry, lenses); geometry.dispose();
  }
  const tire = new THREE.TorusGeometry(0.255, 0.065, 8, 24); tire.scale(1, 1, 1.5);
  const rim = new THREE.TorusGeometry(0.205, 0.017, 6, 20);
  const models = paint.map(body => {
    const car = new Builder();
    let geometry = bodyLoft([
      [-2.28,0.68,0.32,0.68],[-2.16,0.83,0.27,0.85],[-1.83,0.9,0.26,0.92],
      [-0.95,0.92,0.27,0.94],[0.35,0.92,0.27,0.92],[1.12,0.90,0.27,0.87],
      [1.9,0.84,0.30,0.78],[2.21,0.72,0.34,0.69],[2.29,0.57,0.39,0.59],
    ]);
    car.add(geometry, body); geometry.dispose();
    geometry = bodyLoft([
      [-1.42,0.76,0.83,0.93],[-0.81,0.69,0.83,1.40],[-0.55,0.65,0.83,1.48],
      [0.16,0.65,0.83,1.47],[0.4,0.68,0.83,1.36],[1.02,0.77,0.83,0.91],
    ]);
    car.add(geometry, body); geometry.dispose();
    // Front and rear windscreens follow the roof's slopes, with painted pillars left exposed.
    // Windscreens share the reflective glass, while lamp lenses retain their own vertex colours.
    for (const points of [
      [[-0.73,0.990,0.936],[0.73,0.990,0.936],[0.60,1.420,0.336],[-0.60,1.420,0.336]],
      [[0.72,0.996,-1.326],[-0.72,0.996,-1.326],[-0.61,1.409,-0.806],[0.61,1.409,-0.806]],
    ]) { const window = quad(points); car.add(window, glass); window.dispose(); }
    for (const side of [-1, 1]) {
      const rear = quad([[side*0.782,0.99,-1.20],[side*0.672,1.38,-0.76],[side*0.673,1.40,-0.15],[side*0.822,0.99,-0.15]]);
      const front = quad([[side*0.822,0.99,-0.07],[side*0.673,1.40,-0.07],[side*0.686,1.36,0.32],[side*0.799,0.98,0.85]]);
      car.add(rear, glass); car.add(front, glass); rear.dispose(); front.dispose();
      car.box(body,0.18,0.13,0.25,[side*1.0,1.01,0.63],[0,0,0],0.055);
      car.box(rubber,0.06,0.05,0.17,[side*0.91,0.98,0.63]);
      for (const z of [-0.68,0.39]) car.box(metal,0.018,0.026,0.17,[side*0.929,0.84,z]);
      tube(car,rubber,[side*0.925,0.38,-0.10],[side*0.925,0.89,-0.10],0.0045);
      tube(car,rubber,[side*0.92,0.35,-1.03],[side*0.92,0.35,1.05],0.007);
      for (const z of [-1.40,1.34]) {
        car.cyl(rubber,0.345,0.345,0.016,[side*0.925,0.345,z],[0,0,Math.PI/2],24);
        car.add(tire,rubber,mat4([side*0.90,0.32,z],[0,Math.PI/2,0]));
        car.cyl(rubber,0.252,0.252,0.17,[side*0.90,0.32,z],[0,0,Math.PI/2],24);
        car.add(rim,metal,mat4([side*1.003,0.32,z],[0,Math.PI/2,0]));
        car.cyl(rubber,0.19,0.19,0.025,[side*0.985,0.32,z],[0,0,Math.PI/2],20);
        car.cyl(metal,0.052,0.052,0.035,[side*1.007,0.32,z],[0,0,Math.PI/2],12);
        for (let spoke=0;spoke<5;spoke++) {
          const angle=spoke*Math.PI*2/5;
          car.box(metal,0.022,0.04,0.17,[side*1.007,0.32+Math.sin(angle)*0.115,z+Math.cos(angle)*0.115],[-angle,0,0]);
        }
      }
      lens(car,[[side*0.37,0.68,2.255],[side*0.68,0.68,2.215],[side*0.83,0.78,1.96],[side*0.44,0.77,2.08]],'#d8e1df');
      lens(car,[[side*0.37,0.68,-2.285],[side*0.79,0.69,-2.21],[side*0.80,0.80,-2.18],[side*0.37,0.79,-2.26]],'#8b2420');
    }
    car.box(rubber,1.16,0.16,0.025,[0,0.51,2.284],[0,0,0],0.05);
    for (let k=0;k<4;k++) car.box(metal,0.97,0.009,0.012,[0,0.465+k*0.027,2.301]);
    for(const z of [-2.291,2.311]) lens(car,[[-0.23,0.48,z],[0.23,0.48,z],[0.23,0.59,z],[-0.23,0.59,z]],'#d6e1d9');
    return car;
  });

  // Centres of existing 2.8m parking bays (landscape.js), clear of the outside circulation aisle.
  const bays = [[-1,2,0],[-1,5,1],[-1,9,2],[-1,15,0],[-1,24,1],[1,4,1],[1,10,0],[1,18,2],[1,27,1],[1,34,0]];
  for (const [side,index,color] of bays) {
    const angle=side*Math.PI/2+(index%3===0?Math.PI:0);
    all.addBuilder(models[color],mat4([side*115.5,0.018,-56+(index+0.5)*2.8],[0,angle,0]));
  }

  const bike = new Builder(), wheel = new THREE.TorusGeometry(0.31,0.026,6,28), bikeRim = new THREE.TorusGeometry(0.285,0.008,4,28);
  const rear=[0,0.337,-0.54], front=[0,0.337,0.54], crank=[0,0.37,0], seat=[0,0.96,-0.26], head=[0,0.93,0.36];
  for (const p of [rear,front]) {
    bike.add(wheel,rubber,mat4(p,[0,Math.PI/2,0])); bike.add(bikeRim,metal,mat4(p,[0,Math.PI/2,0]));
    bike.cyl(metal,0.03,0.03,0.09,p,[0,0,Math.PI/2],8);
    for(let i=0;i<12;i++) {
      const angle=i*Math.PI/6;
      tube(bike,metal,p,[0,p[1]+Math.cos(angle)*0.28,p[2]+Math.sin(angle)*0.28],0.003);
    }
  }
  for(const [a,b] of [[crank,seat],[seat,head],[head,crank],[crank,rear],[seat,rear]]) tube(bike,paint[2],a,b,0.022);
  for(const side of [-1,1]) {
    tube(bike,metal,[side*0.045,0.93,0.36],[side*0.045,0.337,0.54],0.014);
    tube(bike,paint[2],[side*0.04,0.37,0],[side*0.04,0.337,-0.54],0.014);
  }
  tube(bike,metal,seat,[0,1.035,-0.28],0.016);
  bike.box(rubber,0.20,0.065,0.28,[0,1.06,-0.27],[0,0,0],0.03);
  tube(bike,metal,head,[0,1.08,0.41],0.018); tube(bike,metal,[-0.28,1.08,0.41],[0.28,1.08,0.41],0.014);
  for(const side of [-1,1]) {
    tube(bike,rubber,[side*0.18,1.08,0.41],[side*0.29,1.08,0.41],0.022);
    bike.box(rubber,0.14,0.025,0.07,[side*0.13,0.37,side*0.12]);
  }
  bike.cyl(metal,0.085,0.085,0.018,[0.058,0.37,0],[0,0,Math.PI/2],16);
  tube(bike,rubber,[0.04,0.41,-0.08],[0.15,0.025,-0.22],0.009);
  const commons = BUILDINGS.find(b=>b.kind==='commons');
  const cafeEntry = entrancePoint(commons,2.7), bikeX = cafeEntry.x-9, bikeZ = cafeEntry.z;
  for(let i=0;i<5;i++) all.addBuilder(bike,mat4([bikeX+i*0.9,0.085,bikeZ],[0,0.05*(i%2),0]));
  for(const x of [bikeX-.5,bikeX+4.2]) tube(all,metal,[x,0.08,bikeZ+.15],[x,0.74,bikeZ+.15],0.025);
  tube(all,metal,[bikeX-.5,0.74,bikeZ+.15],[bikeX+4.2,0.74,bikeZ+.15],0.025);

  const group=all.build({name:'Parked cars and bicycles'});
  let triangles=0;
  group.traverse(mesh=>{if(mesh.isMesh)triangles+=(mesh.geometry.index?.count||mesh.geometry.attributes.position.count)/3;});
  group.userData.stats={cars:bays.length,bicycles:5,triangles,materials:group.children.length};
  group.userData.bicycleParking = { minX:bikeX-.55,maxX:bikeX+4.25,minZ:bikeZ-.9,maxZ:bikeZ+.9 };
  tire.dispose(); rim.dispose(); wheel.dispose(); bikeRim.dispose(); cylinder.dispose();
  return group;
}
