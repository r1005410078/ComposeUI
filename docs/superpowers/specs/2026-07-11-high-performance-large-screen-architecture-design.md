# ComposeUI 大屏与高性能架构设计

## 目标

ComposeUI 需要同时支持普通业务页面和高分辨率大屏页面。高性能设计必须保留宿主项目已有的 Vue、React、Angular 等 DOM 业务组件，同时为海量图元、高频动画和大规模数据可视化提供 Worker 与 GPU 渲染路径。

性能目标不是让所有内容都进入 Canvas/WebGL，而是让不同内容使用适合自己的渲染后端：真实业务组件使用 DOM，编辑反馈使用 SVG，海量图元使用 GPU，高频数据和重计算使用 Worker。

## 基本原则

- `PageDocument` 是可编辑、可迁移、可读的权威文档，不直接作为发布运行时的执行结构。
- 发布运行时使用由页面编译器生成的 `RenderPlan`，不携带组件树 UI、选区、命令历史和编辑器会话状态。
- ComposeUI 只直接管理业务组件根节点，不读取、索引或接管业务组件内部 DOM。
- 页面配置更新和实时业务数据更新走不同通道；实时数据不得进入撤销历史或频繁改写页面 JSON。
- DOM、SVG、GPU 和 Worker 是可组合的运行层，不要求一种技术承担所有渲染任务。
- 所有性能优化都必须通过基准测试验证，并保留兼容的降级路径。

## 总体架构

```text
PageDocument（编辑模型）
        │
        ▼
Page Compiler
  ├─ Schema 校验与迁移
  ├─ 布局和依赖分析
  ├─ 静态节点合并
  ├─ 绑定表达式编译
  └─ 资源预处理
        │
        ▼
RenderPlan（运行模型）
        │
        ▼
Runtime Scheduler
  ├─ DOM Islands
  ├─ SVG Editor Overlay
  ├─ GPU Layers
  ├─ Worker Canvas Layers
  └─ Data Worker Pipeline
```

编辑器可以在内存中增量生成预览 `RenderPlan`；正式发布可以在构建、保存或加载阶段完整编译并缓存结果。

## 编辑模型与运行模型分离

### PageDocument

`PageDocument` 面向编辑和持久化，保存节点关系、组件定义、布局配置、绑定、动作、资源引用、来源信息和 Schema 版本。它强调语义完整和可迁移，不以每帧渲染效率为首要目标。

### RenderPlan

`RenderPlan` 是页面编译器生成的扁平运行结构，至少包含：

```ts
interface RenderPlan {
  documentId: string
  revision: number
  adapterId: string
  domIslands: DomIslandPlan[]
  gpuLayers: GpuLayerPlan[]
  workerLayers: WorkerLayerPlan[]
  bindings: CompiledBinding[]
  actions: CompiledAction[]
  assets: CompiledAsset[]
}
```

编译阶段执行：

- 解析自定义组件定义和实例，但保留实例更新所需的稳定引用。
- 预计算静态布局、局部变换和可合并样式。
- 把字符串绑定路径编译为稳定依赖表。
- 按更新边界拆分 DOM Island。
- 把 GPU 组件和 Worker Canvas 组件提取到独立图层。
- 校验组件注册、资源和运行时 Adapter。
- 移除编辑器专用字段和不可达节点。

运行时只加载与当前页面执行相关的数据，避免每次更新遍历完整文档树。

## 节点数量口径

性能指标必须区分以下概念：

- 文档节点：`PageDocument` 中由 ComposeUI 管理的节点。
- 可见 ComposeUI 节点：当前视口内需要布局、命中或渲染的节点。
- 业务组件根节点：ComposeUI 注册和管理的组件边界。
- 业务组件内部 DOM：由业务组件自身创建，ComposeUI 不建立索引和选区。
- GPU 图元：由一个 GPU Layer 内部批量管理的视觉对象，不等同于文档节点。

