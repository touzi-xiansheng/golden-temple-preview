# 桌面 WebGPU 加载优化验证（2026-10-20）

本轮保留默认 `compileAsync`，只优化已被 CPU profile 证实的两处景观生成热点。`refined=false` 的旧版生成路径保持原实现；浏览器完整加载收益须使用真实页面计时，下面的 Node 数据不能替代首帧指标。

## 预编译假设的裁决

同一 Chrome、相同参数、相同七栋建筑与 10/40/45 秒预热，按 off/on/on/off 加载四页：

| 默认目标预编译 | 完整 firstFrameMs |
| --- | --- |
| off | 17,443.7 / 17,593.3 |
| on | 17,373.5 / 17,338.1 |

没有证据支持取消预编译能提高加载速度，因此恢复默认开启，仅保留 `?precompile=0` 诊断。`firstFrameMs` 仍包含完整 GI、反射捕获、预热及最终画面 GPU 完成；`firstVisibleMs` 另外记录遮罩淡出结束，`fullReadyMs` 记录控制与应用接口就绪。

`renderer.info.memory.programs` 是按 WGSL 字符串缓存的活动顶点/片元阶段计数，不是 GPU pipeline 数。预编译前后都是 328，580/570 的差异在后续预热出现，不能推断取消预编译减少了编译工作。on 多出的 24,883,200 字节纹理账面量，恰为 1920×1080×(RGBA16F 8 + depth32 4) 的默认 framebuffer；Three 的估算不能视为驱动真实显存。

原始四页记录已归档为 [refine-startup-compare.json](./refine-startup-compare.json)，与本地 `out/webgpu/startup-compare.json` 内容完全一致。

## Profile 与改动边界

对完整初始化 CDP profile 的 `samples/timeDeltas` 汇总：`buildLandscapeSteps` 栈约 5,341ms CPU，其中 vegetation 2,131ms、accessDistance 585ms、filterSouthBorderGrass 558ms、groundAt 441ms、bark 276ms。这些为包含子函数的时间，不能相加。页面 `landscapeMs` 约 6.7 秒还包括调度等待；不能全部称为 CPU 时间。

在 `refined=true` 时实施：

1. 道路和林地树根查询复用已有 `createGroundSampler`，索引实际渲染三角形，范围覆盖道路点外扩 5 米与 `CONTEXT_EXTENT`。索引为单次构建的局部 JS 数据，不新增 GPU 资源或持久缓存。
2. 草坪裁剪只计算所需的多边形内外判断，保留原奇偶判断公式，不再同时计算每条边的距离。轮廓、三角相交检查、实例保留顺序不变。

未改 `accessDistance`、植物批次、随机数顺序、纹理分辨率，也未加入 Worker 或缓存框架。9.4MB 的 CPU profile 仅保留于忽略目录 `out/webgpu/refine-startup.cpuprofile`。

## CPU 对照与正确性

运行：

```sh
node --expose-gc tools/webgpu-landscape-bench.mjs out/webgpu/landscape-before-loading.js
node --test tools/webgpu-ground.test.mjs
```

第一个参数为**本轮两处 CPU 优化之前**保存的 `src/campus/landscape.js`。它已经包含本轮树冠、背景楼高的 `refined` 改动；两种实现均使用同一批依赖、同一 `refined=true` 输入。基线不是旧线上版本，也不是 `refined=false`。因此这组数字只比较地形采样和草坪内外判断的计算方式，不比较新旧景观几何。

脚本按 before/after/after/before 运行完整同步生成，每次后释放资源并在下次前 GC。原始结果已归档为 [refine-landscape-cpu.json](./refine-landscape-cpu.json)，与本地 `out/webgpu/landscape-cpu-compare.json` 内容完全一致。JSON 中的绝对基线路径仅是当时机器的来源记录；其他机器应使用本节命令指定本地副本。

