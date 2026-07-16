# ComposeUI 当前实现架构

> **本文只描述仓库里已经落地的代码结构。**  
> 产品愿景、未实现子系统与远期微内核全景见设计文档；不要把设计图当成已交付能力。

| 项 | 值 |
| --- | --- |
| 对应里程碑 | M0 内核闭环 + M1 Free Layout 编辑器骨架 + Dockview workspace / operation-log；**M1.5 Foundation 已落地**（目录分层、依赖守卫、Command 插件、canvas/Query 收纳） |
| 包 | `@composeui/core`、`@composeui/editor`、`@composeui/operation-log`、`apps/playground` |
| 权威设计（目标态） | [事务型编辑器微内核](./superpowers/specs/2026-07-11-transactional-editor-microkernel-architecture-design.md)、[产品设计](./superpowers/specs/2026-07-11-embeddable-visual-page-composer-design.md) |
| 基础架构升级（M1.5） | [Foundation Upgrade 设计](./superpowers/specs/2026-07-16-foundation-architecture-upgrade-design.md) |
| 进度表 | [项目概览 · 当前进展](./project-overview.md#当前进展) |
| 包内源码地图 | [`packages/core/src/README.md`](../packages/core/src/README.md)、[`packages/editor/src/README.md`](../packages/editor/src/README.md) |

---

## 1. 一句话

当前实现是一条**可嵌入的文档事务内核 + 桌面 Free Layout 编辑壳 + 旁路操作日志/回放**，不是完整的插件化编辑器平台，也不是运行时页面引擎。

---

## 2. 仓库拓扑（已实现）

```text
composeui/
├── packages/core/           # 文档权威：schema / store / transaction / command / history
├── packages/editor/         # Session + DOM 画布/树 + Dockview workspace + 日志 UI
├── packages/operation-log/  # 事件记录、IndexedDB、bundle、replay engine
└── apps/playground/         # 唯一演示宿主：装配 core + editor + operation-log
```

依赖方向（代码事实）：

```text
playground ──► editor ──► core
     │              └──► operation-log
     └──────────────────► operation-log ──► core（类型/文档快照，无 UI）
```

- **core** 不依赖 editor、operation-log、DOM 框架。
- **operation-log** 可观察 core 的 `EditorOperation`，不反向修改 core 内部。
- **editor** 通过 command/session API 使用 core；日志 UI 依赖 operation-log 的 store/controller 端口。

### 2.1 源码目录即分层（扫一眼应能看懂）

包的**公共 API 仍只从各包 `src/index.ts` 导出**；内部按架构分目录。更细的目录说明见各包 `src/README.md`。

**`@composeui/core`**

```text
packages/core/src/
├── document/          # schema + canonicalize 快照
├── store/             # RecordStore + 树校验
├── kernel/
│   ├── transaction.ts
│   ├── history.ts
│   ├── operations.ts
│   └── commands/      # registry + plugin + editor + builtin/*
├── query/             # tree 投影 + LayoutProjection 类型占位
└── shared/            # Diagnostic / Result
```

**`@composeui/editor`**

```text
packages/editor/src/
├── session/           # Session Scope（viewport、selection…）+ 坐标
├── canvas/            # mount / board-render / overlay / pointer / preview + 交互几何
├── tree/              # 组件树
├── operation-log/     # 日志 UI 控制器与 session 观察适配
├── workspace/         # Dockview 壳、面板、回放控制
│   └── output/        # Output 面板子树
└── styles/            # theme / editor / workspace CSS
```

**`@composeui/operation-log`**（已有清晰子树）

```text
packages/operation-log/src/
├── adapters/   # core / workspace 观察者
├── replay/     # 回放引擎与 handlers
└── *.ts        # recorder、store、bundle、checkpoint…
```

### 2.2 包依赖守卫（已落地）

分层不仅靠约定：仓库用机械检查锁住允许的 import 方向。

| 项 | 值 |
| --- | --- |
| 命令 | `bun run boundaries`（已挂入 `bun run check`） |
| 脚本 | [`scripts/check-package-boundaries.mjs`](../scripts/check-package-boundaries.mjs) |

**规则（代码事实）：**

1. **`packages/editor`、`packages/operation-log`、`apps/**` 消费 core 时，只能** `from "@composeui/core"`  
   - 禁止 `@composeui/core/...` 深路径  
   - 禁止相对/绝对路径指向 `packages/core/src/**`
2. **`packages/core/src/query/**` 不得依赖写路径**  
   - 禁止 import `kernel/commands`、`kernel/plugin` 或任意 `/commands` 模块  
   - Query 只读 store/document；变更仍经 Command → `transact`

**M1.5 Foundation 落地情况：**

| 阶段 | 状态 | 内容 |
| --- | --- | --- |
| **P0** | 已落地 | 目录分层 + 依赖守卫 + 文档对齐 |
| **P1** | 已落地 | `kernel/commands/`（registry / plugin / editor / builtin）；构造期 `CommandPlugin` |
| **P2** | 已落地 | canvas 拆为 mount/board-render/overlay/pointer/preview；`query/tree` + `query/types`（`LayoutProjection` 类型占位，无算法） |

故意违规 import 时 `bun run boundaries` 必须以非零退出码失败。

---

## 3. 运行时总图（Playground 装配）

```text
                    ┌─────────────────────────────────────┐
                    │         apps/playground              │
                    │  createPlaygroundOperationRuntime   │
                    └───────────────┬─────────────────────┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          ▼                         ▼                         ▼
   createEditor()            EditorSession              OperationRecorder
   (PageDocument)            (viewport/selection…)      + IndexedDB store
          │                         │                         │
          │    mountEditorWorkspace │                         │
          │    (Dockview shell)     │                         │
          ▼                         ▼                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │                    @composeui/editor                          │
   │  panels: canvas | scene tree | history | output | …          │
   │  canvas → mountEditor(view=canvas)                            │
   │  tree   → mountComponentTree                                  │
   │  output → OperationLogController + ReplayController           │
   └───────────────────────┬───────────────────┬──────────────────┘
                           │ dispatch          │ session ops
                           ▼                   ▼
                    @composeui/core      (session only)
                           │
                           │ EditorOperationObserver
                           ▼
                    @composeui/operation-log
                    (record / checkpoint / export / replay)
```

宿主（Playground）拥有：文档初始场景、IndexedDB、layout localStorage、导入导出 bundle、Run/导出 JSON 等工具条扩展。ComposeUI 包不负责鉴权、路由、业务后端。

---

## 4. `@composeui/core`：文档权威内核

### 4.1 模块与职责

| 模块 | 路径 | 职责 |
| --- | --- | --- |
| Schema | `document/schema.ts` | `PageDocument`、document/page/node(rectangle)、Free Layout |
| Snapshot | `document/snapshot.ts` | `canonicalizeDocument`（稳定序列化） |
| Store | `store/store.ts` | 不可变 `RecordStore`，读路径 clone |
| Validation | `store/validation.ts` | 树策略（parent、环、sibling index） |
| Transaction | `kernel/transaction.ts` | `transact` / `applyPatch`，forward + inverse |
| History | `kernel/history.ts` | 线性 undo/redo/jump（patch 回放） |
| Commands | `kernel/commands/` | `createEditor`、`CommandRegistry`、构造期插件安装、builtin 贡献 |
| Operations | `kernel/operations.ts` | `EditorOperation` 观察契约 |
| Tree query | `query/tree.ts` | `getTreeItems` / `getChildren` |
| Query types | `query/types.ts` | `LayoutProjection` / `ResolvedBox` 类型占位（无默认实现） |
| Diagnostics | `shared/diagnostics.ts` | `Diagnostic` / `Result` |

### 4.2 写路径（硬约束）

```text
UI / 工具条 / 树 / 画布
        │
        ▼
Editor.dispatch(EditorCommand)
        │
        ▼
CommandRegistry.get(id) → prepare*（业务校验、锁、顶层 move…）
        │
        ▼
transact(store, origin, draft => …)   // contribution.execute
        │  失败 → 原 store + diagnostics，无部分提交
        ▼
History.record(forward, inverse)   // 空 patch 不入栈
        │
        ├── subscribe(EditorChangeEvent)  → UI 重绘
        └── operationObserver             → operation-log（旁路）
```

**持久状态只允许经 command → transaction 变更。** Session、预览、layout 分栏不得写入 `PageDocument`。

### 4.3 当前文档模型（实现范围）

```text
PageDocument
├── schemaVersion: 1
├── rootPageId
└── records[]
    ├── DocumentRecord   (恰好 1)
    ├── PageRecord       (恰好 1，free layout 页)
    └── NodeRecord*      (nodeType: "rectangle" only)
```

- 布局：仅 `FreeLayout`（parent-local `x/y/width/height`）。
- 页面：`overflow`、`background`、`width`/`height` 可持久。
- **无**：auto/grid、业务组件、definition/instance、binding、asset record、adapterId 运行时字段落地。

### 4.4 已实现命令与插件

| Command id | 贡献位置（builtin） | 作用 |
| --- | --- | --- |
| `node.create` | `node-create.ts` | 创建 rectangle |
| `node.move` | `node-transform.ts` | 多选平移（仅顶层，尊重 lock 祖先） |
| `node.resize` / `node.resizeMany` | `node-transform.ts` | 单/多选尺寸 |
| `node.delete` | `node-tree.ts` | 子树删除（不可删 page） |
| `node.reorder` | `node-tree.ts` | parent/index（可与同级交换 index） |
| `node.rename` / `setVisible` / `setLocked` | `node-tree.ts` | 属性 |
| `page.setOverflow` | `page.ts` | 页面溢出 |

命令经 **`CommandRegistry`** 按 id 分发；内置命令由 **`builtinCommandPlugin`** 在 `createEditor` 时安装。宿主可传入额外 `CommandPlugin[]`（构造期 `installCommandPlugins`）；**无**运行时 `installPlugin`。设计背景见 [Foundation Upgrade · §6](./superpowers/specs/2026-07-16-foundation-architecture-upgrade-design.md#6-command-插件设计)。

---

## 5. `@composeui/editor`：会话 + UI 壳

### 5.1 分层（逻辑上）

```text
Document Scope          Session Scope              Chrome / Layout
─────────────────       ──────────────────         ────────────────
core Editor             EditorSession              Dockview workspace
RecordStore             viewport, selection        panel registry
PageDocument            expanded, hover            localStorage layout
History                 grid, interactionMode      toolbar / output
                        pointer preview draft
```

### 5.2 主要源码落点

| 区域 | 路径 | 说明 |
| --- | --- | --- |
| Session | `session/session.ts` | 会话态；不进文档 |
| 坐标 | `session/coordinates.ts` | screen ↔ world ↔ parent-local、`zoomAt` |
| 交互草稿 | `canvas/interactions.ts`, `canvas/group-resize.ts` | 拖拽/组缩放纯几何，commit 再 dispatch |
| 画布挂载 | `canvas/mount.ts` | `mountEditor`：装配 board / overlay / pointer / preview 订阅 |
| Board 渲染 | `canvas/board-render.ts` | page board、节点 DOM |
| 叠层 | `canvas/overlay.ts` | SVG 选框与手柄 |
| 指针 | `canvas/pointer.ts` | 指针控制器 |
| 预览 | `canvas/preview.ts` | 回放/只读预览帧与 banner |
| 组件树 | `tree/component-tree.ts` | `getTreeItems` + session；变更走 command |
| Workspace | `workspace/editor-workspace.ts` 等 | Dockview 分栏、默认面板、布局持久化 |
| 日志 UI | `operation-log/*`, `workspace/output/*` | 列表/过滤/回放条 |
| 回放控制 | `workspace/replay-controller.ts`, `replay-preview-source.ts` | 驱动 engine，预览覆盖画布 |
| 样式 | `styles/theme.css`, `editor.css`, `workspace.css` | 主题 token + 结构样式 |

### 5.3 默认 Workspace 面板（一等公民）

`workspace/panels.ts` 注册：`scene`（树）、`canvas`、`history`、`inspector`/`resources`/`signals`（多为占位空态）、`output`。

- 画布使用 `mountEditor(..., { view: "canvas" })`。
- 布局 JSON 存在 **localStorage**（`StoredWorkspaceLayout`），**不是** `PageDocument` 的一部分。

### 5.4 UI 实现形态（现状诚实描述）

- 原生 DOM + CSS（`styles/editor.css` / `theme.css` / `workspace.css`），无 React/Vue 编辑器壳。
- 画布节点为 **rectangle 的 div**；选框/手柄在 **SVG overlay**。
- 业务组件 Light DOM / 编辑器 Shadow DOM 的完整隔离策略 **尚未按产品设计完整落地**（当前仍是编辑器自渲染矩形）。

---

## 6. `@composeui/operation-log`：旁路可观测与回放

### 6.1 角色

- **不**充当文档权威；权威仍是 core `RecordStore` / `PageDocument`。
- 记录 document command 生命周期、history 动作、session 操作、workspace 事件。
- 支持内存/IndexedDB、checkpoint、bundle 导入导出、ReplayEngine + handler 注册表。

### 6.2 与内核的连接

```text
core Editor.operationObserver  ──► createCoreOperationObserver ──► Recorder
EditorSession.operationObserver ─► createSessionOperationObserver（viewport 合并）
workspace emit                 ──► createWorkspaceOperationObserver
```

Replay：checkpoint/document 快照 + 事件顺序重放；editor 通过 `EditorPreviewSource` 在画布上 **只读预览** 回放帧，避免与 live 编辑状态混淆（由 Playground/workspace 装配）。

---

## 7. Document vs Session vs Workspace（三条状态轨）

| 状态轨 | 存什么 | 持久化目标 | 典型写入方 |
| --- | --- | --- | --- |
| **Document** | page、nodes、layout 几何、visible/locked… | 宿主 save 的 `PageDocument` JSON | `Editor.dispatch` |
| **Session** | viewport、selection、expanded、grid、mode | 一般不进页面文档；可进 log | `EditorSession` |
| **Workspace chrome** | Dockview 分栏、打开面板 | localStorage 布局 | `WorkspaceLayoutStore` |

混淆这三者是最常见的架构误读。**只有 Document 属于“页面产品数据”。**

---

## 8. 请求路径示例

### 8.1 拖动节点

```text
pointerdown  → createPointerMoveSession（session 预览）
pointermove  → 更新预览 DOM/叠层（不写 store）
pointerup    → commit delta → dispatch({ id: "node.move", … })
             → registry → prepare → transact → history → subscribe → 正式重绘
             → operation-log: document.command started/succeeded
```

### 8.2 组件树改名

```text
树 input → dispatch({ id: "node.rename", … }) → 同 8.1 文档路径
selection 变化 → session.setSelection（仅会话）
```

### 8.3 Undo

```text
toolbar/api.undo → editor.undo → History.undo → applyPatch(inverse)
                → subscribe + history.* operation 事件
```

---

## 9. 测试与黄金文件（已实现工程）

| 层 | 工具 | 覆盖侧重 |
| --- | --- | --- |
| 单元/集成 | Vitest | core 事务/命令/history/插件；editor session/canvas/workspace；operation-log |
| 属性 | fast-check | 树/事务类不变量（core） |
| Golden | JSON 文件 | canonical document、部分 log bundle |
| E2E | Playwright Chromium | Playground 主路径、workspace、回放相关 |

单一 Playground 规则：演示与 E2E 共用 `apps/playground`，无 Storybook。

---

## 10. 明确 **尚未** 实现（设计有、代码无）

下列内容出现在设计文档或路线图中，**当前仓库没有可运行实现**。读设计时请对照本表，避免误判。

| 领域 | 状态 |
| --- | --- |
| Auto Layout / Grid 引擎与模式迁移 | 未实现 |
| LayoutProjection **算法实现**（M1.5 仅类型占位） | 未实现（契约在 `query/types.ts`） |
| Layout / Import 等多贡献点插件平台 | 未实现（M1.5 仅落地 Command 贡献点） |
| Framework Adapter（Vue/React…）、业务组件注册 | 未实现 |
| 页面级上下文注入 / 单板单框架运行时根 | 未实现 |
| Component definition / instance / detach | 未实现 |
| Bindings、RenderPlan 编译器、独立 runtime 包 | 未实现 |
| Yjs 协同端口与 Awareness | 未实现 |
| Figma SVG/结构化导入 | 未实现 |
| Worker 数据平面、GPU Layer、空间索引/视口裁剪 | 未实现 |

### 10.1 M1.5 收尾说明

Foundation Upgrade（目录、Command 插件、canvas 拆分、`boundaries`）已在 `main` 落地。

工程债（可选，非阻塞）：

- `pointer.ts` 的 move/resize 手势仍可再拆（**pan / marquee 已拆到独立模块**）。
- 历史 `docs/superpowers/plans/*` 可能仍写旧路径（如 `editor-view.ts`）；**以本文与包内 README 为准**。
- 依赖守卫：`bun run boundaries`（含 core 不得依赖 editor/DOM 框架包）。
| 完整 Shadow DOM 编辑器 chrome 隔离产品形态 | 未按终态落地 |
| 多 page、多 document 协作模型 | M1 固定单 page |
| 发布态 npm 多包独立版本策略 | 现为 private workspace |

目标态微内核全景仍以 [事务型编辑器微内核架构设计](./superpowers/specs/2026-07-11-transactional-editor-microkernel-architecture-design.md) 为准；**实现进度以本文 + 测试为准**。

---

## 11. 与设计文档的读法

```text
优先级（行为争议时）：
1. 用户当前指令
2. 主产品设计（目标行为）
3. 专项设计
4. 项目概览

优先级（“代码里现在有没有”）：
1. 本文 + 源码 + 测试/golden
2. 实施计划（M0/M1/…）中的 exit criteria
3. 设计文档中的目标态描述（可能尚未编码）
```

`AGENTS.md` 中的产品不变量（嵌入优先、Document/Session 分离、命令统一写路径等）**已在当前实现中部分兑现**；多贡献点插件平台与运行时编译等仍属目标态。

---

## 12. 扩展时建议落点（避免继续“无架构感”）

| 若要做… | 建议落在… | 不要… |
| --- | --- | --- |
| 新持久节点字段/命令 | `core` schema + `commands/builtin` 或宿主 `CommandPlugin` + transaction 校验 + golden | 在 `canvas/*` 直接改 record |
| 新会话交互 | `EditorSession` 或交互纯函数 + 最后 dispatch | 把预览坐标写入 PageDocument |
| 新 Dock 面板 | `PanelRegistry` + `workspace/panels` | 把面板布局塞进文档 JSON |
| 新可观测事件 | operation-log category/handler + editor 观察适配 | 让 log 成为第二权威 store |
| 布局算法 Auto/Grid | 新 core 布局模块 + `LayoutProjection` 实现 + 命令迁移事务 | 仅在 DOM 上模拟布局 |
| 业务组件 | 未来 adapter 包 + runtime 根 | 在 core 依赖 React/Vue |

---

## 13. 维护约定

- 合并会改变**包边界、写路径或 Document/Session 归属**的 PR 时，同步更新本文与包内 `src/README.md`。
- 仅新增命令字段或面板标题的琐碎改动，可不必改总图，但应保证 golden/测试反映行为。
- 注释规范（A+D 中文）见 `AGENTS.md` → Code Comment Conventions；模块导读应与本文分层一致。