一个业务表格可能只对应一个 ComposeUI 节点，但内部包含数千个 DOM 元素。业务组件内部 DOM 数量不计入 ComposeUI 节点上限，性能责任通过组件契约和运行策略共同约束。

## 业务组件黑盒边界

ComposeUI 只管理业务组件的外部边界、布局、props、绑定、事件和生命周期，不应：

- 把组件内部 DOM 转换为页面节点。
- 为组件内部元素建立空间索引或选择控制柄。
- 监听组件内部所有 DOM 变化。
- 将组件内部状态写入 `PageDocument`。
- 因内部局部更新而重算整个页面布局。

业务组件宿主容器默认使用布局和绘制隔离；是否启用 `style` 隔离需要由组件兼容性测试决定：

```css
.composeui-component-host {
  contain: layout paint;
}
```

业务组件可以声明性能提示：

```ts
interface ComponentPerformanceHints {
  renderMode: "dom" | "gpu" | "worker-canvas" | "static-texture"
  updateMode: "realtime" | "frame" | "throttled" | "manual"
  maxFps?: number
  suspendWhenHidden?: boolean
  unmountWhenFarAway?: boolean
  containLayout?: boolean
}
```

性能提示只是调度依据，运行时必须为不支持暂停或卸载的有状态组件保留兼容策略。

## DOM Islands

页面运行时按稳定更新边界拆分 DOM Island，而不是形成一个会被任意数据更新穿透的巨大组件树。一个 Island 通常对应顶层布局区域、复杂业务组件或具有独立数据依赖的容器。

每个 Island：

- 只订阅自身绑定依赖。
- 拥有独立错误边界和更新调度状态。
- 可以暂停、降频或延迟挂载。
- 保持当前画板指定框架的统一上下文根。
- 通过同一框架 Root 的 Portal/Teleport 保持 Store、Router、i18n 和主题上下文。

拆分 Island 不能破坏单画板单框架约束，也不能为每个普通组件创建新的框架应用实例。

## 响应式 Store 与增量更新

编辑器 Store 使用按 id 扁平化的不可变 Record，并为父子关系、组件定义引用、绑定依赖和空间范围建立索引。

- 节点更新只通知依赖该记录或字段的订阅者。
- 组件树、属性面板、画布和运行时不能订阅完整文档快照。
- 批量命令在事务结束后统一发布变更。
- 派生布局和边界使用可失效缓存，不持久化为重复真值。
- 自定义组件定义变化只使相关实例和依赖 Island 失效。
- 保存采用增量 Patch 或后台快照，避免阻塞交互线程。

## 空间索引、裁剪与多级细节

运行时和编辑器为可空间定位的节点维护 R-tree 或等价空间索引，并缓存容器子树边界。

- 视口外普通节点不参与绘制，必要时延迟挂载 DOM。
- 组件树使用虚拟列表，只渲染当前滚动窗口内的节点行。
- 远距离缩放时隐藏文字、控制点和不必要细节。
- 复杂静态区域在低缩放级别显示缓存纹理或缩略图，放大后切换为真实 DOM。
- 命中测试先查询空间索引，再对候选节点执行精确几何判断。
- 画板平移和缩放只更新统一视口变换，不逐节点改写位置。

对于有状态业务组件，视口外策略分为保持挂载但暂停更新、隐藏、卸载三档，由组件性能提示决定，不能统一强制卸载。

## 运行时调度器

所有渲染和计算任务进入统一调度器，并按用户感知优先级执行：

1. 输入事件、拖拽和选择反馈。
2. 当前可见区域布局和业务组件更新。
3. 可见 GPU/Canvas 图层数据更新。
4. 视口附近预加载。
5. 不可见组件、缓存和持久化任务。

调度器应：

- 使用 `requestAnimationFrame` 合并同一帧内的多次更新。
- 为主线程设置每帧执行预算，超出预算的非紧急任务延期。
- 对高频数据执行合并和背压，只消费仍有意义的最新状态。
- 允许组件声明最大刷新频率，例如图表 10 FPS、时钟 1 FPS。
- 在页面不可见时暂停非必要动画和轮询。
- 记录长任务、丢帧、更新来源和各 Island 耗时，供性能诊断。

