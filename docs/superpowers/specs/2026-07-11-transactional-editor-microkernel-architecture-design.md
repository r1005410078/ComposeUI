# ComposeUI 事务型编辑器微内核架构设计

## 架构结论

ComposeUI 采用事务型编辑器微内核作为前端主架构：

```text
Transactional Editor Microkernel
+ Normalized Reactive Record Store
+ Command / Query / Projection
+ Plugin Contribution System
+ Compiler Pipeline
+ Ports & Adapters
```

DDD 用于统一领域语言、识别边界和表达不变量，但不作为目录骨架；Feature-Sliced Design 用于编辑器 UI；数据导向设计用于文档 Store、空间索引和 RenderPlan；ECS 只允许用于可选 GPU Layer；Yjs 通过协同端口接入事务系统。

## 目标

- 支撑数万 ComposeUI 节点的增量编辑、查询和渲染。
- 让工具栏、快捷键、组件树、画布和插件复用同一命令语义。
- 所有文档修改具备原子提交、撤销/重做、校验和 Patch。
- 布局、框架、渲染器、导入器和协同能力可以按需安装。
- 核心不依赖 Vue、React、Angular、PixiJS、Figma 或 Yjs。
- 单人模式与 Yjs 协同模式共享命令和事务入口。
- 编辑模型与 RenderPlan 编译、运行时渲染保持清晰边界。

## 非目标

- 不实现后端式 Repository/ORM 抽象。
- 不把完整 `PageDocument` 建模成持有数万实体的对象聚合。
- 不采用完整 Event Sourcing 作为文档持久化方式。
- 不要求所有功能运行在 Worker 或独立进程。
- 不允许插件绕过事务直接修改权威文档状态。

## 内核组成

```text
Host API
   │
   ▼
Editor Microkernel
├─ Schema Registry
├─ Normalized Record Store
├─ Transaction Engine
├─ Command Registry
├─ Query / Projection Engine
├─ History Manager
├─ Validation / Policy Engine
├─ Plugin Registry
├─ Capability Registry
└─ Diagnostics
   │
   ├─ Layout Plugins
   ├─ Framework Adapters
   ├─ Render Backends
   ├─ Import / Export Plugins
   ├─ Collaboration Adapter
   └─ Editor UI
```

微内核只提供稳定机制。具体节点类型、布局算法、属性编辑器和外部集成由插件贡献。

## 规范化 Record Store

所有权威编辑数据以不可变、可序列化 Record 保存：

```ts
type EditorRecord =
  | DocumentRecord
  | PageRecord
  | NodeRecord
  | ComponentDefinitionRecord
  | BindingRecord
  | AssetRecord

interface BaseRecord {
  id: string
  typeName: string
  revision: number
}

interface NodeRecord extends BaseRecord {
  typeName: "node"
  nodeType: string
  parentId: string
  index: string
  props: Record<string, unknown>
}
```

Store 按 `typeName + id` 直接查询，不保存深层重复副本。父子结构通过 `parentId` 和稳定顺序键表达；组件实例通过 `definitionId` 引用定义。

Store 提供：

- 类型化 `get/put/update/remove`。
- Schema 校验和迁移。
- 原子事务。
- 变更监听和细粒度订阅。
- Snapshot、Diff 和 Patch。
- 可重建查询索引。
- 本地会话状态与持久文档状态的 Scope 区分。

视口、当前选区、悬停、展开状态和拖拽预览属于 Session Scope，不写入 `PageDocument`。页面节点、定义、绑定和资源元数据属于 Document Scope。

