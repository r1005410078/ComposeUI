# Dockview Editor Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a framework-neutral, Godot-inspired 2D editor workspace whose panels are managed and persisted by Dockview.

**Architecture:** `@composeui/editor` owns a DOM-only workspace shell, shared `EditorSession`, panel/mode registries, and injectable layout storage. Existing canvas and tree behavior is split into independently mountable views, then composed into Dockview panels; Playground supplies localStorage persistence and remains the integration host.

**Tech Stack:** TypeScript, DOM APIs, Dockview 7 (`dockview`), Lucide (`lucide`), Vitest/jsdom, Playwright, Vite, Bun.

---

## File Map

- Modify `packages/editor/package.json`: add framework-neutral Dockview and Lucide dependencies.
- Modify `packages/editor/src/editor-view.ts`: accept an injected session and support canvas-only composition.
- Modify `packages/editor/src/component-tree.ts`: expose the existing tree as a standalone mounted view.
- Create `packages/editor/src/workspace/types.ts`: public context, panel, mode, storage, and mounted-workspace contracts.
- Create `packages/editor/src/workspace/panel-registry.ts`: stable descriptor registry and duplicate checks.
- Create `packages/editor/src/workspace/mode-registry.ts`: mode registry and mode-bar visibility rule.
- Create `packages/editor/src/workspace/layout-store.ts`: versioned layout envelope and storage adapters.
- Create `packages/editor/src/workspace/panels.ts`: Scene, Canvas, Inspector, and utility panel renderers.
- Create `packages/editor/src/workspace/toolbar.ts`: 2D toolbar and workspace panel menu.
- Create `packages/editor/src/workspace/editor-workspace.ts`: Dockview lifecycle, layout, restore, fallback, and public API.
- Create `packages/editor/src/workspace.css`: compact dark workspace theme and responsive constraints.
- Modify `packages/editor/src/index.ts`: export the workspace API and CSS.
- Create `packages/editor/test/workspace-*.test.ts`: focused unit/DOM coverage.
- Modify `apps/playground/src/main.ts`: mount the workspace and provide localStorage.
- Modify `apps/playground/src/styles.css`: make the workspace fill the application.
- Modify `tests/e2e/m1-editor-spine.spec.ts`: browser-level layout, persistence, reset, and selection checks.

### Task 1: Install dependencies and inject the shared session

**Files:**
- Modify: `packages/editor/package.json`
- Modify: `packages/editor/src/editor-view.ts`
- Test: `packages/editor/test/editor-view.test.ts`
- Modify: `bun.lock`

- [ ] **Step 1: Write the failing shared-session test**

Add a test that creates `const session = new EditorSession()`, calls:

```ts
const mounted = mountEditor(root, editor, { pageId: "page-1", session })
expect(mounted.session).toBe(session)
session.setSelection(["node-1"])
expect(root.querySelector("[data-testid='selection-node-1']")).not.toBeNull()
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `bunx vitest run packages/editor/test/editor-view.test.ts -t "uses an injected session"`
Expected: FAIL because `MountEditorOptions` does not accept `session`.

- [ ] **Step 3: Implement optional session injection**

Change the contract and construction without changing old callers:

```ts
export interface MountEditorOptions {
  pageId: string
  session?: EditorSession
}

const session = options.session ?? new EditorSession()
```

Only call `toggleExpanded(pageId)` when the page is not already expanded.

- [ ] **Step 4: Install the framework-neutral packages**

Run: `bun add --cwd packages/editor dockview lucide`
Expected: `packages/editor/package.json` and `bun.lock` contain `dockview` and `lucide`; no framework binding package is added.

- [ ] **Step 5: Verify and commit**

Run: `bunx vitest run packages/editor/test/editor-view.test.ts`
Expected: PASS.

```bash
git add packages/editor/package.json packages/editor/src/editor-view.ts packages/editor/test/editor-view.test.ts bun.lock
git commit -m "refactor(editor): allow shared editor sessions"
```

### Task 2: Split Scene and Canvas into independently mounted views

**Files:**
- Modify: `packages/editor/src/editor-view.ts`
- Modify: `packages/editor/src/component-tree.ts`
- Create: `packages/editor/test/editor-composition.test.ts`

- [ ] **Step 1: Write failing composition tests**

Test `mountEditor(..., { view: "canvas" })` renders the board but no component-tree aside, and `mountComponentTree(root, editor, { pageId, session })` renders the tree and reacts to the same selection. Also verify both mounted views unsubscribe exactly once when destroyed.

```ts
expect(canvasRoot.querySelector("[data-testid='page-board']")).not.toBeNull()
expect(canvasRoot.querySelector("[aria-label='Component tree']")).toBeNull()
treeRoot.querySelector<HTMLElement>("[data-testid='tree-node-1']")!.click()
expect(session.getState().selection).toEqual(["node-1"])
```

- [ ] **Step 2: Verify the tests fail**

Run: `bunx vitest run packages/editor/test/editor-composition.test.ts`
Expected: FAIL because `view` and `mountComponentTree` do not exist.

- [ ] **Step 3: Add explicit view composition contracts**

```ts
export interface MountEditorOptions {
  pageId: string
  session?: EditorSession
  view?: "combined" | "canvas"
}

