# 操作日志 Workspace 捕获与回放实现计划

> **状态：** 已完成。Workspace 事件捕获、checkpoint/bundle 兼容、隔离回放和 Playground 端到端持久化均已合入；最终全量验证已运行，lint 的现有无关告警已单独记录。

**目标：** 完整记录 Workspace 面板与布局操作，将版本化布局快照写入 checkpoint，并在隔离 Workspace 中确定性回放；日志失败不得阻塞编辑器主流程。

**架构：** `@composeui/editor` 只产生框架无关、可克隆的 `WorkspaceEvent`。`@composeui/operation-log` 通过结构类型适配事件，不反向依赖 editor。布局变化在 Workspace 边界合并后形成唯一权威快照；checkpoint、bundle 和 ReplayEngine 共同保存并恢复 document、session、workspace 三类状态。Playground 的测试挂载与浏览器挂载统一经过同一个 runtime，避免日志注入只在测试路径生效。

**技术栈：** TypeScript、Vitest、Dockview、IndexedDB、Playwright。

---

## 事件与兼容性约束

- `StoredWorkspaceLayout` 固定为 `{ version: 1, modeId: "2d", layout: unknown }`。写入前必须通过 `structuredClone`；不可克隆时只产生诊断，不保存原对象。
- `WorkspaceError` 固定为 `{ name: string; message: string; code?: string }`，禁止把 `Error`、DOM、函数或 Dockview 实例写入事件。
- 面板事件只有真实状态迁移才记录：不存在到存在为 `panel-opened`，存在到不存在为 `panel-closed`，活动面板 ID 改变为 `panel-activated`。
- Dockview 原始 `onDidLayoutChange` 使用 150ms trailing debounce。只记录最后一个 `workspace.layout.changed` 快照；`flushLayout()` 必须立即提交尾部快照。
- `layout-loaded`、`layout-reset` 是独立生命周期事件；不再增加内容重复的 `layout-saved` 事件。存储失败单独记录 `diagnostic.reported`。
- checkpoint 的 `workspaceState`、`workspaceHash` 为可选字段，确保旧 bundle 仍可导入和回放。新 checkpoint 必须同时写入二者。
- operation-log 不得从 `@composeui/editor` 导入任何类型；两边仅通过结构兼容的事件契约连接。

---

### Task 1: 定义 Workspace 事件并稳定 Dockview 语义

**Files:**
- Modify: `packages/editor/src/workspace/types.ts`
- Modify: `packages/editor/src/workspace/editor-workspace.ts`
- Test: `packages/editor/test/editor-workspace.test.ts`

- [x] **Step 1: 先写失败测试**

在 `editor-workspace.test.ts` 的 Dockview fake 中补充活动面板订阅：

```ts
const activePanelListeners = new Set<(panel: { id: string } | undefined) => void>()

onDidActivePanelChange(listener: (panel: { id: string } | undefined) => void) {
  activePanelListeners.add(listener)
  return { dispose: () => activePanelListeners.delete(listener) }
}
```

新增测试并断言：

1. 重复调用 `openPanel("inspector")` 只产生一次 `panel-opened`。
2. 关闭不存在的面板不产生 `panel-closed`。
3. Dockview 活动面板 ID 真正改变时产生 `panel-activated`，重复 ID 不记录。
4. 连续触发三次布局变化，推进 149ms 时没有事件，推进到 150ms 时只有最后一个 `layout-changed`。
5. `flushLayout()` 立即提交尾部布局；`dispose()` 释放布局和活动面板订阅。
6. 加载、重置和失败事件全部可以 `structuredClone`，错误中没有原始异常。

- [x] **Step 2: 运行测试并确认红灯**

Run: `bunx vitest run packages/editor/test/editor-workspace.test.ts`

Expected: FAIL，当前没有活动面板事件、布局合并和 `flushLayout()`。

- [x] **Step 3: 实现可序列化契约**

复用现有 `StoredWorkspaceLayout`，在 `workspace/types.ts` 中增加 `WorkspaceError`，并把现有 failure-only 联合扩展为完整事件联合：

