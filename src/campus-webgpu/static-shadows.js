import { Box3, Matrix4, Vector3 } from 'three/webgpu';

// The sun and geometry are static. Cache shadows in world space, independently of
// both the moving viewer and reflected cameras; refresh at tour cuts or quality changes.
export function createStaticShadows(sun, scene, direction) {
  const overview = new Box3(new Vector3(-130,-1,-115),new Vector3(130,40,115));
  for(const tree of scene.getObjectByName('campus-landscape')?.userData.contextTreePositions || []) {
    const radius=tree.height*.42+3, ground=tree.ground||0;
    overview.expandByPoint(new Vector3(tree.x-radius,ground,tree.z-radius));
    overview.expandByPoint(new Vector3(tree.x+radius,ground+tree.height*1.1+3,tree.z+radius));
  }
  const shotBounds=[[0,12,5,140],[0,10,35,105],[0,12,26,60],[0,12,-23,68],[-18,12,-43,52],[0,12,5,140]];
  let currentShot=null;
  const stats={invalidations:0};
  function update(shot=-1,force=false) {
    if(shot===currentShot&&!force)return;
    currentShot=shot;
    let [x,y,z,radius]=shotBounds[shot] || [0,12,0,170];
    let distance=400,near=100,far=700;
    if(shot<0||shot===0||shot===5) {
      [x,y,z]=overview.getCenter(new Vector3()).toArray();
      const rotation=new Matrix4().lookAt(direction,new Vector3(),sun.up).invert();
      const size=overview.clone().applyMatrix4(rotation).getSize(new Vector3());
      radius=Math.max(size.x,size.y)*.5+4;
      distance=size.z*.5+100;near=50;far=size.z+200;
    }
    sun.shadow.camera.up.set(0,shot===4?0:1,shot===4?1:0);
    sun.target.position.set(x,y,z);sun.target.updateMatrixWorld();
    sun.position.copy(sun.target.position).addScaledVector(direction,distance);sun.updateMatrixWorld();
    Object.assign(sun.shadow.camera,{left:-radius,right:radius,top:radius,bottom:-radius,near,far});
    sun.shadow.bias=-.002/(far-near);
    sun.shadow.normalBias=Math.min(.008,(radius*2/sun.shadow.mapSize.x)*.2);
    sun.shadow.camera.updateProjectionMatrix();sun.shadow.needsUpdate=true;stats.invalidations++;
  }
  sun.shadow.autoUpdate=false;
  update();
  return {update,stats,get shot(){return currentShot;}};
}
