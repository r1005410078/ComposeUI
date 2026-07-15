# Visible Operation Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不修改原始项目的前提下，将隔离回放状态逐帧投影到当前画布，并让日志选中后保持滚动位置稳定。

**Architecture:** `ReplayEngine` 保持纯隔离执行并继续返回 `ReplayState`；`ReplayController` 负责定时逐步执行并发布帧。EditorView 通过通用只读预览源显示回放文档，Workspace 只负责将 Controller 状态适配为预览源；输出面板独立管理“跟随最新/阅读历史”滚动状态。

**Tech Stack:** TypeScript、Vitest、JSDOM、Playwright、ComposeUI Core Editor、Dockview

---

## File Map

- Modify: `packages/operation-log/src/replay/engine.ts` — 目标检查点存在时仍从严格早于目标的检查点启动。
- Modify: `packages/operation-log/test/replay-engine.test.ts` — 精确命中检查点时的可见回放回归测试。
- Modify: `packages/editor/src/workspace/replay-controller.ts` — 逐帧播放、暂停/继续、帧状态和竞态取消。
- Modify: `packages/editor/test/replay-controller.test.ts` — Controller 的定时播放和帧发布测试。
- Modify: `packages/editor/src/editor-view.ts` — 通用只读文档预览源、回放标识和编辑锁定。
- Modify: `packages/editor/test/editor-view.test.ts` — 预览显示、原文档隔离和停止恢复测试。
- Create: `packages/editor/src/workspace/replay-preview-source.ts` — 将 ReplayControllerState 映射为 EditorView 预览模型。
- Create: `packages/editor/test/replay-preview-source.test.ts` — 适配器生命周期和状态映射测试。
- Modify: `packages/editor/src/workspace/types.ts` — 在 Canvas WorkspaceContext 中传递通用预览源。
- Modify: `packages/editor/src/workspace/editor-workspace.ts` — 创建并共享回放预览源，销毁时解除订阅。
- Modify: `packages/editor/src/workspace/panels.ts` — Canvas 面板消费通用预览源。
- Modify: `packages/editor/src/workspace/toolbar.ts` — 回放预览激活时禁用会修改源会话的工具。
- Modify: `packages/editor/test/workspace-toolbar.test.ts` — 工具栏只读锁测试。
- Modify: `packages/editor/src/workspace/output-replay-bar.ts` — 暂停/继续控制和中文状态文本。
- Modify: `packages/editor/test/output-replay-bar.test.ts` — 回放控制按钮测试。
- Modify: `packages/editor/src/workspace/output-panel.ts` — 阅读历史滚动模式和新增日志计数。
- Modify: `packages/editor/src/workspace/workspace.css` — 回放横幅、新日志入口和只读视觉状态。
- Modify: `packages/editor/test/workspace-panels.test.ts` — 日志滚动位置与新增计数测试。
- Modify: `tests/editor-workspace.spec.ts` — 真实拖动日志的可见回放和停止恢复 E2E。

### Task 1: 从目标之前的检查点启动回放

**Files:**

- Modify: `packages/operation-log/src/replay/engine.ts`
- Test: `packages/operation-log/test/replay-engine.test.ts`

- [ ] **Step 1: 写精确命中检查点的失败测试**

在 `ReplayEngine` describe 中增加：

```ts
it("starts before an exact target checkpoint so the target operation stays visible", async () => {
  const events = [event(1, { gridVisible: false }), event(2, { gridVisible: true })]
  const bundle = bundleWithCheckpoints(events)
  const exactSessionState = sessionPort().state
  bundle.checkpoints.push({
    sessionId: "session-1",
    sequence: 2,
    createdAt: "2026-07-14T00:00:02.000Z",
    document,
    sessionState: exactSessionState,
    documentHash: await hashCanonical(document),
    sessionHash: await hashCanonical(exactSessionState),
  })
  const engine = await ReplayEngine.create({
    bundle: await importTestBundle(bundle),
    targetSequence: 2,
    createSession: () => sessionPort(),
  })

  expect(engine.getState().sequence).toBe(0)
  const first = await engine.step(2)
  expect(first.currentSequence).toBe(1)
  expect(first.state?.sequence).toBe(1)
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `bunx vitest run packages/operation-log/test/replay-engine.test.ts -t "starts before an exact target checkpoint"`  
Expected: FAIL，当前 `engine.getState().sequence` 是 2。

- [ ] **Step 3: 使用严格前驱检查点**

在 `ReplayEngine.create()` 中替换检查点过滤条件。目标 0 仍允许 sequence 0，其他目标必须严格小于目标：

```ts
const checkpoints = options.bundle.checkpoints.filter(
  (checkpoint) =>
    checkpoint.sequence < targetSequence || (targetSequence === 0 && checkpoint.sequence === 0),
)
```

保留后续排序、缺失检查点差异和 bundle 验证逻辑不变。

- [ ] **Step 4: 运行 ReplayEngine 测试**

Run: `bunx vitest run packages/operation-log/test/replay-engine.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/operation-log/src/replay/engine.ts packages/operation-log/test/replay-engine.test.ts
git commit -m "fix(operation-log): replay exact targets from predecessor checkpoint"
```

### Task 2: ReplayController 发布逐帧状态

**Files:**

- Modify: `packages/editor/src/workspace/replay-controller.ts`
- Test: `packages/editor/test/replay-controller.test.ts`

- [ ] **Step 1: 写逐帧播放的失败测试**

在 `packages/editor/test/replay-controller.test.ts` 增加固定帧和可控 wait：

```ts
import { createEmptyDocument } from "@composeui/core"

const frame = (sequence: number) => ({
  sequence,
  document: createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
  session: { selection: [], viewport: { x: 0, y: 0, zoom: 1 } },
  workspace: {},
})