```ts
export interface WorkspaceError {
  name: string
  message: string
  code?: string
}

export type WorkspaceEvent =
  | { type: "panel-opened"; panelId: string }
  | { type: "panel-closed"; panelId: string }
  | { type: "panel-activated"; panelId: string }
  | { type: "layout-changed"; layout: StoredWorkspaceLayout }
  | { type: "layout-loaded"; layout: StoredWorkspaceLayout }
  | { type: "layout-reset"; layout: StoredWorkspaceLayout }
  | { type: "layout-failure"; operation: "load" | "save" | "remove"; error: WorkspaceError }
  | { type: "panel-failure"; panelId: string; error: WorkspaceError }
```

实现并导出 `serializeWorkspaceError(error: unknown): WorkspaceError`。只复制字符串 `name`、`message` 和 `code`；未知值使用 `name: "Error"` 与 `String(error)`。

- [x] **Step 4: 实现事件状态迁移与布局合并**

在 `EditorWorkspaceDockview` 增加可选 `onDidActivePanelChange`，在 `EditorWorkspaceApi` 增加：

```ts
flushLayout(): Promise<void>
getLayoutSnapshot(): StoredWorkspaceLayout
```

`openPanel` 必须先检查 `getPanel(id)`；已存在时只聚焦并返回 `false`，不记录 opened。保存最后活动面板 ID，过滤重复 activation。

`EditorWorkspaceMountOptions` 增加 `layoutChangeDelayMs?: number`，默认值为 150。布局处理使用单个 timer 和最新快照：

```ts
let pendingLayout: StoredWorkspaceLayout | undefined
let layoutTimer: ReturnType<typeof setTimeout> | undefined

function scheduleLayout(layout: StoredWorkspaceLayout): void {
  try {
    pendingLayout = structuredClone(layout)
  } catch (error) {
    emit({ type: "layout-failure", operation: "save", error: serializeWorkspaceError(error) })
    return
  }
  if (layoutTimer !== undefined) clearTimeout(layoutTimer)
  layoutTimer = setTimeout(() => void flushLayout(), layoutChangeDelayMs)
}
```

`flushLayout()` 清理 timer，取出一次 `pendingLayout`，发出 `layout-changed`，再调用 layout store；保存失败发出 `layout-failure`，但不得撤销已经发生的 Workspace 状态。加载和重置期间使用 `applyingLayout` 抑制 Dockview 的派生 change 事件，并分别发出 `layout-loaded`、`layout-reset`。

- [x] **Step 5: 回归测试并提交**

```bash
bunx vitest run packages/editor/test/editor-workspace.test.ts
bun run typecheck
git add packages/editor/src/workspace/types.ts packages/editor/src/workspace/editor-workspace.ts packages/editor/test/editor-workspace.test.ts
git commit -m "feat(editor): emit stable workspace events"
```

Expected: PASS。

---

### Task 2: 接入 Workspace observer 与中文 Output 格式化

**Files:**
- Create: `packages/operation-log/src/adapters/workspace-observer.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/workspace-observer.test.ts`
- Modify: `packages/editor/src/workspace/operation-formatters.ts`
- Modify: `packages/editor/test/operation-formatters.test.ts`

- [x] **Step 1: 先写 observer 失败测试**

在 operation-log 内部定义与 editor 结构兼容的独立联合类型，测试不得导入 editor：

```ts
export interface WorkspaceOperationRecorder {
  recordDeferred(factory: () => Promise<RecordOperationInput>): Promise<OperationEvent>
}

export type WorkspaceOperationSourceEvent =
  | { type: "panel-opened" | "panel-closed" | "panel-activated"; panelId: string }
  | { type: "layout-changed" | "layout-loaded" | "layout-reset"; layout: unknown }
  | {
      type: "layout-failure"
      operation: "load" | "save" | "remove"
      error: { name: string; message: string; code?: string }
    }
  | {
      type: "panel-failure"
      panelId: string
      error: { name: string; message: string; code?: string }
    }
```

fake recorder 也实现 `recordDeferred`，并验证映射：

```text
panel-opened     -> workspace.panel.opened
panel-closed     -> workspace.panel.closed
panel-activated  -> workspace.panel.activated
layout-changed   -> workspace.layout.changed
layout-loaded    -> workspace.layout.loaded
layout-reset     -> workspace.layout.reset
layout-failure   -> diagnostic.reported
panel-failure    -> diagnostic.reported
```

