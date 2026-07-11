# ComposeUI 规范地图与实施路线

## 1. 用途

本文件是 ComposeUI 的实施导航，而不是替代已有专题设计。它回答四个问题：

1. 哪些规范是某项能力的权威来源。
2. 各能力之间的前置依赖是什么。
3. 当前实现已经完成到哪里。
4. 下一步应实施什么，以及什么不能提前引入。

每个里程碑必须单独编写实施计划、完成可运行纵向路径并通过测试后，才可进入下一里程碑。不得把本路线图理解为一次性大版本开发清单。

## 2. 规范优先级

发生冲突时按以下顺序处理：

1. 当前用户的明确指令。
2. [主产品设计](./2026-07-11-embeddable-visual-page-composer-design.md)。
3. 相关专题设计：微内核、组件树、性能、Yjs、测试、Playground、脚手架。
4. [项目概览](../../project-overview.md)。

专题规范负责细节，主产品设计负责产品取舍。本路线图只负责记录依赖、状态和实施顺序；不能静默改变任何专题规范的行为。

## 3. 始终成立的约束

以下规则跨越所有里程碑：

- ComposeUI 是可嵌入式页面编排引擎，不是宿主应用、通用低代码平台或完整 Figma 替代品。
- 宿主拥有路由、持久化、鉴权、网络、缓存、业务服务和二进制资源存储。
- 每个画板只能选择一个业务组件框架 Adapter；基础节点可以与该框架共存。
- 框架上下文在画板根部注入一次，不为每个业务组件创建框架根。
- 编辑器 Chrome 在 Shadow DOM；业务组件在宿主 Light DOM。
- `PageDocument` 只保存运行时和持久化所需模型；Workspace 视口、选区、悬停、拖拽预览和 Presence 属于 Session Scope。
- 所有持久修改只经 Command 和原子 Transaction；UI、插件和外部适配器不能绕过事务写入权威状态。
- 核心不直接依赖 Vue、React、Angular、Yjs、Figma、PixiJS 或宿主后端。
- 只使用一个 Vite Playground、Vitest、fast-check 和 Playwright 测试体系。
- 高级矢量、GPU 后端和重型任务编排工具必须由测量结果驱动，不能抢占核心编辑能力的交付。

## 4. 当前基线：M0 已完成

M0 是领域和工具链的最小闭环，已在 `main` 实现：

- Bun Workspace、严格 TypeScript、Oxlint、Oxfmt、Vite、Vitest、Playwright。
- `@composeui/core` 的最小 `PageDocument`、规范化 `RecordStore` 与结构化 `Diagnostic`。
- 创建记录的原子 Transaction、forward/inverse Patch 和 `node.create` Command。
- 可审查的 canonical JSON Golden。
- 唯一 Vite Playground：通过公开 Core API 创建并展示一个矩形节点。
- Chromium E2E：验证画板、节点和 JSON 输出。

M0 的刻意限制：只支持创建矩形节点；尚未支持更新、删除、移动、历史、Session Scope、组件树、真实编辑器 UI、布局引擎、宿主接入或框架 Adapter。

## 5. 里程碑地图

```text
M0 领域闭环                         已完成
 │
 ▼
M1 编辑骨架
 │  Transaction + Session + Workspace + Page Board + Selection + Tree + Free
 ▼
M2 布局与基础节点
 │  Auto Layout + Grid + layout projections + layout interaction
 ▼
M3 可嵌入运行时与组件平台
 │  Host API + editor shell + Adapter + bindings + definitions + RenderPlan
 ├───────────────┐
 ▼               ▼
M4 Figma         M5 Yjs
 │               │
 └───────┬───────┘
         ▼
M6 性能与可选矢量扩展
```

M4 和 M5 都依赖稳定的文档模型、事务语义、诊断、测试夹具和运行时边界；两者不互为前置依赖。M6 不属于核心交付主线，按实际性能基准和产品优先级拆分实施。

## 6. M1：编辑骨架

### 目标

把 M0 的领域最小闭环发展为一个能直接操作页面的编辑器骨架：用户可以在无限工作区查看页面画板，创建、选择、移动、缩放、删除和撤销自由布局节点，并在 Unity 风格组件树与画板间同步定位。

### 必须交付

- 扩展 Record Store 和 Transaction：`update`、`remove`、批量原子变更、精确 inverse patch、事务事件和有限 History。
- 增加 `Document Scope` 与 `Session Scope`；后者包含 viewport、选区、悬停、展开状态和拖拽预览，绝不进入 canonical `PageDocument`。
- 扩展 Page Board：尺寸、背景、溢出、唯一页面根和 Free Layout 容器语义。
- 实现 Workspace 坐标变换、平移、以指针为中心的缩放和临时辅助网格。
- 实现选区：单选、修饰键多选、框选和 SVG 选框覆盖层。
- 实现 Free Layout：局部坐标、移动、缩放、删除和同级重排。
- 实现最小 Unity 风格组件树：根节点、缩进、展开/折叠、选中同步、重命名、显隐/锁定状态和基础拖拽重排。
- Playground 形成确定性场景：创建节点、选中、拖动、撤销/重做、导出 JSON。