export interface MountedComponentTree {
  destroy(): void
}
```

Move tree-specific subscription/update/disposal into exported `mountComponentTree`; keep `view: "combined"` as the default so existing tests and consumers remain compatible.

- [ ] **Step 4: Run editor tests and commit**

Run: `bunx vitest run packages/editor/test/editor-composition.test.ts packages/editor/test/editor-view.test.ts`
Expected: PASS.

```bash
git add packages/editor/src/editor-view.ts packages/editor/src/component-tree.ts packages/editor/test/editor-composition.test.ts
git commit -m "refactor(editor): split scene tree from canvas"
```

### Task 3: Add registries and versioned layout storage

**Files:**
- Create: `packages/editor/src/workspace/types.ts`
- Create: `packages/editor/src/workspace/panel-registry.ts`
- Create: `packages/editor/src/workspace/mode-registry.ts`
- Create: `packages/editor/src/workspace/layout-store.ts`
- Create: `packages/editor/test/workspace-registry.test.ts`
- Create: `packages/editor/test/workspace-layout-store.test.ts`

- [ ] **Step 1: Write failing registry and storage tests**

Cover stable registration order, duplicate `PANEL_ALREADY_REGISTERED`, one-mode hidden/two-mode visible, layout version mismatch returning `undefined`, and reset calling storage removal.

```ts
registry.register({ id: "scene", title: "Scene", mount })
expect(() => registry.register({ id: "scene", title: "Again", mount })).toThrow(
  "PANEL_ALREADY_REGISTERED",
)
expect(modes.shouldRenderModeBar()).toBe(false)
modes.register({ id: "script", title: "Script", createLayout })
expect(modes.shouldRenderModeBar()).toBe(true)
```

- [ ] **Step 2: Verify failure**

Run: `bunx vitest run packages/editor/test/workspace-registry.test.ts packages/editor/test/workspace-layout-store.test.ts`
Expected: FAIL because workspace modules do not exist.

- [ ] **Step 3: Implement focused contracts**

Define `WorkspacePanelDescriptor`, `WorkspacePanelMount`, `WorkspaceModeDescriptor`, `WorkspaceLayoutStore`, `WorkspaceResourceService`, and a typed `WorkspaceEvent` union for layout/panel failures, plus:

```ts
export interface StoredWorkspaceLayout {
  version: 1
  modeId: "2d"
  layout: unknown
}
```

Keep the adapter asynchronous (`load/save/remove` return `Promise`) so browser and remote hosts share one API. Implement `createLocalStorageLayoutStore(storage, key)` without reading `window` globally.

- [ ] **Step 4: Verify and commit**

Run: `bunx vitest run packages/editor/test/workspace-registry.test.ts packages/editor/test/workspace-layout-store.test.ts`
Expected: PASS.

```bash
git add packages/editor/src/workspace packages/editor/test/workspace-registry.test.ts packages/editor/test/workspace-layout-store.test.ts
git commit -m "feat(editor): add workspace registries and layout storage"
```

### Task 4: Build the first-party panel renderers

**Files:**
- Create: `packages/editor/src/workspace/panels.ts`
- Create: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Write failing panel tests**

Assert Scene and Canvas share one Session, Inspector shows the selected record name/type, a supplied resource service populates Resources, a missing service produces an empty state, utility panels expose named status text, and every returned disposer is idempotent.

```ts
session.setSelection(["node-1"])
expect(inspectorRoot.querySelector("[data-testid='inspector-name']")?.textContent).toBe("Rectangle")
expect(outputRoot.querySelector("[data-testid='empty-output']")).not.toBeNull()
```

- [ ] **Step 2: Verify failure**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts`
Expected: FAIL because the renderers do not exist.