断言布局 payload 在 deferred factory 执行前已经克隆；修改源对象不影响日志。断言 recorder 拒绝时 `observe()` 不抛出。

- [x] **Step 2: 运行 observer 测试并确认红灯**

Run: `bunx vitest run packages/operation-log/test/workspace-observer.test.ts`

Expected: FAIL，因为适配器不存在。

- [x] **Step 3: 实现 adapter，保持依赖方向**

创建 `createWorkspaceOperationObserver(recorder)`，返回：

```ts
export interface WorkspaceOperationObserver {
  observe(event: WorkspaceOperationSourceEvent): void
}
```

`observe` 先规范化并 `structuredClone`，再调用 `recordDeferred`。面板和布局事件使用 `category: "workspace"`、`status: "observed"`；失败事件使用 `category: "diagnostic"`、`type: "diagnostic.reported"`，diagnostics code 分别为 `WORKSPACE_LAYOUT_FAILURE`、`WORKSPACE_PANEL_FAILURE`。用 `void promise.catch(() => undefined)` 隔离日志故障。

- [x] **Step 4: 增加中文 Output 格式化测试与实现**

在 `operation-formatters.test.ts` 先断言以下文本，再在 formatter 注册对应类型：

```text
打开面板：inspector
关闭面板：signals
激活面板：canvas:page-1
更新工作区布局
加载工作区布局
重置工作区布局
```

格式化器只读取 panelId、layout.version 和 layout.modeId，不把完整 Dockview JSON 展开到 Output。

- [x] **Step 5: 验证并提交**

```bash
bunx vitest run packages/operation-log/test/workspace-observer.test.ts packages/editor/test/operation-formatters.test.ts
bun run typecheck
git add packages/operation-log/src/adapters/workspace-observer.ts packages/operation-log/src/index.ts packages/operation-log/test/workspace-observer.test.ts packages/editor/src/workspace/operation-formatters.ts packages/editor/test/operation-formatters.test.ts
git commit -m "feat(operation-log): capture workspace events"
```

Expected: PASS，且 `rg '@composeui/editor' packages/operation-log` 无结果。

---

### Task 3: 将 Workspace 状态加入 checkpoint 和 bundle

**Files:**
- Modify: `packages/operation-log/src/checkpoints.ts`
- Modify: `packages/operation-log/src/coordinator.ts`
- Modify: `packages/operation-log/src/bundle.ts`
- Modify: `packages/operation-log/test/coordinator.test.ts`
- Modify: `packages/operation-log/test/bundle.test.ts`

- [x] **Step 1: 先写向后兼容失败测试**

新增三组断言：

1. Coordinator 写出的新 checkpoint 包含 workspace state/hash，`system.checkpoint` payload 也包含 `workspaceHash`。
2. 带 workspace 字段的 bundle 可导出、导入并通过 hash 与 manifest 校验。
3. 不含 workspace 字段的旧 bundle 仍然合法；只提供其中一个字段、hash 不匹配或含额外未知字段必须拒绝。

- [x] **Step 2: 运行测试并确认红灯**

```bash
bunx vitest run packages/operation-log/test/coordinator.test.ts packages/operation-log/test/bundle.test.ts
```

Expected: FAIL，当前 checkpoint 严格键集合不接受 workspace 字段。

- [x] **Step 3: 扩展 snapshot/checkpoint 类型**

使用可选字段保持旧数据兼容：

```ts
export interface OperationCheckpoint {
  // existing fields
  workspaceState?: unknown
  workspaceHash?: string
}

export interface OperationSnapshot {
  // existing fields
  workspaceState?: unknown
  workspaceHash?: string
}
```

Coordinator 校验 optional pair：二者必须同时存在或同时缺失。新 playground snapshot 总是传入二者，`workspaceHash` 使用 `hashCanonical(workspaceState)` 生成。

- [x] **Step 4: 更新 bundle 严格校验与 hash 重算**

`isCheckpoint` 的允许键加入 `workspaceState`、`workspaceHash`，并增加：

```ts
const hasWorkspaceState = Object.hasOwn(value, "workspaceState")
const hasWorkspaceHash = Object.hasOwn(value, "workspaceHash")
if (hasWorkspaceState !== hasWorkspaceHash) return false
```

