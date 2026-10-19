# WebGPU 实施与证据

2026-10-19。**当前状态：用户已要求将现有实验版提交到GitHub并部署预览。** 本轮交付当前可运行快照；完整优化及视觉验收仍按 [总方案](WEBGPU_PLAN.md) 待后续推进。完整候选范围为七栋建筑、两庭院、全部程序生成、写实表现及 WebGPU 专项优化。

## 发布前验证

- 生产构建：`npm run build -- --base=/golden-temple-preview/` 通过。
- `npm run test:webgpu`：18项通过，1项需独立GPU环境的测试跳过；`npm run test:campus`：72项通过。
- 06:26 UTC以生产打包文件运行 `tools/webgpu-check.mjs`：真实WebGPU、1920×1080、七栋建筑、907个间接光探针和4个反射探针成功初始化，六个漫游视角截图完成，未记录页面/GPU错误、警告或站外资产请求。完整首帧约45.41秒，其中反射阶段约28.20秒，编译阶段约7.84秒。阶段为墙钟时间，不是纯GPU耗时。
- 该次检查证明默认页面可运行，不代表动态反射正确性、稳定60Hz、视觉质量、资源生命周期或其他设备已经验收。画面偏白和性能问题仍可见。
- GitHub源码目标：`touzi-xiansheng/golden-temple-preview` 的 `source/webgpu-preview` 分支；部署使用现有 `main` 静态文件分支与GitHub Pages HTTPS。原始上游仓库没有当前账户的写入权限。

“95%以上”没有可复现的概率模型，不能由专家主观打分来证明。本轮采用开工检查和逐阶段验收；通过基础检查表示可以推进实现，不表示最终视觉或性能已有95%的成功概率。

## 已有实机证据

- `node tools/webgpu-check.mjs --lab`：真实 WebGPU 初始化、标准节点材质实际绘制、GPU queue 完成和无 uncaptured GPU error。报告见 [lab.json](../out/webgpu/lab.json)，画面见 [lab-initial.png](../out/webgpu/lab-initial.png)。
- 本机适配器报告 `vendor=apple`、`architecture=metal-3`、`isFallbackAdapter=false`，Three 后端 `compatibilityMode=false`，支持 `timestamp-query`。
- 实际 GPU device 的默认 buffer 限制与 adapter 上限不同。后续实现使用 device.limits，不根据 adapter 最大值推断可用容量。
- 06:13 UTC的 [lab.json](../out/webgpu/lab.json) 记录9项光照校准通过，以及可见列表/CPU参照、原生间接绘制和输出像素验证通过；覆盖零实例、容量全满及独立反射视角。这是校准场景，不能代替全园区验证。
- 06:17 UTC的 [check.json](../out/webgpu/check.json) 记录七栋完整几何基线在1080p成功渲染，未记录错误；当次关闭局部间接光和局部反射。景观生成约6.77秒，编译阶段约21.16秒，首帧约28.13秒。没有受控冷热条件或同负载A/B，不能据此声明性能收益。
- 上述记录早于部分最新改动，后续恢复时须按实际源码重新验证。画面仍有整体偏白与层次不足的问题，尚未视觉验收。

## 尚须通过

1. 最新代码下重跑天空/探针能量校准；完整天空/太阳比例、薄墙/廊下及接触层次检查。
2. TSL迁移虽已跑通完整几何，仍须验证玻璃、叶片、草坪、矿物和树皮在最终组合下的视觉保真。
3. 将已经通过最小校准的GPU可见列表集成到完整园区，验证阴影/反射/历史和全部实例属性；同负载 A/B 后才决定默认启用。
4. 六镜头与自由视角的反射、时域、近景和外围覆盖。
5. 分阶段加载、资源释放、画质切换、设备丢失、HTTPS、现有版本回归与生产构建。

## 当前实现取舍

先由兼容适配层复用旧生成器产生几何和程序纹理，再显式转换为节点材质；不会运行旧 GLSL。转换时可读取旧 hook 的 uniform 数据，以复用闭包内的生成纹理。该步骤有意先保住完整场景及现有细节，生成与材质数据的分离和 Worker 化需后续验证，不能把当前适配层当作已经完成最终架构。

旧版入口继续可用，新版入口是 `campus-webgpu.html`；`webgpu-lab.html` 为内部校准页，不代表园区视觉验收。默认抗锯齿先使用4倍MSAA；`?aa=traa`用于相同场景实验，未经动态验证不把TRAA列为质量提升。
