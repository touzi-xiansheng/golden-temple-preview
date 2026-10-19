# WebGPU 全新程序化园区：架构独立分析

日期：2026-10-19。范围：方案研究，不实施应用、依赖或部署变更；未读取其他专家报告。依据为当前源码、实际安装的 Three.js **0.186.1** 及官方文档，尚无新渲染器的本机性能实验。

## 结论与最终范围

可行。继续由代码生成几何、纹理与布局，用 `three/webgpu`、TSL 和节点渲染管线重建表现层。WebGPU 的实际优势应来自 GPU 驻留数据、计算裁剪和间接绘制，不能把更换渲染器当作加速证明。

最终目标是与现有布局相当的完整园区：总部、研发 A–D、园区客厅、展示中心共七栋建筑，两处庭院、入口道路、柱廊、屋顶种植与外围林地，以及自动漫游、自由探索和画质切换。先验证两栋建筑和一处庭院，只是质量切片，不能替代最终交付。[当前布局](../../src/campus/layout.js)

## 可复用与重建

| 内容 | 判断与处理 |
|---|---|
| 布局、米制尺寸、固定随机种子、运镜 | 可复用 `layout.js`、`core/rng.js`、`tour.js` 的数据和算法。 |
| 倒角、铺装、枝干生长、叶片分布 | 复用生成规则；提取顶点、索引、实例属性，不直接调用绑定旧材质的整座建筑生成器。 |
| `core/geom.js` | 数学操作可复用，但 `Builder` 按材质收集 Mesh，需在新生成模块内部改为材质编号和空间分块。 |
| 玻璃、树皮、叶片、天空、软阴影、间接光 | 重写为节点材质与 TSL；现有 `onBeforeCompile`、GLSL 字符串替换不能搬运。 |
| 反射、后处理、加载调度 | 重建为 GPU 资源生命周期和 `RenderPipeline`，不复用 `EffectComposer`。 |

