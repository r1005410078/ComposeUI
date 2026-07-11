# ComposeUI 项目概览

## 项目定位

ComposeUI 是一个可嵌入任意 Web 项目的可视化页面编排引擎。宿主项目可以只为指定的独立页面启用可视化编辑能力，开发者通过拖放和配置已有业务组件生成 JSON 页面文档，再由宿主应用在运行时加载和渲染。

ComposeUI 不负责替代宿主项目，也不是完整的低代码平台或 Figma 替代品。它聚焦于已有项目中的页面布局、组件组合、数据绑定和页面运行。

## 项目目标

1. 让业务开发者不必反复修改页面布局代码，也能完成独立页面的搭建和调整。
2. 复用项目中已有的 Vue、React、Angular 等业务组件、主题、状态和服务。
3. 使用统一 JSON 页面模型连接编辑器、预览和正式运行时。
4. 支持自由布局、Auto Layout 和 Grid 三种布局方式，覆盖自由设计、常规页面和仪表盘场景。
5. 允许将多个节点封装成可复用自定义组件，并通过定义和实例统一维护。
6. 支持从 Figma 导入 SVG 或结构化节点，减少设计稿到业务页面的重复实现工作。
7. 保持框架无关的核心架构，使编辑器能够嵌入不同技术栈的宿主项目。
8. 支持高分辨率大屏和高频数据场景，通过页面编译、增量更新、Worker 和可选 GPU 图层扩展性能上限。
9. 基于 Yjs 支持多人实时协同、离线编辑、在线状态、远程选区和本地撤销/重做。

## 解决的问题

### 页面调整依赖开发

传统业务页面的布局、间距和组件位置通常需要开发者修改代码、构建并发布。ComposeUI 将这些调整转换为可视化操作，同时保留宿主项目对组件实现和运行环境的控制。

### 页面搭建能力难以复用

不同项目经常重复实现拖拽、布局、属性配置、保存和预览能力。ComposeUI 将这些能力封装为可嵌入的编辑器、文档内核和页面运行时。

### 设计稿与业务组件脱节

设计稿中的视觉节点通常不能直接对应项目里的真实业务组件。ComposeUI 通过 Figma 导入和组件映射，将设计节点转换为基础节点、SVG 或已注册业务组件。

### 多框架接入成本高

不同框架拥有不同的组件生命周期和上下文机制。ComposeUI 使用统一的 `ComponentAdapter` 协议接入框架，并在页面根部一次性注入 Store、Router、i18n、主题、数据和业务服务。

### 编辑器容易污染宿主项目

编辑器自身 UI 使用 Shadow DOM 隔离样式；业务组件保留在 Light DOM 中，继续使用项目原有样式。快捷键、Portal、事件监听和运行状态按编辑器实例隔离。

## 项目具体要做什么

### 可嵌入编辑器

- 提供挂载、更新文档、只读、保存和卸载 API。
- 支持同一宿主页面中的多个独立编辑器实例。
- 提供组件树、无限工作区（Workspace）、页面画板（Artboard）、组件面板和属性面板。
- 支持选中、多选、拖放、缩放、旋转、对齐、吸附、锁定、显隐和撤销/重做。

### 编辑器微内核

- 使用规范化响应式 Record Store 保存页面文档，不维护巨大的深层对象聚合。
- 所有文档修改通过原子 Transaction 和统一 Command 执行，并生成 Patch 和撤销信息。
- 组件树、画布、属性面板和运行时通过 Query/Projection 获取各自的增量只读模型。
- 布局、框架 Adapter、渲染器、导入器和协同能力通过插件贡献点按需接入。
- 使用编译器流水线将编辑文档转换为轻量 RenderPlan。

### 页面与布局

- 无限工作区提供无限平移、缩放、辅助网格和编辑上下文。
- 页面画板表示宿主最终渲染的独立页面，具有明确尺寸、背景和溢出策略。
- 支持自由布局、Auto Layout 和可自定义列数的 Grid。
- Grid 参考 GridStack 的拖放、缩放、碰撞、嵌套和自动紧凑排列交互。

### 组件体系

- 宿主显式注册业务组件、属性、事件和插槽元数据。
- 支持将节点子树创建为可复用自定义组件。
- 每个画板只允许一种业务组件框架，由 `runtime.adapterId` 指定。
- 框架上下文在画板运行时根部统一注入，不为每个组件重复创建应用实例。

### 文档与运行时

- 使用版本化 `PageDocument` 保存页面、节点树、布局、绑定、组件实例和资源引用。
- 宿主负责持久化、接口、鉴权、缓存和路由，ComposeUI 只通过受控 API 交互。
- 支持页面状态、宿主数据源、全局状态和宿主动作的结构化绑定。
- 对缺失组件、无效绑定和不可用资源显示可定位的错误信息。

### 渲染与隔离

- 使用 DOM 内容层渲染页面和真实业务组件。
- 使用 SVG 覆盖层渲染选框、控制柄、参考线和编辑反馈。
- 编辑器 UI 放在 Shadow DOM，业务组件放在 Light DOM 并继承宿主样式。
- Vue、React 是首批官方适配器，其他框架通过 `ComponentAdapter` 扩展。

### Figma 互操作

- 支持 Figma Copy as SVG 后直接粘贴到画板。
- 提供可选 Figma 插件，导出结构化节点、布局、样式和组件信息。
- 支持 Figma 组件到宿主业务组件的映射。
- 对暂不支持的复杂效果降级为 SVG，并生成导入报告。

