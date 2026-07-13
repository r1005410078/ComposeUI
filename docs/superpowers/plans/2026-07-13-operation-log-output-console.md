# Operation Log Output Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Output panel into a compact searchable operation-log console with details, import, export, and replay entry points.

**Architecture:** Editor workspace receives an `OperationLogController` query/command port. The panel owns view state and semantic DOM; formatter registry owns localized summaries; persistence and replay remain outside UI code.

**Tech Stack:** TypeScript DOM APIs, Lucide icons, Dockview, CSS theme tokens, Vitest/jsdom

---

### Task 1: Define the editor-facing log controller

**Files:**
- Create: `packages/editor/src/operation-log.ts`
- Modify: `packages/editor/package.json`
- Modify: `packages/editor/tsconfig.json`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/src/workspace/types.ts`
- Modify: `packages/editor/src/workspace/editor-workspace.ts`
- Test: `packages/editor/test/editor-workspace.test.ts`

- [ ] **Step 1: Write the failing workspace injection test**

```ts
it("passes the operation log controller to first-party panels", () => {
  const operationLog = fakeOperationLogController()
  const mounted = mountEditorWorkspace(root, editor, { pageId: "page-1", operationLog, createDockview })
  expect(capturedContext.operationLog).toBe(operationLog)
  mounted.dispose()
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/editor/test/editor-workspace.test.ts`
Expected: FAIL because workspace options/context do not accept `operationLog`.

- [ ] **Step 3: Add the port**

```ts
export interface OperationLogViewQuery { levels: readonly OperationLogLevel[]; categories: readonly OperationCategory[]; search: string }
export interface OperationLogController {
  query(query: OperationLogViewQuery): Promise<OperationEvent[]>
  subscribe(listener: () => void): () => void
  exportSession(): Promise<string>
  importBundle(serialized: string): Promise<void>
  startReplay(sequence: number): void | Promise<void>
}
```

Ensure `@composeui/operation-log` is an editor dependency and TypeScript project reference (it may already be present after the foundation plan). Add optional `operationLog` to `MountEditorWorkspaceOptions` and `WorkspaceContext`. Pass it unchanged to panels. Keep it optional so existing hosts remain source-compatible.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/editor/test/editor-workspace.test.ts && bun run typecheck`
Expected: PASS.

```bash
git add packages/editor
git commit -m "feat(editor): inject operation log controller"
```

### Task 2: Add localized formatters

**Files:**
- Create: `packages/editor/src/workspace/operation-formatters.ts`
- Test: `packages/editor/test/operation-formatters.test.ts`

- [ ] **Step 1: Write failing formatter tests**

```ts
it("formats move coordinates and diagnostics in Chinese", () => {
  expect(formatOperation(moveEvent())).toContain('移动“矩形 1”：(120, 80) -> (180, 120)')
  expect(formatOperation(failedEvent("NODE_LOCKED"))).toContain("NODE_LOCKED")
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/editor/test/operation-formatters.test.ts`
Expected: FAIL because formatter registry is missing.

- [ ] **Step 3: Implement registry and safe fallback**

```ts
export type OperationFormatter = (event: OperationEvent) => string
const formatters = new Map<string, OperationFormatter>()
export function registerOperationFormatter(type: string, formatter: OperationFormatter): () => void {
  formatters.set(type, formatter)
  return () => { if (formatters.get(type) === formatter) formatters.delete(type) }
}
export function formatOperation(event: OperationEvent): string {
  return formatters.get(event.type)?.(event) ?? `${event.type} · ${event.status}`
}
```

Register document create/move/resize/rename/delete, history, session, and diagnostic formatters. Read names and coordinates from structured payload/patch and never parse stored display strings.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/editor/test/operation-formatters.test.ts`
Expected: PASS.

```bash
git add packages/editor
git commit -m "feat(editor): format operation log summaries"
```

### Task 3: Render toolbar, filtered rows, and details

**Files:**
- Create: `packages/editor/src/workspace/output-panel.ts`
- Modify: `packages/editor/src/workspace/panels.ts`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Replace the empty-state test with failing console tests**

```ts
it("filters operation rows and opens structured details", async () => {
  const context = createContext(undefined, fakeOperationLogController([moveEvent(), errorEvent()]))
  const root = document.createElement("div")
  const dispose = panel("output").mount(root, context)
  await vi.waitFor(() => expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(2))
  root.querySelector<HTMLButtonElement>("[data-testid='output-level-error']")!.click()
  expect(root.querySelectorAll("[data-testid='output-entry']")).toHaveLength(1)
  root.querySelector<HTMLButtonElement>("[data-testid='output-entry']")!.click()
  expect(root.querySelector("[data-testid='output-details']")?.textContent).toContain("NODE_LOCKED")
  if (typeof dispose === "function") dispose()
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts`
Expected: FAIL because Output still renders only an empty message.

- [ ] **Step 3: Implement semantic console DOM**

Create icon buttons for clear view, level/category filters, auto-scroll, import, export, and replay; a labeled search input; an independently scrolling `role="log"` list; and a details `<aside>`. Keep `clearedThroughSequence` as view state so clear never deletes persistence. Query on controller notifications, ignore stale async responses with a render generation counter, and dispose subscriptions/listeners idempotently.

Rows use stable test IDs, `data-level`, `data-category`, and `aria-selected`. Render payload and patch as escaped text through `textContent`, never `innerHTML`.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts`
Expected: PASS including missing-controller empty state and stale-query tests.

```bash
git add packages/editor
git commit -m "feat(editor): render operation output console"
```

### Task 4: Add compact themed styles

**Files:**
- Modify: `packages/editor/src/theme.css`
- Modify: `packages/editor/src/workspace/workspace.css`
- Test: `packages/editor/test/theme.test.ts`
- Test: `packages/editor/test/workspace-styles.test.ts`

- [ ] **Step 1: Write failing token/structure assertions**

```ts
expect(themeCss).toContain("--composeui-output-row-height:")
expect(workspaceCss).toContain("grid-template-rows: var(--composeui-panel-toolbar-height) minmax(0, 1fr)")
expect(workspaceCss).toContain(".composeui-editor__output-entry[data-level=\"error\"]")
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/editor/test/theme.test.ts packages/editor/test/workspace-styles.test.ts`
Expected: FAIL because console tokens and selectors are missing.

- [ ] **Step 3: Implement styles using existing colors**

Add density-only tokens for row height, time column width, and details width. Use existing surface, border, text, accent, danger, warning, and success tokens. The panel grid must keep toolbar fixed, list scrollable, and details bounded. Use ellipsis for summaries and preserve the existing themed scrollbars. Do not add new palette colors.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/editor/test/theme.test.ts packages/editor/test/workspace-styles.test.ts`
Expected: PASS.

```bash
git add packages/editor
git commit -m "style(editor): refine operation output console"
```

### Task 5: Wire playground persistence and verify the UI

**Files:**
- Modify: `apps/playground/package.json`
- Modify: `apps/playground/tsconfig.json`
- Modify: `apps/playground/src/main.ts`
- Test: `apps/playground/src/operation-log.test.ts`
- Test: `tests/editor-workspace.spec.ts`

- [ ] **Step 1: Write failing host and e2e assertions**

```ts
it("creates one recorder and injects its controller", async () => {
  const mounted = await mountPlaygroundForTest(app, fakeIndexedDb())
  mounted.scenario.createNode()
  await mounted.operationLog.flush()
  expect(await mounted.operationLog.query({ search: "node.create", levels: [], categories: [] })).toHaveLength(1)
})
```

E2E assertion:

```ts
await page.getByTestId("create-node").click()
await expect(page.getByTestId("output-entry").filter({ hasText: "创建" })).toBeVisible()
await page.reload()
await expect(page.getByTestId("output-entry").filter({ hasText: "创建" })).toBeVisible()
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bunx vitest run apps/playground/src/operation-log.test.ts && bunx playwright test tests/editor-workspace.spec.ts`
Expected: FAIL because the playground does not create or inject the service.

- [ ] **Step 3: Wire the host**

Add `@composeui/operation-log` dependency/reference. Open `IndexedDbOperationLogStore`, start one coordinator for the project, create core/session adapters before mounting the workspace, and pass an `OperationLogController` into `mountEditorWorkspace`. Dispose workspace first, then end/flush the coordinator, then close IndexedDB.

- [ ] **Step 4: Run focused and full checks**

Run: `bunx vitest run apps/playground/src/operation-log.test.ts packages/editor/test && bunx playwright test tests/editor-workspace.spec.ts && bun run check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/playground tests packages/editor
git commit -m "feat(playground): enable persistent operation console"
```
