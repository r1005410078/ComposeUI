# ComposeUI 基础架构升级设计（Foundation Upgrade）

| 项 | 值 |
| --- | --- |
| 状态 | 已定稿（brainstorm 确认） |
| 日期 | 2026-07-16 |
| 类型 | 架构升级 / 非产品功能里程碑（工作名 M1.5） |
| 前置 | M0/M1 已完成；目录分层重组可能已在工作区（P0 收口） |
| 后续 | 实施计划 → 分轨实现 → 再进入 M2 布局 |

相关文档：

- [当前实现架构](../../current-architecture.md)
- [事务型编辑器微内核](./2026-07-11-transactional-editor-microkernel-architecture-design.md)
- [规范地图](./2026-07-11-specification-roadmap-design.md)
- [core 源码布局](../../../packages/core/src/README.md)
- [editor 源码布局](../../../packages/editor/src/README.md)

---

## 1. 背景与问题

M0/M1 交付了事务内核与 Free Layout 编辑骨架，并叠加 Dockview workspace 与 operation-log。设计文档描述的完整微内核远大于代码实现。

近期已完成或进行中的**目录分层**（`document/` / `store/` / `kernel/` / `query/`，以及 editor 的 `session/` / `canvas/` / `tree/` / `workspace/`）让架构「能被看见」，但仍不足：

1. **`canvas/editor-view.ts` 仍是上帝文件**（约 1200 行）：挂载、渲染、叠层、指针、预览耦合。
2. **`kernel/commands.ts` 巨型 switch**：扩展命令必须改核心文件，无正式贡献点。
3. **分层靠约定**：缺少机械依赖守卫，容易回潮到深路径 import。
4. **投影无统一叙事**：`getTreeItems` 存在，但 Query / 未来 LayoutProjection 边界未钉死。

若不先升级基础，M2（Auto/Grid）与 M3（Adapter）会在巨石文件与硬编码 switch 上叠加，返工成本高。

---

## 2. 决策记录（brainstorm）

| 决策点 | 选择 |
| --- | --- |
| 升级深度 | **B** — 结构 + 扩展接缝（非纯搬家，亦非提前做 Auto/Grid） |
| 公共 API | **C** — 允许破坏性整理（包仍为 private `0.0.0`） |
| 模块范围 | **全部**：拆 canvas、Command 注册表/插件、投影接缝、依赖守卫、收口目录 |
| 插件深度 | **正式** register / unregister / dispose |
| 插件宽度 | **仅 Command 贡献点**（不做多贡献点微内核，不做面板插件化） |
| 落地路径 | **A 分轨竖切** P0 → P1 → P2 |

---

## 3. 目标与非目标

### 3.1 目标

1. 目录与模块边界与写路径一致，并与 `current-architecture` / 包内 README 同步。
2. 全部文档命令经 **可注册 Command 贡献点** 进入 `transact`；宿主可安装/卸载命令插件。
3. 拆分 canvas 上帝文件为可独立理解的子模块。
4. Query 层收纳现有树投影，并预留 LayoutProjection **类型与文档位**（无布局算法）。
5. 依赖方向有机械守卫，接入 `bun run check`（或等价门禁）。
6. 允许破坏性收敛公共/测试 API，换取清晰边界。
7. 为 M2 增加命令与布局投影实现提供挂点，**本轮不交付布局产品功能**。

### 3.2 非目标

- Auto Layout / Grid 引擎、跨模式迁移交互、布局黄金算法。
- Framework Adapter、业务组件、RenderPlan 编译器。
- Yjs、Figma、GPU/Worker。
- Layout / Import / 面板等多贡献点完整插件平台。
- 将现有 `PanelRegistry` 重塑为统一 Plugin 叙事（可保留现状）。
- 细粒度 Store 订阅引擎、虚拟列表、性能大优化。

---

## 4. 硬边界（本轮不改变语义）

```text
Document 权威     →  @composeui/core（仅经 Command → prepare → transact）
Session Scope     →  @composeui/editor session（viewport / selection / …）
Workspace chrome  →  editor workspace + localStorage 布局
旁路观测          →  @composeui/operation-log（不得成为第二权威文档）
```

插件与 UI **禁止**绕过事务写入权威 RecordStore。

---

## 5. 目标源码结构

### 5.1 `@composeui/core`

```text
packages/core/src/
├── index.ts
├── document/           # schema, snapshot
├── store/              # RecordStore, validation
├── shared/             # Diagnostic, Result
├── kernel/
│   ├── transaction.ts
│   ├── history.ts
│   ├── plugin.ts       # CommandPlugin 安装与 dispose
│   └── commands/
│       ├── registry.ts
│       ├── editor.ts   # createEditor / dispatch 门面
│       └── builtin/    # 内置命令 prepare（按命令或命令族分文件）
└── query/
    ├── tree.ts         # getTreeItems, getChildren
    └── types.ts        # Query 叙事；LayoutProjection 类型占位
```

### 5.2 `@composeui/editor`