### 不在 M1 中

- Auto Layout、Grid、业务组件 Adapter、数据绑定、自定义组件、Figma、Yjs、GPU 和高级矢量。
- 完整属性面板、复杂对齐/吸附、旋转、组、多画板管理和跨容器布局转换。
- 面向外部宿主的正式 Shadow DOM 挂载 API。M1 可使用 Playground 内部编辑器壳，但必须避免把壳逻辑写入 Core。

### 验收出口

- 每次持久修改都由 Command 产生一个原子 Transaction 和一个可撤销历史项。
- 任意失败事务不改变 Document Scope、Store revision 或 History。
- Session Scope 改变不影响导出的 canonical JSON。
- 画板与组件树选区双向同步；树排序与文档同级顺序一致。
- 自由布局拖动使用父容器局部坐标，缩放与 Workspace zoom 无关。
- Playground 的确定性场景具备 Vitest 单元/属性测试、JSON Golden 和 Playwright E2E。

### 权威规范

- [主产品设计：Workspace、画板和 Free Layout](./2026-07-11-embeddable-visual-page-composer-design.md#无限工作区与页面画板)
- [微内核：Store、Transaction、Command、Projection](./2026-07-11-transactional-editor-microkernel-architecture-design.md)
- [Unity 风格组件树](./2026-07-11-unity-style-component-tree-design.md)
- [测试与黄金文件策略](./2026-07-11-testing-and-golden-files-strategy.md)

## 7. M2：布局与基础节点

### 目标

让页面可以使用基础节点、Auto Layout 和任意列数 Grid 进行稳定布局，并在编辑器和运行时得到相同计算结果。

### 必须交付

- 基础节点：矩形、文本、图片、Group、自由/Auto/Grid 容器和 SVG 展示。
- 纯函数布局引擎和布局 Projection。
- Auto Layout：方向、换行、间距、内边距、对齐、`fixed/hug/fill`、最小/最大尺寸和绝对定位子节点。
- Grid：可配置列数、`x/y/w/h`、拖放、缩放、碰撞、锁定、嵌套和自动紧凑排列。
- 节点在 Free、Auto、Grid 间移动时的单事务布局数据转换。
- 布局 JSON Golden、属性测试和浏览器交互测试。

### 前置条件

M1 的局部坐标、拖拽会话、命令、History、组件树排序和选区覆盖层必须稳定。

### 验收出口

- 对相同输入，布局计算和 canonical 输出保持确定。
- 不允许重叠的 Grid 在碰撞处理后没有重叠；锁定项位置保持不变。
- Auto/Grid 子节点的实际位置由布局 Projection 决定，而不是直接写入自由坐标。
- Playground 同时演示 Free、Auto 和自定义列数 Grid 场景。

### 权威规范

- [主产品设计：布局](./2026-07-11-embeddable-visual-page-composer-design.md#布局)
- [微内核：布局策略和插件边界](./2026-07-11-transactional-editor-microkernel-architecture-design.md)
- [测试：布局 Golden 与属性测试](./2026-07-11-testing-and-golden-files-strategy.md)

## 8. M3：可嵌入运行时与组件平台

### 目标

让宿主应用可以安全嵌入编辑器、注册真实业务组件、提供上下文和数据，并将 `PageDocument` 编译为可运行的页面。

### 必须交付

- `@composeui/editor`、`@composeui/runtime` 和最小公开 Host API；Core 继续保持框架无关。
- 多实例 mount/update/read-only/save/error/unmount 生命周期和资源释放。
- 编辑器 Shadow DOM 与业务组件 Light DOM/Portal 根的隔离边界。
- `ComponentAdapter` 协议，以及 Vue、React 官方适配器；每个画板只有一个 `runtime.adapterId`。
- 页面级上下文根，注入宿主 data、state、actions、router、i18n、theme 和服务。
- 组件面板、属性元数据、基础绑定、错误诊断和预览/编辑模式切换。
- Component Definition/Instance、公开属性、插槽、事件、循环校验与 detach。
- 文档持久化边界和 `PageDocument → RenderPlan` 编译。

### 前置条件

M1/M2 必须提供完整页面树、布局 Projection、稳定 Command/Transaction、诊断和可复用 Playground 场景。

### 验收出口

- 一个宿主页面可同时挂载多个隔离编辑器实例。
- 已注册 Vue 或 React 组件通过唯一画板运行时根获得宿主上下文；同一画板拒绝混合业务框架。
- 编辑器 CSS 不泄漏到业务组件；业务组件保留宿主样式。
- 运行时缺少组件、无效绑定和不可用数据源显示可定位诊断。
- 同一 JSON 可在编辑器预览和宿主运行时解析为等价 RenderPlan。

### 权威规范

- [主产品设计：可嵌入架构、绑定和渲染](./2026-07-11-embeddable-visual-page-composer-design.md)
- [组件树：定义与实例](./2026-07-11-unity-style-component-tree-design.md#自定义组件与实例)
- [高性能设计：RenderPlan 和 DOM Islands](./2026-07-11-high-performance-large-screen-architecture-design.md)
- [Playground 设计](./2026-07-11-vite-playground-demo-design.md)

## 9. M4：Figma 互操作

### 目标

提供两条独立且安全的导入链路：标准 SVG 粘贴优先保留视觉效果，结构化 Figma Payload 优先保留可编辑结构。

### 必须交付

- SVG 清理、资源安全检查、粘贴定位和一次性撤销。
- 版本化结构化 `FigmaImportPayload`、大小限制、转换器和导入诊断。
- Frame/Group/基础图形/Text/Image/Vector/Auto Layout 转换。
- Figma 组件到已注册业务组件的稳定映射；无法映射时降级为节点树或 SVG。
- 固定导入 Fixture、转换 Golden、恶意输入和浏览器集成测试。

### 前置条件

M2 的节点和布局模型、M3 的组件注册/资源/诊断/事务/运行时边界必须稳定。

## 10. M5：Yjs 协同

### 目标

以可选适配器接入 Yjs，在不污染 Core 的前提下实现文档协同、离线合并、Presence 和当前用户撤销。

### 必须交付

- Collaboration Port 和 `@composeui/collaboration-yjs`；Core 不导入 Yjs。
- 协同模式下 Y.Doc 为共享权威，Record Store 为本地查询和渲染 Projection。
- 规范化 Record 映射到 Y.Map；一个 ComposeUI Command 对应一个 Yjs transaction。
- Awareness 管理用户、光标、选区等临时 Presence；不写入 `PageDocument`。
- Y.UndoManager 仅跟踪当前用户的本地 origin。
- Provider 由宿主提供传输、鉴权、持久化、备份和审计。
- 多客户端收敛 Golden、断网/重连和冲突诊断测试。

### 前置条件

稳定的事务 origin、完整 Patch、Session Scope、树/组件定义策略、canonical serializer 和 M3 的协同入口。

### 权威规范

- [Yjs 实时协同设计](./2026-07-11-yjs-collaboration-design.md)
- [测试：协同 Golden](./2026-07-11-testing-and-golden-files-strategy.md)

## 11. M6：性能与可选矢量扩展

### 性能路线

先测量真实业务组件、4K 页面和大文档，再按顺序引入：窄订阅与增量 Projection、组件树虚拟化、空间索引、视口裁剪、DOM Islands、Worker 数据平面、可选 GPU Layer。不得因为矩形节点基准而提前建设自研 CanvasKit、Rust 或 WebGPU 后端。

性能工作必须使用固定场景记录 before/after，且不把 GPU buffer、动画帧、空间索引或实时数据写入 `PageDocument` 或 Y.Doc。

### 矢量路线

核心仅承诺基础图形和 SVG 展示。钢笔路径、锚点编辑、布尔运算、复杂矢量分组和 SVG 深度编辑是独立可选扩展，不阻塞 M1–M5。

### 权威规范

- [大屏与高性能架构设计](./2026-07-11-high-performance-large-screen-architecture-design.md)
- [主产品设计：矢量能力路线图](./2026-07-11-embeddable-visual-page-composer-design.md#矢量能力路线图)

## 12. 计划与状态维护规则

- 每个里程碑开始前，在 `docs/superpowers/plans/` 创建只覆盖该里程碑的实施计划。
- 计划必须列出代码边界、测试、Golden、Playground 场景、浏览器验证和退出条件。
- 完成里程碑后更新本规范地图、项目概览和 `AGENTS.md` 的当前状态；不要把“已设计”写成“已实现”。
- 任何改变 `PageDocument`、Transaction Patch、布局结果、RenderPlan、导入转换或 Yjs 收敛语义的改动，都必须新增或审查 Golden。
- 不因后续功能而破坏 M0/M1 的公开入口；需要不兼容变更时必须设计 Schema migration 和诊断。

## 13. 下一个动作

下一步是为 M1 编写独立实施计划。M1 的第一个纵向路径应为：创建自由布局节点，在 Workspace 中选中和拖动它，通过组件树定位，执行撤销/重做，并导出不含 Session Scope 的 JSON。

