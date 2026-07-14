# Operation Log Output Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crowded Output toolbar with a contextual, accessible toolbar that keeps log browsing primary and reveals filtering, data management, and replay controls only when relevant.

**Architecture:** Keep `output-panel.ts` responsible for querying, rows, selection, details, and controller wiring. Add a focused `output-toolbar.ts` DOM component for search/filter/more interactions and an `output-replay-bar.ts` component for replay state and commands. Use container queries for Dockview-width adaptation, preserve existing operation-log controller ports, and drive all behavior through explicit render models and callbacks.

**Tech Stack:** TypeScript, DOM APIs, Lucide, CSS container queries, Vitest with jsdom, Playwright.

---

## File Structure

- Create `packages/editor/src/workspace/output-toolbar.ts`: toolbar model, search, filter popover, more menu, keyboard behavior, hidden import input, and lifecycle cleanup.
- Create `packages/editor/src/workspace/output-replay-bar.ts`: isolated replay status, controls, difference rendering, and asynchronous action state.
- Modify `packages/editor/src/workspace/output-panel.ts`: retain list/details/query orchestration and wire the two new UI components to existing controllers.
- Modify `packages/editor/src/workspace/workspace.css`: contextual toolbar, popup, menu, replay bar, and container-responsive rules using existing theme tokens.
- Create `packages/editor/test/output-toolbar.test.ts`: focused toolbar DOM, filter, menu, keyboard, and state tests.
- Create `packages/editor/test/output-replay-bar.test.ts`: focused replay state and command tests.
- Modify `packages/editor/test/workspace-panels.test.ts`: integration tests for controller wiring, selection, import/export, clear, and replay.
- Modify `packages/editor/test/workspace-styles.test.ts`: structural assertions for no toolbar overflow and container breakpoints.
- Modify `tests/e2e/m1-editor-spine.spec.ts`: browser verification for the default, selected, filter, and responsive Output states.

---

### Task 1: Introduce the contextual toolbar shell

**Files:**
- Create: `packages/editor/src/workspace/output-toolbar.ts`
- Create: `packages/editor/test/output-toolbar.test.ts`
- Modify: `packages/editor/src/workspace/output-panel.ts`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Write failing toolbar state tests**

Create `packages/editor/test/output-toolbar.test.ts` with a jsdom suite that mounts the toolbar through an explicit model:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { mountOutputToolbar } from "../src/workspace/output-toolbar"

const actions = () => ({
  onSearch: vi.fn(),
  onFilterChange: vi.fn(),
  onResetFilters: vi.fn(),
  onAutoScrollChange: vi.fn(),
  onImport: vi.fn(),
  onExport: vi.fn(),
  onClearView: vi.fn(),
  onReplaySelected: vi.fn(),
})

const defaultModel = {
  levels: [],
  categories: [],
  search: "",
  autoScroll: true,
  selectedSequence: undefined,
  canReplaySelection: false,
  busyAction: undefined,
} as const

