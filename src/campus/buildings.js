import * as THREE from 'three';
import { Builder, mat4, instanced } from '../core/geom.js';
import { rng } from '../core/rng.js';
import { BUILDINGS, entrancePoint } from './layout.js';
import { buildingMaterials } from './building-materials.js';
import { cutPavingStone } from './arcade-paving.js';
import { buildArcadeSoffits } from './arcade-soffit.js';
import { buildGalleryCladding } from './gallery-cladding.js';
import { buildTerracePlanting } from './terrace-planting.js';

// One flat chamfer per edge: 44 triangles, with a real millimetre radius on
// every axis. Scaling a rounded unit cube would stretch the bevel on long piers.
function chamferedBox(w, h, d, radius) {
  const half = [w/2,h/2,d/2], inner = half.map(v=>v-radius), positions = [];
  const polygon = vertices => {
    const a = new THREE.Vector3(...vertices[0]), b = new THREE.Vector3(...vertices[1]), c = new THREE.Vector3(...vertices[2]);
    if (b.sub(a).cross(c.sub(a)).dot(a)<0) vertices.reverse();
    for(let i=1;i<vertices.length-1;i++) positions.push(...vertices[0],...vertices[i],...vertices[i+1]);
  };
  for(let axis=0;axis<3;axis++)for(const sign of [-1,1]) {
    const a=(axis+1)%3,b=(axis+2)%3;
    polygon([[-1,-1],[1,-1],[1,1],[-1,1]].map(([s,t])=>{
      const p=[0,0,0];p[axis]=sign*half[axis];p[a]=s*inner[a];p[b]=t*inner[b];return p;
    }));
  }
  for(let along=0;along<3;along++)for(const s of [-1,1])for(const t of [-1,1]) {
    const a=(along+1)%3,b=(along+2)%3;
    polygon([[-1,0],[-1,1],[1,1],[1,0]].map(([end,face])=>{
      const p=[0,0,0];p[along]=end*inner[along];p[a]=s*(face?inner[a]:half[a]);p[b]=t*(face?half[b]:inner[b]);return p;
    }));
  }
  for(const x of [-1,1])for(const y of [-1,1])for(const z of [-1,1]) {
    const signs=[x,y,z];
    polygon([0,1,2].map(axis=>half.map((v,i)=>signs[i]*(i===axis?v:inner[i]))));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
  geometry.computeVertexNormals();
  return geometry;
}

export function buildBuildings({ bevels = true } = {}) {
  const root = new THREE.Group();
  root.name = 'Campus architecture';
  const m = buildingMaterials(), random = rng('campus-architecture');
  const spandrelRandom = rng('campus-architecture-spandrel');
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const batches = new Map();
  const edgeBuilder = new Builder(), edgeGeometries = new Map(), edgeBounds = new Map();
  let beveledParts = 0;
  const details = new Map(), sizes = new Map(), rooms = new Map(), paneTypes = new Map(), roofPlants = [];
  const entrances = [], arcades = [], roofHeights = {};
  const roofPlantSites=[];
  const roofFanRings=[],roofFanWells=[],roofServicePlans=[];
  const roofServiceStats={tiles:0,posts:0,fans:0};
  const arcadePlanarSurfaces = [];
  const pavingObstacles = [];
  const soffitPlans = [];
  const galleryPiers = [];
  const endwallBuilder = new Builder(), endwallPlans = [];
  const cafeFurniture = new Builder();
  let rampTriangles = 0;
  let glassZone = 0;
  const entryWidth = b => b.kind === 'headquarters' ? 10.6 : b.kind === 'commons' ? 9.5 : 8;
  const box = (material, x, y, z, w, h, d, rotation = 0, room = null) => {
    if (!(w > 0 && h > 0 && d > 0)) throw new Error('Architecture dimensions must be positive');
    if (material === m.glass) material = m.glassZones[glassZone];
    if (!material.userData.campusGlass && y-h/2 <= .1801 && y+h/2 > .1801) {
      pavingObstacles.push(new THREE.Box3(new THREE.Vector3(-w/2,-h/2,-d/2),new THREE.Vector3(w/2,h/2,d/2))
        .applyMatrix4(mat4([x,y,z],Array.isArray(rotation)?rotation:[0,rotation,0])));
    }
    let chamfer = 0;
    if (bevels && y-h/2<7.8) {
      const mineral = [m.stone,m.pale,m.concrete,m.darkStone].includes(material);
      const pier = h>1.8 && Math.min(w,d)>.2 && Math.max(w,d)<3;
      const slabEdge = h>.12 && h<.9 && Math.min(w,d)<.9 && Math.max(w,d)>3;
      if (mineral && (pier || slabEdge)) chamfer = material===m.concrete ? .012 : .008;
      const metal = material===m.aluminum || material===m.silver;
      const slender = h>1.8 && Math.min(w,d)<.13 && Math.max(w,d)<.9;
      const coping = h<.12 && Math.min(w,d)<.4 && Math.max(w,d)>1;
      if (metal && (slender || coping)) chamfer = .002;
    }
    if (chamfer) {
      const key = `${w},${h},${d},${chamfer}`;
      if (!edgeGeometries.has(key)) edgeGeometries.set(key,chamferedBox(w,h,d,chamfer));
      const transform = mat4([x,y,z],Array.isArray(rotation)?rotation:[0,rotation,0]);
      edgeBuilder.add(edgeGeometries.get(key),material,transform);
      if (!edgeBounds.has(material)) edgeBounds.set(material,[]);
      edgeBounds.get(material).push(new THREE.Box3(new THREE.Vector3(-w/2,-h/2,-d/2),new THREE.Vector3(w/2,h/2,d/2)).applyMatrix4(transform));
      beveledParts++;return;
    }
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material).push(mat4([x, y, z], Array.isArray(rotation) ? rotation : [0, rotation, 0], [w, h, d]));
    if (material.userData.campusGlass) {
      if (!details.has(material)) { details.set(material, []); sizes.set(material, []); rooms.set(material, []); paneTypes.set(material, []); }
      const paneType = room?.spandrel ? 1 : 0;
      // A separate seed preserves every existing window and terrace plant.
      const paneRandom = room?.random ?? (paneType ? spandrelRandom : random);
      const pane = [paneRandom.next(), paneRandom.next(), paneRandom.float(0.18, 0.82), paneRandom.next()];
      if (room?.detail) pane.splice(1, 3, ...room.detail);
      const paneHeight = Math.max(h, d);
      details.get(material).push(...pane);
      sizes.get(material).push(w, paneHeight);
      rooms.get(material).push(...(room?.layout || [0,Math.max(3,w*3),paneHeight/2+.1,paneHeight/2+.35]));
      paneTypes.get(material).push(paneType);
    }
  };

  function terrace(x, z, w, d, y, planted = false, cladding = m.pale, parapetHeight = 0.82) {
    box(m.roof, x, y + 0.06, z, w - 0.24, 0.12, d - 0.24);
    for (const s of [-1, 1]) {
      box(cladding, x, y + parapetHeight / 2, z + s * (d / 2 - 0.14), w, parapetHeight, 0.28);
      box(m.silver, x, y + parapetHeight + 0.02, z + s * (d / 2 - 0.14), w + 0.04, 0.055, 0.34);
      box(cladding, x + s * (w / 2 - 0.14), y + parapetHeight / 2, z, 0.28, parapetHeight, d - 0.56);
      box(m.silver, x + s * (w / 2 - 0.14), y + parapetHeight + 0.02, z, 0.34, 0.055, d - 0.56);
    }
    if (planted) {
      for (const s of [-1, 1]) {
        box(m.concrete, x + s * (w / 2 - 1.25), y + 0.32, z, 1.2, 0.55, d - 3);
        box(m.soil, x + s * (w / 2 - 1.25), y + 0.61, z, 1.02, 0.08, d - 3.2);
        for (let k = -d / 2 + 2; k < d / 2 - 1.3; k += 1.15) {
          box(m.foliage, x + s * (w / 2 - 1.25), y + 0.74, z + k, 0.95, random.float(0.22, 0.42), 1.05);
        }
      }
    }
  }

  function planter(x, z, w, d, y, eastRootInset = 0) {
    box(m.concrete,x,y+.04,z,w,.08,d);
    for(const side of [-1,1]) {
      box(m.concrete,x+side*(w/2-.045),y+.28,z,.09,.4,d);
      box(m.concrete,x,y+.28,z+side*(d/2-.045),w-.18,.4,.09);
    }
    box(m.soil, x, y + 0.265, z, w - 0.18, 0.37, d - 0.18);
    for (let ix = -w / 2 + 0.5; ix < w / 2 - 0.2; ix += 0.7) {
      for (let iz = -d / 2 + 0.4; iz < d / 2 - 0.2; iz += 0.65) {
        roofPlants.push(mat4([x + ix + random.float(-0.12, 0.12), y + 0.72, z + iz], [0, random.float(0, Math.PI), 0], [random.float(0.7, 1), random.float(0.5, 0.85), random.float(0.65, 0.9)]));
        const matrix=roofPlants[roofPlants.length-1],p=matrix.elements;
        const shapeSeed=`terrace-shrub-${p[12]},${p[13]},${p[14]}`,rootOffsetX=ix>0?-eastRootInset:0;
        p[12]+=rootOffsetX;
        roofPlantSites.push({ground:y+.45,bounds:[x-w/2+.09,x+w/2-.09,z-d/2+.09,z+d/2-.09],shapeSeed,rootOffsetX});
      }
    }
  }

  function roofGarden(x, z, w, d, y, angle = 0) {
    const dx = Math.cos(angle), dz = -Math.sin(angle), nx = Math.sin(angle), nz = Math.cos(angle);
    const place = (material, u, height, v, bw, bh, bd) => box(material, x + dx*u + nx*v, height, z + dz*u + nz*v, bw, bh, bd, angle);
    place(m.wood, 0, y + 0.14, 0, w, 0.12, d);
    for (let k = -d / 2 + 0.18; k < d / 2; k += 0.28) place(m.darkMetal, 0, y + 0.205, k, w, 0.009, 0.012);
    for (const side of [-1, 1]) {
      const u = side * (w / 2 - 0.65);
      planter(x + dx*u, z + dz*u, Math.abs(dx)*1.1 + Math.abs(nx)*d, Math.abs(dz)*1.1 + Math.abs(nz)*d, y + 0.2);
    }
    for (const side of [-1, 1]) {
      place(m.wood, side * (w / 2 - 1.8), y + 0.62, 0, 0.6, 0.15, Math.min(d - 0.8, 3.6));
      for (const end of [-1, 1]) place(m.darkMetal, side * (w / 2 - 1.8), y + 0.42, end * Math.min(d / 2 - 0.8, 1.25), 0.45, 0.42, 0.09);
    }
  }

  // Real four-bay openings only on the selected upper office end elevations.
  function endwallStorey(b,x,z,distance,span,base,place,wall) {
    const bay=span/4, frame=.055, bite=.006, glazingInset=frame-bite;
    const shape=new THREE.Shape([new THREE.Vector2(-span/2,.01),new THREE.Vector2(span/2,.01),
      new THREE.Vector2(span/2,b.floorHeight-.01),new THREE.Vector2(-span/2,b.floorHeight-.01)]);
    const plan={id:b.id,x,z:z+distance,base,span,openings:[]};
    // The removed two ordinary panes each consumed four draws from the shared stream.
    for(let i=0;i<8;i++)random.next();
    for(let col=0;col<4;col++) {
      const service=col===(b.id==='a'?0:3),u=-span/2+(col+.5)*bay;
      const w=service?1.15:3.2,h=service?b.floorHeight-1.12:2.05,sill=service?.6:.85;
      const lo=u-w/2,hi=u+w/2,head=sill+h;
      shape.holes.push(new THREE.Path([new THREE.Vector2(lo,sill),new THREE.Vector2(lo,head),new THREE.Vector2(hi,head),new THREE.Vector2(hi,sill)]));
      const paneRandom=rng(`office-end:${b.id}:${base}:${col}`);
      const detail=[paneRandom.next(),paneRandom.float(.18,.82),paneRandom.next()];
      const center=sill+h/2,intervals=service?[[lo+glazingInset,hi-glazingInset]]:
        [[lo+glazingInset,u-frame/2+bite],[u+frame/2-bite,hi-glazingInset]];
      const opening={col,service,u,w,h,sill,head,panes:[]};
      for(const [left,right]of intervals) {
        const paneCenter=(left+right)/2,layout=[paneCenter-u,bay,center,b.floorHeight-.28-center];
        place(m.glass,paneCenter,base+center,-.19,right-left,h-2*glazingInset,.045,{random:paneRandom,detail,layout});
        opening.panes.push({left,right,bottom:sill+glazingInset,top:head-glazingInset,layout});
      }
      // Four closed pressure frames meet the wall return and conceal a 6mm glass bite.
      for(const side of [-1,1])place(m.darkMetal,u+side*(w/2-frame/2),base+center,-.1725,frame,h,.095);
      for(const side of [-1,1])place(m.darkMetal,u,base+center+side*(h/2-frame/2),-.1725,w-2*frame,frame,.095);
      if(!service)place(m.darkMetal,u,base+center,-.1725,frame,h-2*frame,.095);
      plan.openings.push(opening);
    }
    const geometry=new THREE.ExtrudeGeometry(shape,{depth:.34,steps:1,bevelEnabled:false,curveSegments:1});
    geometry.translate(0,0,-.13);
    endwallBuilder.add(geometry,wall,mat4([x,base,z+distance]));geometry.dispose();
    // Retain the existing recessed floor separation without changing neighbouring ledges.
    place(m.darkStone,0,base+.012,-.1,span,.022,.05);
    endwallPlans.push(plan);
  }

  // A facade coordinate system keeps all four elevations consistent, including corner returns.
  function facade(b, x, z, w, d, bottom, floors, kind, continuedSides = []) {
    const fh = b.floorHeight;
    const isStone = kind === 'stone';
    const isGallery = kind === 'gallery';
    const targetBay = isStone ? 2.8 : isGallery ? 4.25 : 1.6;
    for (const side of [0, 1, 2, 3]) {
      const front = side === ({ south: 0, east: 1, north: 2, west: 3 }[b.entranceSide || 'south']);
      const horizontal = side % 2 === 0;
      const span = horizontal ? w : d;
      const count = Math.round(span / targetBay), bay = span / count;
      const angle = side * Math.PI / 2;
      const continuesAbove = continuedSides.includes(side);
      const dx = Math.cos(angle), dz = -Math.sin(angle);
      const nx = Math.sin(angle), nz = Math.cos(angle);
      const distance = (horizontal ? d : w) / 2;
      // Only C's upper east panes use the elevated static capture; retain all pane RNG calls.
      const place = (material, u, y, depth, bw, bh, bd, room = null) => {
        let px=x+dx*u+nx*(distance+depth);
        if(b.kind==='commons' && bottom===.16) {
          if(side===1)px-=5;
          if(horizontal) {
            const left=px-bw/2,right=Math.min(px+bw/2,b.x+b.w/2-5.1);
            if(right<=left) {
              // Retain the original glass and roof-plant random streams when a pane is removed.
              if(material.userData.campusGlass) {
                const pr=room?.random??(room?.spandrel?spandrelRandom:random);
                pr.next();pr.next();pr.float(.18,.82);pr.next();
              }
              return;
            }
            if(right<px+bw/2) {
              const center=(left+right)/2;
              if(room?.layout)room={...room,layout:[room.layout[0]+dx*(center-px),...room.layout.slice(1)]};
              px=center;bw=right-left;
            }
          }
        }
        box(material===m.glass && b.id==='c' && side===1 && bottom>=.16+b.floorHeight?m.glassZones[3]:material,
          px,y,z+dz*u+nz*(distance+depth),bw,bh,bd,angle,room);
      };
      const galleryPier = (u,y,bw,bh) => galleryPiers.push({
        x:x+dx*u+nx*(distance+.025), y, z:z+dz*u+nz*(distance+.025), w:bw, h:bh, d:.75, side,
      });
      // Narrow ends contain stairs and service rooms. Their punched openings and
      // solid cladding deliberately differ from the long office elevations.
      if (b.kind === 'office' && horizontal) {
        const wall = b.variant === 0 ? m.stone : m.pale;
        const slotW = 1.15, slotH = fh - 1.12;
        const slots = [-span * 0.28, span * 0.28];
        const intervals = [-span/2, slots[0]-slotW/2, slots[0]+slotW/2, slots[1]-slotW/2, slots[1]+slotW/2, span/2];
        for (let f = 0; f < floors; f++) {
          const base = bottom + f*fh;
          if (side===0 && (b.id==='a'||b.id==='d') && kind==='stone' && base>=.16+fh-1e-8 && base<.16+4*fh-1e-8) {
            endwallStorey(b,x,z,distance,span,base,place,wall);continue;
          }
          place(wall, 0, base + 0.31, 0.04, span, 0.60, 0.34);
          place(wall, 0, base + fh - 0.26, 0.04, span, 0.50, 0.34);
          place(m.darkStone, 0, base + 0.012, -0.1, span, 0.022, 0.05);
          for (let j = 0; j < intervals.length; j += 2) {
            const a = intervals[j], c = intervals[j+1], panels = Math.ceil((c-a)/1.5), panelW = (c-a)/panels;
            for (let p = 0; p < panels; p++) place(wall, a+(p+0.5)*panelW, base + 0.6 + slotH/2, 0.04, panelW-0.018, slotH, 0.34);
          }
          for (const u of slots) {
            place(m.glass, u, base + 0.6 + slotH/2, -0.19, slotW-0.1, slotH-0.08, 0.045);
            for (const s of [-1, 1]) place(m.darkMetal, u+s*(slotW/2-0.028), base+0.6+slotH/2, -0.07, 0.055, slotH, 0.34);
            place(m.darkMetal, u, base+0.61, 0.065, slotW, 0.06, 0.45);
          }
        }
        continue;
      }
      for (let floor = 0; floor < floors; floor++) {
        const base = bottom + floor * fh;
        const ground = base < 0.5;
        const spandrelH = ground ? 0.42 : isStone ? 0.72 : 0.64;
        const glassH = fh - spandrelH - 0.12;
        // Office partitions follow structural bays, not individual glass panes.
        // Adjacent panes see the same room, ceiling grid and lighting state.
        const roomBays = isStone || isGallery ? 2 : 3;
        const roomDetails = Array.from({length:Math.ceil(count/roomBays)},(_,i) => {
          const roomRng = rng(`${b.id}:${side}:${bottom}:${floor}:room-${i}`);
          return [roomRng.next(),roomRng.float(.18,.82),roomRng.next()];
        });
        // Slab edges, glazing gaskets and reveals cast separate, readable shadows.
        const curtain = !isStone && !isGallery;
        // The 6mm glass bite is concealed behind the pressure caps. Pane edges
        // stop inside each rail, rather than overlapping adjacent glass faces.
        const visionBottom = curtain ? .074 : .1;
        const visionTop = curtain ? glassH + .0435 : glassH + .1;
        const visionHeight = visionTop - visionBottom;
        const visionCenter = (visionBottom + visionTop) / 2;
        const spandrelBottom = curtain ? glassH + .0965 : fh - spandrelH;
        const spandrelTop = curtain ? fh + (floor === floors - 1 && !continuesAbove ? -.006 : .016) : fh;
        const panelHeight = spandrelTop - spandrelBottom;
        const panelCenter = (spandrelBottom + spandrelTop) / 2;
        // The insulated backing sits behind one continuous exterior glass plane.
        place(curtain ? m.spandrel : m.stone, 0, base + panelCenter, curtain ? -.33 : -.06, span, panelHeight, .27);
        place(m.darkMetal, 0, base + .045, curtain ? -.18 : -.015, span, .07, .16);
        place(m.aluminum, 0, base + glassH + .07, curtain ? -.20 : .03, span, .065, .20);
        const entranceBay = col => ground && front && Math.abs(-span / 2 + (col + .5) * bay) < entryWidth(b) / 2 + bay / 2;
        for (let col = 0; col < count; col++) {
          const u = -span / 2 + (col + 0.5) * bay;
          const entrance = entranceBay(col);
          const pierW = isStone ? 0.56 : isGallery ? bay * 0.68 : 0.075;
          const glassW = bay - pierW + (curtain ? .012 : -.045);
          if (curtain) place(m.glass, u, base + panelCenter, -.15, glassW, panelHeight, .045, { spandrel:true });
          if (entrance) continue;
          const pierCenter = u - bay / 2 + (isGallery && col === 0 ? pierW / 4 : 0);
          const visiblePierWidth = isGallery && col === 0 ? pierW / 2 : pierW;
          const roomIndex = Math.floor(col/roomBays), firstBay = roomIndex*roomBays;
          const roomWidth = Math.min(roomBays,count-firstBay)*bay;
          const room = {
            detail:roomDetails[roomIndex],
            layout:[(col-firstBay+.5)*bay-roomWidth/2,roomWidth,visionCenter,fh-.28-visionCenter],
          };
          place(m.glass, u, base + visionCenter, -.15, glassW, visionHeight, .045, room);
          // Stone has expressed full-depth piers; curtain walls have finer extruded mullions.
          if (isGallery) galleryPier(pierCenter,base+fh/2,visiblePierWidth,fh-.035);
          else place(isStone ? m.stone : m.aluminum, pierCenter,
            base + fh / 2, curtain ? -.216 : .13, visiblePierWidth, curtain ? fh : fh - .035, isStone ? .66 : .24);
          // A skipped entrance bay cannot supply the preceding window's right
          // mullion. Close that last ordinary pane without altering the portal.
          if (curtain && col + 1 < count && entranceBay(col + 1)) {
            const closureU = u + bay / 2;
            const meetsPortal = closureU + pierW/2 > -entryWidth(b)/2-.44 && closureU-pierW/2 < -entryWidth(b)/2;
            // The gallery's existing stone jamb already closes the vision
            // pane. Only its spandrel needs a short mullion above that jamb.
            const closureBottom = meetsPortal ? fh-.29 : base;
            const closureTop = base + fh;
            place(m.aluminum, closureU, (closureBottom+closureTop)/2, -.216, pierW, closureTop-closureBottom, .24);
          }
          if (isStone && !ground) {
            place(m.darkMetal, u, base + 0.13, 0.17, bay - pierW, 0.07, 0.66);
            place(m.aluminum, u + glassW * 0.19, base + glassH / 2 + 0.1, -0.09, 0.045, glassH, 0.13);
          }
          if (!isStone && !isGallery && col % 3 === 0 && !ground) {
            place(b.kind === 'headquarters' ? m.aluminum : m.pale, u - bay / 2, base + fh / 2, 0.22, b.kind === 'headquarters' ? 0.085 : 0.105, fh - 0.035, 0.67);
          }
        }
      }
      // A volume can end below a setback or a stone storey, where there is no
      // coplanar next-floor sill. This cap closes its own glazing independently.
      if (!isStone && !isGallery && !continuesAbove) place(m.aluminum, 0, bottom + floors * fh + .023, -.18, span, .07, .16);
      if (isGallery) galleryPier(span/2-bay*.17,bottom+floors*fh/2,bay*.34,floors*fh);
      else place(isStone ? m.stone : m.aluminum, span / 2, bottom + floors * fh / 2, isStone ? .13 : -.216,
        isStone ? .56 : .075, floors * fh, isStone ? .66 : .24);
      if (b.kind==='commons' && bottom===.16 && horizontal) {
        // The shortened north/south panes need a new jamb, with the same 6mm glass bite.
        const cutX=b.x+b.w/2-5.1;
        box(m.aluminum,cutX+.075/2-.006,bottom+floors*fh/2,z+nz*(distance-.216),.075,floors*fh,.24,angle);
      }
    }
  }

  function volume(b, x, z, w, d, bottom, floors, kind, roof = true, continuedSides = []) {
    const height = floors * b.floorHeight;
    // A recessed solid core closes corners and keeps dark spaces behind the glazing.
    const cafeSetback=b.kind==='commons' && bottom===.16?5:0;
    box(m.recess, x-cafeSetback/2, bottom + height / 2, z, w - 0.46-cafeSetback, height, d - 0.46);
    facade(b, x, z, w, d, bottom, floors, kind, continuedSides);
    if (roof) terrace(x, z, w, d, bottom + height, false, b.kind === 'commons' ? m.wood : kind === 'stone' || kind === 'gallery' ? m.stone : m.pale, b.kind === 'commons' ? 0.35 : 0.82);
    return bottom + height;
  }

  function entrance(b) {
    const e = entrancePoint(b), angle = Math.atan2(e.nx, e.nz);
    const tx = e.nz, tz = -e.nx;
    const place = (material, u, y, v, w, h, d, room = null) => box(material, e.x + tx*u + e.nx*v, y, e.z + tz*u + e.nz*v, w, h, d, angle, room);
    const width = entryWidth(b);
    const height = b.floorHeight - 0.5;
    entrances.push({ id: b.id, x: e.x, z: e.z, nx: e.nx, nz: e.nz, recessed: !!b.arcade });
    place(m.recess, 0, height/2 + 0.16, -0.48, width, height, 0.12);
    place(m.darkStone, 0, 0.08, 0.98, width+1.4, 0.16, 2.35);
    // Keep the ramp wholly on the existing approach; the gallery path is diagonal.
    const rampCenter = b.kind==='headquarters' ? 2.25 : b.kind==='gallery' ? 3 : 0;
    if (!b.arcade) {
      if (b.kind==='commons') place(m.concrete, 0, 0.04, 2.28, width+1.8, 0.08, 0.3);
      else for (const [left,right] of [[-width/2-.9,rampCenter-.6],[rampCenter+.6,width/2+.9]]) {
        place(m.concrete, (left+right)/2, 0.04, 2.28, right-left, 0.08, 0.3);
      }
    }
    const ramp = new THREE.BufferGeometry();
    const rx = width/2+1.35;
    const local = [[rx-.6,.005,2.4],[rx+.6,.005,2.4],[rx+.6,.16,.32],
      [rx-.6,.005,2.4],[rx+.6,.16,.32],[rx-.6,.16,.32]];
    let positions=local.flatMap(([u,y,v]) => [e.x+tx*u+e.nx*v,y,e.z+tz*u+e.nz*v]);
    if(b.kind==='commons') {
      // Closed 4.09% wedge from the existing .075m path to the .16m landing.
      // The original west ramp ended against the portal pier; this reaches the clear north route.
      const points=[[-20.4,.075,52.57],[-19.2,.075,52.57],[-19.2,.16,54.65],[-20.4,.16,54.65],
        [-20.4,.055,52.57],[-19.2,.055,52.57],[-19.2,.055,54.65],[-20.4,.055,54.65]];
      const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
        [3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]];
      positions=faces.flatMap(face=>face.flatMap(index=>points[index]));
    } else if (!b.arcade) {
      // A closed 4.09% wedge joins the outermost .16m surface to the .075m road.
      // The gallery's full-width base projects beyond its recessed foyer landing.
      const base = entrancePoint(BUILDINGS.find(value=>value.id===b.id), .08);
      const top = Math.max(.98+2.35/2, (base.x-e.x)*e.nx+(base.z-e.z)*e.nz), foot = top+2.08;
      const points = [[rampCenter-.6,.075,foot],[rampCenter+.6,.075,foot],
        [rampCenter+.6,.16,top],[rampCenter-.6,.16,top],
        [rampCenter-.6,.055,foot],[rampCenter+.6,.055,foot],
        [rampCenter+.6,.055,top],[rampCenter-.6,.055,top]];
      const faces = [[0,1,2],[0,2,3],[4,6,5],[4,7,6],[0,5,1],[0,4,5],
        [3,2,6],[3,6,7],[0,3,7],[0,7,4],[1,5,6],[1,6,2]];
      positions = faces.flatMap(face=>face.flatMap(index=>{
        const [u,y,v]=points[index]; return [e.x+tx*u+e.nx*v,y,e.z+tz*u+e.nz*v];
      }));
    }
    const vertices = new Float32Array(positions);
    rampTriangles+=vertices.length/9;
    ramp.setAttribute('position', new THREE.BufferAttribute(vertices,3));
    ramp.computeVertexNormals();
    const rampMesh = new THREE.Mesh(ramp, m.concrete);
    rampMesh.name = `Entry ramp ${b.id}`;
    rampMesh.receiveShadow = true; root.add(rampMesh);
    for (const s of [-1, 1]) {
      place(m.darkStone, s*(width/2+.22), height/2+.16, -0.05, .44, height+.1, .85);
    }
    if (!b.arcade) {
      place(m.darkMetal, 0, height+.34, 0.95, width+2.5, .24, 2.8);
      place(m.wood, 0, height+.185, 0.95, width+2.25, .065, 2.65);
      place(m.silver, 0, height+.47, 0.95, width+2.6, .04, 2.9);
    }
    const doorH = height-0.28;
    const foyerRng = rng(`${b.id}:foyer`), foyerDetail = [foyerRng.next(),.75,.5];
    const firstDoorGlass = batches.get(m.glassZones[glassZone])?.length || 0;
    const doorDepth = b.arcade ? -.1525 : -.24;
    for (let i = 0; i < 4; i++) {
      const u = (i-1.5)*width/4;
      place(m.glass, u, .16+doorH/2, doorDepth, width/4-.06, doorH, .05,
        {detail:foyerDetail,layout:[u,width+.4,doorH/2,b.floorHeight-.34-doorH/2]});
      place(m.darkMetal, u-width/8, .16+doorH/2, -.18, .065, doorH+.04, .12);
    }
    place(m.darkMetal, 0, .16+doorH+.07, -.18, width, .12, .13);
    place(m.glass, 0, .16+doorH+.20, doorDepth, width, .2, .05,
      {detail:foyerDetail,layout:[0,width+.4,doorH+.2,b.floorHeight-.34-doorH-.2]});
    if (b.arcade) {
      const surface = arcadePlanarSurfaces.find(value=>value.id===b.id);
      const bounds = new THREE.Box3(new THREE.Vector3(...surface.min),new THREE.Vector3(...surface.max));
      for (const instance of batches.get(m.glassZones[glassZone]).slice(firstDoorGlass)) {
        const matrix = new THREE.Matrix4().fromArray(new Float32Array(instance.elements));
        bounds.union(new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrix));
      }
      if (e.nx) bounds.min.x=bounds.max.x=surface.point[0];
      else bounds.min.z=bounds.max.z=surface.point[2];
      surface.min=bounds.min.toArray(); surface.max=bounds.max.toArray();
    }
    for (const s of [-1, 1]) place(m.silver, s*.19, 1.35, -.06, .035, .65, .06);
    for (const s of [-1, 1]) {
      place(m.darkMetal, s*(width/2-.2), 1.15, .42, .1, 1.4, .22);
    }
  }

  function arcade(b, floors, kind) {
    const e = entrancePoint(b), depth = 2.4;
    const ground = { ...b, x: b.x-e.nx*depth/2, z: b.z-e.nz*depth/2,
      w: b.w-Math.abs(e.nx)*depth, d: b.d-Math.abs(e.nz)*depth };
    const slabY = .16+b.floorHeight;
    const firstGlass = batches.get(m.glassZones[glassZone])?.length || 0;
    // The setback moves only the courtyard face. An upper curtain wall on the
    // unchanged back face owns the shared storey sill, so no second cap is added.
    const backSide = ({ south: 2, east: 3, north: 0, west: 1 })[b.entranceSide || 'south'];
    volume(ground, ground.x, ground.z, ground.w, ground.d, .16, 1, 'curtain', false, kind === 'curtain' ? [backSide] : []);
    const frontBounds = new THREE.Box3(), outward = new THREE.Vector3(e.nx,0,e.nz);
    let frontPoint;
    for (const instance of batches.get(m.glassZones[glassZone]).slice(firstGlass)) {
      // Match the uploaded Float32 instance matrices, including the actual glass thickness.
      const matrix = new THREE.Matrix4().fromArray(new Float32Array(instance.elements));
      const normal = new THREE.Vector3().setFromMatrixColumn(matrix,2);
      if (normal.clone().normalize().dot(outward) < .999) continue;
      frontPoint ||= new THREE.Vector3().setFromMatrixPosition(matrix).addScaledVector(normal,.5);
      frontBounds.union(new THREE.Box3(new THREE.Vector3(-.5,-.5,-.5),new THREE.Vector3(.5,.5,.5)).applyMatrix4(matrix));
    }
    if (frontPoint) {
      if (e.nx) frontBounds.min.x = frontBounds.max.x = frontPoint.x;
      else frontBounds.min.z = frontBounds.max.z = frontPoint.z;
      arcadePlanarSurfaces.push({id:b.id,point:frontPoint.toArray(),normal:outward.toArray(),
        min:frontBounds.min.toArray(),max:frontBounds.max.toArray()});
    }
    const roofY = volume(b, b.x, b.z, b.w, b.d, slabY, floors-1, kind);
    const span = e.nx ? b.d : b.w, angle = Math.atan2(e.nx,e.nz);
    const tx = e.nz, tz = -e.nx;
    const place = (material,u,y,v,w,h,d) => box(material,e.x+tx*u+e.nx*v,y,e.z+tz*u+e.nz*v,w,h,d,angle);
    place(m.concrete,0,slabY-.16,-depth/2,span,.32,depth);
    // A continuous recessed bed closes the joints and conceals the older .16m landing.
    place(m.pavingJoint,0,.089,-depth/2,span,.178,depth);
    const bays = 2*Math.ceil(span/12), step = (span-1.2)/bays, columns=[];
    for (let i=0;i<=bays;i++) {
      const u = -(span-1.2)/2+i*step;
      // A clear 6m entrance bay interrupts the regular structural rhythm.
      if (Math.abs(u)<3) continue;
      place(m.concrete,u,(slabY-.32+.18)/2,-.28,.44,slabY-.32-.18,.44);
      // Keep the visible .46m top; the base seats 2mm into the recessed mortar bed.
      place(m.darkStone,u,.318,-.28,.46,.284,.46);
      columns.push([u-.22,u+.22,-.5,-.06]);
    }
    soffitPlans.push({id:b.id,origin:[e.x,e.z],angle,span:span-.6,depth:depth-.35,centerV:-depth/2,bottom:slabY-.35,columns});
    arcades.push({ id:b.id,depth,facadeX:e.x,facadeZ:e.z,insideX:entrancePoint(ground).x,insideZ:entrancePoint(ground).z,soffitY:slabY-.35,span });
    return { height:roofY,ground };
  }

  function buildArcadePaving() {
    const joint=.003, bevel=.001, top=.18, thickness=.02, moduleU=.9, moduleV=.6;
    const group=new THREE.Group(), cuts=new Builder(), matrices=[], colors=[];
    group.name='Cut stone arcade paving';
    const stats={joint,bevel,top,thickness,bedTop:.178,module:[moduleU,moduleV],fullTiles:0,cutTiles:0,triangles:0,surfaces:[]};
    const tileGeometry=chamferedBox(moduleU-joint,thickness,moduleV-joint,bevel);
    tileGeometry.setAttribute('color',new THREE.Float32BufferAttribute(new Float32Array(tileGeometry.attributes.position.count*3).fill(1),3));
    const subtract=(rect,obstacle)=>{
      const u0=Math.max(rect[0],obstacle[0]),u1=Math.min(rect[1],obstacle[1]);
      const v0=Math.max(rect[2],obstacle[2]),v1=Math.min(rect[3],obstacle[3]);
      if(u1<=u0 || v1<=v0) return [rect];
      return [[rect[0],u0,rect[2],rect[3]],[u1,rect[1],rect[2],rect[3]],
        [u0,u1,rect[2],v0],[u0,u1,v1,rect[3]]].filter(r=>r[1]-r[0]>2*bevel && r[3]-r[2]>2*bevel);
    };
    for(const arcade of arcades) {
      const b=BUILDINGS.find(value=>value.id===arcade.id),e=entrancePoint(b),tx=e.nz,tz=-e.nx;
      const angle=Math.atan2(e.nx,e.nz),span=arcade.span,depth=arcade.depth;
      const obstacles=pavingObstacles.map(bounds=>{
        const points=[bounds.min.x,bounds.max.x].flatMap(x=>[bounds.min.z,bounds.max.z].map(z=>
          [(x-e.x)*tx+(z-e.z)*tz,(x-e.x)*e.nx+(z-e.z)*e.nz]));
        return [Math.min(...points.map(p=>p[0]))-joint,Math.max(...points.map(p=>p[0]))+joint,
          Math.min(...points.map(p=>p[1]))-joint,Math.max(...points.map(p=>p[1]))+joint];
      }).filter(r=>r[1]>-span/2 && r[0]<span/2 && r[3]>-depth && r[2]<0);
      const surface={id:arcade.id,origin:[e.x,e.z],tangent:[tx,tz],normal:[e.nx,e.nz],span,depth,obstacles,tiles:[]};
      const random=rng(`campus-arcade-paving-${arcade.id}`),columns=Math.ceil(span/moduleU);
      for(let column=0;column<columns;column++)for(let row=0;row<Math.round(depth/moduleV);row++) {
        const u=(column-columns/2)*moduleU,v=-depth+row*moduleV;
        const cell=[Math.max(-span/2,u)+joint/2,Math.min(span/2,u+moduleU)-joint/2,v+joint/2,v+moduleV-joint/2];
        let pieces=[cell];
        for(const obstacle of obstacles) pieces=pieces.flatMap(rect=>subtract(rect,obstacle));
        // Instance/vertex colours are linear reflectance multipliers, not sRGB swatches.
        const tone=random.float(.97,1.03),warm=random.float(-.004,.004);
        const color=new THREE.Color().setRGB(tone+warm,tone,tone-warm,THREE.LinearSRGBColorSpace);
        if(!pieces.length)continue;
        const rect=pieces[0],w=rect[1]-rect[0],d=rect[3]-rect[2],uCenter=(rect[0]+rect[1])/2,vCenter=(rect[2]+rect[3])/2;
        const regular=pieces.length===1 && Math.abs(w-(moduleU-joint))<1e-8 && Math.abs(d-(moduleV-joint))<1e-8;
        let footprint;
        if(regular) {
          matrices.push(mat4([e.x+tx*uCenter+e.nx*vCenter,top-thickness/2,e.z+tz*uCenter+e.nz*vCenter],[0,angle,0]));
          colors.push(color);stats.fullTiles++;stats.triangles+=44;
          footprint=[[[rect[0],rect[2]],[rect[1],rect[2]],[rect[1],rect[3]],[rect[0],rect[3]]]];
        } else {
          const geometry=cutPavingStone(pieces,top,thickness,bevel),values=[];
          for(let vertex=0;vertex<geometry.attributes.position.count;vertex++)values.push(color.r,color.g,color.b);
          geometry.setAttribute('color',new THREE.Float32BufferAttribute(values,3));
          cuts.add(geometry,m.arcadePaving,mat4([e.x,0,e.z],[0,angle,0]));
          stats.cutTiles++;stats.triangles+=geometry.attributes.position.count/3;
          footprint=geometry.userData.footprint;geometry.dispose();
        }
        surface.tiles.push({rect:cell,cell:[column,row],regular,footprint});
      }
      stats.surfaces.push(surface);
    }
    if(matrices.length) {
      const mesh=instanced(tileGeometry,m.arcadePaving,matrices);
      mesh.name='Full 600 x 900mm arcade stones';
      colors.forEach((color,index)=>mesh.setColorAt(index,color));mesh.instanceColor.needsUpdate=true;
      group.add(mesh);
    } else tileGeometry.dispose();
    const cutGroup=cuts.build({name:'Arcade stone edge and column cuts'});
    group.add(cutGroup);
    group.userData=stats;
    return group;
  }

  function roofMaintenance(x,z,w,d,y,sw,sd) {
    const doorX=w/2-4.1,doorZ=d/2-1.66,width=1.2,joint=.006,module=.6;
    const rects=[[-width/2,doorX+width/2,doorZ,doorZ+width],
      [-width/2,width/2,.35,doorZ+.6],[-4.65,4.65,-.25,.95]];
    // Make a disjoint route before laying modules; this keeps the three
    // runs joined without coplanar paving or unnecessary cuts at the turns.
    const subtract=(rect,cut)=>{
      const x0=Math.max(rect[0],cut[0]),x1=Math.min(rect[1],cut[1]),z0=Math.max(rect[2],cut[2]),z1=Math.min(rect[3],cut[3]);
      if(x1-x0<1e-8||z1-z0<1e-8)return[rect];
      return [[rect[0],x0,rect[2],rect[3]],[x1,rect[1],rect[2],rect[3]],
        [x0,x1,rect[2],z0],[x0,x1,z1,rect[3]]].filter(r=>r[1]-r[0]>1e-8&&r[3]-r[2]>1e-8);
    };
    const disjoint=[];
    for(const rect of [rects[2],rects[0],rects[1]]) {
      let pieces=[rect];for(const used of disjoint)pieces=pieces.flatMap(p=>subtract(p,used));
      disjoint.push(...pieces);
    }
    for(const r of disjoint)for(let ix=0;ix<Math.ceil((r[1]-r[0]-1e-8)/module);ix++)for(let iz=0;iz<Math.ceil((r[3]-r[2]-1e-8)/module);iz++) {
      const p=[r[0]+ix*module,Math.min(r[1],r[0]+(ix+1)*module),r[2]+iz*module,Math.min(r[3],r[2]+(iz+1)*module)];
      const pw=p[1]-p[0]-joint,pd=p[3]-p[2]-joint;
      if(pw<=0||pd<=0)throw new Error('Roof route leaves an invalid paving cut');
      box(m.darkStone,x+(p[0]+p[1])/2,y+.145,z+(p[2]+p[3])/2,pw,.05,pd);roofServiceStats.tiles++;
    }
    const front=-2.4+sd/2,back=-2.4-sd/2,gap=.75;
    const runs=[[-sw/2,back,sw/2,back],[-sw/2,back,-sw/2,front],[sw/2,back,sw/2,front],[-sw/2,front,-gap,front],[gap,front,sw/2,front]];
    const posts=new Map();
    for(const[a,b,c,e]of runs){const length=Math.hypot(c-a,e-b),parts=Math.ceil(length/2.8);
      box(m.darkMetal,x+(a+c)/2,y+.17,z+(b+e)/2,c===a?.14:length,.1,c===a?length:.14);
      for(let i=0;i<=parts;i++){const px=a+(c-a)*i/parts,pz=b+(e-b)*i/parts;posts.set(`${px.toFixed(7)},${pz.toFixed(7)}`,[px,pz]);}
    }
    for(const[px,pz]of posts.values()){box(m.aluminum,x+px,y+1.1925,z+pz,.1,2.145,.1);roofServiceStats.posts++;}
    roofServicePlans.push({x,z,w,d,y,door:[x+doorX,z+doorZ],route:rects.map(r=>[x+r[0],x+r[1],z+r[2],z+r[3]]),gate:{x,z:z+front,clearWidth:1.4},equipmentFront:z-.65,baseFront:z-.4});
  }
  function roofFan(px,pz,y) {
    // The collar meets the existing case top. Its open underside is buried;
    // the dark receiver is 10mm above that top, so it cannot z-fight with it.
    roofFanRings.push(mat4([px,y+1.725,pz]));
    roofFanWells.push(mat4([px,y+1.735,pz]));
    for(let i=0;i<3;i++) {
      const a=i*Math.PI*2/3;
      box(m.silver,px+Math.cos(a)*.17,y+1.7575,pz-Math.sin(a)*.17,.56,.025,.13,a);
    }
    roofServiceStats.fans++;
  }

  function equipment(b, y, w = b.w, d = b.d, x = b.x, z = b.z) {
    const count = b.floors > 3 ? 3 : 2;
    for (let i = 0; i < count; i++) {
      const px = x + (i - (count - 1) / 2) * 3.2;
      box(m.darkMetal, px, y + 0.18, z - 2.5, 2.7, 0.3, 4.2);
      box(m.silver, px, y + 1, z - 2.5, 2.5, 1.45, 3.7);
      for(const offset of [-.88,.88])roofFan(px,z-2.5+offset,y);
      for (const side of [-1, 1]) {
        box(m.darkMetal, px, y + 1, z - 2.5 + side * 1.87, 2.25, 1.05, 0.035);
        for (let l = 0; l < 6; l++) box(m.silver, px, y + 0.53 + l * 0.18, z - 2.5 + side * 1.91, 2.25, 0.065, 0.1);
      }
    }
    // The screen conceals mechanical plant from ordinary pedestrian sightlines.
    const sw = Math.min(w - 5, count * 3.3 + 1.3), sd = Math.min(d - 5, 8);
    for (const side of [-1, 1]) {
      for (let j = 0; j < 9; j++) {
        if(side<0)box(m.aluminum,x,y+.2+j*.25,z-2.4-sd/2,sw,.13,.1);
        else for(const s of [-1,1])box(m.aluminum,x+s*(sw+1.4)/4,y+.2+j*.25,z-2.4+sd/2,(sw-1.4)/2,.13,.1);
        box(m.aluminum, x + side * sw / 2, y + 0.2 + j * 0.25, z - 2.4, 0.1, 0.13, sd);
      }
    }
    roofMaintenance(x,z,w,d,y,sw,sd);
    box(m.concrete, x + w / 2 - 4.1, y + 1.2, z + d / 2 - 4, 4.5, 2.4, 4.6);
    box(m.silver, x + w / 2 - 4.1, y + 2.43, z + d / 2 - 4, 4.7, 0.08, 4.8);
    box(m.darkMetal, x + w / 2 - 4.1, y + 1.195, z + d / 2 - 1.68, 1.15, 2.05, 0.04);
  }

  function commonsCafe(b) {
    const front=b.x+b.w/2,wall=front-5,roofBottom=.16+b.floorHeight-.44;
    const rect=(material,x0,x1,z0,z1)=>box(material,(x0+x1)/2,.08,(z0+z1)/2,x1-x0,.16,z1-z0);
    // These meet the original landing/base at their edges; no coplanar overlay.
    rect(m.arcadePaving,-16.55,front+.08,54.65,56.92);
    rect(m.arcadePaving,-22,-16.55,54.65,54.845);
    for(const z of [57.8,63.2,68.6,74.0]) {
      box(m.darkMetal,front-.35,(roofBottom+.16)/2,z,.24,roofBottom-.16,.24);
      box(m.darkMetal,front-.35,.18,z,.32,.04,.32);
    }
    const rod=(a,c,r=.014)=>{
      const start=new THREE.Vector3(...a),end=new THREE.Vector3(...c),delta=end.sub(start);
      const geometry=new THREE.CylinderGeometry(r,r,delta.length(),8);
      const rotation=new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0,1,0),delta.clone().normalize());
      cafeFurniture.add(geometry,m.darkMetal,mat4(start.addScaledVector(delta,.5).toArray(),[0,0,0],1,rotation));geometry.dispose();
    };
    for(const z of [60.5,65.7,70.9]) {
      const x=-10.9;
      const top=new THREE.CylinderGeometry(.43,.43,.035,24);
      cafeFurniture.add(top,m.wood,mat4([x,.8825,z]));top.dispose();
      rod([x,.20,z],[x,.865,z],.035);
      for(const angle of [0,Math.PI/2,Math.PI,Math.PI*1.5])rod([x,.20,z],[x+Math.cos(angle)*.31,.18,z+Math.sin(angle)*.31],.019);
      for(const side of [-1,1]) {
        const cz=z+side*.82;
        for(const sx of [-1,1]) {
          rod([x+sx*.205,.16,cz-side*.20],[x+sx*.185,.59,cz-side*.18]);
          rod([x+sx*.205,.16,cz+side*.20],[x+sx*.185,1.00,cz+side*.255]);
          rod([x+sx*.185,.575,cz-side*.18],[x+sx*.185,.575,cz+side*.20]);
        }
        for(let i=0;i<5;i++)cafeFurniture.box(m.wood,.46,.025,.074,[x,.5975,cz+(i-2)*.083]);
        for(let i=0;i<3;i++)cafeFurniture.box(m.wood,.46,.075,.025,[x,.75+i*.10,cz+side*(.228+i*.008)],[side*.08,0,0]);
      }
    }
    root.userData.commonsCafe={wall,glassOuterX:wall-.1275,coreEastX:wall-.23,floorTop:.16,ceiling:roofBottom,
      ramp:{rect:[-20.4,-19.2,52.57,54.65],low:.075,high:.16,base:.055,turn:[-20.7,-18.9,54.65,56.45]},
      columns:[57.8,63.2,68.6,74.0],tableCenters:[60.5,65.7,70.9].map(z=>[-10.9,z]),
      routeRects:[[-22,-7.9,54.65,56.45],[-9.7,-7.9,54.65,74.6]],
      addedFloorRects:[[-16.55,front+.08,54.65,56.92],[-22,-16.55,54.65,54.845]]};
  }

  for (const b of BUILDINGS) {
    glassZone = b.id === 'hq' ? 0 : b.x < 0 ? 1 : 2;
    let entranceBuilding = b;
    roofHeights[b.id] = .16+b.floors*b.floorHeight;
    if(b.kind==='commons') {
      const split=b.x+b.w/2-5.08,left=b.x-b.w/2-.08,right=b.x+b.w/2+.08;
      box(m.darkStone,(left+split)/2,.08,b.z,split-left,.16,b.d+.16);
      box(m.arcadePaving,(split+right)/2,.08,b.z,right-split,.16,b.d+.16);
    } else box(m.darkStone, b.x, 0.08, b.z, b.w + 0.16, 0.16, b.d + 0.16);
    if (b.kind === 'headquarters') {
      const topFloors = Math.min(2,b.floors-1);
      const terraceY = volume(b, b.x, b.z, b.w, b.d, 0.16, b.floors-topFloors, 'curtain');
      const topX = b.x - 5, topZ = b.z - 1.5, topW = b.w - 13, topD = b.d - 5;
      const topY = volume(b, topX, topZ, topW, topD, terraceY, topFloors, 'curtain');
      equipment(b, topY, topW, topD, topX, topZ);
      for (const s of [-1, 1]) {
        // A paired stone frame gives the headquarters a legible silhouette at campus scale.
        box(m.pale, b.x + s * (b.w / 2 - 0.25), terraceY / 2, b.z + b.d / 2 + 0.28, 0.5, terraceY, 1.2);
      }
      box(m.pale, b.x, terraceY + 0.58, b.z + b.d / 2 + 0.28, b.w + 0.45, 0.55, 1.2);
      for (let z = -b.d/2+2; z < b.d/2-1.5; z += 1.8) {
        planter(b.x + b.w / 2 - 3, b.z + z, 2.2, 1.5, terraceY + 0.1);
      }
    } else if (b.kind === 'office') {
      const lowerFloors = b.variant === 0 ? b.floors - 1 : b.floors;
      const kind = b.variant === 0 ? 'stone' : 'curtain';
      const e = entrancePoint(b), angle = Math.atan2(e.nx,e.nz), tx = e.nz, tz = -e.nx;
      const place = (material,u,y,v,w,h,d) => box(material,e.x+tx*u+e.nx*v,y,e.z+tz*u+e.nz*v,w,h,d,angle);
      const span = e.nx ? b.d : b.w;
      let height;
      if (b.arcade) {
        const result = arcade(b,lowerFloors,kind);
        height = result.height;
        entranceBuilding = result.ground;
      } else height = volume(b,b.x,b.z,b.w,b.d,.16,lowerFloors,kind);
      if (b.variant === 1) {
        equipment(b, height);
        // Full-height solid returns frame the courtyard elevation; the glass in
        // between remains fine-grained rather than repeating four identical sides.
        for (const side of [-1, 1]) {
          const bottom = b.arcade ? .16+b.floorHeight : .16;
          place(m.pale,side*(span/2-1.1),(height+bottom)/2,.04,1.65,height-bottom,.52);
          for (let f = b.arcade ? 2 : 1; f < b.floors; f++) place(m.darkStone,side*(span/2-1.1),.16+f*b.floorHeight,.305,1.6,.018,.02);
        }
        const planterInset=b.id==='c'?1.06:1.4;
        planter(e.x-e.nx*planterInset,e.z-e.nz*planterInset,e.nx ? 1.5 : span-4,e.nx ? span-4 : 1.5,height+.13,b.id==='c'?.06:0);
      } else {
        const topW = b.w-4.8, topD = b.d-3.2, topX = b.x-e.nx*2.4;
        const topY = volume(b,topX,b.z,topW,topD,height,1,'curtain');
        equipment(b,topY,topW,topD,topX,b.z);
        roofGarden(e.x-e.nx*2.5,e.z-e.nz*2.5,span-4,3.6,height,angle);
        for (let f = 1; f <= lowerFloors; f++) {
          place(m.stone,0,.16+f*b.floorHeight-.14,.24,span,.16,.55);
        }
      }
    } else if (b.kind === 'commons') {
      const lowerY = volume(b, b.x, b.z, b.w, b.d, 0.16, 1, 'curtain');
      const topY = volume(b, b.x - 3.5, b.z + 3.4, b.w - 8, b.d - 7, lowerY, b.floors-1, 'curtain');
      // The cafe's stepped roof and pergola face the inhabited garden to the north.
      box(m.wood, b.x, lowerY - 0.18, b.z, b.w + 1.6, 0.52, b.d + 1.4);
      box(m.aluminum, b.x, lowerY + 0.11, b.z, b.w + 1.7, 0.065, b.d + 1.5);
      const roofW=b.w-6.7,roofD=b.d-5.7,sideW=(roofW-14)/2,endD=(roofD-6)/2;
      // The wood roof supports the planter base but leaves its entire soil cavity open.
      box(m.wood,b.x-3.5,topY+.10,b.z+3.4,roofW,.06,roofD);
      for(const side of [-1,1]) {
        box(m.wood,b.x-3.5+side*(7+sideW/2),topY+.35,b.z+3.4,sideW,.44,roofD);
        box(m.wood,b.x-3.5,topY+.35,b.z+3.4+side*(3+endD/2),14,.44,endD);
      }
      roofGarden(b.x + 1, b.z - b.d / 2 + 3.4, b.w - 3.4, 4.1, lowerY);
      for (let i = 0; i < 19; i++) {
        const x = b.x - 11.8 + i * 1.35;
        box(m.wood, x, lowerY + 2.8, b.z - b.d / 2 + 3.3, 0.11, 0.23, 4.3);
      }
      for (const side of [-1, 1]) {
        box(m.aluminum, b.x + side * 12.1, lowerY + 1.4, b.z - b.d / 2 + 1.5, 0.12, 2.8, 0.12);
        box(m.aluminum, b.x, lowerY + 2.64, b.z - b.d / 2 + 3.3 + side * 1.8, 24.4, 0.18, 0.1);
        for (let i = 0; i < 10; i++) box(m.wood, b.x - 3.5 + side * (b.w - 8) / 2, lowerY + b.floorHeight / 2, b.z - 1.6 + i * 1.1, 0.4, b.floorHeight, 0.13);
      }
      planter(b.x - 3.5, b.z + 3.4, 14, 6, topY + 0.13);
      box(m.darkMetal, b.x + 5.5, topY + 0.75, b.z + 6, 3, 1.35, 3.2);
    } else {
      const podium = { ...b, w: b.w - 4, d: b.d - 4, z: b.z + 1 };
      const lowerY = volume(podium, podium.x, podium.z, podium.w, podium.d, 0.16, 1, 'curtain');
      const upperY = volume(b, b.x, b.z, b.w, b.d, lowerY, b.floors-1, 'gallery');
      entranceBuilding = podium;
      // A warm, slotted stone gallery floats above a recessed transparent foyer.
      box(m.stone, b.x, lowerY + 0.08, b.z, b.w + 0.1, 0.32, b.d + 0.1);
      for (const side of [-1, 1]) box(m.darkStone, b.x + side * (b.w / 2 - 2.4), b.floorHeight / 2 + .16, b.z - b.d / 2 + 1.3, 0.65, b.floorHeight, 0.65);
      for (let i = 0; i < 4; i++) {
        const z = b.z - 7.5 + i * 4.1;
        box(m.darkMetal, b.x, upperY + 0.32, z, b.w - 6, 0.5, 2.25);
        box(m.glass, b.x, upperY + 0.67, z - 0.1, b.w - 6.2, 0.045, 2.2, [-0.21, 0, 0]);
        for (let rib = -b.w / 2 + 3; rib <= b.w / 2 - 3; rib += 2.3) {
          box(m.aluminum, b.x + rib, upperY + 0.69, z - 0.1, 0.065, 0.075, 2.27, [-0.21, 0, 0]);
        }
      }
    }
    entrance(entranceBuilding);
    if(b.kind==='commons')commonsCafe(b);
  }
  const furniture=cafeFurniture.build({name:'Commons cafe tables and chairs'});root.add(furniture);
  const furnitureTriangles=furniture.children.reduce((n,mesh)=>n+(mesh.geometry.index?.count??mesh.geometry.attributes.position.count)/3,0);

  const endwalls=endwallBuilder.build({name:'Office end elevations'});root.add(endwalls);
  const endwallTriangles=endwalls.children.reduce((n,mesh)=>n+mesh.geometry.attributes.position.count/3,0);
  root.userData.endwalls={plans:endwallPlans,triangles:endwallTriangles,meshes:endwalls.children.length};
  const cladding=buildGalleryCladding(galleryPiers,m.stone,chamferedBox);root.add(cladding);
  const paving=buildArcadePaving();root.add(paving);
  const soffit=buildArcadeSoffits(soffitPlans,m,box);root.add(soffit);
  for (const [material, matrices] of batches) {
    const geometry = material.userData.campusGlass ? unitBox.clone() : unitBox;
    if (material.userData.campusGlass) {
      geometry.setAttribute('paneDetail', new THREE.InstancedBufferAttribute(new Float32Array(details.get(material)), 4));
      geometry.setAttribute('paneSize', new THREE.InstancedBufferAttribute(new Float32Array(sizes.get(material)), 2));
      geometry.setAttribute('paneRoom', new THREE.InstancedBufferAttribute(new Float32Array(rooms.get(material)), 4));
      // 0: vision/ordinary glass; 1: opaque-backed spandrel without an interior.
      geometry.setAttribute('paneType', new THREE.InstancedBufferAttribute(new Float32Array(paneTypes.get(material)), 1));
    }
    const mesh = instanced(geometry, material, matrices);
    mesh.name = material.name;
    root.add(mesh);
  }
  const rimGeometry=new THREE.LatheGeometry([[.72,0],[.72,.075],[.66,.075],[.66,0]].map(p=>new THREE.Vector2(...p)),12);
  rimGeometry.normalizeNormals();
  const wellGeometry=new THREE.CircleGeometry(.66,12);wellGeometry.rotateX(-Math.PI/2);
  let roofFanTriangles=0;
  for(const [geometry,material,matrices,name]of [[rimGeometry,m.silver,roofFanRings,'Roof fan collars'],[wellGeometry,m.darkMetal,roofFanWells,'Recessed roof fan wells']]) {
    const mesh=instanced(geometry,material,matrices);mesh.name=name;root.add(mesh);
    roofFanTriangles+=(geometry.index?.count??geometry.attributes.position.count)/3*matrices.length;
  }
  root.userData.roofService={...roofServiceStats,plans:roofServicePlans,fanGeometryTriangles:roofFanTriangles};
  const terracePlants=buildTerracePlanting(roofPlants,roofPlantSites);
  root.add(terracePlants);
  root.userData.terracePlanting=terracePlants.userData;
  const edges = edgeBuilder.build({name:'Chamfered low-level facade details'});
  // Preserve disjoint solid bounds for collision checks; a material batch spans
  // several buildings, so its enclosing box is not itself a solid obstacle.
  for(const mesh of edges.children) mesh.userData.componentBounds = edgeBounds.get(mesh.material);
  root.add(edges);
  for(const geometry of edgeGeometries.values()) geometry.dispose();
  root.userData.buildingCount = BUILDINGS.length;
  root.userData.entrances = entrances;
  root.userData.arcades = arcades;
  root.userData.arcadePlanarSurfaces = arcadePlanarSurfaces;
  root.userData.arcadePaving = paving.userData;
  root.userData.arcadeSoffit = soffit.userData;
  root.userData.galleryCladding = cladding.userData;
  root.userData.roofHeights = roofHeights;
  root.userData.beveledParts = beveledParts;
  root.userData.glassPanes = [...details.values()].reduce((sum, panes) => sum + panes.length / 4, 0);
  root.userData.spandrelPanes = [...paneTypes.values()].reduce((sum, panes) => sum + panes.filter(type=>type===1).length, 0);
  root.userData.triangles = [...batches.values()].reduce((sum, instances) => sum + instances.length * 12, 0) + rampTriangles + terracePlants.userData.triangles + beveledParts*44 + paving.userData.triangles + soffit.userData.triangles + cladding.userData.triangles + roofFanTriangles + endwallTriangles + furnitureTriangles;
  return root;
}
