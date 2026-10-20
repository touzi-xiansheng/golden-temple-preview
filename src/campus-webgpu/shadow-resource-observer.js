import { RenderObjectRefreshType } from 'three/webgpu';

// r186 observes shadow dimensions, so an offscreen object can miss an A→B→A
// resize. Refresh its bindings once on return, even when the dimensions match.
export function observeShadowResources(observer, getGeneration) {
  const needsRefresh=observer.needsRefresh, generations=new WeakMap();
  observer.needsRefresh=function(renderObject,nodeFrame) {
    const refresh=needsRefresh.call(this,renderObject,nodeFrame);
    const generation=getGeneration();
    if(generations.get(renderObject)!==generation) {
      generations.set(renderObject,generation);
      return RenderObjectRefreshType.FULL;
    }
    return refresh;
  };
  return observer;
}