it("publishes the checkpoint and each replay frame before reaching the target", async () => {
  const waits: Array<() => void> = []
  const engine = {
    getState: vi.fn(() => frame(0)),
    step: vi
      .fn()
      .mockResolvedValueOnce(
        replayResult({
          status: "paused",
          currentSequence: 1,
          targetSequence: 2,
          state: frame(1),
        }),
      )
      .mockResolvedValueOnce(
        replayResult({ currentSequence: 2, targetSequence: 2, state: frame(2) }),
      ),
    runTo: vi.fn(),
    verify: vi.fn(),
    continueBestEffort: vi.fn(),
  }
  const controller = new ReplayController({
    createEngine: vi.fn(async () => engine),
    wait: () => new Promise<void>((resolve) => waits.push(resolve)),
    frameDelayMs: 300,
  })
  const published: number[] = []
  controller.subscribe((state) => {
    if (state.frame !== undefined) published.push(state.frame.sequence)
  })

  await controller.start(2)
  expect(published).toEqual([0])
  waits.shift()?.()
  await vi.waitFor(() => expect(published).toEqual([0, 1]))
  expect(controller.getState().status).toBe("running")
  waits.shift()?.()
  await vi.waitFor(() => expect(controller.getState().status).toBe("completed"))

  expect(published).toEqual([0, 1, 2])
  expect(controller.getState()).toMatchObject({ status: "completed", currentSequence: 2 })
})

it("pauses on the first difference and keeps that frame visible", async () => {
  const difference = {
    type: "patch-mismatch" as const,
    sequence: 1,
    path: "forward.updated[0].layout.x",
    expected: 40,
    actual: 41,
  }
  const engine = {
    getState: vi.fn(() => frame(0)),
    step: vi.fn(async () =>
      replayResult({
        status: "paused",
        deterministic: false,
        currentSequence: 1,
        targetSequence: 2,
        difference,
        state: frame(1),
      }),
    ),
    runTo: vi.fn(),
    verify: vi.fn(),
    continueBestEffort: vi.fn(),
  }
  const controller = new ReplayController({
    createEngine: vi.fn(async () => engine),
    wait: async () => undefined,
  })

  await controller.start(2)
  await vi.waitFor(() => expect(controller.getState().status).toBe("paused"))

  expect(controller.getState()).toMatchObject({
    currentSequence: 1,
    deterministic: false,
    difference,
  })
  expect(controller.getState().frame?.sequence).toBe(1)
  expect(engine.step).toHaveBeenCalledOnce()
})
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `bunx vitest run packages/editor/test/replay-controller.test.ts -t "publishes the checkpoint"`  
Expected: FAIL，`ReplayControllerState` 没有 `frame`，构造参数也不接受 `wait`。

- [ ] **Step 3: 实现帧状态和逐步播放循环**

在 `replay-controller.ts` 中增加：

```ts
import type { ReplayState } from "@composeui/operation-log"

export interface ReplayControllerState {
  readonly active: boolean
  readonly status: "idle" | "running" | "paused" | "completed"
  readonly currentSequence?: number
  readonly targetSequence?: number
  readonly startedAtSequence?: number
  readonly deterministic: boolean
  readonly error?: string
  readonly difference?: ReplayDifference
  readonly nondeterministicFromSequence?: number
  readonly frame?: ReplayState
}

export interface ReplayControllerOptions {
  createEngine: ReplayEngineFactory
  frameDelayMs?: number
  wait?: (delayMs: number) => Promise<void>
}
```

构造器保存 `frameDelayMs ?? 300` 和 `wait ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))`。`start()` 创建引擎并发布 `engine.getState()` 后立即返回，让输出面板解除初始化 busy；自动播放循环由 Controller 内部启动并逐次调用 `engine.step(targetSequence)`。每次结果通过 `#applyResult` 把 `result.state` 克隆到 `frame`。只有尚未到达目标且没有差异时才等待下一帧。`stop()` 和启动失败必须清除旧 `frame`；播放命令失败保留最后一个已确认帧，但不能发布未完成的新帧。

`start()` 的边界如下；目标就是检查点时直接完成，不创建多余定时器：

```ts
async start(sequence: number): Promise<ReplayControllerState> {
  this.#assertSequence(sequence)
  const generation = ++this.#generation
  this.#engine = undefined
  this.#publish({ active: true, status: "running", deterministic: true })
  try {
    const engine = await this.#createEngine(sequence)
    if (generation !== this.#generation) return this.getState()
    this.#engine = engine
    const frame = structuredClone(engine.getState())
    const completed = frame.sequence >= sequence
    const state = this.#publish({
      active: true,
      status: completed ? "completed" : "running",
      currentSequence: frame.sequence,
      targetSequence: sequence,
      startedAtSequence: frame.sequence,
      deterministic: true,
      frame,
    })
    if (!completed) {
      void this.#playTo(generation, sequence).catch((error) =>
        this.#recoverFromError(generation, error),
      )
    }
    return state
  } catch (error) {
    return this.#recoverStartError(generation, error)
  }
}
```

`stateFromResult` 使用明确字段：

```ts
return {
  active,
  status,
  currentSequence: result.currentSequence,
  targetSequence: result.targetSequence,
  startedAtSequence: result.startedAtSequence,
  deterministic: result.deterministic,
  ...(result.state === undefined ? {} : { frame: structuredClone(result.state) }),
  ...(result.difference === undefined ? {} : { difference: structuredClone(result.difference) }),
  ...(result.nondeterministicFromSequence === undefined
    ? {}
    : { nondeterministicFromSequence: result.nondeterministicFromSequence }),
}
```

不要把 `ReplayEngine.step()` 的 `paused` 直接当成 Controller 暂停：引擎用它表示“本次单步结束但目标前仍有事件”。自动播放时由 Controller 传入 `running`；只有结果包含 `difference` 时强制暂停：

```ts
#applyResult(
  result: ReplayResult,
  requestedStatus: "running" | "paused" | "completed",
): ReplayControllerState {
  return this.#publish(
    stateFromResult(result, true, result.difference === undefined ? requestedStatus : "paused"),
  )
}
```

播放循环使用 generation 阻止迟到帧：

```ts
async #playTo(generation: number, targetSequence: number): Promise<void> {
  const engine = this.#engine
  if (engine === undefined) return
  while (generation === this.#generation) {
    await this.#wait(this.#frameDelayMs)
    if (generation !== this.#generation) return
    const result = await engine.step(targetSequence)
    if (generation !== this.#generation) return
    const reachedTarget = result.currentSequence >= targetSequence
    this.#applyResult(result, reachedTarget ? "completed" : "running")
    if (reachedTarget || result.difference !== undefined) return
  }
}
```

