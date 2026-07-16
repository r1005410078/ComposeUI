# ComposeUI 基础架构升级设计（Foundation Upgrade）

| 项 | 值 |
| --- | --- |
| 状态 | **正式定稿**（brainstorm 确认 + 契约补丁） |
| 日期 | 2026-07-16 |
| 类型 | 架构升级 / 非产品功能里程碑（工作名 M1.5） |
| 前置 | M0/M1 已完成；core/editor **源码目录分层重组已合入**（P0 剩余重点为依赖守卫与文档对齐，勿重复搬家） |
| 后续 | 实施计划 → 分轨实现（P0 守卫 → P1 命令插件 → P2 canvas/Query）→ 再进入 M2 布局 |

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
2. 全部文档命令经 **可注册 Command 贡献点** 进入 `transact`；宿主可在 Editor 构造时安装命令插件，注册可撤销并随 Editor 释放。
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
    command: DispatchCommand,
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
  /** API 作用域属于当前插件；Editor 跟踪其全部注册以支持回滚与统一释放。 */
  registerCommand(contribution: CommandContribution): () => void
}

interface EditorOptions {
  // 现有字段保留（onDiagnostic, operationObserver, …）
  plugins?: readonly CommandPlugin[]
}

/** registry、观察与日志链路共同承载的开放命令信封。 */
interface DispatchCommand {
  id: CommandId
  payload?: unknown
}

interface Editor {
  /** 内置命令重载保留 id/payload 的字面量提示。 */
  dispatch(command: EditorCommand): Result<void>
  /** 开放重载承载宿主插件命令。 */
  dispatch(command: DispatchCommand): Result<void>
  /**
   * 与 `dispatch` 同一实现（别名）。
   * 保留导出以兼容现有调用方；行为与 dispose 语义与 dispatch 完全一致。
   */
  execute(command: EditorCommand | DispatchCommand): Result<void>
  /** 幂等释放 core 侧插件、命令注册与 Editor 级 listener；释放后不再接受调用。 */
  dispose(): void
  undo(): Result<void>
  redo(): Result<void>
  jumpToHistory(index: number): Result<void>
  // canUndo / canRedo / getStore / getHistory / getRecord / getDiagnostics / subscribe：见 §6.4
}