证据：[建筑和材质耦合](../../src/campus/buildings.js)、[整树规则](../../src/campus/whole-tree.js)、[旧渲染流程](../../src/campus/rendering.js)。官方明确不支持旧 shader 注入和 Composer；普通内置材质虽可转换，也不能恢复它们被注入的效果。[迁移说明](https://threejs.org/manual/pages/webgpurenderer.html)

## r186 能力与写实路线

- **太阳和阴影**：已有 `CSMShadowNode`；也有 `SunLight` 的双级联阴影，后者需注册 `SunLightNode`。第一切片优先试 SunLight＋固定日光，测试近景偏移、级联接缝与自由视角稳定性；不能继续冻结随镜头变化的级联图。[SunLight 源码](../../node_modules/three/examples/jsm/lights/SunLight.js)、[阴影配置](https://threejs.org/docs/pages/SunLightShadow.html)
- **漫反射光**：`LightProbeGrid` 在 GPU 上完成立方体采集、L2 球谐投影与 3D atlas 打包，支持分批和多反弹烘焙。按庭院/廊下建立小网格，逐批完成；源码会在烘焙时替换 SunLight。它没有据此自动成为具备可见性判断的 DDGI：薄墙漏光、网格重叠重复贡献必须实测。[官方说明](https://threejs.org/docs/pages/LightProbeGrid.html)、[采样实现](../../node_modules/three/examples/jsm/tsl/lighting/LightProbeGridNode.js)
- **玻璃和反射**：基础采用程序天空、局部 PMREM 探针、玻璃厚度和可见室内体积；关键柱廊增加限量低分辨率 `ReflectorNode`，关闭递归反射。SSR 作为可选补充，不能承担离屏反射。r186 SSR 的环境重要性采样要求带 CPU 像素的等距柱状环境图，不接受 PMREM/cubemap，不能把程序天空探针直接接入。[Reflector](https://threejs.org/docs/pages/ReflectorNode.html)、[SSR 源码](../../node_modules/three/examples/jsm/tsl/display/SSRNode.js)
- **抗锯齿和间接细节**：`RenderPipeline` 输出 HDR beauty、深度、法线和 velocity，评估 TRAA；使用时关闭 MSAA。SSGI 的时域模式依赖 TRAA，只作为探针未表达的局部细节候选，检查重复增亮；首轮不同时启用 SSR、SSGI、TAAU。植物风动需前帧位置，切镜、改变分辨率和重建场景要失效历史，r186 TRAA 没有可直接假定存在的通用 `reset()`。[RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html)、[TRAA](https://threejs.org/docs/pages/TRAANode.html)、[SSGI](https://threejs.org/docs/pages/SSGINode.html)

材质优先保证尺度、倒角、接触、粗糙度与室内外亮度关系，再增加微表面细节；这些写实条件不由 WebGPU 自动提供。

## 模块、数据流与分工

独立 `campus-webgpu.html` 和 `src/campus-webgpu/`；原有入口继续可比较。后续只增加 Vite 构建入口，锁定现有版本。生成、GPU 资源、渲染之间使用三个 deep module，避免提前制造多后端框架：

| Module / 文件 | 最小 Interface 与契约 |
|---|---|
| `world/build.js`、`world/worker.js` | `buildWorld(spec, {signal,onChunk})`：返回固定种子、版本、分块包围盒、各级几何、材质编号和实例数组；单位为米，不返回材质或 renderer。 |
| `scene.js` | `createScene(chunks, renderer)`：返回根节点、探针/反射区域和 `dispose()`；隐藏上传、材质共享、资源所有权。 |
| `render.js`、`visibility.js` | `createView(renderer, scene)`：接收已初始化的 renderer，返回 `frame(camera,time)`、`resize()`、`setQuality()`、`stats()`、`dispose()`；内部管理裁剪、阴影、反射和时域历史。 |

主线程负责界面、相机和调度；Worker 负责拓扑复杂的树枝、建筑规则、LOD 与可缓存 TypedArray，使用 transfer 传输。GPU 负责适合并行的纹理生成、实例可见性/LOD 选择、风动及渲染。先验证分块实例绘制，再在密集植物上比较 compute＋可见索引压缩＋indirect draw；不能仅把不可见实例缩到零便声称节省提交量。[本地 indirect 实现](../../node_modules/three/src/renderers/common/IndirectStorageBufferAttribute.js)、[官方能力](https://threejs.org/docs/pages/IndirectStorageBufferAttribute.html)

**主相机、阴影相机、反射相机分别维护可见集**，避免屏外树木失去投影/反射。裁剪结果留在 GPU，正常帧不读回。缓存键含生成器版本、参数和种子；材料/光照变化单独使探针失效。Rust 不列为首版依赖。

## 访问和真实后端

WebGPU 要求安全上下文。开发可用 localhost；现有 `http://100.110.84.28:5173` 应另行提供可信 HTTPS，不能要求用户关闭浏览器安全限制。[WebGPU 规范](https://www.w3.org/TR/webgpu/#navigator-gpu)、[安全上下文规范](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)

启动检查 `isSecureContext`、`navigator.gpu`，随后 `await renderer.init()` 并断言 `renderer.backend.isWebGPUBackend`。该 renderer 会默认回退 WebGL2，类名不足以证明成功。记录后端、设备限制、compatibilityMode 和可用计时特性；不支持时显示原因与原版链接，须由用户选择打开原版。处理 `onDeviceLost` 与 GPU 错误。[回退源码](../../node_modules/three/src/renderers/webgpu/WebGPURenderer.js)、[初始化实现](../../node_modules/three/src/renderers/webgpu/WebGPUBackend.js)

## 分阶段验收

1. **能力门槛**：真实 WebGPU、节点材质、探针＋阴影、TRAA 各自最小复现；这是技术验证，不能作为写实成果。
2. **完整质量切片**：两栋有室内层次的建筑、真实柱廊、一处成熟树木庭院及完整铺装。固定六种视角覆盖近景、逆光、廊下、玻璃掠射、运动和鸟瞰；并排核对原版与新版，记录冷/热启动、稳定帧和移动帧。
3. **完整园区**：扩展七栋建筑与外围景观，加入分块加载和三档 LOD，检验全程漫游、任意自由视角和资源释放；此时才确定 GPU 裁剪的净收益。
4. **完成门槛**：目标设备实际后端记录、相同画质预算的 CPU/GPU 分项耗时、帧时间分位数、长时间漫游和截图对照全部归档。性能数值是验收测量结果，研究阶段不承诺翻倍或固定 60 FPS。

## 五个优先验证问题与待挑战假设

1. 目标浏览器的真实 WebGPU 是否具备需要的 MRT、存储缓冲和计时能力？
2. 风动叶片、细窗框及切镜时，TRAA 的清晰度和拖影是否优于现有组合？
3. 探针在廊下/薄墙附近能否保持可信亮度，分批烘焙是否拖慢首个可交互画面？
4. 同画质下，compute 裁剪＋间接绘制是否比 CPU 分块 LOD 更便宜，且阴影反射不丢物体？
5. 七栋建筑全量场景中，玻璃反射、探针和后处理的显存/带宽是否仍可承受？

请其他专家重点挑战三个假设：**固定日光＋局部探针足以构成主光照；少量平面反射足以保证关键玻璃镜头；植物是值得加入 GPU 计算复杂度的热点**。这些是设计取舍，不是现成实验结论。

## 第二轮：交叉评审后的主线裁决

已阅读 [视觉方案](visual-realism.md)，并追踪 r186 的光照累加过程。需要修正第一轮容易造成的印象：**`LightProbeGrid` 可复用为烘焙器和数据格式，但不能直接加入现有天空照明后便认为光照组合正确。新版本确实需要一个小型、自定义的 TSL 光照组合模块。**

### 双计与重叠问题已由源码确认

`EnvironmentNode.setup()` 同时向 `context.radiance` 和 `context.iblIrradiance` 加入环境贡献；`LightProbeGridNode.setup()` 则向 `context.irradiance` 加入球谐辐照度。名称不同并不表示它们互斥：`PhysicalLightingModel.indirectDiffuse()` 消费 `irradiance`，而 `indirectSpecular()` 除镜面计算外，还将 `iblIrradiance` 产生的漫反射加到同一个 `reflectedLight.indirectDiffuse`。若探针已捕获天空，直接叠加便重复计算这部分照明。[环境节点](../../node_modules/three/src/nodes/lighting/EnvironmentNode.js)、[物理光照模型](../../node_modules/three/src/nodes/functions/PhysicalLightingModel.js)

多个内置网格同样逐个累加，没有归一化。`falloff=0` 会在范围外继续采样钳制后的边缘数据；设为正数也只是让每个网格独立衰减，在重叠区域仍可能同时具有权重 1。因此“给网格加 falloff”不能解决重叠变亮。[网格采样](../../node_modules/three/examples/jsm/tsl/lighting/LightProbeGridNode.js)

还有一个细节：`iblIrradiance` 同时参与镜面多重散射补偿。不能用 `scene.environmentIntensity=0`、清空环境图或盲目清零 `iblIrradiance` 来修复漫反射；这会一起改变玻璃、金属和粗糙表面的环境表现。

### 最小可控处理

1. 主渲染场景不挂自动累加的 probe Light；网格仅作为由烘焙模块持有的 atlas 数据。保留太阳直射、程序天空背景以及 PMREM 镜面反射。
2. 在材料工厂内，由标准/物理节点材质的 `setupEnvironment()` 共同使用一个 `CampusEnvironmentNode`。保留 r186 `EnvironmentNode` 的 `radiance`、清漆等路径；在该节点内部明确设置唯一的 `iblIrradiance` 为下面的混合值。探针不再另行加入 `irradiance`，也不再叠加 HemisphereLight 或另一份 GI。无需复制整个 PBR 模型，但这一扩展依赖 r186 的节点契约，应锁版本并做升级回归。
3. 用 TSL 复用 atlas 解码公式，显式计算位置、接收面和覆盖权重。局部廊下网格优先；庭院粗网格只填补剩余权重；天空填补无探针区域。局部多个网格先归一化，不能按数量增亮。设局部权重之和为 `s`，则 `cL=clamp(s,0,1)`、`EL=sum(wi*Ei)/max(s,epsilon)`；最终 `E=cL*EL+(1-cL)*(cB*EB+(1-cB)*Esky)`。各权重均非负，总和为 1。`Esky` 来自全局程序天空的独立漫反射采样，不由玻璃的局部镜面探针替代。
4. 第一版不读取未完成网格的部分数据：分批烘焙结束后才将该网格标记 ready 并平滑提高覆盖权重。烘焙用独立的静态简化场景；禁用所有已烘焙网格反馈、平面反射和后处理，保留直射太阳与不含太阳圆盘的天空，首轮仅 `bounces:0`。这样捕获天空可见度和被照表面的反射，不把旧结果反复烘焙进去。此处的第零轮捕获仍可能包含表面的一次反射，不应称为“完全没有间接光”。

这比直接挂内置网格多出有限的组合代码，却保留镜面环境、避免天空双计，并把漏光与权重错误集中到一个模块。现有项目已经采用“替换漫反射、保留镜面”的职责划分，新版应迁移这个原则，不能迁移 GLSL 字符串替换实现。[现有组合逻辑](../../src/campus/indirect-light.js)

### 收敛后的效果顺序与反证门槛

**首个写实基线采用固定晴日＋级联太阳阴影＋上述受控探针＋程序 PMREM＋TRAA；SSR 和 SSGI 暂不进入主线。** 固定日光只减少变量，并不能消除漏光；若廊下仍失真，先修探针覆盖、法线偏移和遮挡代理，不能用 SSGI 或曝光掩盖。

“少量平面反射足够”收紧为按可见面共享和调度：同一平面上的窗格共享捕获；第一切片先允许一个关键反射平面，其他玻璃使用有空间校正的局部探针与可信室内。横移掠射时若关键物体视差失真，优先为该镜头增加第二个可见平面并测量，而不是把全园区换成 SSR。平面反射替换对应镜面来源，不能与原探针高光等强相加；近景反射与低分辨率远景探针切换需平滑权重。若完整园区实测经常同时需要更多平面，这个假设即被推翻，必须重新分配反射预算。

验收增加四个小型校准场景：无遮挡灰板的天空/探针亮度一致性；两份相同 atlas 重叠后亮度不变；穿越网格边缘的连续灰板；金属球与玻璃在启用漫反射探针前后仍保有同一镜面环境来源。再测试真实廊下、逆光树叶和沿幕墙横移。数值容差需按 atlas 分辨率和采样误差先标定；研究阶段不虚构已通过结果。