- [ ] **Step 4: 运行 Controller 全部测试**

Run: `bunx vitest run packages/editor/test/replay-controller.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/workspace/replay-controller.ts packages/editor/test/replay-controller.test.ts
git commit -m "feat(editor): publish visible replay frames"
```

### Task 3: 增加暂停、继续和竞态取消

**Files:**

- Modify: `packages/editor/src/workspace/replay-controller.ts`
- Test: `packages/editor/test/replay-controller.test.ts`
- Test: `packages/editor/test/output-replay-bar.test.ts`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: 写暂停/恢复和迟到帧的失败测试**

```ts
it("pauses between frames and resumes from the same isolated engine", async () => {
  const waits: Array<() => void> = []
  const engine = {
    getState: vi.fn(() => frame(0)),
    step: vi
      .fn()
      .mockResolvedValueOnce(
        replayResult({ currentSequence: 1, targetSequence: 2, state: frame(1) }),
      )
      .mockResolvedValueOnce(
        replayResult({ currentSequence: 2, targetSequence: 2, state: frame(2) }),
      ),
    runTo: vi.fn(),
    verify: vi.fn(),
    continueBestEffort: vi.fn(),
  }
  const controller = new ReplayController({
    createEngine: vi.fn(async () => engine),
    wait: () => new Promise<void>((resolve) => waits.push(resolve)),
  })
  await controller.start(2)
  controller.pause()
  waits.shift()?.()
  await Promise.resolve()
  expect(engine.step).not.toHaveBeenCalled()

  const resumed = controller.resume()
  await vi.waitFor(() => expect(waits).toHaveLength(1))
  waits.shift()?.()
  await vi.waitFor(() => expect(engine.step).toHaveBeenCalledOnce())
  controller.pause()
  await resumed
  expect(controller.getState()).toMatchObject({ status: "paused", currentSequence: 1 })
})

it("ignores a frame completed after stop", async () => {
  let resolveStep: ((value: ReturnType<typeof replayResult>) => void) | undefined
  const engine = {
    getState: vi.fn(() => frame(0)),
    step: vi.fn(() => new Promise((resolve) => (resolveStep = resolve))),
    runTo: vi.fn(),
    verify: vi.fn(),
    continueBestEffort: vi.fn(),
  }
  const controller = new ReplayController({
    createEngine: vi.fn(async () => engine),
    wait: async () => undefined,
  })

  await controller.start(2)
  await vi.waitFor(() => expect(engine.step).toHaveBeenCalledOnce())
  controller.stop()
  resolveStep?.(replayResult({ currentSequence: 1, targetSequence: 2, state: frame(1) }))
  await Promise.resolve()

  expect(controller.getState()).toEqual({ active: false, status: "idle", deterministic: true })
})

it("keeps visible frames for backward and forward steps", async () => {
  const engine = {
    getState: vi.fn(() => frame(2)),
    step: vi.fn(async () =>
      replayResult({ currentSequence: 2, targetSequence: 2, state: frame(2) }),
    ),
    runTo: vi.fn(async (sequence: number) =>
      replayResult({ currentSequence: sequence, targetSequence: sequence, state: frame(sequence) }),
    ),
    verify: vi.fn(),
    continueBestEffort: vi.fn(),
  }
  const controller = new ReplayController({
    createEngine: vi.fn(async () => engine),
    wait: async () => undefined,
  })

  await controller.start(2)
  await vi.waitFor(() => expect(controller.getState().status).toBe("completed"))
  await controller.stepBackward()
  expect(controller.getState().frame?.sequence).toBe(1)
  await controller.stepForward()
  expect(controller.getState().frame?.sequence).toBe(2)
})

it("clears the old frame when a new replay cannot start", async () => {
  const engine = {
    getState: vi.fn(() => frame(0)),
    step: vi.fn(async () =>
      replayResult({ currentSequence: 1, targetSequence: 1, state: frame(1) }),
    ),
    runTo: vi.fn(),
    verify: vi.fn(),
    continueBestEffort: vi.fn(),
  }
  const createEngine = vi
    .fn()
    .mockResolvedValueOnce(engine)
    .mockRejectedValueOnce(new Error("bundle integrity failed"))
  const controller = new ReplayController({ createEngine, wait: async () => undefined })

  await controller.start(1)
  await vi.waitFor(() => expect(controller.getState().frame?.sequence).toBe(1))
  await controller.start(2)

  expect(controller.getState()).toMatchObject({
    active: false,
    status: "idle",
    error: "bundle integrity failed",
  })
  expect(controller.getState()).not.toHaveProperty("frame")
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run packages/editor/test/replay-controller.test.ts -t "pauses between frames"`  
Expected: FAIL，`pause()` 尚不存在。

- [ ] **Step 3: 实现控制接口**

为 `ReplayControllerPort` 增加：

```ts
pause(): ReplayControllerState
resume(): Promise<ReplayControllerState>
```

`pause()` 增加 generation 并发布保留当前 `frame` 的 paused 状态；`resume()` 使用现有 engine 和 target 重新进入逐帧循环。所有异步 step/wait 返回后先比较 generation，`stop()` 必须增加 generation、清空 engine 和 frame。

使用以下控制边界；`resume()` 与 `start()` 一样只负责启动后台循环并立即返回当前状态：

```ts
pause(): ReplayControllerState {
  if (!this.#state.active || this.#state.status !== "running") return this.getState()
  this.#generation += 1
  return this.#publish({ ...this.#state, status: "paused" })
}

async resume(): Promise<ReplayControllerState> {
  const target = this.#state.targetSequence
  if (!this.#state.active || this.#engine === undefined || target === undefined) {
    throw new Error("REPLAY_NOT_ACTIVE")
  }
  if (this.#state.status === "running") return this.getState()
  const generation = ++this.#generation
  this.#publishRunning()
  void this.#playTo(generation, target).catch((error) => this.#recoverFromError(generation, error))
  return this.getState()
}
```