`validateCheckpointHashes` 只在字段成对存在时校验 workspace hash。bundle 重算 hash 的路径也要重算 `workspaceHash`，不能保留导入值。

- [x] **Step 5: 验证并提交**

```bash
bunx vitest run packages/operation-log/test/coordinator.test.ts packages/operation-log/test/bundle.test.ts
bun run typecheck
git add packages/operation-log/src/checkpoints.ts packages/operation-log/src/coordinator.ts packages/operation-log/src/bundle.ts packages/operation-log/test/coordinator.test.ts packages/operation-log/test/bundle.test.ts
git commit -m "feat(operation-log): checkpoint workspace state"
```

Expected: 新旧 bundle 测试全部 PASS。

---

### Task 4: 在隔离 Workspace 中实现回放

**Files:**
- Modify: `packages/operation-log/src/replay/types.ts`
- Modify: `packages/operation-log/src/replay/engine.ts`
- Modify: `packages/operation-log/src/replay/builtin-handlers.ts`
- Modify: `packages/operation-log/src/index.ts`
- Modify: `packages/operation-log/test/replay-handlers.test.ts`
- Modify: `packages/operation-log/test/replay-engine.test.ts`
- Modify: `packages/operation-log/test/replay-roundtrip.test.ts`

- [x] **Step 1: 先写 replay port 与 handler 失败测试**

定义 fake Workspace 并覆盖 open、close、activate、layout changed/loaded/reset。断言 handler 只调用 fake，不访问活动 editor。再断言 checkpoint 含 workspace 时从该状态创建；旧 checkpoint 缺失时从 `undefined` 创建。

- [x] **Step 2: 运行测试并确认红灯**

```bash
bunx vitest run packages/operation-log/test/replay-handlers.test.ts packages/operation-log/test/replay-engine.test.ts packages/operation-log/test/replay-roundtrip.test.ts
```

Expected: FAIL，ReplayHandlerContext 目前只有 editor/session。

- [x] **Step 3: 增加 ReplayWorkspacePort 和创建工厂**

```ts
export interface ReplayWorkspacePort {
  openPanel(panelId: string): void
  closePanel(panelId: string): void
  activatePanel(panelId: string): void
  applyLayout(layout: unknown): void
  resetLayout(layout: unknown): void
  getState(): unknown
}

export interface ReplayHandlerContext {
  editor: Editor
  session: ReplaySessionPort
  workspace: ReplayWorkspacePort
  sideEffects: "disabled"
}
```

`ReplayEngineCreateOptions` 增加可选工厂，避免破坏现有调用方：

```ts
createWorkspace?: (initialState: unknown) => ReplayWorkspacePort | Promise<ReplayWorkspacePort>
```

`ReplayState` 增加 `workspace: unknown`。创建引擎时把 `checkpoint.workspaceState` 克隆后传给工厂；缺失时传 `undefined`。未传工厂时使用 operation-log 内部的纯内存 Workspace port，保证旧调用方无需修改且所有回放仍与活动编辑器隔离。显式工厂创建失败返回新的 `workspace-error` difference，不复用 `session-error`。

- [x] **Step 4: 注册 builtin Workspace handlers**

为以下类型增加 handler：

```text
workspace.panel.opened
workspace.panel.closed
workspace.panel.activated
workspace.layout.changed
workspace.layout.loaded
workspace.layout.reset
```

handler 对 panelId 和 versioned layout 做严格运行时校验；非法 payload 返回 `schema-incompatible`，不能把未知结构直接传给宿主。诊断事件保持 no-op，不改变 Workspace。

- [x] **Step 5: 增加 roundtrip 断言**

构造 document、session、workspace 都发生变化的 bundle，从 checkpoint 回放到目标 sequence，断言最终三个 `hashCanonical` 与录制态一致。再用无 workspace 字段的旧 fixture 回放，断言仍完成且 workspace 初始值为 `undefined`。

- [x] **Step 6: 验证并提交**

```bash
bunx vitest run packages/operation-log/test/replay-handlers.test.ts packages/operation-log/test/replay-engine.test.ts packages/operation-log/test/replay-roundtrip.test.ts
bun run typecheck
git add packages/operation-log/src/replay/types.ts packages/operation-log/src/replay/engine.ts packages/operation-log/src/replay/builtin-handlers.ts packages/operation-log/src/index.ts packages/operation-log/test/replay-handlers.test.ts packages/operation-log/test/replay-engine.test.ts packages/operation-log/test/replay-roundtrip.test.ts
git commit -m "feat(operation-log): replay workspace state"
```