- [ ] **Step 3: Implement the panel factories**

Use `mountComponentTree` for Scene and `mountEditor(..., { view: "canvas", session })` for Canvas. Implement Resources, History, Signals, Output, Debugger, Animation, and Shader Editor as accessible empty-state panels. Inspector subscribes to Core and Session and renders only the current first selection; it does not mutate records in this task.

- [ ] **Step 4: Verify and commit**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts packages/editor/test/editor-composition.test.ts`
Expected: PASS.

```bash
git add packages/editor/src/workspace/panels.ts packages/editor/test/workspace-panels.test.ts
git commit -m "feat(editor): add workspace panel renderers"
```

### Task 5: Compose Dockview and the default Godot-inspired layout

**Files:**
- Create: `packages/editor/src/workspace/editor-workspace.ts`
- Create: `packages/editor/test/editor-workspace.test.ts`
- Modify: `packages/editor/src/index.ts`

- [ ] **Step 1: Write failing workspace lifecycle tests**

Mock `createDockview` behind an injected `createDockview` test seam. Assert all ten stable panel IDs are added, Canvas is protected, one mode creates no mode bar, close/reopen works, restore errors apply defaults, stale Canvas IDs bind to the current page, and two `dispose()` calls destroy Dockview/panels once. Force an auxiliary renderer to throw and assert an in-panel error plus a `panel-error` event; force Canvas to throw and assert a blocking Canvas state. Reject layout saving and assert a `layout-save-error` event without unmounting the editor.

- [ ] **Step 2: Verify failure**

Run: `bunx vitest run packages/editor/test/editor-workspace.test.ts`
Expected: FAIL because `mountEditorWorkspace` is not exported.

- [ ] **Step 3: Implement the shell and public API**

Use `createDockview(root, { createComponent })`, `api.addPanel`, `api.toJSON()`, and `api.fromJSON()`. Add panels in deterministic relative positions: Scene left of Canvas; Resources/History below Scene; Inspector/Signals right; utility group below Canvas. Rebind serialized `canvas:*` IDs to `canvas:${pageId}` before restore and reject restored layouts without Canvas.

```ts
export interface MountedEditorWorkspace {
  session: EditorSession
  api: {
    openPanel(id: string): void
    focusPanel(id: string): void
    resetLayout(): Promise<void>
  }
  dispose(): void
}
```

- [ ] **Step 4: Verify and commit**

Run: `bunx vitest run packages/editor/test/editor-workspace.test.ts`
Expected: PASS.

```bash
git add packages/editor/src/workspace/editor-workspace.ts packages/editor/test/editor-workspace.test.ts packages/editor/src/index.ts
git commit -m "feat(editor): compose dockview workspace shell"
```

### Task 6: Add the 2D toolbar, editable Inspector, and workspace styling

**Files:**
- Create: `packages/editor/src/workspace/toolbar.ts`
- Modify: `packages/editor/src/workspace/panels.ts`
- Create: `packages/editor/src/workspace.css`
- Modify: `packages/editor/src/editor.css`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/editor/test/workspace-panels.test.ts`

- [ ] **Step 1: Write failing interaction tests**

Assert toolbar Grid toggles shared Session state, Undo/Redo call Core, panel menu reopens a closed panel, and Inspector rename dispatches `node.rename` so undo restores the old value.