新增必需接口方法后，同步更新测试中的三个 `ReplayControllerPort` 对象 stub：`output-replay-bar.test.ts` 的 `createController()` 以及 `workspace-panels.test.ts` 中两个显式标注为 `ReplayControllerPort` 的对象都加入：

```ts
pause: vi.fn(() => state),
resume: vi.fn(async () => state),
```

这三个 stub 都已有名为 `state` 的固定或可变 `ReplayControllerState`，直接返回该变量；不要用类型断言绕过缺失方法。

- [ ] **Step 4: 运行测试**

Run: `bunx vitest run packages/editor/test/replay-controller.test.ts packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-panels.test.ts && bun run typecheck`  
Expected: 三个测试文件 PASS，typecheck exit 0。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/workspace/replay-controller.ts packages/editor/test/replay-controller.test.ts packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-panels.test.ts
git commit -m "feat(editor): control replay playback"
```

### Task 4: 为 EditorView 增加只读预览源

**Files:**

- Modify: `packages/editor/src/editor-view.ts`
- Test: `packages/editor/test/editor-view.test.ts`

- [ ] **Step 1: 写预览显示和恢复的失败测试**

在 `editor-view.test.ts` 使用现有编辑器 fixture，创建一个可发布预览的测试源：

```ts
function createTestPreviewSource() {
  let state: EditorPreviewFrame = { active: false }
  const listeners = new Set<(frame: EditorPreviewFrame) => void>()
  return {
    getState: () => structuredClone(state),
    subscribe(listener: (frame: EditorPreviewFrame) => void) {
      listeners.add(listener)
      listener(structuredClone(state))
      return () => listeners.delete(listener)
    },
    publish(next: EditorPreviewFrame) {
      state = structuredClone(next)
      for (const listener of listeners) listener(structuredClone(state))
    },
  }
}

function movedDocument(editor: ReturnType<typeof createEditor>): PageDocument {
  const previewEditor = createEditor(canonicalizeDocument(editor.getStore()))
  previewEditor.dispatch({
    id: "node.move",
    payload: { ids: ["node-blue"], delta: { x: 40, y: 30 } },
  })
  return canonicalizeDocument(previewEditor.getStore())
}

it("renders a read-only preview document and restores the source document", () => {
  const root = document.createElement("div")
  const editor = createEditor(createDocumentWithPage())
  addRectangle(editor, { id: "node-blue", x: 400, y: 200 })
  const session = new EditorSession()
  const preview = createTestPreviewSource()
  const mounted = mountEditor(root, editor, { pageId: "page-1", view: "canvas", preview })
  const original = editor.getRecord("node-blue")

  preview.publish({
    active: true,
    currentSequence: 7,
    targetSequence: 9,
    document: movedDocument(editor),
    session: session.getState(),
  })
  const previewNode = root.querySelector<HTMLElement>("[data-node-id='node-blue']")!
  expect(previewNode.style.left).toBe("440px")
  expect(previewNode.style.top).toBe("230px")
  expect(root.querySelector("[data-testid='replay-canvas-banner']")?.textContent).toContain(
    "当前 #7",
  )
  previewNode.dispatchEvent(pointerEvent("pointerdown", 410, 210))
  window.dispatchEvent(pointerEvent("pointermove", 450, 240))
  window.dispatchEvent(pointerEvent("pointerup", 450, 240))
  expect(editor.getRecord("node-blue")).toEqual(original)

  preview.publish({ active: false })
  const restoredNode = root.querySelector<HTMLElement>("[data-node-id='node-blue']")!
  expect(restoredNode.style.left).toBe("400px")
  expect(restoredNode.style.top).toBe("200px")
  expect(root.querySelector("[data-testid='replay-canvas-banner']")).toBeNull()
  mounted.destroy()
})
```

复用该测试文件已有的 `createDocumentWithPage`、`addRectangle` 和 `pointerEvent`，不另建第二套 fixture。

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run packages/editor/test/editor-view.test.ts -t "renders a read-only preview"`  
Expected: FAIL，`MountEditorOptions.preview` 不存在。

- [ ] **Step 3: 定义通用预览接口并实现渲染切换**

在 `editor-view.ts` 定义与 operation-log 解耦的接口：

```ts
import { createEditor } from "@composeui/core"
import type { PageDocument } from "@composeui/core"

export interface EditorPreviewFrame {
  active: boolean
  document?: PageDocument
  session?: EditorSessionState
  currentSequence?: number
  targetSequence?: number
}

export interface EditorPreviewSource {
  getState(): EditorPreviewFrame
  subscribe(listener: (frame: EditorPreviewFrame) => void): () => void
}

export interface MountEditorOptions {
  pageId: string
  session?: EditorSession
  view?: "combined" | "canvas"
  preview?: EditorPreviewSource
}
```

订阅预览源。激活时用 `createEditor(frame.document).getStore()` 更新现有 `CanvasView`，使用 frame session 更新视口和选择；设置 `shell.dataset.replay = "true"` 并渲染 `data-testid="replay-canvas-banner"`。原 Editor/Session 的订阅在预览激活时不得覆盖画面。预览关闭时重新读取原 store 和 session state。销毁时取消预览订阅。

切换入口保持单一：

```ts
const banner = document.createElement("div")
banner.className = "composeui-editor__replay-canvas-banner"
banner.dataset.testid = "replay-canvas-banner"
let previewFrame: EditorPreviewFrame = options.preview?.getState() ?? { active: false }

const renderPreview = (next: EditorPreviewFrame): void => {
  activeInteraction?.cancel()
  previewFrame = structuredClone(next)
  shell.dataset.replay = String(next.active)
  banner.remove()
  if (!next.active || next.document === undefined) {
    currentStore = coreEditor.getStore()
    sessionState = session.getState()
  } else {
    currentStore = createEditor(next.document).getStore()
    if (next.session !== undefined) sessionState = structuredClone(next.session)
    banner.textContent = `回放模式 · 当前 #${next.currentSequence ?? "-"} / 目标 #${next.targetSequence ?? "-"}`
    workspace.append(banner)
  }
  const page = currentStore.get(options.pageId)
  if (page?.typeName !== "page") return
  canvas.update(currentStore, page, true)
  updateViewport()
  renderSelectionOverlay(overlay, currentStore, canvas.visibleNodes, sessionState)
}

