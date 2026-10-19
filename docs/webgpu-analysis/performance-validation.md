# WebGPU 专属优化与验证方案

2026-10-19。独立性能研究；只形成方案，未改应用、依赖或配置，未运行 GPU 基准。目标设备暂定 Apple M4 Pro、1920×1080；其他设备未经验证。以下预算是建议目标，不是已测收益。

## 证据边界

当前依赖锁定 Three.js 0.186.1；[入口](../../src/campus/main.js)仍使用 WebGL。[已有验收](../../out/campus/check.json)记录约 918 万场景三角形、271 个网格、60 FPS、首帧 8.62 秒；[另一次观察](/private/tmp/golden-temple-performance-audit.json)首帧 27.85 秒，景观生成 6.31 秒、反射阶段 15.09 秒。两次不是受控冷热对照，后者明确注明帧耗时是 `renderOnce/gl.finish` 周围的 JS 时间，不能解释成纯 GPU 时间。静态场景三角形数也不是每帧实际处理量。

## 值得做的优化及边界

| 方向 | 实施与取舍 |
| --- | --- |
| GPU 剔除、压缩、间接绘制 | 先对植物簇执行视锥和屏幕尺寸判断，把可见实体 ID 按材质、物种、LOD 写入紧凑列表，再写间接命令的实例数。CPU 保留粗分区剔除，避免逐叶百万次判断的固定成本。顶点着色器把物体移出画面仍执行顶点工作，不算真正剔除。 |
| LOD 与实例数据 | 首版三级 LOD，按投影尺寸加滞回；轮廓、树冠体积、遮光率需保持。静态参数进 storage buffer，仅更新相机、风与少量变化；压缩后的实例仍使用稳定实体 ID 访问当前与上一帧状态。LOD 本身也适用于 WebGL，不能独占记作 WebGPU 收益。 |
| 程序纹理 compute | 优先树皮、地表噪声、法线等规则并行计算，结果留 GPU 并生成 mip；同帧材质直接采样。复杂枝干拓扑仍可用 Worker。分别比较 CPU 生成加上传、片元离屏烘焙、compute；一次性小纹理未必值得新增管线。 |
| 时域与带宽 | 用 TRAA 改善细叶和栏杆闪烁，需深度、速度与历史缓冲，且关闭 MSAA。先共享深度及必要的 MRT 输出，合并能合并的后处理，避免每个效果重绘场景。1080p 的 RGBA16F 单纹理约 16.6 MB，一读一写约 33.2 MB，只是理论数据量，不是实测带宽。 |
| 启动与静态复用 | 按种子、生成器版本、材质参数缓存几何/纹理；静态光照、反射按失效条件更新；分批预热真正要用的管线。不能假定驱动编译缓存可控，也不能序列化 GPU 对象后跨会话复用。静止时收敛后休眠，风和时变效果需要暂停或继续更新。 |

