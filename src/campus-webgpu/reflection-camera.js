import { Matrix4, Vector3, Vector4, WebGPUCoordinateSystem } from 'three/webgpu';

const bias = new Matrix4().set(.5,0,0,.5, 0,-.5,0,.5, 0,0,1,0, 0,0,0,1);
const finite = values => values.every(Number.isFinite);

// AABB corners projected onto the facade give a conservative polygon even for
// rotated facades. A convex hull also removes the duplicate corners of thin panes.
function facadePolygon({ bounds, plane, normal }) {
  const u = normal.clone().cross(Math.abs(normal.y) < .9 ? new Vector3(0,1,0) : new Vector3(1,0,0)).normalize();
  const v = normal.clone().cross(u);
  const points = [];
  for (const x of [bounds.min.x,bounds.max.x]) for (const y of [bounds.min.y,bounds.max.y]) for (const z of [bounds.min.z,bounds.max.z]) {
    const world = plane.projectPoint(new Vector3(x,y,z),new Vector3());
    points.push({ x:world.dot(u), y:world.dot(v), world });
  }
  points.sort((a,b)=>a.x-b.x || a.y-b.y);
  const unique = points.filter((p,i)=>!i || Math.abs(p.x-points[i-1].x)>1e-8 || Math.abs(p.y-points[i-1].y)>1e-8);
  if (unique.length < 3) return [];
  const cross = (a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const half = ordered => {
    const hull=[];
    for (const p of ordered) { while (hull.length>1 && cross(hull.at(-2),hull.at(-1),p)<=1e-10) hull.pop(); hull.push(p); }
    return hull.slice(0,-1);
  };
  return [...half(unique),...half([...unique].reverse())].map(p=>p.world);
}

// Clip in homogeneous space before dividing by W. Merely projecting a box's
// corners produces huge/negative rectangles when the viewer passes its edge.
export function projectReflectionPortal(facade, camera, width, height) {
  if (!(width>0 && height>0)) return null;
  const matrix = new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);
  let polygon = facadePolygon(facade).map(world=>({ world, clip:new Vector4(...world.toArray(),1).applyMatrix4(matrix) }));
  const clipPlanes = [p=>p.w-1e-6, p=>p.x+p.w, p=>p.w-p.x, p=>p.y+p.w, p=>p.w-p.y,
    camera.coordinateSystem===WebGPUCoordinateSystem ? p=>p.z : p=>p.z+p.w, p=>p.w-p.z];
  for (const distance of clipPlanes) {
    const next=[];
    for (let i=0;i<polygon.length;i++) {
      const a=polygon[i],b=polygon[(i+1)%polygon.length],da=distance(a.clip),db=distance(b.clip);
      if (da>=0) next.push(a);
      if ((da>=0)!==(db>=0)) {
        const t=da/(da-db);
        next.push({world:a.world.clone().lerp(b.world,t),clip:a.clip.clone().lerp(b.clip,t)});
      }
    }
    polygon=next;
    if (polygon.length<3) return null;
  }
  let area=0;
  for (let i=0;i<polygon.length;i++) {
    const a=polygon[i].clip,b=polygon[(i+1)%polygon.length].clip;
    area+=(a.x*b.y-b.x*a.y)/(a.w*b.w);
  }
  const areaPixels=Math.abs(area)*width*height/8;
  if (!Number.isFinite(areaPixels) || areaPixels<1e-4) return null;
  return {polygon:polygon.map(p=>p.world),areaPixels};
}

// Configure scratch state only. The owner commits this matrix and its matching
// texture together after a successful render; invalid geometry returns null.
export function configureReflectionCamera(mirror, camera, facade, portal, {width,height,mode='portal',paddingPixels=2}={}) {
  if (!['portal','reference'].includes(mode)) throw new RangeError('Unknown reflection mode');
  if (!portal || !(width>0 && height>0)) return null;
  const {plane,normal}=facade,eye=new Vector3().setFromMatrixPosition(camera.matrixWorld);
  const reflect=point=>point.addScaledVector(normal,-2*plane.distanceToPoint(point));
  mirror.position.copy(reflect(eye.clone()));
  const look=reflect(camera.getWorldDirection(new Vector3()).add(eye));
  mirror.up.setFromMatrixColumn(camera.matrixWorld,1).reflect(normal);
  mirror.lookAt(look);
  mirror.coordinateSystem=camera.coordinateSystem;
  mirror._reversedDepth=camera.reversedDepth;
  mirror.near=camera.near;mirror.far=camera.far;mirror.layers.mask=camera.layers.mask;
  mirror.updateMatrixWorld();
  mirror.projectionMatrix.copy(camera.projectionMatrix);
  let x0=0,y0=0,x1=width,y1=height;
  if (mode==='portal') {
    const viewProjection=new Matrix4().multiplyMatrices(mirror.projectionMatrix,mirror.matrixWorldInverse);
    const points=portal.polygon.map(p=>new Vector4(...p.toArray(),1).applyMatrix4(viewProjection));
    if (points.some(p=>p.w<=1e-7 || !finite(p.toArray()))) return null;
    const xs=points.map(p=>(p.x/p.w+1)*width/2),ys=points.map(p=>(p.y/p.w+1)*height/2);
    x0=Math.max(0,Math.floor(Math.min(...xs))-paddingPixels);x1=Math.min(width,Math.ceil(Math.max(...xs))+paddingPixels);
    y0=Math.max(0,Math.floor(Math.min(...ys))-paddingPixels);y1=Math.min(height,Math.ceil(Math.max(...ys))+paddingPixels);
    if (!(x1>x0 && y1>y0)) return null;
    const left=2*x0/width-1,right=2*x1/width-1,bottom=2*y0/height-1,top=2*y1/height-1;
    const crop=new Matrix4().set(2/(right-left),0,0,-(right+left)/(right-left), 0,2/(top-bottom),0,-(top+bottom)/(top-bottom), 0,0,1,0, 0,0,0,1);
    mirror.projectionMatrix.premultiply(crop);
  }
  const textureMatrix=bias.clone().multiply(mirror.projectionMatrix).multiply(mirror.matrixWorldInverse);
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
  const clip=plane.clone().applyMatrix4(mirror.matrixWorldInverse);
  const equation=new Vector4(...clip.normal.toArray(),clip.constant);
  const gpu=camera.coordinateSystem===WebGPUCoordinateSystem,reversed=camera.reversedDepth;
  const farZ=reversed ? (gpu ? 0 : -1) : 1;
  const opposite=new Vector4(Math.sign(equation.x)||1,Math.sign(equation.y)||1,farZ,1).applyMatrix4(mirror.projectionMatrixInverse);
  const denominator=equation.dot(opposite);
  if (!Number.isFinite(denominator) || Math.abs(denominator)<1e-7) return null;
  equation.multiplyScalar((gpu ? 1 : 2)/denominator);
  const p=mirror.projectionMatrix.elements,c=equation.toArray();
  for (let i=0;i<4;i++) p[2+i*4]=reversed ? p[3+i*4]-c[i] : gpu ? c[i] : c[i]-p[3+i*4];
  if (!finite(p) || Math.abs(mirror.projectionMatrix.determinant())<1e-12) return null;
  mirror.projectionMatrixInverse.copy(mirror.projectionMatrix).invert();
  return {textureMatrix,width:x1-x0,height:y1-y0,crop:[x0,y0,x1,y1]};
}