class EditorInitializationError extends Error {
  readonly code: "PLUGIN_ID_CONFLICT" | "COMMAND_ID_CONFLICT" | "PLUGIN_INSTALL_FAILED"
}
```

说明：

- 今日全部 `EditorCommand` 变体由 **builtin plugin(s)** 注册，源码位于 `kernel/commands/builtin/`。
- **Builtin 插件 id（钉死）：** 使用稳定 id `composeui.builtin`（若拆多个 builtin 插件，则使用 `composeui.builtin.<族>`，且均以 `composeui.builtin` 前缀保留）。宿主 `CommandPlugin.id` **不得**与已安装插件 id 冲突，否则 `PLUGIN_ID_CONFLICT`。
- **命令载荷类型（钉死）：**
  - 内置命令：保留可辨识联合 `EditorCommand`（`id` 字面量 + payload）。
  - 开放信封：`DispatchCommand` 是 dispatch、registry、operation observer 与 operation-log 存储层共同使用的最小命令形状。
  - 分发入口：为 `EditorCommand` 与 `DispatchCommand` 提供公开重载；`execute` 与 `dispatch` 同实现。实现统一按 `id` 查 registry，builtin 的 `prepare` 内再收窄为对应 `EditorCommand` 变体。
  - 宿主插件命令：使用自有 `id` 字符串 + `payload`；**不要求**并入 `EditorCommand` 联合。插件侧自行断言 payload。
  - 分发**不得**依赖手写穷尽 `switch` 作为唯一扩展方式。
- 同一 `CommandId` 重复注册：**失败**（`COMMAND_ID_CONFLICT`）。禁止静默覆盖。跨插件撞 id 同样冲突。
- **命令 id 命名约定（文档约定，M1.5 不强制校验）：** 内置使用 `node.*` / `page.*`（及现有 id）；宿主插件宜使用自有前缀（如 `host.*` 或反域名），降低误撞概率。
- M1.5 不提供运行时 `installPlugin` / `uninstallPlugin`；`options.plugins` 是唯一宿主安装入口。
- **注册记账（钉死）：**
  - Editor 在每次 `registerCommand` 时把 `(commandId → contribution)` 与「所属 pluginId」记入 registry。
  - `registerCommand` 返回的 **unregister** 只移除**该 commandId** 的注册（幂等）；这是测试与插件内部可调用的**单项撤销**，**不是**运行时卸载整个插件的公共 API。
  - 插件 `register()` 返回的 **disposer** 只负责插件**私有资源**（定时器、外部订阅等）。**不得**依赖 disposer 作为卸载命令的唯一路径；Editor 在释放该插件时仍按 registry 记账移除其全部 command id，并对 disposer 做幂等调用。
  - 禁止 double-free 导致抛错：unregister / disposer / `Editor.dispose` 均须幂等。

### 6.3 数据流

```text
createEditor(document, options)
  → RecordStore.fromDocument
  → 创建 CommandRegistry
  → 安装 builtin plugins
  → 安装 options.plugins（若有）
  → 任一插件抛错或 register 冲突
      → 按安装逆序调用已收集 disposer，清空 registry
      → 构造失败（throw 带稳定 code 的初始化错误）

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
| Editor 构造 | 先装 `composeui.builtin`（及族），再装 `options.plugins`（若有） |
| `registerCommand` | 写入 registry 并记账所属 pluginId；返回对该 commandId 的幂等 unregister |
| 插件安装失败 | 按安装逆序释放已成功安装的插件 disposer 与其命令注册，清空 registry；构造过程不泄漏注册或 core 侧 listener |
| 插件返回的 disposer | 由 Editor 持有；语义见 §6.2「注册记账」——仅私有资源，命令卸载以 registry 为准 |
| `Editor.dispose()` | 幂等；按安装逆序：调用插件 disposer → 按记账移除全部 command → 清空 core 侧 `subscribe` listeners 与内部钩子；builtin 与宿主插件均由 Editor 持有 |
| dispose 后：变更类 API | `dispatch` / `execute` / `undo` / `redo` / `jumpToHistory` 返回 `Result` 失败，`Diagnostic.code === "EDITOR_DISPOSED"`；**store 不变** |
| dispose 后：只读 API | `getStore` / `getRecord` / `getHistory` / `canUndo` / `canRedo` / `getDiagnostics` 允许继续返回**最后一致快照**（structuredClone 语义与现有一致）；不抛错 |
| dispose 后：`subscribe` | **不**再保存 listener；返回 no-op disposer；**不**再调用 `onDiagnostic`（避免宿主已拆钩子时二次失败） |
| dispose 后：`onDiagnostic` / `operationObserver` | dispose **完成之后**不再调用；dispose 过程中因清理而产生的诊断可选记录到内部缓冲，但不依赖宿主钩子仍存活 |
| core dispose vs UI destroy | **core `Editor.dispose`** 只释放 core 会话资源。`mountEditor` / workspace 的 DOM、Session 订阅、Dockview 由 **editor 侧 `destroy`/`dispose`** 负责，并应在卸 UI 时调用（或先于）`editor.dispose()`。core 不卸载 DOM。 |
| 进行中的指针预览 | 仍为 Session 草稿；与今日一样，无跨指针的 document 事务悬挂；UI destroy 须取消指针捕获并丢弃预览 |

### 6.5 错误处理策略

| 阶段 | 策略 |
| --- | --- |
| 文档装载失败 | 保持现有构造失败语义（如 `fromDocument` 抛稳定 message code） |
| 插件抛错、插件 id 冲突、重复 command id | 构造期回滚已安装项后，**throw** 带稳定 `code` 的 `EditorInitializationError`；`message` 仅供描述，不作为机器契约；`PLUGIN_INSTALL_FAILED` 可保留 `cause` |
| dispatch / execute / prepare / 事务校验失败 | **`Result` + `Diagnostic[]`**，store 不变 |
| undo / redo / jump 失败 | 保持现有 `Result` + Diagnostic 语义；dispose 后统一 `EDITOR_DISPOSED` |
| operationObserver / subscribe listener 抛错 | 记诊断或不阻断；**不得**回滚已成功事务 |

### 6.6 Operation observation 与 replay

- `EditorOperation` 的 document command 事件使用 `DispatchCommand`，因此 builtin 与宿主插件命令共享 started / succeeded / failed 观察语义。
- operation-log 原样保存命令信封，不要求在记录时识别插件 payload；日志格式不得把命令强制断言为 `EditorCommand`。
- replay 创建 Editor 时必须安装产生该日志所需的同版本插件。若 dispatch 返回 `COMMAND_NOT_REGISTERED`，adapter 转为现有 `missing-handler` 差异，`eventType` 记为 `document.command:<commandId>`；不得静默跳过。
- replay handler 通过公共 `Editor.dispatch` 重放命令；operation-log 不直接调用 contribution 或事务内核。

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
  resolveNodeBox(nodeId: string): ResolvedBox | undefined
}