## 独立数据平面

实时数据流与页面配置流分离：

```text
WebSocket / 宿主数据源
        │
        ▼
Data Worker
  ├─ 解码
  ├─ 聚合
  ├─ 排序
  ├─ 采样
  └─ 增量 Diff
        │
        ▼
Binding Runtime
        │
        ├─ DOM Island Patch
        └─ GPU Buffer Patch
```

高频数据优先使用 TypedArray 和可转移 ArrayBuffer，减少大对象克隆和垃圾回收。只有在部署环境满足跨源隔离要求且基准测试证明必要时，才采用 SharedArrayBuffer 环形队列。

数据更新不得进入命令历史。页面只保存数据源引用和绑定规则，不保存不断变化的实时结果。

启用 Yjs 协同时，只同步页面配置、组件结构、绑定规则和资源元数据。实时业务数据、动画帧、图表采样结果、RenderPlan、空间索引和 GPU Buffer 都不进入 Y.Doc。远程 Yjs 事务必须转换为按 Record id 分组的最小 Patch，禁止每次协同更新重新序列化完整页面或重建全部 RenderPlan。

## Worker 与 OffscreenCanvas

以下任务优先放入 Worker：

- 大数据解析、过滤、聚合和降采样。
- 路径细分、复杂几何和空间索引批量构建。
- 大型文档的导入、迁移和编译。
- 支持 Worker 渲染的 Canvas/WebGL 图层。

`OffscreenCanvas` 可以把 Canvas/WebGL 渲染和动画循环移出主线程，但 DOM 业务组件、输入事件和最终页面组合仍由主线程负责。运行时必须提供能力检测和主线程回退，不能假定所有宿主环境都启用相同特性。

参考：[MDN OffscreenCanvas](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas)。

## GPU 图层协议

GPU Layer 是批量图元渲染单元，不是为每个图元创建一个框架组件。适用场景包括粒子、动态背景、地图、轨迹、热力图、大量散点、关系线和高频动画。

```ts
interface GpuLayerAdapter {
  create(plan: GpuLayerPlan, context: GpuContext): GpuLayerHandle
  update(handle: GpuLayerHandle, patch: GpuLayerPatch): void
  resize(handle: GpuLayerHandle, viewport: Viewport): void
  suspend(handle: GpuLayerHandle): void
  destroy(handle: GpuLayerHandle): void
}
```

GPU Layer 应支持：

- 稳定 Layer id 和增量属性更新。
- 纹理、Shader 和 Buffer 复用。
- 视口裁剪、分块和多级细节。
- 静态内容缓存为纹理。
- 拾取结果映射回业务数据 id。
- WebGL/WebGPU 能力检测和降级策略。

通用 2D 图元可以参考 PixiJS 的 Scene Graph、Render Group、裁剪和纹理缓存；海量数据可视化可以参考 deck.gl 的 Layer、稳定 id、GPU Buffer 和更新触发器设计。