本地已有 [`setIndirect`](../../node_modules/three/src/core/BufferGeometry.js)、[`IndirectStorageBufferAttribute`](../../node_modules/three/src/renderers/common/IndirectStorageBufferAttribute.js)、[`StorageTextureNode`](../../node_modules/three/src/nodes/accessors/StorageTextureNode.js)；[后端](../../node_modules/three/src/renderers/webgpu/WebGPUBackend.js)确实调用 `drawIndexedIndirect`，但多个 offset 仍逐条编码，不能等同原生多重间接绘制。规范的 indexed 命令是五个 32 位值；不要求可选 `indirect-first-instance` 时保持 `firstInstance=0`。[官方接口](https://threejs.org/docs/pages/BufferGeometry.html)、[规范源码](https://github.com/gpuweb/gpuweb/blob/main/spec/index.bs)

首版不投入逐叶遮挡查询、全园区 Hi-Z、全路径追踪或自研通用渲染引擎；先证明额外 compute/pass 的总成本低于省下的绘制。`shader-f16`、subgroups 只作为可选实验，精度与设备能力分别验收。

## 必须正确的部分

主相机、阴影相机、反射相机需要各自列表或保守可见集合；不可用主视锥剔除投影者。包围体包含风摆和 LOD 过渡。WebGPU 裁剪深度为 0–1，反射斜裁剪及 reversed-Z 需重新推导，不能照搬旧 WebGL 公式。计数清零、压缩、命令生成分派有序提交，验证容量边界、零实例、重复 ID；不能用一次 dispatch 内的工作组屏障假装全 GPU 同步。每帧不回读实例数决定绘制。[坐标及同步差异](https://developer.chrome.com/docs/web-platform/webgpu/from-webgl-to-webgpu)

当前植物使用双面与 `alphaTest`，应保留裁切语义及匹配的阴影深度材质。原子追加会改变顺序，不能直接用于依赖排序的透明混合植物。TRAA 检查逆光叶缘、玻璃、快速平移、遮挡显露和 LOD 切换；风、GPU 位移、广告牌朝向都要有正确历史位置。切镜、改尺寸、改光照时明确失效历史，不能只期待自动恢复。[当前植物](../../src/campus/foliage-material.js)、[TRAA 源码](../../node_modules/three/examples/jsm/tsl/display/TRAANode.js)

池化目标与缓冲，切画质/重建时销毁旧资源；验证 device loss 后重建、页面隐藏恢复、连续十次切换的资源数量稳定。资源所有者负责停止任务、释放缓冲、纹理、查询集；共享资源不得提前释放。[WebGPU 生命周期与同步](https://gpuweb.github.io/gpuweb/)

## 实验与验收关卡

1. **确认后端。** 默认设置下 `isSecureContext`、`navigator.gpu` 和初始化成功均为真，再断言 `renderer.backend.isWebGPUBackend`；`isWebGPURenderer` 不够，因为它会回退 WebGL。100.x 的 HTTP 地址不享受 localhost 例外，远程使用可信 HTTPS。[Three 后端选择](../../node_modules/three/src/renderers/webgpu/WebGPURenderer.js)、[Chrome 故障排查](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips)
2. **记录环境。** 保存浏览器/系统版本、物理设备、供电、显示刷新率、DPR、实际 render target 尺寸、代码与种子哈希。读取实际渲染 device 的 `adapterInfo`，或创建该 device 的 `adapter.info`：vendor、architecture、device、description、isFallbackAdapter；缺失记未知，不推断。不要使用旧 `adapter.isFallbackAdapter`。保留 adapter/device 的 features、limits、请求参数及 compatibilityMode；本地后端默认请求 compatibility，能力必须实查。[当前官方字段](https://gpuweb.github.io/types/interfaces/GPUAdapterInfo.html)、[Chrome 字段说明](https://developer.chrome.com/blog/new-in-webgpu-136)
3. **控制比较。** 固定六镜头加自由探索，涵盖树冠、近叶、廊下、玻璃及逆光；冻结种子、天气、几何、分辨率和效果。先 WebGPU 普通实例版，再只打开一项优化，最后组合；旧 WebGL 作为视觉参照，只有相同负载才比较后端成本。降分辨率、减少效果另记画质档位收益。
4. **正确计时。** 预热后 A/B 交错重复至少三轮，每轮完整漫游；分别报告 RAF 帧间隔、CPU 提交、GPU render/compute 各 pass 的 p50/p95/p99。用可选 timestamp-query 及 `trackTimestamp` 异步解析，避免每帧等待回读。时间戳会量化，应按帧 ID 配对、剔除无效值，不能把最后一次值当新样本。60 Hz 下用 GPU 毫秒比较余量；无查询时辅以 tracing 或相同离屏负载的批量吞吐，明确其含 CPU/排队成本。[Three 查询实现](../../node_modules/three/src/renderers/webgpu/utils/WebGPUTimestampQueryPool.js)、[Chrome 时间戳](https://developer.chrome.com/blog/new-in-webgpu-121)
5. **核验输出。** 小场景对照 CPU 可见集合，离线回读压缩列表与间接参数，单独统计提交量；后端 `renderer.info` 的三角形统计仍使用 CPU drawParams，不能证明 GPU 剔除。截图对照之外录制固定速度视频及切镜后逐帧序列，拒绝漏影、漏倒影、持续拖影、突变或 NaN。

启动单列首次用户缓存空、同会话重载、浏览器重启三组；分别记录下载、生成、编译、烘焙、首次完整帧和主线程长任务。驱动缓存状态不可控时明确标注，不能称严格冷启动。

容量按实际 `maxStorageBufferBindingSize`、`maxBufferSize`、`maxComputeWorkgroupsPerDimension` 和每阶段绑定数分块；格式的 storage、过滤和混合能力也要探测。不能把 M4 Pro 统一内存容量当成浏览器可任意分配的显存，或默认所有设备支持相同 f16/subgroup 路径。[设备限制](https://gpuweb.github.io/gpuweb/#limits)

## 建议预算、退出条件与待反驳假设

M4 Pro 原生 1080p 建议：GPU 总时间 p95 ≤14 ms、CPU 提交 p95 ≤4 ms；目标稳定 60 Hz，另查 p99 卡顿；应用可核算 GPU 资源 ≤768 MiB，不把该数当实际驱动总显存。完整画面首次缓存空 ≤10 秒、重载 ≤3 秒，启动单次主线程任务 ≤50 ms；网络条件单列。Windows、Safari、移动端必须独立建档，不能继承通过。

单项优化在至少两个代表视角总 GPU 时间改善 ≥10% 或 ≥1 ms，且其余视角不恶化超过 5%，才保留复杂实现；阈值也只是建议。视觉门槛不通过即退回。测不出收益则保留较简单路径，不因使用了 compute 就宣称成功。

请其他专家独立反驳：① 植物簇剔除收益能覆盖列表构建；② 三级 LOD 能保住近景轮廓和遮光率；③ compute 纹理比 CPU/片元烘焙更划算；④ TRAA 的稳定性收益大于拖影与带宽成本；⑤ 静态烘焙缓存足以达到启动预算而不需要实时全局光照。这五项均尚未实测成立。

## 第二轮：交叉评审结论

已阅读 [架构方案](architecture.md) 与 [视觉方案](visual-realism.md)，并核对探针、物理光照和反射源码。**条件同意固定日光、空间间接光和有限平面反射作为完整七栋园区主线；TRAA 与 GPU 裁剪仍应是分别过关的候选。** 两栋质量切片只能证明局部表现成立，不能证明七栋的成本、自由探索覆盖或启动预算。

### 先削减实现复杂度，保留写实门槛

延期 SSR、SSGI、连续太阳、多次反弹、Hi-Z、逐叶剔除、自研通用渲染图，以及默认启用的 f16/subgroups。先使用无风、固定太阳、CPU 空间分块和普通实例绘制。反射先验证一个平面，再验证角部同时两个平面；这属于实验顺序，不能变成最终只允许一个平面或限制自由探索。空间 AA 基线应先存在，不能要求所有材质从第一天就接受时域历史。

### 探针组合修复正确，但必须同时控制采样和烘焙成本

自定义唯一间接光组合可消除天空双计及重叠加亮，属于必要正确性修复，不能称性能优化。需要额外落实三件事：

1. **限制候选网格。** 本地 `LightProbeGridNode` 每网格读取七次 3D atlas；对七栋所有网格先采样再乘零权重仍有成本。按空间分块确定局部与背景候选，先限制到一个局部加一个背景；边界确需更多候选时单列成本。保持少量稳定着色器变体，以参数/atlas 地址表达区域，避免每网格复制整套材质和管线。编译后的 WGSL、着色器计时与接缝测试一起检查；不能假定 TSL 算式自动消除无效采样。[采样源码](../../node_modules/three/examples/jsm/tsl/lighting/LightProbeGridNode.js)
2. **独立校准能量语义。** SH 结果已经是辐照度，`EnvironmentNode` 的天空路径含 π，而物理模型消费 `iblIrradiance` 时除 π。用恒定天空验证 `E=πL`，再测同 atlas 重叠、边界、金属、玻璃和薄叶。保留同一镜面环境来源不等于所有金属亮度必须完全不变：`iblIrradiance` 也影响镜面多重散射。误差容限先由采样收敛实验确定，不靠曝光掩盖。[环境节点](../../node_modules/three/src/nodes/lighting/EnvironmentNode.js)、[物理模型](../../node_modules/three/src/nodes/functions/PhysicalLightingModel.js)
3. **测量烘焙随数量增长的成本。** 每探针需要六面场景捕获，再做 SH 投影和打包；若沿用 907 个探针，就是至少 5,442 次面捕获，并非数个便宜全屏 pass。每次 `bake()` 范围调用还会使阴影重绘，过小任务切片会放大启动成本。分别测 32/128/512 个探针的 CPU 编码、GPU 捕获、打包和峰值内存，选择能让界面响应的批量大小。简化烘焙场景必须保留墙体遮蔽与树冠透光，防止用错误代理换取快烘焙。网格 ready、天空回填与历史失效需统一调度，不能把尚未完成的画面称为完整首帧。[烘焙源码](../../node_modules/three/examples/jsm/lighting/LightProbeGrid.js)、[六面渲染](../../node_modules/three/src/cameras/CubeCamera.js)

### 动态反射与时域组合是新增的关键风险

反射选择应依据当前屏幕面积、粗糙度、距离和可见性，并加入切换滞回。降低更新频率会让倒影落后，平滑混合也可能产生双影，二者均须经过沿幕墙横移测试；不能直接当免费优化。GPU 时间须包括捕获、可能追加的阴影与反射中的间接光采样。半分辨率只减少像素量，不会自动减少几何处理量。

**玻璃表面的速度不等于镜中影像的速度。** TRAA 使用表面深度/速度，未必能拒绝反射平面切换或镜中风树的旧历史。本地 `ReflectorNode` 捕获时关闭 MRT，`TRAANode` 公开入口也没有现成 reactive-mask 参数；正确植物速度并不能独自解决反射拖影。先对“空间 AA/TRAA × 平面反射开/关”做四组对照，再决定是否需要局部历史拒绝或材质分层。若额外实现不划算，使用通过视觉门槛的空间 AA，不强行保留 TRAA。[反射源码](../../node_modules/three/src/nodes/utils/ReflectorNode.js)、[TRAA 源码](../../node_modules/three/examples/jsm/tsl/display/TRAANode.js)

### GPU 裁剪的组合正确性

每个阴影级联、每个镜像相机和主视角分别计算可见集合；切换相机时不能覆盖尚待使用的列表。共享缓冲可以按有序 pass 复用，先用独立列表建立参考。植物主画面、深度、阴影与反射使用同一时刻的风场，但各视图独立选择保守 LOD。历史按稳定实体 ID 保存，每显示帧只推进一次，不能每个反射 pass 都推进；重新可见、LOD 拓扑变化与新生成实例需拒绝无效历史。主视角裁剪使用无抖动视锥加保守边界，防止 TRAA 抖动导致边缘实例反复消失。

### 真实实验顺序与预算裁决

1. 真实后端/能力记录与 GPU 计时最小实验。
2. 恒定天空、灰板、探针重叠及薄墙场景，验证自定义间接光和采样成本。
3. 两栋质量切片用空间 AA 达到静态写实；一个/两个反射平面验证自由视角。
4. 加入 TRAA，再单独加入可复现微风，完成玻璃与植物运动对照。
5. 扩展完整七栋，先让 CPU 分块/LOD 基线过视觉门槛，再比较植物 GPU 压缩与间接绘制；同时核对阴影、反射和历史。
6. 最后组合通过的优化，进行完整漫游、启动缓存、资源释放与长时间稳定性验收。程序纹理 compute 可独立实验，必须比较包含编译/上传的总成本。

**14 ms GPU p95、4 ms CPU p95、启动 10 秒仍是规划预算，当前证据不能证明能同时达到。** 首轮可暂把 GPU 分配为主场景约 6 ms、阴影 2 ms、反射 3 ms、AA/后处理 2 ms、裁剪及余量 1 ms；这些是寻找超支项的假设，不是效果删减配额。以同一帧的完整成本统计，不能相加来自不同样本的 p95 冒充总 p95。若最坏自由视角超过预算，先优化/重新分配并复验；在写实门槛不变下仍不达标，就如实交付性能未达标结论，不能偷偷降低画质、避开视角或缩成两栋来宣告完成。