const unsubscribePreview = options.preview?.subscribe(renderPreview)
```

把这段代码放在 `activeInteraction` 声明之后，并在 `destroy()` 中调用 `unsubscribePreview?.()`。`renderPreview()` 开头取消当前交互，防止正常拖动进行中切入回放后仍提交。增加统一判断：

```ts
const isPreviewActive = (): boolean => previewFrame.active
```

在 `startPointerInteraction`、`startGroupResizeInteraction`、`onBoardPointerDown`、`startWorkspacePan`、`startMarqueeSelection`、`onWorkspacePointerDown`、`onWorkspaceWheel`、`onWindowKeyDown` 和 `onShellKeyDown` 的第一行执行 `if (isPreviewActive()) return`。`onCoreChange` 与 `onSessionChange` 在预览激活时也直接返回，避免源订阅覆盖回放画面；预览关闭时由 `renderPreview({ active: false })` 主动重新读取源 store/session 并恢复。不要向原 Editor 或 Session dispatch。

- [ ] **Step 4: 运行 EditorView 测试**

Run: `bunx vitest run packages/editor/test/editor-view.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/editor-view.ts packages/editor/test/editor-view.test.ts
git commit -m "feat(editor): render read-only replay previews"
```

### Task 5: 将 ReplayController 适配到 Canvas 面板

**Files:**

- Create: `packages/editor/src/workspace/replay-preview-source.ts`
- Create: `packages/editor/test/replay-preview-source.test.ts`
- Modify: `packages/editor/src/workspace/types.ts`
- Modify: `packages/editor/src/workspace/editor-workspace.ts`
- Modify: `packages/editor/src/workspace/panels.ts`

- [ ] **Step 1: 写状态映射失败测试**

```ts
const replayFrame = (sequence: number) => ({
  sequence,
  document: createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
  session: new EditorSession().getState(),
  workspace: {},
})

type ReplayControllerStub = ReplayControllerPort & {
  publish(next: ReplayControllerState): void
}

function createReplayControllerStub(initialState: ReplayControllerState): ReplayControllerStub {
  let state = initialState
  const listeners = new Set<(state: ReplayControllerState) => void>()
  return {
    start: vi.fn(async () => state),
    pause: vi.fn(() => state),
    resume: vi.fn(async () => state),
    stepBackward: vi.fn(async () => state),
    stepForward: vi.fn(async () => state),
    runTo: vi.fn(async () => state),
    verify: vi.fn(async () => state),
    continueBestEffort: vi.fn(async () => state),
    stop: vi.fn(),
    getState: () => structuredClone(state),
    subscribe(listener: (state: ReplayControllerState) => void) {
      listeners.add(listener)
      listener(structuredClone(state))
      return () => listeners.delete(listener)
    },
    publish(next: ReplayControllerState) {
      state = structuredClone(next)
      for (const listener of listeners) listener(structuredClone(state))
    },
  }
}

it("maps active replay frames and clears the canvas when replay stops", () => {
  const controller = createReplayControllerStub({
    active: false,
    status: "idle",
    deterministic: true,
  })
  const source = createReplayPreviewSource(controller)
  const frames: EditorPreviewFrame[] = []
  const unsubscribe = source.subscribe((frame) => frames.push(frame))

  controller.publish({
    active: true,
    status: "running",
    deterministic: true,
    currentSequence: 1,
    targetSequence: 3,
    frame: replayFrame(1),
  })
  controller.publish({ active: false, status: "idle", deterministic: true })

  expect(frames.at(-2)).toMatchObject({ active: true, currentSequence: 1, targetSequence: 3 })
  expect(frames.at(-1)).toEqual({ active: false })
  unsubscribe()
  source.dispose()
})