### 大屏与高性能

- 将可编辑 `PageDocument` 编译为轻量 `RenderPlan`，发布运行时不携带编辑器状态。
- 将真实业务组件作为 DOM 黑盒，只管理组件根节点，不接管内部 DOM。
- 通过细粒度 Store、空间索引、视口裁剪、DOM Islands 和统一帧调度减少无关更新。
- 高频数据通过 Worker 数据平面和增量 Patch 更新，不频繁修改页面 JSON。
- 海量图元、地图和大规模数据可视化通过可选 GPU Layer 渲染。

### 多人实时协同

- 使用 Yjs 同步页面配置和组件结构，实时业务数据不进入协同文档。
- 本地命令与 Yjs 原子事务桥接，远程变更增量投影到 Record Store。
- 支持离线编辑、自动合并、在线成员、远程光标和远程选区。
- 本地撤销只跟踪当前用户操作，不回滚其他用户修改。
- 协同 Provider、服务端鉴权、Update 持久化和备份由宿主负责。

## 核心边界

- 核心版本只支持桌面页面，不提供移动端和响应式断点编辑。
- 不内置 HTTP 请求、鉴权、缓存和后端工作流。
- 不允许在同一画板中混合 Vue、React、Angular 等业务组件。
- 不执行页面 JSON 中的任意 JavaScript。
- 高级钢笔路径、复合路径和布尔运算属于可选矢量扩展，不阻塞核心版本。

## 交付阶段

1. 可嵌入内核和编辑器：宿主 API、文档 Schema、命令系统、无限工作区、页面画板、组件树、选区、三种布局、隔离和多实例支持。
2. 组件与运行时平台：`ComponentAdapter`、Vue/React 适配器、组件面板、自定义组件、数据和动作绑定、持久化及预览。
3. Figma 互操作：SVG 粘贴、Figma 插件、结构化导入、组件映射、资源导入和转换诊断。
4. Yjs 实时协同：共享文档映射、Provider 端口、离线同步、Awareness、本地撤销和冲突诊断。

## 当前进展

| 项目 | 状态 | 说明 |
| --- | --- | --- |
| 产品定位与范围 | 已完成 | 已明确为可嵌入式可视化页面编排引擎，不定位为低代码平台。 |
| 核心需求设计 | 已完成 | 已确定无限工作区、页面画板、组件树、自由/Auto/Grid 布局和自定义组件。 |
| 嵌入架构设计 | 已完成 | 已确定包边界、宿主 API、Shadow DOM/Light DOM 隔离、多实例和生命周期。 |
| 编辑器微内核架构 | 已完成设计 | 已确定 Record Store、Transaction、Command、Projection、插件系统、编译器流水线和依赖规则。 |
| 框架接入约束 | 已完成 | 已确定页面级上下文注入和单画板单框架约束。 |
| Figma 导入方案 | 已完成设计 | 已确定 SVG 和结构化插件两条导入链路，尚未实现。 |
| 大屏与高性能架构 | 已完成设计 | 已确定页面编译器、DOM Islands、Worker 数据平面、GPU Layer、性能目标和分阶段落地路线。 |
| Yjs 实时协同架构 | 已完成设计 | 已确定共享数据映射、事务桥接、Provider、Awareness、本地撤销、权限边界和交付路线。 |
| 测试与黄金文件策略 | 已完成设计 | 已确定 Vitest、fast-check、Playwright、Golden 规范、视觉回归、协同和性能测试分层。 |
| 示例与演示方案 | 已完成设计 | 已确定只使用单一 Vite Playground，并复用场景 Fixture 服务演示、E2E、视觉和性能测试。 |
| 规范地图 | 已完成 | 已建立 M0–M6 依赖路线、阶段边界和验收出口，见[规范地图](./superpowers/specs/2026-07-11-specification-roadmap-design.md)。 |
| M0 实施计划 | 已完成 | 已完成脚手架、最小文档/事务闭环、Golden、Playground 和 E2E。 |
| 工程代码 | M0 已完成 | 已实现最小 `@composeui/core` 与 `apps/playground`；编辑器骨架、布局、运行时和集成能力尚未开始。 |
| 自动化测试工程 | M0 已完成 | Vitest、Golden 和 Chromium Playwright 已建立；属性、视觉、协同和性能测试尚未开始。 |

## 下一步

依据[规范地图](./superpowers/specs/2026-07-11-specification-roadmap-design.md)为 M1 编写实施计划，优先完成 Transaction/History、Session Scope、无限工作区、页面画板、选区、组件树和 Free Layout 的最小可运行闭环。

详细设计见：[ComposeUI 可嵌入式可视化页面编排引擎设计](./superpowers/specs/2026-07-11-embeddable-visual-page-composer-design.md)。

大屏专项设计见：[ComposeUI 大屏与高性能架构设计](./superpowers/specs/2026-07-11-high-performance-large-screen-architecture-design.md)。

协同专项设计见：[ComposeUI Yjs 实时协同设计](./superpowers/specs/2026-07-11-yjs-collaboration-design.md)。

前端内核设计见：[ComposeUI 事务型编辑器微内核架构设计](./superpowers/specs/2026-07-11-transactional-editor-microkernel-architecture-design.md)。

测试专项设计见：[ComposeUI 测试与黄金文件策略](./superpowers/specs/2026-07-11-testing-and-golden-files-strategy.md)。

示例专项设计见：[ComposeUI Vite Playground 示例与演示设计](./superpowers/specs/2026-07-11-vite-playground-demo-design.md)。
