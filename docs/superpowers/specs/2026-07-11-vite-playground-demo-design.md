# ComposeUI Vite Playground 示例与演示设计

## 架构决策

ComposeUI 只建设一个基于 Vite 的 `apps/playground`，不引入 Storybook、Ladle 或第二套示例运行器。

Playground 同时承担：

- 人工体验完整编辑器。
- 日常开发和调试。
- 产品能力演示。
- React、Vue 等框架 Adapter 验证。
- Playwright E2E 宿主。
- 视觉黄金文件宿主。
- Yjs 协同测试宿主。
- 大文档和 4K 大屏性能基准宿主。

独立 UI 状态也通过 Playground 场景展示，不额外建设组件故事系统。

## 目标

- 用户打开一个地址即可体验 ComposeUI 的真实能力，而不是静态文档或伪交互原型。
- 示例使用真实 `PageDocument`、组件注册、宿主上下文和 Adapter。
- 一个场景定义可以被 Playground、Playwright、视觉黄金和性能测试共同复用。
- 示例代码体现真实宿主接入方式，可以作为项目集成参考。
- Playground 不进入 ComposeUI 生产包，也不成为内核依赖。

## 非目标

- 不提供营销落地页。
- 不重复实现一套独立编辑器状态。
- 不在 Playground 中绕过公开 Host API 调用内核私有模块。
- 不通过随机数据和不稳定动画制造演示效果。
- 不把所有框架业务组件混合到同一个画板。
- 不使用 Storybook 维护独立 Stories。

## 应用结构

```text
apps/playground/
├─ index.html
├─ vite.config.ts
└─ src/
   ├─ main.ts
   ├─ app/
   │  ├─ playground-shell.ts
   │  ├─ scenario-router.ts
   │  ├─ scenario-picker.ts
   │  └─ debug-panels.ts
   ├─ scenarios/
   │  ├─ basic-layout.ts
   │  ├─ auto-layout-form.ts
   │  ├─ grid-dashboard.ts
   │  ├─ custom-components.ts
   │  ├─ data-binding.ts
   │  ├─ figma-import.ts
   │  ├─ collaboration.ts
   │  ├─ large-document.ts
   │  └─ large-screen-4k.ts
   ├─ adapters/
   │  ├─ react.ts
   │  ├─ vue.ts
   │  └─ registry.ts
   ├─ test-components/
   │  ├─ react/
   │  ├─ vue/
   │  └─ shared-metadata/
   ├─ host-context/
   │  ├─ data-sources.ts
   │  ├─ actions.ts
   │  ├─ themes.ts
   │  └─ services.ts
   └─ testing/
      ├─ playground-test-api.ts
      └─ stability-signals.ts
```

可复用 Fixture、Golden 和 canonicalizer 仍放在 `packages/testing`，Playground 只引用公开测试入口。

## 场景模型

每个场景是一个确定性模块：

```ts
interface DemoScenario {
  id: string
  title: string
  description: string
  category:
    | "getting-started"
    | "layout"
    | "components"
    | "integration"
    | "collaboration"
    | "performance"

  supportedAdapters: string[]
  defaultAdapter: string
  viewport?: {
    width: number
    height: number
    deviceScaleFactor?: number
  }

  createDocument(context: ScenarioContext): PageDocument
  createComponents(context: ScenarioContext): ComponentRegistration[]
  createHostContext(context: ScenarioContext): HostContext
  setup?(context: ScenarioRuntimeContext): Promise<Disposable | void>
}
```

场景必须显式声明支持的 Adapter。切换 Adapter 时重新加载对应场景文档或使用预先准备的等价 Fixture，不能在已有画板中混合框架组件。

## URL 与路由

每个场景拥有稳定、可分享和可自动化的 URL：

```text
/?scenario=basic-layout&adapter=vue
/?scenario=grid-dashboard&adapter=react
/?scenario=collaboration&adapter=vue&room=test-room
/?scenario=large-document&nodes=20000
/?scenario=large-screen-4k&adapter=react
```

URL 参数只允许场景声明的白名单字段，并在加载时校验范围。无效参数显示诊断并回退到场景默认值，不直接执行任意代码或加载任意远程模块。

Playwright 使用这些 URL 直接进入确定状态，避免通过多个 UI 步骤准备每个测试前置条件。

## Playground Shell

Playground Shell 是开发辅助 UI，不属于 ComposeUI 编辑器产品 UI。它包含：

- 场景选择器。
- Adapter 选择器。
- 重置场景。
- 编辑/预览/只读模式切换。
- 当前 `PageDocument` 查看器。
- 最近 Command、Transaction 和 Patch 查看器。
- `RenderPlan` 查看器。
- Diagnostic 面板。
- 性能指标面板。
- Yjs 连接、客户端和 Awareness 状态。

辅助面板默认收起，不能遮挡主要编辑体验。视觉黄金测试可以通过 URL 参数或测试 API 隐藏 Playground Shell，只截取编辑器区域。

## 首批场景

### 基础布局

覆盖页面画板、文本、图片、基础图形、自由定位、选择、缩放、对齐和撤销/重做。

### Auto Layout 表单

覆盖方向、间距、内边距、对齐、`fixed/hug/fill`、嵌套容器和业务表单组件。

### Grid 仪表盘

覆盖自定义列数、拖放、缩放、碰撞、锁定、自动紧凑排列和嵌套 Grid。