it("omits malformed replay session state", () => {
  const controller = createReplayControllerStub({
    active: true,
    status: "paused",
    deterministic: true,
    currentSequence: 1,
    targetSequence: 1,
    frame: { ...replayFrame(1), session: { selection: "not-an-array" } },
  })
  const source = createReplayPreviewSource(controller)

  expect(source.getState()).toMatchObject({ active: true, currentSequence: 1 })
  expect(source.getState()).not.toHaveProperty("session")
  source.dispose()
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run packages/editor/test/replay-preview-source.test.ts`  
Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现适配器并连接面板**

`createReplayPreviewSource(controller)` 在 `state.active` 后立即发布 `{ active: true }`，即使引擎仍在加载且尚无 frame，也先锁住源画布；frame 到达后再附加文档。新增本地 `isEditorSessionState(value: unknown)`，逐项验证：`viewport.x/y/zoom` 是有限数且 zoom 大于 0，`selection/expanded` 是 string array，`hoveredId` 是 string 或 null，`gridVisible` 是 boolean，`interactionMode` 是 `select | pan`。非法状态时省略 session，不使用类型断言。适配器实现 `EditorPreviewSource`，并额外提供幂等的 `dispose()`；`dispose()` 解除 Controller 订阅、清空 listener 集合，之后不再发布帧。

映射函数保持无副作用：

```ts
function toPreviewFrame(state: ReplayControllerState): EditorPreviewFrame {
  if (!state.active) return { active: false }
  const metadata = {
    active: true,
    ...(state.currentSequence === undefined ? {} : { currentSequence: state.currentSequence }),
    ...(state.targetSequence === undefined ? {} : { targetSequence: state.targetSequence }),
  }
  if (state.frame === undefined) return metadata
  return {
    ...metadata,
    document: structuredClone(state.frame.document),
    currentSequence: state.currentSequence ?? state.frame.sequence,
    ...(isEditorSessionState(state.frame.session)
      ? { session: structuredClone(state.frame.session) }
      : {}),
  }
}
```

适配器发布与销毁逻辑使用固定接口：

```ts
export interface ReplayPreviewSource extends EditorPreviewSource {
  dispose(): void
}

export function createReplayPreviewSource(controller: ReplayControllerPort): ReplayPreviewSource {
  let current = toPreviewFrame(controller.getState())
  let disposed = false
  const listeners = new Set<(frame: EditorPreviewFrame) => void>()
  const unsubscribeController = controller.subscribe((state) => {
    if (disposed) return
    current = toPreviewFrame(state)
    for (const listener of [...listeners]) listener(structuredClone(current))
  })
  return {
    getState: () => structuredClone(current),
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      listener(structuredClone(current))
      return () => listeners.delete(listener)
    },
    dispose() {
      if (disposed) return
      disposed = true
      unsubscribeController()
      listeners.clear()
    },
  }
}
```

在 `WorkspaceContext` 增加可选的 `preview?: EditorPreviewSource`：

```ts
import type { EditorPreviewSource } from "../editor-view"

export interface WorkspaceContext {
  editor: Editor
  session: EditorSession
  pageId: string
  api: WorkspaceCommandApi
  resources?: WorkspaceResourceService
  operationLog?: OperationLogControllerPort
  preview?: EditorPreviewSource
  emit: (event: WorkspaceEvent) => void
}
```

`editor-workspace.ts` 只在创建 Canvas renderer 时构造一次预览源，将实例传给 Canvas context，并在 panel disposer 中最后调用 `preview.dispose()`：

```ts
const replayController = options.operationLog?.replayController
const preview =
  descriptor.id === CANVAS && replayController !== undefined
    ? createReplayPreviewSource(replayController)
    : undefined
const context: WorkspaceContext = {
  editor,
  session,
  pageId,
  api: contextApi,
  emit: emitContextEvent,
  ...(preview === undefined ? {} : { preview }),
  ...(options.resources === undefined ? {} : { resources: options.resources }),
  ...(options.operationLog === undefined ? {} : { operationLog: options.operationLog }),
}
```

在 `createCanvasPanel()` 中只消费 context，不再创建第二个 Controller 订阅：

```ts
const mounted = mountEditor(root, context.editor, {
  pageId: context.pageId,
  session: context.session,
  view: "canvas",
  ...(context.preview === undefined ? {} : { preview: context.preview }),
})
return () => mounted.destroy()
```

- [ ] **Step 4: 运行适配器和面板测试**

Run: `bunx vitest run packages/editor/test/replay-preview-source.test.ts packages/editor/test/workspace-panels.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/workspace/replay-preview-source.ts packages/editor/test/replay-preview-source.test.ts packages/editor/src/workspace/types.ts packages/editor/src/workspace/editor-workspace.ts packages/editor/src/workspace/panels.ts
git commit -m "feat(editor): project replay state onto canvas"
```

### Task 6: 更新回放控制条和画布样式

**Files:**

- Modify: `packages/editor/src/workspace/output-replay-bar.ts`
- Modify: `packages/editor/src/workspace/toolbar.ts`
- Modify: `packages/editor/src/workspace/editor-workspace.ts`
- Modify: `packages/editor/src/workspace/workspace.css`
- Test: `packages/editor/test/output-replay-bar.test.ts`
- Test: `packages/editor/test/workspace-toolbar.test.ts`

- [ ] **Step 1: 写暂停/继续控制失败测试**

```ts
it("shows pause while playing and resume while paused", () => {
  const root = document.createElement("div")
  const running = createController({ active: true, status: "running", deterministic: true })
  const mount = mountOutputReplayBar(root, {
    controller: running,
    getSelectedSequence: () => 8,
    onError: vi.fn(),
    model: { busy: false },
  })
  root.querySelector<HTMLButtonElement>("[data-testid='replay-pause']")!.click()
  expect(running.pause).toHaveBeenCalledOnce()

  running.publish({ active: true, status: "paused", deterministic: true })
  root.querySelector<HTMLButtonElement>("[data-testid='replay-resume']")!.click()
  expect(running.resume).toHaveBeenCalledOnce()
  mount.dispose()
})

it("locks source-session toolbar actions while preview is active", () => {
  const context = createToolbarContext()
  const root = document.createElement("div")
  let frame: EditorPreviewFrame = { active: true }
  const listeners = new Set<(next: EditorPreviewFrame) => void>()
  const preview: EditorPreviewSource = {
    getState: () => frame,
    subscribe(listener) {
      listeners.add(listener)
      listener(frame)
      return () => listeners.delete(listener)
    },
  }
  mountWorkspaceToolbar(root, {
    ...context,
    panels: [],
    preview,
  })

  for (const id of ["select", "pan", "grid", "undo", "redo"]) {
    expect(
      root.querySelector<HTMLButtonElement>(`[data-testid='workspace-tool-${id}']`)?.disabled,
    ).toBe(true)
  }
  root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-pan']")!.click()
  expect(context.session.getState().interactionMode).toBe("select")

  frame = { active: false }
  for (const listener of listeners) listener(frame)
  expect(
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-pan']")?.disabled,
  ).toBe(false)
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run packages/editor/test/output-replay-bar.test.ts -t "shows pause"`  
Expected: FAIL，暂停和恢复按钮不存在。

- [ ] **Step 3: 实现控制条与主题化样式**

使用 Task 3 已补齐的 Controller stub。运行中只保留可用的“暂停”和“停止”；用户暂停后显示“继续自动播放、上一步、下一步、验证、停止”；到达目标后显示“上一步、下一步、验证、停止”。差异状态继续使用独立的“忽略差异并继续”命令，不与普通恢复混用。使用 Lucide `Pause` 和 `Play`，保留图标按钮和 tooltip。

不要继续沿用 `state.status === "running"` 即禁用全部按钮的旧逻辑。按状态显式组装控制项：

```ts
if (state.status === "running") {
  controls.append(
    action("replay-pause", "暂停", Pause, "pause", () => options.controller.pause(), model.busy),
    action("replay-stop", "停止", Square, "square", () => options.controller.stop(), false),
  )
} else {
  if (state.status === "paused" && state.difference === undefined) {
    controls.append(
      action("replay-resume", "继续自动播放", Play, "play", () => options.controller.resume()),
    )
  }
  controls.append(
    action("replay-step-backward", "上一步", StepBack, "step-back", () =>
      options.controller.stepBackward(),
    ),
    action("replay-step-forward", "下一步", StepForward, "step-forward", () =>
      options.controller.stepForward(),
    ),
    action("replay-verify", "验证", BadgeCheck, "badge-check", () => options.controller.verify()),
  )
  if (!state.deterministic) {
    controls.append(
      action("replay-continue", "忽略差异并继续", FastForward, "fast-forward", () =>
        options.controller.continueBestEffort(),
      ),
    )
  }
  controls.append(
    action("replay-stop", "停止", Square, "square", () => options.controller.stop(), false),
  )
}
```

`WorkspaceToolbarOptions` 增加 `preview?: EditorPreviewSource`。Toolbar 保存 `preview?.getState().active ?? false`，订阅 preview 后在 `render()` 中设置 `select`、`pan`、`grid`、`undo` 和 `redo` 的 disabled 状态；每个 click handler 也先检查 read-only，避免脚本触发 disabled button 时执行命令：

```ts
let readOnly = options.preview?.getState().active ?? false

const render = (): void => {
  const state = options.session.getState()
  setPressed(select, state.interactionMode === "select")
  setPressed(pan, state.interactionMode === "pan")
  setPressed(grid, state.gridVisible)
  select.disabled = readOnly
  pan.disabled = readOnly
  grid.disabled = readOnly
  undo.disabled = readOnly || !options.editor.canUndo()
  redo.disabled = readOnly || !options.editor.canRedo()
}

const unsubscribePreview = options.preview?.subscribe((frame) => {
  readOnly = frame.active
  render()
})
```

在 Canvas renderer 调用 `mountWorkspaceToolbar()` 时传入 Task 5 创建的 `preview`；toolbar disposer 中调用 `unsubscribePreview?.()`。工具选择、网格、撤销和重做 handler 均以 `if (readOnly) return` 开头。

在 `workspace.css` 使用现有主题 token 添加：

```css
.composeui-editor__replay-canvas-banner {
  position: absolute;
  inset: 8px auto auto 50%;
  z-index: 5;
  transform: translateX(-50%);
  border: 1px solid var(--composeui-border-strong);
  background: var(--composeui-surface-panel-raised);
  color: var(--composeui-text-primary);
  padding: 4px 10px;
  pointer-events: none;
}

.composeui-editor[data-replay="true"] .composeui-editor__workspace {
  cursor: default;
}
```

不要新增硬编码主题色。

- [ ] **Step 4: 运行控制条测试**

Run: `bunx vitest run packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-toolbar.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/workspace/output-replay-bar.ts packages/editor/src/workspace/toolbar.ts packages/editor/src/workspace/editor-workspace.ts packages/editor/src/workspace/workspace.css packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-toolbar.test.ts
git commit -m "feat(editor): add visible replay controls"
```

### Task 7: 修复日志选中后的滚动跳动

**Files:**

- Modify: `packages/editor/src/workspace/output-panel.ts`
- Modify: `packages/editor/src/workspace/workspace.css`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: 写滚动保持失败测试**

```ts
const operationEvents = (count: number): OperationEvent[] =>
  Array.from({ length: count }, (_, index) =>
    operationEvent({ eventId: `event-${index + 1}`, sequence: index + 1 }),
  )

it("keeps the selected history row anchored while new events arrive", async () => {
  let rows = operationEvents(30)
  const listeners = new Set<(state: OperationLogControllerState) => void>()
  const operationLog = {
    ...fakeOperationLogController(rows),
    query: vi.fn(async () => rows),
    subscribe(listener: (state: OperationLogControllerState) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    publish(nextRows: OperationEvent[]) {
      rows = nextRows
      const state: OperationLogControllerState = {
        rows,
        query: { levels: [], categories: [], search: "" },
        filter: {},
      }
      for (const listener of listeners) listener(state)
    },
  }
  const root = document.createElement("div")
  const dispose = panel("output").mount(root, createContext(undefined, operationLog))
  await vi.waitFor(() =>
    expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(30),
  )
  const list = root.querySelector<HTMLElement>("[data-testid='output-list']")!
  Object.defineProperties(list, {
    scrollHeight: { configurable: true, value: 900 },
    clientHeight: { configurable: true, value: 200 },
  })
  list.scrollTop = 320
  root.querySelectorAll<HTMLElement>("[data-testid='output-entry']")[5]!.click()
  operationLog.publish(operationEvents(32))

  expect(list.scrollTop).toBe(320)
  expect(root.querySelector("[data-testid='output-new-entries']")?.textContent).toContain(
    "新增 2 条",
  )
  root.querySelector<HTMLButtonElement>("[data-testid='output-new-entries']")!.click()
  expect(list.scrollTop).toBe(900)
  expect(root.querySelector("[data-testid='output-new-entries']")).toBeNull()
  dispose?.()
})
```

- [ ] **Step 2: 运行并确认失败**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts -t "keeps the selected history row"`  
Expected: FAIL，点击后 `scrollTop` 变为列表底部且无新增入口。

- [ ] **Step 3: 实现阅读历史状态**

在 `output-panel.ts` 增加：

```ts
let unseenCount = 0
let lastRenderedMaximumSequence = 0

const enterHistoryReading = (): void => {
  autoScroll = false
}

const scrollToLatest = (): void => {
  autoScroll = true
  unseenCount = 0
  list.scrollTop = list.scrollHeight
  renderToolbar()
  renderNewEntries()
}
```

创建一个位于列表右下方的 `newEntries` button，`data-testid="output-new-entries"`，文本为 `新增 ${unseenCount} 条 · 回到底部`，`unseenCount === 0` 时从 DOM 移除。`renderRows` 在替换 DOM 前保存滚动位置，并用序号差集更新计数：

```ts
const previousScrollTop = list.scrollTop
const nextMaximumSequence = Math.max(0, ...latestRows.map((event) => event.sequence))
if (!autoScroll && nextMaximumSequence > lastRenderedMaximumSequence) {
  unseenCount += latestRows.filter(
    (event) =>
      event.sequence > lastRenderedMaximumSequence && event.sequence <= nextMaximumSequence,
  ).length
}
lastRenderedMaximumSequence = Math.max(lastRenderedMaximumSequence, nextMaximumSequence)
```

上述计算放在 `latestRows` 赋值之后、`list.replaceChildren()` 之前；现有行创建循环结束后执行 `if (autoScroll) list.scrollTop = list.scrollHeight`，否则执行 `list.scrollTop = previousScrollTop`，最后调用 `renderNewEntries()`。日志行点击先调用 `enterHistoryReading()` 再重绘。新增入口点击调用 `scrollToLatest()`。工具栏显式重新开启自动滚动时也调用 `scrollToLatest()`；关闭时只设置 `autoScroll = false` 并刷新 toolbar。

订阅 ReplayController 状态并保存 `replayCurrentSequence`；对应日志行设置 `data-replay-current="true"`。当前回放序号只改变高亮属性，不调用 `scrollIntoView`。保存 `unsubscribeReplayRows`，在 panel disposer 中与现有 controller、replay bar 和 toolbar 订阅一起解除。测试同时断言帧更新后旧的 `scrollTop` 保持不变。

在 `workspace.css` 使用现有 token 增加：

```css
.composeui-editor__output-new-entries {
  align-self: end;
  background: var(--composeui-surface-panel-raised);
  border: 1px solid var(--composeui-border-strong);
  border-radius: var(--composeui-radius-control);
  box-shadow: var(--composeui-shadow-control);
  color: var(--composeui-text-primary);
  cursor: pointer;
  grid-column: 1;
  grid-row: 1;
  justify-self: center;
  margin-bottom: var(--composeui-space-2);
  min-height: var(--composeui-icon-button-size);
  padding: 0 var(--composeui-space-3);
  z-index: 3;
}

.composeui-editor__output-entry[data-replay-current="true"] {
  background: var(--composeui-output-row-selected);
  box-shadow: inset 3px 0 var(--composeui-accent-primary);
  color: var(--composeui-text-primary);
}
```

- [ ] **Step 4: 运行输出面板测试**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts packages/editor/test/output-toolbar.test.ts`  
Expected: PASS。

- [ ] **Step 5: 提交**

```bash
git add packages/editor/src/workspace/output-panel.ts packages/editor/src/workspace/workspace.css packages/editor/test/workspace-panels.test.ts
git commit -m "fix(editor): keep operation log reading position"
```

### Task 8: 完整可见回放 E2E

**Files:**

- Modify: `tests/editor-workspace.spec.ts`

- [ ] **Step 1: 扩展现有 pointer-driven E2E**

在现有 `replays a pointer-driven node move through the persisted operation bundle` 中，用以下代码替换当前选择日志并启动回放的代码块。只使用 DOM 状态等待，不增加固定 sleep：

```ts
const list = page.getByTestId("output-list")
const eventCountBeforeReplay = await page.getByTestId("output-entry").count()
await moveEntry.evaluate((row) => {
  const list = row.closest<HTMLElement>("[data-testid='output-list']")
  if (list === null) throw new Error("OUTPUT_LIST_MISSING")
  list.scrollTop = 100
  ;(row as HTMLElement).click()
})
await expect.poll(() => list.evaluate((element) => element.scrollTop)).toBe(100)
await page.getByTestId("output-replay").click()

await expect(page.getByTestId("replay-canvas-banner")).toContainText("回放模式")
await expect(page.locator("[data-node-id='node-blue']")).toHaveCSS(
  "left",
  `${beforePosition.left}px`,
)
await expect(page.locator("[data-node-id='node-blue']")).toHaveCSS(
  "left",
  `${beforePosition.left + 40}px`,
)
await expect(page.getByTestId("replay-summary")).toContainText("状态：completed")
await expect(page.getByTestId("output-entry")).toHaveCount(eventCountBeforeReplay)

await page.getByTestId("replay-stop").click()
await expect(page.getByTestId("replay-canvas-banner")).toHaveCount(0)
await expect(page.locator("[data-node-id='node-blue']")).toHaveCSS(
  "left",
  `${beforePosition.left}px`,
)
```

- [ ] **Step 2: 运行 pointer-driven E2E**

Run: `bunx playwright test tests/e2e/editor-workspace.spec.ts --grep "pointer-driven"`  
Expected: 1 test PASS；先观察到检查点位置，再观察到目标位置，停止后恢复源位置。

- [ ] **Step 3: 运行完整 Workspace E2E**

Run: `bunx playwright test tests/e2e/editor-workspace.spec.ts`  
Expected: 3 tests PASS。

- [ ] **Step 4: 提交**

```bash
git add tests/editor-workspace.spec.ts
git commit -m "test(editor): cover visible operation replay"
```

### Task 9: 全量验证

**Files:**

- No production changes expected.

- [ ] **Step 1: 格式化本计划涉及文件**

```bash
bunx oxfmt --write \
  packages/operation-log/src/replay/engine.ts \
  packages/operation-log/test/replay-engine.test.ts \
  packages/editor/src/editor-view.ts \
  packages/editor/src/workspace/replay-controller.ts \
  packages/editor/src/workspace/replay-preview-source.ts \
  packages/editor/src/workspace/types.ts \
  packages/editor/src/workspace/editor-workspace.ts \
  packages/editor/src/workspace/panels.ts \
  packages/editor/src/workspace/toolbar.ts \
  packages/editor/src/workspace/output-replay-bar.ts \
  packages/editor/src/workspace/output-panel.ts \
  packages/editor/test/editor-view.test.ts \
  packages/editor/test/replay-controller.test.ts \
  packages/editor/test/replay-preview-source.test.ts \
  packages/editor/test/output-replay-bar.test.ts \
  packages/editor/test/workspace-toolbar.test.ts \
  packages/editor/test/workspace-panels.test.ts \
  tests/editor-workspace.spec.ts
```

- [ ] **Step 2: 运行静态检查和单元测试**

Run: `bun run lint && bun run typecheck && bun run test`  
Expected: lint 0 warnings，typecheck exit 0，全部 Vitest tests PASS。

- [ ] **Step 3: 运行黄金测试、E2E 和构建**

Run: `bun run test:golden && bunx playwright test tests/e2e/editor-workspace.spec.ts && bun run build`  
Expected: golden tests PASS，3 E2E PASS，所有 workspace builds exit 0。

- [ ] **Step 4: 检查工作区范围**

Run: `git status --short && git diff --check`  
Expected: 没有意外文件和 whitespace errors；保留任务开始前已有的用户改动，不纳入本功能提交。