/** M2 实现：一次绑定 store/snapshot，供同一渲染或命中周期复用计算上下文。 */
type CreateLayoutProjection = (store: RecordStore) => LayoutProjection
```

- 画布 **继续** 直接读取 free `NodeRecord.layout` 渲染，直到 M2 切换到真实 projection。
- **禁止**在 M1.5 提交「读 free layout 的默认 `LayoutProjection` 实现」并伪装为投影层已完成；类型与文档占位即可。M2 再提供真实实现并切换画布消费路径。

### 7.2 明确不做

- 增量失效订阅总线。
- Auto/Grid 计算与 golden。
- 本轮默认布局投影实现类。

---

## 8. 依赖边界守卫

### 8.1 规则

1. `packages/editor`、`packages/operation-log` 与 `apps/**` 只允许从 `@composeui/core` 公共入口导入，禁止：
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

- **目录分层若已合入：不再重复 rename**；只核对与 §5 目标树一致（`commands/` 子树可在 P1 再拆）。
- 落地依赖守卫 + 挂入 `check`；覆盖 editor、operation-log、apps。
- P0 **不**迁移 Query 实现、**不**引入 Command 插件运行时；Query 收纳归 P2。
- 更新 `docs/current-architecture.md` 与包内 README（若有漂移）。
- **验收**：全量现有测试绿；故意违规 import 时守卫失败。

### P1 — Command 插件内核

- `CommandRegistry` + `CommandPlugin` API；builtin 插件 id 见 §6.2。
- 内置命令迁入 `builtin/` 并以 plugin 安装。
- `createEditor({ plugins })`；冲突与未知命令语义按 §6。
- `DispatchCommand` 贯通 dispatch、operation observer 与 operation-log/replay（**触及包：core + operation-log**，及必要的 editor/playground 装配）。
- 幂等 `Editor.dispose()` 与 dispose 后 API 语义按 §6.4。
- 测试：内置命令回归；通过 `registerCommand` 返回的 **unregister**（非 runtime uninstallPlugin）做单项撤销；插件命令 observe → replay；plugin/command id 冲突；安装失败逆序回滚；重复 dispose；dispose 后 dispatch/undo/subscribe。
- **验收**：无产品行为变化（同一命令序列 → 同一 canonical `PageDocument` JSON 意图不变）。

### P2 — Canvas 拆分与 Query 收纳

- 拆分 `editor-view` 为 §9 模块。
- Query 路径与 LayoutProjection 类型占位。
- 文档与 AGENTS 源码地图同步。
- **验收**：`editor-view.ts` 删除或仅保留不拥有交互/渲染状态的薄兼容入口；editor 浏览器单测与相关 E2E 绿；golden 文件内容不变。

允许 P0 与已有工作区改动合并为同一提交序列；P1/P2 建议独立可审阅提交或 PR。

---

## 11. 测试策略

| 层 | 要求 |
| --- | --- |
| 单元 | registry、安装失败回滚、plugin/editor dispose、builtin prepare 等价性 |
| 集成 | createEditor + dispatch 全命令路径；插件命令 observe/replay；history undo/redo 不回归；dispose 后 API |
| 属性 | 既有 fast-check 保持 |
| Golden | 同一命令序列产生的 **canonical** `PageDocument` JSON **byte-for-byte 不变**（无布局产品变更；不含事务 id / 旁路 log 字节） |
| E2E | Playground 主路径冒烟；不强制新视觉基线 |

测试优先依赖**包公共导出**；减少对 `packages/*/src/**` 深路径的耦合（破坏性清理允许改测试 import）。

---

## 12. 验收出口（里程碑完成定义）

1. `bun run check`（或项目约定的全量门禁）通过。
2. 源码目录与本设计 §5、包内 README、`current-architecture` 一致。
3. 宿主可通过 `CommandPlugin` 注册命令，并与内置命令共享 history / operation 观察与 replay 语义。
4. `editor-view.ts` 已删除或仅为薄兼容入口；指针状态、DOM board 渲染和 overlay 分属 §9 模块。
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
| 目录重组与升级交织难审 | 目录已合入则 P0 只做守卫；P1 行为中立重构单独可审 |
| dispose 与 UI 生命周期纠缠 | §6.4 明确 core dispose vs editor destroy；UI 负责指针取消 |
| unregister 与插件 disposer 双路径 | §6.2 记账规则：命令以 registry 为准，disposer 仅私有资源 |

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

---

## 16. 定稿说明

本文档经 brainstorm 确认、作者修订与契约补丁后 **正式定稿**，作为 M1.5 实施与验收的权威范围说明。

定稿补丁摘要（相对初版）：

- 钉死 `execute` 别名、dispose 后变更/只读/`subscribe`/`onDiagnostic` 语义。
- 钉死 registry 记账、单项 unregister vs 插件 disposer 职责。
- 钉死 builtin 插件 id、命令 id 命名约定（非强制校验）。
- 钉死 core dispose vs editor UI destroy 边界。
- 明确 P0 不重复搬家、P1 跨 core + operation-log、禁止默认 LayoutProjection 假实现。

后续变更须显式修订本文版本说明，并同步实施计划。