Expected: PASS。

---

### Task 5: 统一 Playground 挂载并完成端到端链路

**Files:**
- Modify: `apps/playground/src/main.ts`
- Modify: `apps/playground/src/operation-log.test.ts`
- Modify: `tests/editor-workspace.spec.ts`

- [x] **Step 1: 先写 runtime 挂载失败测试**

测试必须调用与浏览器相同的 `runtime.mount(root, options)`，并从返回值获得 Workspace API：

```ts
const workspace = runtime.mount(root, { layoutStore })
workspace.api.openPanel("signals")
workspace.api.closePanel("signals")
await workspace.api.flushLayout()
await runtime.flush()
```

查询当前 session，断言面板事件和唯一 layout.changed 已持久化，checkpoint 中含 workspace state/hash。

- [x] **Step 2: 运行测试并确认红灯**

Run: `bunx vitest run apps/playground/src/operation-log.test.ts`

Expected: FAIL，当前浏览器 `mountPlayground()` 直接调用 `mountEditorWorkspace`，绕过 runtime observer。

- [x] **Step 3: 合并为唯一挂载路径**

修改 runtime 的 `mount`：返回 `MountedEditorWorkspace`，接收 layoutStore 和其他 editor mount options，并始终注入同一个 recorder 创建的 Workspace observer。删除 `mountPlayground()` 内第二次直接 `mountEditorWorkspace`；浏览器也调用 `runtime.mount(editorHost, options)`。

runtime 的 snapshot 从已挂载 API 获取：

```ts
const workspaceState = mounted?.api.getLayoutSnapshot()
return {
  document,
  sessionState,
  documentHash: await hashCanonical(document),
  sessionHash: await hashCanonical(sessionState),
  ...(workspaceState === undefined
    ? {}
    : {
        workspaceState,
        workspaceHash: await hashCanonical(workspaceState),
      }),
}
```

销毁顺序固定为：`await mounted.api.flushLayout()`、`await coordinator.flush()`、`mounted.dispose()`、`await coordinator.end()`。

- [x] **Step 4: 增加浏览器断言**

在 `tests/editor-workspace.spec.ts` 打开并关闭一个可关闭面板，刷新页面后打开 Output，筛选 workspace 类别并断言中文记录仍存在；同时断言画布节点未因日志查询或回放而变化。

- [x] **Step 5: 验证并提交**

```bash
bunx vitest run apps/playground/src/operation-log.test.ts
bunx playwright test tests/e2e/editor-workspace.spec.ts --reporter=line
git add apps/playground/src/main.ts apps/playground/src/operation-log.test.ts tests/editor-workspace.spec.ts
git commit -m "feat(playground): persist workspace operation logs"
```

Expected: 单元测试和浏览器测试 PASS，浏览器代码中只剩一个 Workspace 挂载入口。

---

### Task 6: 全量验证并更新第二阶段状态

**Files:**
- Modify: `docs/superpowers/specs/2026-07-13-operation-log-system-design.md`

- [x] **Step 1: 运行完整验证**

```bash
bun run test
bun run typecheck
bun run lint
bun run build
git diff --check
rg '@composeui/editor' packages/operation-log
```

Expected: 前五个命令全部通过，最后一个命令无输出并以未匹配状态退出。仓库已有且与本任务无关的问题必须单独报告，不得通过修改无关文件掩盖。

- [x] **Step 2: 更新设计文档状态**

在中文版设计文档第二阶段中将以下内容标记完成：

- Workspace 面板与布局事件捕获。
- Workspace 状态持久化和 bundle 向后兼容。
- 隔离 Workspace 回放。

继续保留为未完成：更高频交互采样、导入 bundle 管理能力、连续视觉回放。

- [x] **Step 3: 最终提交**

```bash
git add docs/superpowers/specs/2026-07-13-operation-log-system-design.md
git commit -m "docs: complete workspace logging phase"
git status --short
```

Expected: 工作树干净；如存在用户预先保留的无关改动，只列出且不纳入提交。