参考：[PixiJS Render Groups](https://pixijs.com/8.x/guides/concepts/render-groups)、[deck.gl Layers](https://deck.gl/docs/developer-guide/using-layers)、[deck.gl Performance](https://deck.gl/docs/developer-guide/performance)。

## 静态纹理与快照

复杂但低频变化的基础图形子树可以缓存为 GPU 纹理，避免每帧重复绘制。仅当子树内部变化时重新生成缓存。

真实 DOM 业务组件不能默认转换为纹理，因为这会破坏交互、可访问性、文字选择和框架生命周期。只有组件显式实现快照协议，并且当前处于非交互展示状态时，运行时才能使用静态纹理替代。

## 资源与内存管理

- 图片根据实际显示尺寸选择合适分辨率，避免所有大屏素材按原始尺寸加载。
- GPU 纹理和 Buffer 使用引用计数或明确生命周期，并在页面卸载时释放。
- 重复图片、字体和 SVG 资源按内容或稳定资源 id 去重。
- 大纹理使用图集或分块，但必须考虑最大纹理尺寸和更新成本。
- 对象池只用于基准测试确认存在分配热点的高频对象，避免普遍池化增加复杂度。
- 运行时记录 JS Heap、DOM 数量、GPU 资源估算和资源加载失败。

## 高级渲染内核

如果未来基准测试证明 PixiJS/WebGL 无法满足复杂矢量、文字排版或极端图元规模，可以将 CanvasKit/Skia + WebAssembly 或 Rust + WebAssembly + WebGPU 作为独立 `RenderBackend`。

该方案具有更强的图形控制能力，但会增加包体、字体管理、无障碍、调试和 DOM 业务组件合成成本，因此不进入核心版本。参考：[Skia CanvasKit](https://docs.skia.org/docs/user/modules/canvaskit/)。

## 性能目标

以下数字是首版设计目标，不是未经测试的产品承诺。最终阈值必须在目标硬件、真实组件和真实数据上测量。

| 指标 | 首版目标 |
| --- | ---: |
| 单文档 ComposeUI 节点 | 20,000 |
| 组件树可浏览节点 | 50,000 |
| 同屏可见 ComposeUI 节点 | 500–1,000 |
| 同屏中等复杂业务组件根节点 | 50–200 |
| 常规压力场景页面总 DOM | 10,000–30,000 |
| 单 GPU Layer 动态图元 | 50,000 起步 |
| 拖拽、缩放、平移目标 | 60 FPS |
| 属性修改可见反馈 | 50ms 内 |
| 主线程单次非紧急任务 | 避免超过 50ms |

单个业务组件内部 DOM 不设统一硬限制，由组件自身负责虚拟化和局部更新。ComposeUI 需要分别统计文档节点、组件根节点和页面总 DOM，禁止混用指标。

## 性能降级策略

当运行时发现设备能力不足或持续丢帧时，按以下顺序降级：

1. 降低非关键组件刷新频率。
2. 暂停不可见区域动画和数据订阅。
3. 降低图片、文字和 Canvas 的渲染分辨率。
4. 使用静态纹理替代明确支持快照的区域。
5. 降低 GPU Layer 多级细节或采样数量。
6. 禁用非必要阴影、模糊和过渡效果。

降级必须可观察，并允许宿主覆盖策略，不能静默改变业务数据语义。

## 测试与基准

性能基准至少分为：

- 编辑器空节点基准：排除业务组件成本，测试 Store、布局、选区和组件树。
- 组件黑盒基准：测试单个复杂表格、图表或表单。
- 组合大屏基准：同时运行多个图表、表格、动画和实时数据源。
- GPU 图层基准：测试不同图元数量、更新比例、纹理数量和拾取频率。
- 长时间稳定性：持续运行数小时，检查内存、监听器、纹理和 Worker 泄漏。
- 多实例基准：同一宿主页面中存在多个编辑器或运行时实例。

测试产物记录硬件、浏览器、分辨率、设备像素比、节点构成、数据频率、平均 FPS、P95 帧耗时、长任务数量、内存和首次加载时间。

4K/8K 不是单独的节点指标。大屏测试必须单独关注 GPU Fill Rate、设备像素比、纹理尺寸和图表刷新频率。

## 落地顺序

1. 扁平化 Record Store、细粒度订阅、组件黑盒边界和组件树虚拟化。
2. 空间索引、视口裁剪、统一帧调度和性能诊断。
3. `PageDocument → RenderPlan` 页面编译器和轻量发布运行时。
4. DOM Islands、组件性能提示和独立数据平面。
5. Data Worker、增量 Patch 和高频数据背压。
6. PixiJS/deck.gl 风格 GPU Layer Adapter。
7. OffscreenCanvas Worker 渲染和静态纹理协议。
8. 只有基准测试证明必要时，再评估 CanvasKit 或 Rust/WebGPU 后端。