| 实现 | 两次完整 CPU 生成 | 均值 |
| --- | --- | --- |
| before | 5,638.0 / 5,618.4ms | 5,628.2ms |
| after | 4,866.3 / 5,034.7ms | 4,950.5ms |

该次对照减少约 677.7ms（12.0%）。Canvas 绘制被 stub，排除了浏览器调度和 GPU；四次测量不构成统计置信区间。

四次 220 个景观 mesh 的所有几何属性、索引、实例矩阵与实例颜色 SHA-256 完全一致：`945ebba343bc0ef9937a755667a8495c2b6392719d2d587a96f7c38994496a06`；1,064,716 实例、8,493,119 三角形及南庭/东南裁剪数量也一致。

实际地形回归通过：优化生成期间不调用地形 Raycaster；474 个树根相对原射线最大误差 5.75e-14 米；1,896 个生成道路顶点相对原射线最大误差 5.95e-7 米（Float32 坐标舍入），在 2e-6 米容差内。

优化前源码 SHA-256：`99946a80865d1914d8623569501c5b1e532d9ba0d87b9dd3e5835cb8f2ecefc6`；对照时优化后源码：`8a612b39ff33b9ec85d9fd378f41a28a8191c33d82719eec8a67d3968ab380d0`。

## 重新取得精确基线

当前机器保留了忽略目录中的 `out/webgpu/landscape-before-loading.js`。重新检出仓库时，它不会随 Git 下载；不能直接用上一线上提交的整个 `landscape.js` 替代，否则会同时撤销本轮 `refined` 几何变化。

以下脚本在内存中仅撤销两处 CPU 优化，写出独立基线副本，应用源码不会被修改。它在变换前后都核对上述 SHA-256，源码版本不符时会停止。已只读核对该变换可精确恢复 56,167 字节的原基线。若以后源码变化，应先在包含本轮优化的对应提交上使用干净检出目录执行，或取该提交的源码副本并修改脚本读取路径；基准运行依赖也应固定在同一提交。不要删除哈希校验来套用新版本。

```sh
node --input-type=module <<'EOF'
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
const sha = value => createHash('sha256').update(value).digest('hex');
let source = fs.readFileSync('src/campus/landscape.js', 'utf8');
assert.equal(sha(source), '8a612b39ff33b9ec85d9fd378f41a28a8191c33d82719eec8a67d3968ab380d0');
source = source.replace("import { createGroundSampler } from './context-visibility.js';\n", '');
const filterStart = source.indexOf('function filterSouthBorderGrass(');
const filterEnd = source.indexOf('  const bounds=', filterStart);
source = source.slice(0, filterStart)
  + "function filterSouthBorderGrass(group,prefix,outline,oldOutlines) {\n"
  + "  const added=p=>southBorderContour(p.x,p.z,outline).inside&&!oldOutlines.some(o=>southBorderContour(p.x,p.z,o).inside);\n"
  + source.slice(filterEnd);
const groundStart = source.indexOf('  // Index the rendered terrain');
const groundEnd = source.indexOf('\n\n\n  ring(', groundStart);
source = source.slice(0, groundStart)
  + "  const groundRay=new THREE.Raycaster(new THREE.Vector3(),new THREE.Vector3(0,-1,0));\n"
  + "  function groundAt(x,z) { groundRay.ray.origin.set(x,200,z); const hit=groundRay.intersectObject(terrainMesh,false)[0]; return (hit?.point.y??terrainHeight(x,z))-0.035; }"
  + source.slice(groundEnd);
source = source.replace(/filterSouthBorderGrass\((.*),refined\);/g, 'filterSouthBorderGrass($1);');
assert.equal(sha(source), '99946a80865d1914d8623569501c5b1e532d9ba0d87b9dd3e5835cb8f2ecefc6');
fs.mkdirSync('out/webgpu', { recursive: true });
fs.writeFileSync('out/webgpu/landscape-before-loading.js', source);
EOF
```
