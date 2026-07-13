# Operation Log Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replay validated operation logs in an isolated editor and report the first deterministic difference without invoking host side effects.

**Architecture:** Bundle validation produces trusted data objects, then ReplayEngine restores the nearest checkpoint and dispatches registered semantic handlers into a newly created core/session runtime. Expected command result, patch, diagnostics, and hashes are compared after every deterministic event.

**Tech Stack:** TypeScript, `@composeui/core`, `@composeui/editor`, Vitest, Playwright

---

### Task 1: Define replay results and handler registry

**Files:**
- Create: `packages/operation-log/src/replay/types.ts`
- Create: `packages/operation-log/src/replay/registry.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/replay-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

```ts
it("rejects duplicate handlers and reports unknown event types", () => {
  const registry = new ReplayHandlerRegistry()
  registry.register("document.command", commandHandler)
  expect(() => registry.register("document.command", commandHandler)).toThrow("DUPLICATE_REPLAY_HANDLER")
  expect(registry.resolve("plugin.unknown")).toEqual({ ok: false, difference: expect.objectContaining({ type: "missing-handler" }) })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/replay-registry.test.ts`
Expected: FAIL because replay types do not exist.

- [ ] **Step 3: Implement public replay types**

```ts
export type ReplayDifference =
  | { type: "command-mismatch"; sequence: number; expected: unknown; actual: unknown }
  | { type: "patch-mismatch"; sequence: number; path: string; expected: unknown; actual: unknown }
  | { type: "state-hash-mismatch"; sequence: number; expected: string; actual: string }
  | { type: "missing-handler"; sequence: number; eventType: string }
  | { type: "schema-incompatible"; sequence: number; version: number }
  | { type: "environment-mismatch"; sequence: number; requirement: string }

export interface ReplaySessionPort {
  setSelection(ids: readonly string[]): void
  setViewport(viewport: { x: number; y: number; zoom: number }): void
  setInteractionMode(mode: "select" | "pan"): void
  setGridVisible(visible: boolean): void
  setExpanded(ids: readonly string[]): void
  getState(): unknown
}
export interface ReplayHandlerContext { editor: Editor; session: ReplaySessionPort; sideEffects: "disabled" }
export type ReplayHandler = (event: OperationEvent, context: ReplayHandlerContext) => Promise<ReplayDifference | undefined>
```

Registry registration returns an unregister function and never loads handlers from imported bundle data.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/replay-registry.test.ts`
Expected: PASS.

```bash
git add packages/operation-log
git commit -m "feat(operation-log): define replay handlers"
```

### Task 2: Implement command, history, and session handlers

**Files:**
- Create: `packages/operation-log/src/replay/builtin-handlers.ts`
- Test: `packages/operation-log/test/replay-handlers.test.ts`

- [ ] **Step 1: Write failing deterministic handler tests**

```ts
it("replays a command and detects the first patch field mismatch", async () => {
  const context = isolatedRuntime(checkpoint())
  expect(await handleDocumentCommand(createEvent(), context)).toBeUndefined()
  const difference = await handleDocumentCommand(createEvent({ expectedWidth: 999 }), context)
  expect(difference).toMatchObject({ type: "patch-mismatch", path: "forward.created[0].layout.width" })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/replay-handlers.test.ts`
Expected: FAIL because built-in handlers are missing.

- [ ] **Step 3: Implement handlers**

For `document.command:succeeded`, dispatch the stored `EditorCommand`, capture the emitted transaction, compare success, diagnostics, then recursively compare canonical patches and return the first differing path. For failed commands, require failure and matching diagnostic codes without changing state. Implement undo, redo, and jump through public Editor methods. Implement selection, viewport, tool, grid, and tree disclosure through `ReplaySessionPort`. Ignore `started` command events after validating their payload shape.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/replay-handlers.test.ts`
Expected: PASS.

```bash
git add packages/operation-log
git commit -m "feat(operation-log): replay built-in operations"
```

### Task 3: Implement ReplayEngine and checkpoint seeking

**Files:**
- Create: `packages/operation-log/src/replay/engine.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/replay-engine.test.ts`

- [ ] **Step 1: Write failing seek and pause tests**

```ts
it("starts at the nearest checkpoint and pauses at the first difference", async () => {
  const engine = await ReplayEngine.create({ bundle: bundleWithCheckpoints([0, 100]), targetSequence: 120 })
  const result = await engine.runTo(120)
  expect(result.startedAtSequence).toBe(100)
  expect(result.status).toBe("paused")
  expect(result.difference).toMatchObject({ type: "state-hash-mismatch", sequence: 114 })
  expect(result.currentSequence).toBe(114)
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/replay-engine.test.ts`
Expected: FAIL because ReplayEngine is missing.

- [ ] **Step 3: Implement isolated execution**

`create` must accept only an already validated `LogBundleV1`, choose the nearest checkpoint, create a new Editor, obtain a fresh replay session from an injected `createSession(initialState): ReplaySessionPort` factory, register only built-in/host-approved handlers, and expose `step`, `runTo`, `verify`, `getState`, and `continueBestEffort`. After every deterministic event compute canonical document hash and compare `afterHash`. Default mismatch behavior is pause; best-effort marks every later result non-deterministic.

The replay context contains no save, resource, network, upload, or workspace host adapters. Its side-effect capability is the literal `"disabled"`.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/replay-engine.test.ts`
Expected: PASS including tests proving the active editor is unchanged.

```bash
git add packages/operation-log
git commit -m "feat(operation-log): add deterministic replay engine"
```

### Task 4: Add replay controller and Output integration

**Files:**
- Create: `packages/editor/src/workspace/replay-controller.ts`
- Modify: `packages/editor/src/operation-log-adapter.ts`
- Modify: `packages/editor/src/workspace/output-panel.ts`
- Modify: `packages/editor/src/workspace/workspace.css`
- Test: `packages/editor/test/replay-controller.test.ts`
- Test: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Write failing UI flow test**

```ts
it("starts isolated replay from a selected event and renders a difference", async () => {
  const root = mountOutputWithReplay(tamperedBundle())
  root.querySelector<HTMLElement>("[data-sequence='12']")!.click()
  root.querySelector<HTMLButtonElement>("[data-testid='output-replay']")!.click()
  await vi.waitFor(() => expect(root.querySelector("[data-testid='replay-difference']")?.textContent).toContain("patch-mismatch"))
  expect(activeEditor.getStore()).toEqual(originalStore)
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/editor/test/replay-controller.test.ts packages/editor/test/workspace-panels.test.ts`
Expected: FAIL because replay UI state is missing.

- [ ] **Step 3: Implement replay controls**

Add an `EditorSessionReplayAdapter` implementing `ReplaySessionPort`, including a deterministic `setExpanded` implementation. Add step backward by checkpoint/recreate, step forward, run-to-event, verify, stop, and continue-best-effort commands. Render current sequence, deterministic status, and typed expected/actual/path detail. Disable editor save/run actions while the isolated replay surface is active; do not replace or mutate the active editor instance.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/editor/test/replay-controller.test.ts packages/editor/test/workspace-panels.test.ts`
Expected: PASS.

```bash
git add packages/editor
git commit -m "feat(editor): expose operation replay controls"
```

### Task 5: Add end-to-end replay verification

**Files:**
- Modify: `tests/editor-workspace.spec.ts`
- Test: `packages/operation-log/test/replay-roundtrip.test.ts`

- [ ] **Step 1: Write failing round-trip and browser scenarios**

```ts
it("reconstructs create, move, rename, undo, redo and jump exactly", async () => {
  const bundle = await recordScenario(["create", "move", "rename", "undo", "redo", "jump"])
  const result = await (await ReplayEngine.create({ bundle })).verify()
  expect(result).toMatchObject({ status: "completed", deterministic: true })
  expect(result.document).toEqual(bundle.finalDocument)
})
```

Browser scenario: perform the same operations, reload, open Output, select the final event, run verification, and assert `回放一致` is visible.

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/replay-roundtrip.test.ts && bunx playwright test tests/editor-workspace.spec.ts`
Expected: FAIL until round-trip fixtures and UI wiring are complete.

- [ ] **Step 3: Complete fixture/wiring code**

Build fixtures exclusively through public commands and exported bundle APIs. Wire the playground Output controller's `startReplay` to the isolated replay controller. Expose deterministic completion in Output without writing a new document command event into the recorded source session.

- [ ] **Step 4: Run complete verification**

Run: `bun run check && bun run test:e2e`
Expected: all checks PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/operation-log packages/editor apps/playground tests
git commit -m "test(operation-log): verify replay end to end"
```