### 自定义组件

覆盖组件定义、实例、公开属性、插槽、覆盖、定义编辑、解除关联和循环引用诊断。

### 数据绑定

覆盖 `pageState`、宿主 `dataSources`、`globalState`、Action、错误占位和预览模式。

### Figma 导入

覆盖 Copy as SVG、结构化载荷、组件映射、资源导入和降级诊断。自动演示使用仓库内固定 Fixture，不依赖在线 Figma。

### Yjs 协同

在同一页面显示两个独立编辑器实例或提供两个浏览器上下文入口，覆盖远程选区、并发编辑、断网和重连。

### 大文档

支持参数化节点数，默认 20,000，用于组件树虚拟化、空间索引、小 Patch 和内存测试。

### 4K 大屏

使用固定 3840 × 2160 画板，组合图表、表格、动画和 GPU Layer，展示 DOM/GPU 分层和刷新降频。

## 框架 Adapter

Playground 可以加载多个 Adapter 包，但一个场景实例和画板只能激活一个 Adapter。

每个官方 Adapter 在 Playground 中提供：

- 相同语义的测试业务组件。
- 页面级上下文注入。
- Router、Store、i18n 和主题示例。
- Portal/Teleport/Overlay 示例。
- 挂载、更新、错误和卸载状态。

测试组件保持简单但不能是假节点。它们需要真实创建框架组件树，以验证上下文、Light DOM 样式、事件和生命周期。

## Fixture 复用

场景数据按以下方向复用：

```text
packages/testing Fixture
        │
        ├─ Playground Scenario
        ├─ Vitest Golden Test
        ├─ Playwright E2E
        ├─ Visual Golden
        └─ Performance Benchmark
```

禁止在 E2E 测试文件内复制大型 `PageDocument`。测试只引用场景 id 和少量参数。

当场景用于黄金文件时，必须使用确定性 id、固定时钟、固定资源 URI 和固定数据。实时演示模式可以由场景显式启用动态数据，但视觉测试默认使用静态模式。

## Playwright 接入

Playground 暴露仅在开发和测试构建中存在的测试 API：

```ts
interface PlaygroundTestApi {
  ready(): Promise<void>
  reset(): Promise<void>
  getDocument(): PageDocument
  getRenderPlan(): RenderPlan
  getDiagnostics(): Diagnostic[]
  executeCommand(command: Command): Promise<CommandResult>
  waitForStable(): Promise<void>
  getPerformanceSnapshot(): PerformanceSnapshot
}
```

测试 API 必须调用公开 Editor API，不能绕过 Transaction、Policy 或 Adapter。生产构建不导出该全局接口。

Playwright 可以先通过 API 装载确定状态，再通过真实 Pointer、Keyboard 和 UI 操作验证用户行为。

## 稳定信号

Playground 提供统一稳定条件，禁止 E2E 使用任意固定 sleep：

- 编辑器实例已挂载。
- 场景 Fixture 已加载。
- 字体和图片已完成加载或失败处理。
- 当前事务、布局和 RenderPlan 编译已完成。
- DOM Island 已完成本帧更新。
- Canvas/GPU Layer 已报告首帧完成。
- Yjs 场景达到指定连接和同步状态。

`waitForStable()` 只表示已知任务完成，不应掩盖持续动画。视觉测试模式需要冻结或确定性推进动画时间。

## 视觉与性能模式

```text
/?scenario=grid-dashboard&mode=visual-test
/?scenario=large-screen-4k&mode=performance
```

视觉测试模式：

- 固定字体、locale、timezone、主题和数据。
- 禁用动画和光标闪烁。
- 隐藏非测试目标的调试面板。
- 使用固定 viewport 和 device scale factor。

性能模式：

- 禁用开发日志和调试 Overlay。
- 保留性能标记和采样 API。
- 使用固定数据规模和更新频率。
- 输出节点数、DOM 数、帧耗时、长任务和内存趋势。

## 构建与发布

- Playground 使用 Vite 开发服务器和静态构建。
- 所有 ComposeUI 包通过 workspace 源码或正式公开入口加载。
- 示例组件和调试依赖不得进入生产包产物。
- 静态构建可以部署到文档站子路径或独立演示域名。
- 发布构建保留场景切换和只读体验，但移除测试全局 API、内部日志和危险调试命令。
- 协同公开演示使用隔离测试房间、临时身份和严格资源限制。

## 测试

- 每个场景至少有一个加载 Smoke Test。
- 场景声明的 Adapter 组合必须通过注册和文档校验。
- 场景 Fixture 必须通过 canonical Golden，防止示例无意漂移。
- 核心场景具有 Playwright 用户旅程。
- 视觉场景具有固定 Baseline。
- 性能场景具有 PR 烟雾和固定硬件夜间基准。
- Playground Shell 自身错误不能阻断编辑器卸载和场景重置。

## 落地顺序

1. 建立单一 Vite `apps/playground` 和场景路由。
2. 建立 `DemoScenario`、Fixture 入口和测试组件注册。
3. 完成基础布局、Auto Layout 和 Grid 三个场景。
4. 接入 Playwright 测试 API 和稳定信号。
5. 增加自定义组件、数据绑定和 Adapter 场景。
6. 增加 Figma、Yjs、大文档和 4K 大屏场景。
7. 增加静态演示构建、视觉模式和性能模式。