规范化数据可减少深层复制和无关 UI 更新。参考：[Redux Normalizing State](https://redux.js.org/usage/structuring-reducers/normalizing-state-shape)、[tldraw Store](https://tldraw.dev/reference/store/Store)。

## 事务引擎

所有权威文档变更必须在事务中完成：

```ts
editor.transact(
  {
    origin,
    history: "record",
    label: "移动节点"
  },
  tx => {
    tx.update(nodeId, patch)
    tx.update(parentId, parentPatch)
  }
)
```

### 事务生命周期

```text
Begin
  → Resolve Command
  → Read Preconditions
  → Apply Draft Changes
  → Validate Records
  → Validate Cross-Record Policies
  → Build Forward/Inverse Patch
  → Commit Atomically
  → Update Indexes
  → Publish Transaction Event
  → Refresh Projections
  → Schedule Rendering
```

任何校验失败都必须在 Commit 前终止，不能产生部分修改。事务提交后观察者只能读取新状态，不能在同一提交过程中看到中间状态。

### 事务来源

`TransactionOrigin` 使用类型化对象，不使用可能冲突的裸字符串：

```ts
type TransactionOrigin =
  | { kind: "local-command"; editorId: string; commandId: string }
  | { kind: "remote-collaboration"; providerId: string }
  | { kind: "migration"; migrationId: string }
  | { kind: "import"; importerId: string }
  | { kind: "repair"; policyId: string }
  | { kind: "system-init" }
```

Origin 用于撤销范围、遥测、Yjs `trackedOrigins`、避免同步回环和诊断。

## Patch 模型

事务输出稳定、可序列化的 Record Patch：

```ts
interface TransactionPatch {
  created: EditorRecord[]
  updated: Array<{
    id: string
    typeName: string
    before: Partial<EditorRecord>
    after: Partial<EditorRecord>
  }>
  removed: EditorRecord[]
}
```

Patch 必须满足：

- 能确定受影响的 Record id 和字段。
- 能生成对应 Inverse Patch。
- 不包含完整未变更文档。
- 可以驱动索引、Projection、RenderPlan 和持久化增量更新。
- 具有明确 Schema 版本。
- 不包含实时业务数据、DOM 引用或不可序列化对象。

Patch 是本地变更描述，不直接等同于网络协议。Yjs Adapter 将命令语义转换为 Y.Doc 事务，而不是盲目广播 Inverse Patch。

## 命令系统

Command 表达用户或系统意图，Handler 负责读取状态、执行领域策略并产生事务：

```ts
interface Command<TPayload = unknown, TResult = void> {
  id: string
  payload: TPayload
}

interface CommandHandler<C extends Command> {
  canExecute(ctx: CommandContext, command: C): boolean
  execute(ctx: CommandContext, command: C): Promise<CommandResult>
}
```

示例命令：

- `node.create`
- `node.move`
- `node.resize`
- `node.delete`
- `selection.group`
- `component.createDefinition`
- `component.detachInstance`
- `binding.update`
- `figma.paste`
- `document.migrate`

工具栏、快捷键、上下文菜单、组件树、画布和插件只能调用 Command，不得重复实现修改逻辑。

命令返回结构化结果，包括事务 id、创建的节点、选区建议、诊断和是否进入历史。UI 不通过解析错误字符串判断后续行为。

## 撤销与重做

单人模式的 History Manager 保存有限事务历史和 Inverse Patch。拖拽、缩放等连续交互采用“预览 + 单次提交”：

- Pointer Move 更新临时交互状态或合并事务草稿。
- Pointer Up 生成一个最终文档事务。
- Escape 丢弃草稿并恢复初始状态。

协同模式由 Yjs Adapter 使用 Y.UndoManager，并通过 Transaction Origin 只跟踪当前用户本地命令。History API 对上层 UI 保持一致，但底层实现可以不同。

不采用完整 Event Sourcing。持久化保存当前 Snapshot、Schema 版本和按需增量 Update；命令历史是有界编辑会话能力，不是永久业务账本。

## Query 与 Projection

UI 和渲染器不能直接扫描完整 Store，而通过查询和投影读取：

```ts
queries.getChildren(parentId)
queries.getVisibleNodes(viewport)
queries.getComponentTreeRows(viewState)
queries.getInstanceOverrides(instanceId)
queries.getBindingsBySource(sourceId)
queries.getDiagnosticsForNode(nodeId)
```

Projection 是由 Record 和索引派生的只读模型：

- 组件树扁平可见行。
- 属性面板 ViewModel。
- 当前视口节点集合。
- 自定义组件实例解析结果。
- 导入诊断列表。
- RenderPlan 和 DOM Island。

Projection 允许缓存，但不是权威数据。依赖 Record 发生 Patch 后只失效相关缓存。

## 索引系统

索引由 Store Patch 增量维护，并可以从权威 Records 重建：

- `childrenByParentId`
- `instancesByDefinitionId`
- `bindingsBySourceId`
- `nodesByComponentId`
- `diagnosticsByNodeId`
- `definitionsDependencyGraph`
- 空间 R-tree
- 可见节点集合

索引更新属于事务提交后的内核阶段。插件可以贡献索引，但必须声明依赖的 Record 类型和字段，禁止每次事务全量重扫文档。

## Policy 与领域规则

领域规则使用纯函数 Policy 或无状态 Domain Service 表达：

```ts
interface ParentingPolicy {
  validate(input: {
    node: NodeRecord
    parent: NodeRecord
    store: ReadonlyStore
  }): PolicyResult
}
```

核心 Policy 包括：

- 禁止循环父子关系。
- 单画板单框架。
- 节点与容器兼容性。
- 自定义组件定义循环检测。
- 实例只能覆盖公开契约。
- Grid 跨度和碰撞约束。
- 资源、绑定和组件引用完整性。

Policy 不持有 UI 状态，不调用网络，不直接写 Store。需要修改时由 Command 根据 Policy 结果执行事务。

## 插件贡献系统

插件通过 Manifest 和 `activate` 注册能力：

```ts
interface EditorPlugin {
  manifest: {
    id: string
    version: string
    requires?: string[]
    capabilities?: string[]
  }
  activate(ctx: PluginContext): Disposable | Promise<Disposable>
}
```

支持的 Contribution Point：

- Node Type 和 Node Schema。
- Command 和快捷键声明。
- Property Inspector。
- Layout Engine。
- ComponentAdapter。
- RenderBackend 和 GPU Layer。
- Importer / Exporter。
- Binding Source 和 Action Type。
- Validation Policy 和 Diagnostic Provider。
- Toolbar、Context Menu 和 Component Palette 条目。
- Collaboration Adapter。

插件只能通过公开 Capability 获取服务，不直接导入内核内部模块。所有注册返回 Disposable，在编辑器卸载或插件停用时释放。

插件默认按能力或首次使用惰性激活，避免未使用的 Figma、GPU 或协同模块增加启动成本。该方向可参考 VS Code 的贡献点、命令和惰性 Extension Host。[VS Code Extension Host](https://code.visualstudio.com/api/advanced-topics/extension-host)

## 插件隔离级别

首版支持两档：

1. 可信内置插件：与编辑器同线程运行，适用于核心布局、官方框架 Adapter 和 UI Feature。
2. Worker 插件：通过消息协议运行，适用于大型导入、编译、数据处理和不需要 DOM 的第三方能力。

不可信第三方代码不能默认获得 DOM、宿主上下文、资源令牌或任意命令执行权限。后续如开放插件市场，需要增加 Manifest 权限、能力授权、签名和 Worker/iframe 沙箱；这不属于首版。

## Ports & Adapters

内核通过端口访问外部系统：

```ts
interface PersistencePort {}
interface AssetPort {}
interface ComponentPort {}
interface RenderPort {}
interface CollaborationPort {}
interface TelemetryPort {}
interface ClockPort {}
```

Vue、React、Angular、Yjs、DOM、PixiJS、Figma 和宿主服务都是 Adapter。端口接口按用例设计，禁止出现包含几十个不相关方法的万能 HostService。

## 编译器流水线

页面发布和预览通过 Compiler Pass 生成 `RenderPlan`：

```text
Records
  → Validate
  → Resolve Definitions
  → Resolve Components
  → Compute Layout
  → Split DOM Islands
  → Extract GPU Layers
  → Compile Bindings
  → Optimize Assets
  → RenderPlan
```

Compiler Pass 声明输入依赖和输出 Scope。事务 Patch 只使受影响 Pass 和 DOM Island 失效，避免每次属性修改重新编译完整页面。

Compiler 不修改编辑文档；发现问题时产生 Diagnostic。自动修复必须回到 Command/Transaction 层显式执行。

## Yjs 协同桥接

`@composeui/collaboration-yjs` 实现 `CollaborationPort`：

- 本地 Command 在 Y.Doc 原子事务中落地。
- Yjs 事务事件转换为 Record Patch。
- Transaction Origin 映射到 Yjs Origin。
- Y.UndoManager 提供本地用户撤销。
- Awareness 提供在线成员、远程光标和选区。
- Record Store 在协同模式中是 Y.Doc 的本地 Projection，不是独立可写真值。

微内核不依赖 Yjs Shared Type，单人模式无需加载 Yjs 包。完整设计见：[Yjs 实时协同设计](./2026-07-11-yjs-collaboration-design.md)。

## UI 架构

编辑器 UI 使用 Feature/Vertical Slice 组织，依赖方向由 UI 编排层指向公开内核 API：

```text
packages/editor/src/
├─ app/
│  ├─ editor-instance
│  └─ dependency-wiring
├─ widgets/
│  ├─ component-tree
│  ├─ workspace
│  ├─ property-panel
│  └─ component-palette
├─ features/
│  ├─ select-nodes
│  ├─ move-nodes
│  ├─ resize-nodes
│  ├─ create-component
│  ├─ bind-property
│  └─ paste-from-figma
├─ entities/
│  ├─ node
│  ├─ component-definition
│  └─ asset
└─ shared/
   ├─ ui
   └─ platform
```

FSD 只用于 UI 代码组织。`@composeui/core` 不使用 `widgets/features/pages` 等 UI 术语。参考：[Feature-Sliced Design](https://fsd.how/docs/get-started/overview/)。

## 包结构建议

```text
packages/
├─ schema
├─ store
├─ core
├─ editor
├─ runtime
├─ compiler
├─ layout-free
├─ layout-auto
├─ layout-grid
├─ render-dom
├─ render-svg-overlay
├─ adapter-react
├─ adapter-vue
├─ collaboration
├─ collaboration-yjs
├─ import-figma
└─ testing
```

首版不必立即拆出所有 npm 包。可以在 monorepo 中保持这些逻辑边界，只有出现独立发布、可选加载或依赖隔离需求时再拆包。避免为了架构图制造大量空包。

## 依赖规则

```text
schema ← store ← core ← editor
                 ↑      ↑
              compiler  UI features
                 ↑
               runtime

adapters/plugins → public core capabilities
core ✕ adapters/plugins/framework UI
```

- `schema` 不依赖其他业务包。
- `store` 依赖 Schema，但不依赖编辑器 UI。
- `core` 不依赖具体框架、渲染器、Provider 和导入器。
- `runtime` 不依赖组件树、选区和命令历史 UI。
- 插件通过公开 API 注册，不反向导入内核私有文件。
- 测试工具可以依赖公开包，但不能成为生产依赖。

使用包导出边界、lint 规则和依赖图测试强制这些约束，不能只依赖团队约定。

## 错误与诊断

内核错误使用结构化 Diagnostic：

```ts
interface Diagnostic {
  code: string
  severity: "info" | "warning" | "error"
  message: string
  recordIds?: string[]
  source: string
  fixes?: Command[]
}
```

命令前置条件不满足、插件激活失败、Schema 不兼容、引用缺失和编译失败都通过 Diagnostic 返回。UI 可以定位节点、展示说明并执行修复 Command。

不可恢复的内核异常进入 `onError` 和遥测，但不得让插件异常破坏已提交文档状态。

## 测试策略

测试工具、黄金文件规范、Playwright E2E、视觉回归、协同测试和性能基准的完整方案见：[测试与黄金文件策略](./2026-07-11-testing-and-golden-files-strategy.md)。

### Store 与事务

- 事务原子性和回滚。
- Forward/Inverse Patch 对称性。
- 批量更新只发布一次事务事件。
- Snapshot、迁移和 Patch 重放一致。
- Session Scope 不进入持久文档。

### Command 与 Policy

- 每个命令的成功、拒绝和诊断路径。
- UI 入口调用相同命令产生一致结果。
- 非法父子关系、跨框架、循环组件和 Grid 冲突。
- 连续交互只产生一个撤销步骤。

### Query 与性能

- Projection 增量失效而非全量重建。
- 20,000 节点下的小 Patch 查询成本。
- 组件树虚拟化、空间索引和可见节点查询。
- 自定义组件定义更新只影响相关实例。

### 插件

- 激活、惰性加载、依赖缺失和卸载清理。
- Contribution id 冲突。
- 插件不能绕过事务写 Store。
- Worker 插件超时、崩溃和取消。

### 协同

- 本地命令和远程 Yjs Update 产生等价 Record Projection。
- Origin 跟踪和本地撤销。
- 并发事务收敛后通过 Policy 校验。

## 落地顺序

1. Schema、Record 类型和规范化 Store。
2. Transaction Engine、Patch、Origin 和 History。
3. Command Registry、Policy 和结构化 Diagnostic。
4. Query、Projection、索引和细粒度订阅。
5. Editor Instance、Capability Registry 和内置插件注册。
6. DOM/SVG 渲染、布局和 UI Feature 接入统一命令。
7. Compiler Pass 和 RenderPlan 增量失效。
8. Yjs Collaboration Adapter。
9. Worker 插件和可选 GPU RenderBackend。

每一步都必须形成可运行纵向闭环，不能先搭建所有抽象再开始页面编辑功能。