```text
packages/editor/src/
├── index.ts
├── session/
├── canvas/
│   ├── mount.ts            # mountEditor 装配
│   ├── board-render.ts     # page board + nodes DOM
│   ├── overlay.ts          # SVG 选框 / 手柄
│   ├── pointer.ts          # 指针状态机 → dispatch
│   ├── preview.ts          # EditorPreviewSource 绑定
│   ├── colors.ts
│   ├── interactions.ts
│   └── group-resize.ts
├── tree/
├── operation-log/
├── workspace/
│   └── output/
└── styles/
```

公开包入口仍为各包 `index.ts`；**允许**删除或重命名不稳定的深层测试依赖路径。

---

## 6. Command 插件设计

### 6.1 贡献点范围

- **仅**文档命令（变更 `RecordStore` / `PageDocument` 的意图）。
- 不包含：Session 操作、Workspace 面板、operation-log 格式化、布局算法插件。

### 6.2 契约（规范性描述）

```ts
/** 稳定命令 id，如 "node.move" */
type CommandId = string

interface CommandContribution {
  id: CommandId
  /**
   * 只读 store 上校验并产生 draft 变更函数。
   * 不得直接 mutate store；不得调用 transact。
   */
  prepare(
    store: RecordStore,
    command: EditorCommand,
  ): Result<(draft: TransactionDraft) => void>
  /** 可选：history 标签 / 日志展示 */
  label?: string
}

interface CommandPlugin {
  id: string
  /**
   * 向 API 注册零个或多个命令。
   * 可返回 dispose；也可依赖 Editor 级 dispose 统一卸载。
   */
  register(api: CommandPluginApi): void | (() => void)
}

interface CommandPluginApi {
  registerCommand(contribution: CommandContribution): () => void
}

interface EditorOptions {
  // 现有字段保留（onDiagnostic, operationObserver, …）
  plugins?: readonly CommandPlugin[]
}
```

说明：

- 今日全部 `EditorCommand` 变体由 **builtin plugin(s)** 注册，源码位于 `kernel/commands/builtin/`。
- `EditorCommand` 可保留可辨识联合类型以便 TypeScript 体验；分发**不得**依赖手写穷尽 switch 作为唯一扩展方式。宿主扩展命令可采用可辨识扩展（如开放 `id` 字符串 + payload）或并行类型——实施计划中选定一种并更新导出；**破坏性变更允许**。
- 同一 `CommandId` 重复注册：**失败**。禁止静默覆盖。

### 6.3 数据流

```text
createEditor(document, options)
  → RecordStore.fromDocument
  → 创建 CommandRegistry
  → 安装 builtin plugins
  → 安装 options.plugins（若有）
  → 任一 register 冲突 → 构造失败（throw 稳定错误码）

dispatch(command)
  → registry.lookup(command.id)
  → 未注册 → Result 失败 Diagnostic（如 COMMAND_NOT_REGISTERED）
  → contribution.prepare(store, command)
  → prepare 失败 → Result 失败，不进入 transact
  → transact({ kind: "local-command", commandId }, mutator)
  → 空 patch：不入 history（保持现语义）
  → 成功：history.record + operationObserver + subscribe
```

### 6.4 生命周期

| 事件 | 行为 |
| --- | --- |
| Editor 构造 | 安装 builtin + 宿主 plugins |
| `registerCommand` | 写入 registry；返回对该 id 的 unregister |
| 插件 dispose / Editor dispose | 移除该插件注册的全部 command id |
| 进行中的指针预览 | 仍为 Session 草稿；与今日一样，无跨指针的 document 事务悬挂 |

### 6.5 错误处理策略

| 阶段 | 策略 |
| --- | --- |
| 文档装载失败、插件 id 冲突、重复 command id | **throw** 稳定 `Error.message` 错误码（与现 `fromDocument` 风格一致） |
| dispatch / prepare / 事务校验失败 | **`Result` + `Diagnostic[]`**，store 不变 |
| operationObserver / subscribe listener 抛错 | 记诊断或不阻断；**不得**回滚已成功事务 |

---

## 7. Query 与 LayoutProjection 占位

### 7.1 本轮

- 将 `getTreeItems` / `getChildren` 归入 `query/tree.ts`（或等价路径），由 `index.ts` 导出。
- 在 `query/types.ts` 定义面向未来的投影类型，至少包含：

```ts
/** 父级局部坐标下的轴对齐盒（与当前 FreeLayout 语义对齐）。 */
interface ResolvedBox {
  x: number
  y: number
  width: number
  height: number
}

/**
 * 布局投影：由权威 store 得到用于渲染/命中的几何。
 * M1.5 仅类型与文档；M2 提供 free/auto/grid 实现。
 * 本轮可不提供默认实现类；禁止提交“空操作假实现”冒充布局引擎。
 */
interface LayoutProjection {
  /** 解析节点在父局部坐标系中的盒；不存在或不可投影时返回 undefined。 */
  resolveNodeBox(store: RecordStore, nodeId: string): ResolvedBox | undefined
}
```

- 画布 **继续** 直接读取 free `NodeRecord.layout` 渲染，直到 M2 切换到真实 projection。

### 7.2 明确不做

- 增量失效订阅总线。
- Auto/Grid 计算与 golden。