- [ ] **Step 2: Verify failure**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts -t "toolbar|Inspector"`
Expected: FAIL because controls are not implemented.

- [ ] **Step 3: Implement controls with Lucide icons**

Use Lucide `createElement`/icon nodes for commands, native `button` elements, `title`, `aria-label`, and `aria-pressed`. Keep unsupported transform tools disabled with explicit accessible names. Inspector commits rename on change/Enter through:

```ts
editor.dispatch({ id: "node.rename", payload: { id: node.id, name: input.value } })
```

- [ ] **Step 4: Implement compact responsive CSS**

Import `dockview/dist/styles/dockview.css` explicitly. Give the shell `height/width: 100%`, enforce `min-width: 0; min-height: 0`, use a restrained dark neutral palette, 28-32px controls, no card nesting, and CSS custom properties for host overrides. Hide the mode-bar element entirely when only `2d` exists.

- [ ] **Step 5: Verify and commit**

Run: `bunx vitest run packages/editor/test/workspace-panels.test.ts packages/editor/test/editor-workspace.test.ts`
Expected: PASS.

```bash
git add packages/editor/src/workspace packages/editor/src/editor.css packages/editor/src/index.ts packages/editor/test/workspace-panels.test.ts
git commit -m "feat(editor): add workspace tools and inspector"
```

### Task 7: Integrate the workspace into Playground with persistence

**Files:**
- Modify: `apps/playground/src/main.ts`
- Modify: `apps/playground/src/styles.css`
- Modify: `apps/playground/src/m1-free-layout-scenario.test.ts`

- [ ] **Step 1: Add a failing Playground integration test**

Extract `createPlaygroundLayoutStore(storage)` and test its key is `composeui:workspace:2d:v1`, save/load round-trips, and malformed JSON returns no layout.

- [ ] **Step 2: Verify failure**

Run: `bunx vitest run apps/playground/src/m1-free-layout-scenario.test.ts`
Expected: FAIL because the store factory does not exist.

- [ ] **Step 3: Replace the standalone editor mount**

Call `mountEditorWorkspace(editorHost, scenario.editor, { pageId, layoutStore })`. Move Create, Grid, overflow, export, and reset-layout commands into the workspace toolbar/panel menu; keep canonical JSON output functional. Expose the mounted workspace through `window.__composeuiM1` in development.

- [ ] **Step 4: Update application layout CSS**

Make `#app` and `.playground-editor-host` fill the viewport with no obsolete 44px external toolbar row. Ensure Dockview receives a non-zero stable host size.

- [ ] **Step 5: Verify and commit**

Run: `bunx vitest run apps/playground/src/m1-free-layout-scenario.test.ts && bun run --cwd apps/playground build`
Expected: PASS and successful Vite build.

```bash
git add apps/playground/src/main.ts apps/playground/src/styles.css apps/playground/src/m1-free-layout-scenario.test.ts
git commit -m "feat(playground): host the dockview editor workspace"
```

### Task 8: Add browser acceptance coverage and run the full gate

**Files:**
- Modify: `tests/e2e/m1-editor-spine.spec.ts`

- [ ] **Step 1: Add E2E acceptance cases**

Test the initial panel titles, absence of a mode bar, Scene-to-Canvas selection, Inspector rename plus undo, auxiliary panel close/reopen, layout persistence after reload, corrupted localStorage fallback, reset preserving canonical JSON, and no overlap at `1440x900` and `900x700`.

- [ ] **Step 2: Run E2E and inspect screenshots**

Run: `bun run test:e2e -- tests/e2e/m1-editor-spine.spec.ts`
Expected: PASS. Capture screenshots for both viewports and inspect that Canvas remains visible, labels fit, and toolbar/panels do not overlap.

- [ ] **Step 3: Run package and repository verification**

Run: `bun run format`
Expected: formatter completes.

Run: `bun run check`
Expected: format check, lint, typecheck, unit tests, and all builds PASS.

Run: `bun run test:e2e`
Expected: all Playwright tests PASS.

- [ ] **Step 4: Commit acceptance coverage**

```bash
git add tests/e2e/m1-editor-spine.spec.ts
git commit -m "test(editor): cover dockview workspace workflows"
```

## Implementation Notes

- Do not add `dockview-react`, `dockview-vue`, or `dockview-angular`; those belong only in future host adapters.
- Do not serialize layout, selection, viewport, or panel state into canonical JSON.
- Preserve `mountEditor` default behavior for existing consumers.
- Keep empty utility panels honest: named empty states, no simulated debugger/resource data.
- Prefer Dockview public APIs over querying or mutating its internal DOM.
- Official Dockview v7 references: <https://dockview.dev/docs/overview/installation/> and <https://dockview.dev/docs/core/state/load/>.