describe("output toolbar", () => {
  it("renders only the primary browsing controls by default", () => {
    const root = document.createElement("div")
    const mounted = mountOutputToolbar(root, actions())
    mounted.update({
      levels: [],
      categories: [],
      search: "",
      autoScroll: true,
      selectedSequence: undefined,
      canReplaySelection: false,
      busyAction: undefined,
    })

    expect(root.querySelector("[aria-label='搜索操作日志']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-filter-trigger']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-auto-scroll']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-more-trigger']")).not.toBeNull()
    expect(root.querySelector("[data-testid='output-replay']")).toBeNull()
    expect(root.querySelectorAll(".composeui-editor__output-toolbar-action")).toHaveLength(3)
  })

  it("shows one labeled replay action only for a replayable selection", () => {
    const root = document.createElement("div")
    const callbacks = actions()
    const mounted = mountOutputToolbar(root, callbacks)
    mounted.update({
      levels: [],
      categories: [],
      search: "",
      autoScroll: true,
      selectedSequence: 46,
      canReplaySelection: true,
      busyAction: undefined,
    })

    const replay = root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!
    expect(replay.textContent).toContain("回放到此处")
    replay.click()
    expect(callbacks.onReplaySelected).toHaveBeenCalledWith(46)
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts
```

Expected: FAIL because `../src/workspace/output-toolbar` does not exist.

- [ ] **Step 3: Add the toolbar model and mount contract**

Create `packages/editor/src/workspace/output-toolbar.ts` with these public internal types:

```ts
import type { OperationCategory, OperationStatus } from "@composeui/operation-log"

export type OutputToolbarBusyAction = "import" | "export" | "clear" | "replay"

export interface OutputToolbarModel {
  readonly levels: readonly OperationStatus[]
  readonly categories: readonly OperationCategory[]
  readonly search: string
  readonly autoScroll: boolean
  readonly selectedSequence: number | undefined
  readonly canReplaySelection: boolean
  readonly busyAction: OutputToolbarBusyAction | undefined
}

export interface OutputToolbarActions {
  onSearch(value: string): void
  onFilterChange(filter: {
    levels: readonly OperationStatus[]
    categories: readonly OperationCategory[]
  }): void
  onResetFilters(): void
  onAutoScrollChange(enabled: boolean): void
  onImport(file: File): void | Promise<void>
  onExport(): void | Promise<void>
  onClearView(): void
  onReplaySelected(sequence: number): void | Promise<void>
}

export interface MountedOutputToolbar {
  update(model: OutputToolbarModel): void
  dispose(): void
}

export function mountOutputToolbar(
  root: HTMLElement,
  actions: OutputToolbarActions,
): MountedOutputToolbar {
  let disposed = false
  let model: OutputToolbarModel = {
    levels: [],
    categories: [],
    search: "",
    autoScroll: true,
    selectedSequence: undefined,
    canReplaySelection: false,
    busyAction: undefined,
  }
  const toolbar = document.createElement("div")
  toolbar.className = "composeui-editor__output-toolbar"
  toolbar.dataset.testid = "output-toolbar"

  const search = document.createElement("input")
  search.type = "search"
  search.setAttribute("aria-label", "搜索操作日志")
  search.addEventListener("input", () => actions.onSearch(search.value))

  const filter = createLabeledButton("output-filter-trigger", "筛选", Filter)
  const autoScroll = createLabeledButton("output-auto-scroll", "自动滚动", ListEnd)
  autoScroll.classList.add("composeui-editor__output-auto-scroll-primary")
  autoScroll.addEventListener("click", () => actions.onAutoScrollChange(!model.autoScroll))
  const more = createIconButton("output-more-trigger", "更多操作", Ellipsis)
  toolbar.append(search, filter, autoScroll, more)
  root.replaceChildren(toolbar)

  const render = (): void => {
    search.value = model.search
    const count = model.levels.length + model.categories.length
    setButtonLabel(filter, count === 0 ? "筛选" : `筛选 ${count}`)
    autoScroll.setAttribute("aria-pressed", String(model.autoScroll))
    toolbar.querySelector("[data-testid='output-replay']")?.remove()
    if (model.canReplaySelection && model.selectedSequence !== undefined) {
      const sequence = model.selectedSequence
      const replay = createLabeledButton("output-replay", "回放到此处", Play)
      replay.classList.add("composeui-editor__output-replay-primary")
      replay.disabled = model.busyAction === "replay"
      replay.addEventListener("click", () => void actions.onReplaySelected(sequence))
      toolbar.insertBefore(replay, more)
    }
  }

  return {
    update(next) {
      if (disposed) return
      model = { ...next, levels: [...next.levels], categories: [...next.categories] }
      render()
    },
    dispose() {
      if (disposed) return
      disposed = true
      root.replaceChildren()
    },
  }
}
```

Implement `createLabeledButton`, `createIconButton`, and `setButtonLabel` directly above `mountOutputToolbar`. `createLabeledButton` appends a Lucide icon and one `.composeui-editor__output-button-label` span; `setButtonLabel` updates that span plus `aria-label` and `title`. The Filter and More triggers remain closed shell controls in this task; Tasks 2 and 3 attach their popup DOM and listeners. Store popup-level document listeners when those tasks add them, and remove them in the existing idempotent `dispose()` path.

- [ ] **Step 4: Wire toolbar state into the Output panel**

In `output-panel.ts`, replace direct `toolbar.append(...)` construction with:

```ts
const toolbarHost = document.createElement("div")
toolbarHost.className = "composeui-editor__output-toolbar-host"

const toolbar = mountOutputToolbar(toolbarHost, {
  onSearch(value) {
    search = value
    void refresh()
  },
  onFilterChange(filter) {
    levels = [...filter.levels]
    categories = [...filter.categories]
    void refresh()
  },
  onResetFilters() {
    levels = []
    categories = []
    void refresh()
  },
  onAutoScrollChange(enabled) {
    autoScroll = enabled
  },
  onImport: handleImport,
  onExport: handleExport,
  onClearView: clearCurrentView,
  onReplaySelected: startSelectedReplay,
})
```

Add one `renderToolbar()` function and call it after selection, query, auto-scroll, busy, and replay-relevant changes:

```ts
const renderToolbar = (): void => {
  toolbar.update({
    levels,
    categories,
    search,
    autoScroll,
    selectedSequence: selected?.sequence,
    canReplaySelection: selected !== undefined,
    busyAction,
  })
}
```

Move the current import/export/replay logic into named local handlers `handleImport`, `handleExport`, and `startSelectedReplay`; Task 3 connects the first two to the More menu and Task 4 replaces the old direct replay controls. Remove the ten old flat filter buttons and old replay buttons from the direct panel DOM.

- [ ] **Step 5: Add query retry and filtered-empty behavior**

Extend `workspace-panels.test.ts` with a controller whose first `query()` rejects and second call resolves. Assert that the panel shows `查询操作日志失败`, renders a labeled `output-query-retry` button, and shows rows after clicking it.

Add another test with an active filter and no rows:

```ts
expect(root.querySelector("[data-testid='output-empty-filtered']")?.textContent).toContain(
  "没有符合条件的日志",
)
root.querySelector<HTMLButtonElement>("[data-testid='output-reset-empty-filter']")!.click()
expect(operationLog.query).toHaveBeenLastCalledWith({ levels: [], categories: [], search: "" })
```

Change `refresh()` to report query failures rather than silently converting them to an ordinary empty list:

```ts
try {
  const rows = await controller.query({ levels, categories, search })
  if (disposed || generation !== queryGeneration) return
  clearError()
  renderRows(rows)
} catch (error) {
  if (disposed || generation !== queryGeneration) return
  showError("查询操作日志", error, () => void refresh())
}
```

Extend `showError` with an optional retry callback and append a text button labeled `重试`. When `latestRows` is empty and any query field is active, render `output-empty-filtered` with a `重置筛选` button; otherwise retain `暂无输出。`.

Add a click listener to the list background that clears `selected`, clears the details host, and rerenders the toolbar only when `event.target === list`. Row clicks must call `event.stopPropagation()` so selecting a row does not immediately clear it.

- [ ] **Step 6: Run focused integration tests**

Run:

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
```

Expected: PASS after updating old selectors in `workspace-panels.test.ts` to use the new contextual trigger and labeled replay action.

- [ ] **Step 7: Commit the toolbar shell**

```bash
git add packages/editor/src/workspace/output-toolbar.ts packages/editor/src/workspace/output-panel.ts packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
git commit -m "refactor(editor): add contextual output toolbar"
```

---

### Task 2: Replace flat filters with one accessible filter popover

**Files:**
- Modify: `packages/editor/src/workspace/output-toolbar.ts`
- Modify: `packages/editor/test/output-toolbar.test.ts`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Add failing filter popover tests**

Add tests that verify the trigger count, checkbox semantics, reset behavior, and focus restoration:

```ts
it("groups status and category filters in one popover", () => {
  const root = document.createElement("div")
  const callbacks = actions()
  const mounted = mountOutputToolbar(root, callbacks)
  mounted.update({
    levels: ["failed"],
    categories: ["document"],
    search: "",
    autoScroll: true,
    selectedSequence: undefined,
    canReplaySelection: false,
    busyAction: undefined,
  })

  const trigger = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!
  expect(trigger.textContent).toContain("筛选 2")
  trigger.click()

  const popover = root.querySelector<HTMLElement>("[data-testid='output-filter-popover']")!
  expect(popover.getAttribute("role")).toBe("dialog")
  expect(popover.querySelectorAll("input[type='checkbox']")).toHaveLength(10)

  const failed = popover.querySelector<HTMLInputElement>("[data-filter-level='failed']")!
  expect(failed.checked).toBe(true)
  failed.click()
  expect(callbacks.onFilterChange).toHaveBeenCalledWith({
    levels: [],
    categories: ["document"],
  })

  popover.querySelector<HTMLButtonElement>("[data-testid='output-filter-reset']")!.click()
  expect(callbacks.onResetFilters).toHaveBeenCalledOnce()
})

it("closes the filter popover with Escape and restores trigger focus", () => {
  const root = document.createElement("div")
  const mounted = mountOutputToolbar(root, actions())
  mounted.update(defaultModel)
  const trigger = root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!
  trigger.click()
  root.querySelector("[data-testid='output-filter-popover']")!.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  )
  expect(root.querySelector("[data-testid='output-filter-popover']")).toBeNull()
  expect(document.activeElement).toBe(trigger)
})
```

Add a keyboard test that focuses the first checkbox, presses ArrowDown and ArrowUp, and verifies focus moves through the ten filter options without closing the popover.

- [ ] **Step 2: Run tests and verify red state**

Run:

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts
```

Expected: FAIL because the trigger has no popover or checkboxes.

- [ ] **Step 3: Implement the filter popover**

Use the existing ordered constants and localized labels, moved from `output-panel.ts` into `output-toolbar.ts`:

```ts
const LEVELS: readonly OperationStatus[] = ["observed", "started", "succeeded", "failed"]
const CATEGORIES: readonly OperationCategory[] = [
  "document",
  "history",
  "session",
  "workspace",
  "diagnostic",
  "system",
]
```

Render one `role="dialog"` popover anchored inside the toolbar host. Each option is a native checkbox wrapped by a label. Toggle from the current model and call `onFilterChange` with complete arrays. Set `aria-expanded` and `aria-controls` on the trigger. Close on Escape, outside pointer-down, “完成”, or when another toolbar menu opens. Restore focus to the trigger for keyboard closure.

The controller uses an empty array to mean “all values”. Therefore an empty `levels` or `categories` array renders every checkbox checked. When the user unchecks one option from this default state, first expand the empty array to the complete constant list, then remove that option. When every option becomes checked again, normalize the array back to empty before calling `onFilterChange`.

Do not close after each checkbox click; users must be able to compose filters. Display the active count as `levels.length + categories.length`. Implement roving focus for ArrowDown/ArrowUp across the ten native checkboxes while retaining normal Tab behavior.

- [ ] **Step 4: Update integration assertions**

Replace direct clicks on `[data-testid='output-level-*']` and `[data-testid='output-category-*']` with:

```ts
root.querySelector<HTMLButtonElement>("[data-testid='output-filter-trigger']")!.click()
root.querySelector<HTMLInputElement>("[data-filter-level='failed']")!.click()
root.querySelector<HTMLInputElement>("[data-filter-category='document']")!.click()
```

Retain assertions against the exact controller query:

```ts
expect(operationLog.query).toHaveBeenLastCalledWith({
  levels: ["failed"],
  categories: ["document"],
  search: "",
})
```

- [ ] **Step 5: Verify and commit**

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
git add packages/editor/src/workspace/output-toolbar.ts packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
git commit -m "feat(editor): group output filters in a popover"
```

Expected: PASS.

---

### Task 3: Move data management into the More menu

**Files:**
- Modify: `packages/editor/src/workspace/output-toolbar.ts`
- Modify: `packages/editor/src/workspace/output-panel.ts`
- Modify: `packages/editor/test/output-toolbar.test.ts`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Add failing More menu tests**

Add a test proving low-frequency actions are absent from the default row and available with explicit labels in the menu:

```ts
it("places import, export, auto-scroll, and clear in the More menu", () => {
  const root = document.createElement("div")
  const callbacks = actions()
  const mounted = mountOutputToolbar(root, callbacks)
  mounted.update(defaultModel)

  expect(root.querySelector("[data-testid='output-import']")).toBeNull()
  expect(root.querySelector("[data-testid='output-export']")).toBeNull()
  expect(root.querySelector("[data-testid='output-clear']")).toBeNull()

  root.querySelector<HTMLButtonElement>("[data-testid='output-more-trigger']")!.click()
  const menu = root.querySelector<HTMLElement>("[data-testid='output-more-menu']")!
  expect(menu.getAttribute("role")).toBe("menu")
  expect(menu.textContent).toContain("导入日志")
  expect(menu.textContent).toContain("导出日志")
  expect(menu.textContent).toContain("自动滚动")
  expect(menu.textContent).toContain("清空当前视图")
})
```

Add keyboard assertions for ArrowDown, ArrowUp, Enter, Escape, and focus restoration. Add a test that opening More closes Filter and opening Filter closes More.

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts
```

Expected: FAIL because the More menu has no items.

- [ ] **Step 3: Implement the More menu and busy states**

Render a `role="menu"` with buttons using these exact labels and test IDs:

```text
output-import       导入日志
output-export       导出日志
output-menu-scroll  自动滚动：开|关
output-clear        清空当前视图
```

Use `FileInput`, `Download`, `ListEnd`, and `Eraser` Lucide icons. Keep the file input hidden and call `actions.onImport(file)` after selection. Clear its value after handling so selecting the same file again emits `change`.

Disable only the action matching `busyAction`; update its text to `正在导入…`, `正在导出…`, or `正在清空…`. Do not close the menu before a rejected async action can be announced by the panel error region.

- [ ] **Step 4: Add explicit clear confirmation in the panel**

Do not use `window.confirm`. On the first clear click, replace the menu item area with an inline confirmation:

```text
仅清空当前视图，持久化日志仍会保留。
[取消] [确认清空]
```

Expose the confirmation through toolbar model state:

```ts
export interface OutputToolbarModel {
  // existing fields
  readonly confirmClear: boolean
}
```

Add `onRequestClear`, `onCancelClear`, and `onConfirmClear` callbacks. Only `onConfirmClear` calls the existing `clearCurrentView()` logic. Closing the menu cancels confirmation.

- [ ] **Step 5: Preserve existing import/export failure behavior**

In `output-panel.ts`, wrap each asynchronous action with one shared helper:

```ts
const runToolbarAction = async (
  action: OutputToolbarBusyAction,
  label: string,
  operation: () => void | Promise<void>,
): Promise<void> => {
  if (busyAction !== undefined) return
  busyAction = action
  clearError()
  renderToolbar()
  try {
    await operation()
    clearError()
  } catch (error) {
    showError(label, error)
  } finally {
    busyAction = undefined
    renderToolbar()
  }
}
```

Retain the current Blob/data-URL download fallback and the existing import bundle call. Verify failed imports do not clear rows, selection, search, levels, or categories.

Add a successful-import assertion that the current live rows remain unchanged until the controller publishes a new session/view state. This preserves the current independent imported-session boundary rather than appending imported events directly into `latestRows`.

- [ ] **Step 6: Verify and commit**

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
git add packages/editor/src/workspace/output-toolbar.ts packages/editor/src/workspace/output-panel.ts packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
git commit -m "feat(editor): add output data management menu"
```

Expected: PASS.

---

### Task 4: Render replay as a contextual status and control bar

**Files:**
- Create: `packages/editor/src/workspace/output-replay-bar.ts`
- Create: `packages/editor/src/workspace/output-value-format.ts`
- Create: `packages/editor/test/output-replay-bar.test.ts`
- Modify: `packages/editor/src/workspace/output-panel.ts`
- Modify: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Write failing replay bar tests**

Create a focused jsdom suite:

```ts
// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { mountOutputReplayBar } from "../src/workspace/output-replay-bar"

describe("output replay bar", () => {
  it("stays hidden while replay is inactive", () => {
    const root = document.createElement("div")
    const mounted = mountOutputReplayBar(root, replayActions())
    mounted.update({
      active: false,
      status: "idle",
      deterministic: true,
      selectedSequence: undefined,
      busy: false,
    })
    expect(root.hidden).toBe(true)
  })

  it("labels each active replay command and hides best-effort until a difference exists", () => {
    const root = document.createElement("div")
    const mounted = mountOutputReplayBar(root, replayActions())
    mounted.update({
      active: true,
      status: "paused",
      deterministic: true,
      currentSequence: 18,
      targetSequence: 46,
      selectedSequence: 46,
      busy: false,
    })

    expect(root.textContent).toContain("回放至 #46")
    expect(root.textContent).toContain("当前 #18")
    expect(root.textContent).toContain("一致")
    expect(root.querySelector("[data-testid='replay-step-backward']")?.textContent).toContain("上一步")
    expect(root.querySelector("[data-testid='replay-step-forward']")?.textContent).toContain("下一步")
    expect(root.querySelector("[data-testid='replay-continue']")).toBeNull()
    expect(root.querySelector("[data-testid='replay-stop']")?.textContent).toContain("停止")
  })
})
```

Add a second model with `deterministic: false` and `difference`, asserting that the typed difference and “继续回放” appear.

- [ ] **Step 2: Run the test and verify red state**

Run:

```bash
bunx vitest run packages/editor/test/output-replay-bar.test.ts
```

Expected: FAIL because the replay bar module does not exist.

- [ ] **Step 3: Implement replay bar model and actions**

Create these contracts:

```ts
import type { ReplayDifference } from "@composeui/operation-log"
import type { ReplayControllerState } from "./replay-controller"

export interface OutputReplayBarModel extends ReplayControllerState {
  readonly selectedSequence?: number
  readonly busy: boolean
}

export interface OutputReplayBarActions {
  onStepBackward(): void | Promise<void>
  onStepForward(): void | Promise<void>
  onRunTo(sequence: number): void | Promise<void>
  onVerify(): void | Promise<void>
  onContinue(): void | Promise<void>
  onStop(): void
  onError(action: string, error: unknown): void
}
```

Use separate Lucide icons: `StepBack`, `StepForward`, `FastForward`, `BadgeCheck`, `Play`, and `Square`. Do not use `Trash2` for stop. Hide the entire bar when inactive. Disable commands while `status === "running"` or `busy === true`; disable “运行到选中项” without a selected sequence.

Set `role="status"` and `aria-live="polite"` on the replay summary. Keep the typed difference outside the live summary so large payloads are not repeatedly announced.

Move the existing `safeText` function from `output-panel.ts` to `packages/editor/src/workspace/output-value-format.ts`, export only `safeText(value: unknown): string`, and import it from both `output-panel.ts` and `output-replay-bar.ts`. Preserve its BigInt, circular-reference, serialization-error, and `undefined` handling exactly. Add `packages/editor/src/workspace/output-value-format.ts` to this task's Files and commit command.

- [ ] **Step 4: Wire ReplayController subscription through the component**

In `output-panel.ts`, replace the direct `renderReplay` and six appended replay buttons with:

```ts
const replayBar = mountOutputReplayBar(replayHost, {
  onStepBackward: () => replayController?.stepBackward(),
  onStepForward: () => replayController?.stepForward(),
  onRunTo: (sequence) => replayController?.runTo(sequence),
  onVerify: () => replayController?.verify(),
  onContinue: () => replayController?.continueBestEffort(),
  onStop: () => replayController?.stop(),
  onError: showError,
})

const renderReplayState = (state: ReplayControllerState): void => {
  replayState = state
  replayBar.update({ ...state, selectedSequence: selected?.sequence, busy: busyAction === "replay" })
  renderToolbar()
}
```

The toolbar’s “回放到此处” starts replay; the replay bar owns all controls after activation. Ensure panel disposal unsubscribes from replay state and disposes both child components exactly once.

- [ ] **Step 5: Update integration tests for state-dependent controls**

Assert:

```ts
expect(root.querySelector("[data-testid='replay-step-forward']")).toBeNull()
root.querySelector<HTMLElement>("[data-testid='output-entry']")!.click()
expect(root.querySelector("[data-testid='output-replay']")?.textContent).toContain("回放到此处")
root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
await vi.waitFor(() => expect(root.querySelector("[data-testid='replay-step-forward']")).not.toBeNull())
```

Retain the existing assertions that replay does not mutate the active editor and that synchronous/asynchronous replay failures are surfaced.

- [ ] **Step 6: Verify and commit**

```bash
bunx vitest run packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-panels.test.ts packages/editor/test/editor-workspace.test.ts
git add packages/editor/src/workspace/output-replay-bar.ts packages/editor/src/workspace/output-value-format.ts packages/editor/src/workspace/output-panel.ts packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-panels.test.ts
git commit -m "feat(editor): add contextual output replay controls"
```

Expected: PASS.

---

### Task 5: Apply themed responsive styling without toolbar scrolling

**Files:**
- Modify: `packages/editor/src/workspace/workspace.css`
- Modify: `packages/editor/test/workspace-styles.test.ts`
- Modify: `packages/editor/src/workspace/output-toolbar.ts`
- Modify: `packages/editor/src/workspace/output-panel.ts`

- [ ] **Step 1: Write failing stylesheet assertions**

Extend `workspace-styles.test.ts`:

```ts
it("keeps the contextual output toolbar bounded by its container", () => {
  const toolbarRule = workspaceCss.match(
    /\.composeui-editor__output-toolbar\s*\{([\s\S]*?)\n\}/,
  )?.[1]
  expect(toolbarRule).toBeDefined()
  expect(toolbarRule).toContain("overflow: visible")
  expect(toolbarRule).not.toContain("overflow-x: auto")
  expect(workspaceCss).toContain("@container (max-width: 760px)")
  expect(workspaceCss).toContain("@container (max-width: 520px)")
  expect(workspaceCss).toContain(".composeui-editor__output-auto-scroll-primary")
  expect(workspaceCss).toContain(".composeui-editor__output-replay-primary")
})

it("uses theme tokens for output popups and replay controls", () => {
  for (const selector of [
    ".composeui-editor__output-filter-popover",
    ".composeui-editor__output-more-menu",
    ".composeui-editor__output-replay",
  ]) expect(workspaceCss).toContain(selector)
  expect(workspaceCss).not.toMatch(/#[0-9a-fA-F]{3,8}/)
})
```

- [ ] **Step 2: Run style tests and verify failure**

Run:

```bash
bunx vitest run packages/editor/test/workspace-styles.test.ts
```

Expected: FAIL because the toolbar still scrolls horizontally and the new component selectors are not styled.

- [ ] **Step 3: Replace old flat-toolbar styles**

Remove `.composeui-editor__output-filter-group` and the toolbar scrollbar rules. Implement:

```css
.composeui-editor__output-toolbar {
  align-items: center;
  background: var(--composeui-surface-toolbar);
  border-bottom: 1px solid var(--composeui-border-default);
  display: flex;
  gap: var(--composeui-gap-compact);
  min-height: var(--composeui-panel-toolbar-height);
  min-width: 0;
  overflow: visible;
  padding: 0 var(--composeui-space-2);
  position: relative;
}

.composeui-editor__output-search {
  flex: 1 1 auto;
  margin-left: 0;
  max-width: none;
  min-width: 96px;
}

.composeui-editor__output-toolbar-action {
  align-items: center;
  display: inline-flex;
  flex: 0 0 auto;
  gap: var(--composeui-space-1);
  white-space: nowrap;
}
```

Style popovers and menus as anchored surfaces with `var(--composeui-surface-panel-raised)`, existing borders, shadows, radius, and text tokens. Set `z-index` high enough to appear above the Output list but below global modal layers.

- [ ] **Step 4: Add container-responsive visibility rules**

Use CSS-only responsive placement so no global resize listener is needed:

```css
@container (max-width: 760px) {
  .composeui-editor__output-auto-scroll-primary {
    display: none;
  }

  .composeui-editor__output-menu-scroll {
    display: flex;
  }
}

@container (max-width: 520px) {
  .composeui-editor__output-replay-primary {
    display: none;
  }

  .composeui-editor__output-details-replay {
    display: inline-flex;
  }
}
```

Render both auto-scroll menu and primary forms, and both replay primary and details forms, but use CSS to expose only one at each width. The hidden controls must use `display: none` so they are excluded from keyboard navigation and accessibility trees.

- [ ] **Step 5: Add narrow details replay placement**

When a replayable event is selected, append a labeled `.composeui-editor__output-details-replay` button to `eventDetails`. Pass an `onReplay` callback into `eventDetails(event, options)` and keep the button hidden outside the narrow breakpoint.

Because the details column is currently hidden below 720px, add a compact selected-row action strip above the list for widths below 520px rather than placing the button inside the hidden details column:

```text
#46  移动“node-blue”                       [回放到此处]
```

Name the class `.composeui-editor__output-selection-action` and render it only when a selection exists. This resolves the design requirement without making the hidden details column interactive.

- [ ] **Step 6: Verify styles and commit**

```bash
bunx vitest run packages/editor/test/workspace-styles.test.ts packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
bun run typecheck
git add packages/editor/src/workspace/workspace.css packages/editor/src/workspace/output-toolbar.ts packages/editor/src/workspace/output-panel.ts packages/editor/test/workspace-styles.test.ts packages/editor/test/output-toolbar.test.ts packages/editor/test/workspace-panels.test.ts
git commit -m "style(editor): make output controls responsive"
```

Expected: PASS with no fixed hex colors added to `workspace.css`.

---

### Task 6: Verify keyboard, browser behavior, and regressions

**Files:**
- Modify: `tests/e2e/m1-editor-spine.spec.ts`
- Modify: `packages/editor/test/output-toolbar.test.ts`
- Modify: `packages/editor/test/output-replay-bar.test.ts`

- [ ] **Step 1: Add browser-level Output workflow coverage**

Add an E2E test after the existing operation-output tests:

```ts
test("uses contextual operation output controls", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("tab", { name: "输出" }).click()

  const toolbar = page.getByTestId("output-toolbar")
  await expect(toolbar.getByLabel("搜索操作日志")).toBeVisible()
  await expect(toolbar.getByRole("button", { name: /^筛选/ })).toBeVisible()
  await expect(toolbar.getByRole("button", { name: "更多操作" })).toBeVisible()
  await expect(toolbar.getByRole("button", { name: "回放到此处" })).toHaveCount(0)

  await page.getByTestId("output-entry").first().click()
  await expect(toolbar.getByRole("button", { name: "回放到此处" })).toBeVisible()

  await toolbar.getByRole("button", { name: /^筛选/ }).click()
  await expect(page.getByTestId("output-filter-popover")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("output-filter-popover")).toHaveCount(0)
})
```

- [ ] **Step 2: Add responsive browser assertions**

Set the Output container to medium and narrow inline widths inside the browser test so its existing `container-type: inline-size` rules are exercised independently of the viewport:

```ts
await page.locator(".composeui-editor__output").evaluate((node) => {
  ;(node as HTMLElement).style.width = "500px"
})
expect(await toolbar.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true)
await expect(page.getByTestId("output-auto-scroll")).toBeHidden()
await expect(page.getByTestId("output-menu-scroll")).toBeVisible()
```

For the narrow state, set the same container to `480px`, assert the primary replay action is hidden and `.composeui-editor__output-selection-action` is visible. Capture desktop and narrow screenshots with `testInfo.outputPath("output-toolbar-wide.png")` and `testInfo.outputPath("output-toolbar-narrow.png")` after `await page.evaluate(() => document.fonts.ready)`. Inspect both artifacts for overlap, clipping, popup placement, and theme consistency before accepting the test run.

- [ ] **Step 3: Run focused unit and browser tests**

Run:

```bash
bunx vitest run packages/editor/test/output-toolbar.test.ts packages/editor/test/output-replay-bar.test.ts packages/editor/test/workspace-panels.test.ts packages/editor/test/workspace-styles.test.ts
bunx playwright test tests/e2e/m1-editor-spine.spec.ts --grep "contextual operation output controls"
```

Expected: PASS. The browser test must show no horizontal toolbar overflow in wide, medium, or narrow states.

- [ ] **Step 4: Run repository-wide verification**

Run:

```bash
bun run format:check
bun run lint
bun run typecheck
bun run test
bun run build
git diff --check
```

Expected: all commands PASS. If `AGENTS.md` or `bun.lock` remain dirty from unrelated user work, do not stage, format, or revert them.

- [ ] **Step 5: Commit final verification coverage**

```bash
git add tests/e2e/m1-editor-spine.spec.ts packages/editor/test/output-toolbar.test.ts packages/editor/test/output-replay-bar.test.ts
git commit -m "test(editor): cover contextual output workflows"
```

---

## Completion Criteria

- The default Output toolbar contains only search, filter, auto-scroll, and More controls.
- Ten flat status/category buttons are replaced by one accessible filter popover.
- Import, export, auto-scroll fallback, and clear-view confirmation live in the More menu.
- “回放到此处” appears only for a replayable selection.
- Replay step, run-to, verify, best-effort, and stop controls appear only during active replay.
- Best-effort continuation appears only after a deterministic difference.
- Stop replay uses a stop icon and label; clear view uses distinct wording and confirmation.
- Dockview width changes do not create toolbar overflow or overlap.
- All controls are keyboard operable and expose accurate accessible state.
- Existing query, details, import/export, persistence, and isolated replay behavior remain passing.