---

## 8. 依赖边界守卫

### 8.1 规则

1. `packages/editor`（及 `apps/playground`）只允许 `from "@composeui/core"` 公共入口，禁止：
   - `@composeui/core/src/...`
   - 经相对路径跨包引用 core 源文件
2. `packages/core/src/query/**` 不得 import `kernel/commands` 或 `kernel/plugin`（query → 仅 document/store/shared）。
3. `packages/core` 不得依赖 `@composeui/editor` 或 DOM 包。

### 8.2 机制

- 实现小型检查脚本（推荐）或 oxlint/import 限制，并挂入根脚本 `check`（或 `check` 依赖的一步）。
- 提供**故意违规**的负向测试或脚本自检说明，确保守卫有效。

---

## 9. Canvas 拆分职责

| 模块 | 职责 |
| --- | --- |
| `mount.ts` | `mountEditor`：DOM 壳、订阅 editor/session、销毁 |
| `board-render.ts` | page board 与节点 Light DOM 同步 |
| `overlay.ts` | SVG 选框、手柄、框选矩形 |
| `pointer.ts` | 指针状态机；预览用 session/几何；完成时 `dispatch` |
| `preview.ts` | `EditorPreviewSource` 帧切换与只读展示 |
| 既有 `interactions` / `group-resize` / `colors` | 纯几何与安全色，保持可单测 |

行为必须与现有 editor-view 测试套件对齐；允许测试改 import 路径。

---

## 10. 分轨交付（P0 / P1 / P2）

### P0 — 收口结构与守卫

- 提交（或完成）core/editor 目录分层重组。
- 落地依赖守卫 + check 集成。
- 更新 `docs/current-architecture.md` 与包内 README（若有漂移）。
- **验收**：全量现有测试绿；守卫对违规失败。

### P1 — Command 插件内核

- `CommandRegistry` + `CommandPlugin` API。
- 内置命令迁入 `builtin/` 并以 plugin 安装。
- `createEditor({ plugins })`；冲突与未知命令语义按 §6。
- 测试：内置命令回归；测试插件 register → dispatch → unregister；id 冲突。
- **验收**：无产品行为变化（同一命令序列 → 同一 canonical 文档与 history 语义）。

### P2 — Canvas 拆分与 Query 收纳

- 拆分 `editor-view` 为 §9 模块。
- Query 路径与 LayoutProjection 类型占位。
- 文档与 AGENTS 源码地图同步。
- **验收**：editor 浏览器单测与相关 E2E 绿；golden 文件内容不变。

允许 P0 与已有工作区改动合并为同一提交序列；P1/P2 建议独立可审阅提交或 PR。

---

## 11. 测试策略

| 层 | 要求 |
| --- | --- |
| 单元 | registry、plugin dispose、builtin prepare 等价性 |
| 集成 | createEditor + dispatch 全命令路径；history undo/redo 不回归 |
| 属性 | 既有 fast-check 保持 |
| Golden | `PageDocument` canonical **字节级意图不变**（无布局产品变更） |
| E2E | Playground 主路径冒烟；不强制新视觉基线 |

测试优先依赖**包公共导出**；减少对 `packages/*/src/**` 深路径的耦合（破坏性清理允许改测试 import）。

---

## 12. 验收出口（里程碑完成定义）

1. `bun run check`（或项目约定的全量门禁）通过。
2. 源码目录与本设计 §5、包内 README、`current-architecture` 一致。
3. 宿主可通过 `CommandPlugin` 注册命令，并与内置命令共享 history / operation 观察语义。
4. `editor-view` 不再以单文件巨石存在；职责落在 §9 模块。
5. 依赖守卫在故意违规时失败。
6. 无 Auto/Grid/Adapter 等非目标范围的「半成品功能」混入。

---

## 13. 风险与缓解

| 风险 | 缓解 |
| --- | --- |
| 插件 API 过度设计拖成 M3 | 宽度锁定为仅 Command；无面板/布局贡献点 |
| 拆 canvas 引入交互回归 | P2 单独轨；以现有 editor-view 测试为网 |
| 破坏性 API 导致本地分支冲突 | 分轨提交；CHANGELOG/提交说明列出删除的导出 |
| LayoutProjection 空类型腐化 | 类型最小；注释标明 M2 实现；禁止假实现 |
| 目录重组与升级交织难审 | P0 先合结构，再 P1 行为中立重构 |

---

## 14. 实施顺序约束

1. 先写**实施计划**（`docs/superpowers/plans/`），再编码。
2. 每轨：测试保护 → 重构 → check。
3. 不在本升级中开启 M2 布局功能开发。
4. 若与主产品设计冲突：以主产品设计的**目标行为**为准；以本文界定**本轮实现边界**。

---

## 15. 成功标准（产品外）

- 新成员打开 `packages/*/src` 能在 5 分钟内指认 Document 写路径与 Session 边界。
- 新增一个文档命令的主路径是：新增 builtin 或 plugin 文件并注册，而不是改巨型 switch。
- M2 启动时只需实现布局算法并替换/接入 projection，而不必先拆巨石文件。
