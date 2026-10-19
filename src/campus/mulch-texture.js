import * as THREE from 'three';
import { rng } from '../core/rng.js';

// Overlapping bark chips at centimetre scale; colour and physical relief stay independent.
export function createMulchTextures() {
  const size=1024, metres=1.6, color=document.createElement('canvas'),height=document.createElement('canvas');
  color.width=color.height=height.width=height.height=size;
  const c=color.getContext('2d'),h=height.getContext('2d'),random=rng('campus-bark-mulch');
  c.fillStyle='#302a21';c.fillRect(0,0,size,size);h.fillStyle='#282828';h.fillRect(0,0,size,size);
  for(let i=0;i<10500;i++) {
    const x=random.float(0,size),y=random.float(0,size),angle=random.float(0,Math.PI*2);
    const length=random.float(.012,.052)*size/metres,width=random.float(.004,.017)*size/metres;
    const shade=random.float(.66,1.3),warm=random.float(-4,4),elevation=random.int(90,215);
    const points=[[-.5,-.24],[-.32,-.52],[.33,-.43],[.5,-.08],[.34,.42],[-.36,.48]].map(([u,v])=>[u*length,v*width*random.float(.8,1.2)]);
    for(const ox of [-size,0,size]) for(const oy of [-size,0,size]) {
      if(x+ox< -35||x+ox>size+35||y+oy< -35||y+oy>size+35)continue;
      for(const ctx of [c,h]) {
        ctx.save();ctx.translate(x+ox,y+oy);ctx.rotate(angle);
        ctx.beginPath();points.forEach(([px,py],j)=>j?ctx.lineTo(px,py):ctx.moveTo(px,py));ctx.closePath();
      }
      c.fillStyle=`rgb(${Math.round(78*shade+warm)},${Math.round(65*shade)},${Math.round(48*shade-warm)})`;c.fill();
      c.strokeStyle='rgba(32,25,18,.45)';c.lineWidth=.8;c.stroke();
      const slope=h.createLinearGradient(0,-width*.5,0,width*.5);
      slope.addColorStop(0,`rgb(${elevation*.65},${elevation*.65},${elevation*.65})`);
      slope.addColorStop(.42,`rgb(${elevation},${elevation},${elevation})`);
      slope.addColorStop(1,`rgb(${elevation*.76},${elevation*.76},${elevation*.76})`);
      h.fillStyle=slope;h.fill();
      c.clip();c.strokeStyle='rgba(148,124,88,.23)';c.lineWidth=.65;
      for(const t of [-.23,.08,.29]) {c.beginPath();c.moveTo(-length*.5,width*t);c.lineTo(length*.5,width*(t+.1));c.stroke();}
      c.restore();h.restore();
    }
  }
  const map=new THREE.CanvasTexture(color),bump=new THREE.CanvasTexture(height);map.colorSpace=THREE.SRGBColorSpace;
  for(const texture of [map,bump]){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.anisotropy=8;}
  return {map,bump,metres};
}
