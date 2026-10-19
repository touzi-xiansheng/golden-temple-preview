import * as THREE from 'three';
import { Builder, instanced, mat4 } from '../core/geom.js';
import { rng } from '../core/rng.js';
import { cutPavingStone } from './arcade-paving.js';

export function buildArcadeSoffits(plans, materials, box) {
  const group=new THREE.Group(),builder=new Builder(),matrices=[],colors=[],phases=[];
  group.name='Jointed ash arcade soffits';
  const joint=.003,bevel=.0006,thickness=.02,moduleLength=2.4,rows=14,edgeMargin=.02;
  const stats={joint,bevel,thickness,moduleLength,rows,fullBoards:0,cutBoards:0,boardTriangles:0,backingTriangles:0,triangles:0,surfaces:[]};
  group.userData=stats;
  if(!plans.length)return group;
  const boardWidth=(plans[0].depth-2*edgeMargin-(rows-1)*joint)/rows;
  const fullGeometry=cutPavingStone([[-(moduleLength-joint)/2,(moduleLength-joint)/2,-boardWidth/2,boardWidth/2]],thickness/2,thickness,bevel);
  const setGrain=(geometry,origin,phase,color)=>{
    const p=geometry.attributes.position,uv=[],rgb=[];
    for(let i=0;i<p.count;i++) {
      uv.push(p.getX(i)-origin[0]+phase[0],p.getZ(i)-origin[1]+phase[1]);
      rgb.push(color.r,color.g,color.b);
    }
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));
    geometry.setAttribute('color',new THREE.Float32BufferAttribute(rgb,3));
  };
  setGrain(fullGeometry,[0,0],[0,0],new THREE.Color(1,1,1));
  const clip=(rect,obstacle)=>{
    const u0=Math.max(rect[0],obstacle[0]),u1=Math.min(rect[1],obstacle[1]),v0=Math.max(rect[2],obstacle[2]),v1=Math.min(rect[3],obstacle[3]);
    if(u1<=u0 || v1<=v0)return [rect];
    return [[rect[0],u0,rect[2],rect[3]],[u1,rect[1],rect[2],rect[3]],
      [u0,u1,rect[2],v0],[u0,u1,v1,rect[3]]].filter(r=>r[1]-r[0]>2*bevel && r[3]-r[2]>2*bevel);
  };
  let cutVertexCount=0;
  for(const plan of plans) {
    const {id,origin,angle,span,depth,centerV,bottom}=plan,tx=Math.cos(angle),tz=-Math.sin(angle),nx=Math.sin(angle),nz=Math.cos(angle);
    const bounds=[-span/2,span/2,centerV-depth/2,centerV+depth/2];
    const obstacles=plan.columns.map(r=>[r[0]-joint,r[1]+joint,r[2]-joint,r[3]+joint]);
    const subtract=rect=>obstacles.reduce((pieces,obstacle)=>pieces.flatMap(r=>clip(r,obstacle)),[rect]);
    const surface={id,origin,tangent:[tx,tz],normal:[nx,nz],bottom,top:bottom+thickness,backingBottom:bottom+.025,boardWidth,bounds,obstacles,boards:[],trim:[]};
    const transform=mat4([origin[0],0,origin[1]],[0,angle,0]);
    const backing=cutPavingStone(subtract(bounds),bottom+.03,.005,.0001);
    builder.add(backing,materials.soffitBacking,transform);stats.backingTriangles+=backing.attributes.position.count/3;backing.dispose();
    // The narrow perimeter extrusion stops at column heads instead of passing through them.
    const trimWidth=.012;
    const trimRects=[[bounds[0],bounds[1],bounds[2],bounds[2]+trimWidth],[bounds[0],bounds[1],bounds[3]-trimWidth,bounds[3]],
      [bounds[0],bounds[0]+trimWidth,bounds[2]+trimWidth,bounds[3]-trimWidth],[bounds[1]-trimWidth,bounds[1],bounds[2]+trimWidth,bounds[3]-trimWidth]];
    for(const rect of trimRects.flatMap(subtract)) {
      const u=(rect[0]+rect[1])/2,v=(rect[2]+rect[3])/2;
      box(materials.aluminum,origin[0]+tx*u+nx*v,bottom+.012,origin[1]+tz*u+nz*v,rect[1]-rect[0],.024,rect[3]-rect[2],angle);
      surface.trim.push(rect);
    }
    const random=rng(`campus-soffit-${id}`),start=bounds[0]+edgeMargin,end=bounds[1]-edgeMargin;
    for(let row=0;row<rows;row++) {
      const v=bounds[2]+edgeMargin+row*(boardWidth+joint),offset=(row%2)*moduleLength/2;
      for(let segment=0,u=start-offset;u<end;segment++,u+=moduleLength) {
        const rect=[Math.max(start,u)+joint/2,Math.min(end,u+moduleLength)-joint/2,v,v+boardWidth];
        const pieces=subtract(rect);
        if(!pieces.length)continue;
        const uvOrigin=[(rect[0]+rect[1])/2,(rect[2]+rect[3])/2],phase=[random.float(0,16),random.float(0,4)];
        const tone=random.float(.975,1.025),warm=random.float(-.003,.003),color=new THREE.Color().setRGB(tone+warm,tone,tone-warm,THREE.LinearSRGBColorSpace);
        const regular=pieces.length===1 && Math.abs(pieces[0][1]-pieces[0][0]-(moduleLength-joint))<1e-8 && Math.abs(pieces[0][3]-pieces[0][2]-boardWidth)<1e-8;
        const board={rect,row,segment,phase,uvOrigin,regular};
        if(regular) {
          const [uCenter,vCenter]=uvOrigin;
          board.instance=matrices.length;
          matrices.push(mat4([origin[0]+tx*uCenter+nx*vCenter,bottom+thickness/2,origin[1]+tz*uCenter+nz*vCenter],[0,angle,0]));
          colors.push(color);phases.push(...phase);stats.fullBoards++;stats.boardTriangles+=fullGeometry.attributes.position.count/3;
          board.footprint=[[[rect[0],rect[2]],[rect[1],rect[2]],[rect[1],rect[3]],[rect[0],rect[3]]]];
        } else {
          const geometry=cutPavingStone(pieces,bottom+thickness,thickness,bevel);
          board.footprint=geometry.userData.footprint;board.vertexStart=cutVertexCount;board.vertexCount=geometry.attributes.position.count;
          cutVertexCount+=board.vertexCount;
          setGrain(geometry,uvOrigin,phase,color);builder.add(geometry,materials.soffit,transform);
          stats.cutBoards++;stats.boardTriangles+=geometry.attributes.position.count/3;geometry.dispose();
        }
        surface.boards.push(board);
      }
    }
    stats.surfaces.push(surface);
  }
  if(matrices.length) {
    fullGeometry.setAttribute('soffitPhase',new THREE.InstancedBufferAttribute(new Float32Array(phases),2));
    const mesh=instanced(fullGeometry,materials.soffit,matrices);mesh.name='Full length ash soffit boards';
    colors.forEach((color,i)=>mesh.setColorAt(i,color));mesh.instanceColor.needsUpdate=true;group.add(mesh);
  } else fullGeometry.dispose();
  group.add(builder.build({name:'Soffit cuts and recessed backing'}));
  stats.triangles=stats.boardTriangles+stats.backingTriangles;
  return group;
}
