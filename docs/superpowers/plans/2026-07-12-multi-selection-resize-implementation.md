# Multi-Selection Resize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resize same-parent multi-selected Free Layout rectangles through eight group handles in one undoable transaction.

**Architecture:** Core validates and atomically writes final layouts through `node.resizeMany`. Editor geometry is pure and receives only snapshots; the view keeps pointer changes in DOM and SVG until pointer release.

**Tech Stack:** TypeScript, Bun, Vitest, jsdom, Playwright, Vite, Oxlint, Oxfmt.

---

## File Structure

- `packages/core/src/commands.ts`: batch command and validation.
- `packages/core/src/index.ts`: public command export.
- `packages/core/test/commands-free-layout.test.ts`: command success, undo, atomic errors.
- `packages/editor/src/group-resize.ts`: pure bounds and eight-handle math.
- `packages/editor/test/group-resize.test.ts`: geometry tests.
- `packages/editor/src/editor-view.ts`: frame, handles, preview, command dispatch.
- `packages/editor/src/editor.css`: interactive handle styles.
- `packages/editor/test/editor-view.test.ts`: jsdom editor interaction tests.
- `tests/e2e/m1-editor-spine.spec.ts`: browser drag and undo tests.

### Task 1: Add `node.resizeMany`

**Files:**
- Modify: `packages/core/src/commands.ts:28-76,303-326,448-468`
- Modify: `packages/core/src/index.ts:4-18`
- Test: `packages/core/test/commands-free-layout.test.ts`

- [ ] **Step 1: Write the failing core tests**

Create two same-parent rectangles at `(10,20)` and `(110,60)`. Dispatch this command, then assert both final layouts, one `node.resizeMany` transaction label, and one undo restoring both records.

```ts
editor.dispatch({
  id: "node.resizeMany",
  payload: { items: [
    { id: "first", x: 10, y: 20, width: 200, height: 160 },
    { id: "second", x: 210, y: 100, width: 200, height: 160 },
  ] },
})
```

Add an atomic-failure table for fewer than two items, duplicate ids, cross-parent records, locked records, `NaN` positions, and zero dimensions. Compare canonical documents before and after every failure.

- [ ] **Step 2: Verify RED**

Run: `bunx vitest run packages/core/test/commands-free-layout.test.ts`

Expected: FAIL because `node.resizeMany` is absent from `EditorCommand`.

- [ ] **Step 3: Add the minimal command**

Add this command type, include it in `EditorCommand`, export it from `index.ts`, and route it in `prepareCommand`.

```ts
export interface ResizeManyNodeCommand {
  id: "node.resizeMany"
  payload: {
    items: Array<{ id: string; x: number; y: number; width: number; height: number }>
  }
}
```

Implement `prepareResizeMany` beside `prepareResize`: verify at least two unique ids, finite `x/y`, `validSize(width, height)`, `nodeResult`, `lockedTransformBarrier`, and one `parentId`. On success, update every item in the same draft:

```ts
for (const item of command.payload.items) {
  const node = nodesById.get(item.id)!
  draft.update(item.id, {
    layout: { ...node.layout, x: item.x, y: item.y, width: item.width, height: item.height },
  })
}
```

- [ ] **Step 4: Verify GREEN and commit**

Run: `bunx vitest run packages/core/test/commands-free-layout.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

Commit: `git add packages/core/src/commands.ts packages/core/src/index.ts packages/core/test/commands-free-layout.test.ts && git commit -m "feat(core): add atomic multi-node resize command"`.

### Task 2: Add Pure Group Geometry

**Files:**
- Create: `packages/editor/src/group-resize.ts`
- Test: `packages/editor/test/group-resize.test.ts`

- [ ] **Step 1: Write failing geometry tests**

Use these snapshots:

```ts
const items = [
  { id: "first", x: 10, y: 20, width: 100, height: 80 },
  { id: "second", x: 210, y: 60, width: 100, height: 80 },
]
```

Assert bounds equal `{ left: 10, top: 20, right: 310, bottom: 140 }`. Assert south-east pointer `(610,260)` doubles dimensions and returns second `{ x: 410, y: 100, width: 200, height: 160 }`. Assert north-west fixes `right/bottom`; east-only leaves heights untouched; crossing an opposite edge clamps that group axis to `1`.

- [ ] **Step 2: Verify RED**

Run: `bunx vitest run packages/editor/test/group-resize.test.ts`

Expected: FAIL because `group-resize.ts` is absent.

- [ ] **Step 3: Implement pure geometry**

Create this API:

```ts
export type GroupResizeHandle = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw"
export interface GroupResizeItem { id: string; x: number; y: number; width: number; height: number }
export interface GroupBounds { left: number; top: number; right: number; bottom: number }
export function selectionBounds(items: readonly GroupResizeItem[]): GroupBounds
export function resizeGroup(
  items: readonly GroupResizeItem[],
  initial: GroupBounds,
  handle: GroupResizeHandle,
  pointer: { x: number; y: number },
): { bounds: GroupBounds; items: GroupResizeItem[] }
```

Move only edges named by the handle, preserve opposite edges, clamp moved edges to leave one unit, and scale every item from the original snapshot, never from a previous preview.

- [ ] **Step 4: Verify GREEN and commit**

Run: `bunx vitest run packages/editor/test/group-resize.test.ts`

Expected: PASS.

Commit: `git add packages/editor/src/group-resize.ts packages/editor/test/group-resize.test.ts && git commit -m "feat(editor): add group resize geometry"`.

### Task 3: Add SVG Handles and Preview Interaction

**Files:**
- Modify: `packages/editor/src/editor-view.ts:1-220,400-610,730-850`
- Modify: `packages/editor/src/editor.css:154-185`
- Test: `packages/editor/test/editor-view.test.ts`

- [ ] **Step 1: Write failing editor tests**

Select two sibling rectangles and assert `group-resize-n`, `ne`, `e`, `se`, `s`, `sw`, `w`, and `nw` exist. Start on `group-resize-se`, move it, and assert temporary styles while no command was dispatched:

```ts
expect(first.style.width).toBe("200px")
expect(second.style.left).toBe("410px")
expect(dispatch).not.toHaveBeenCalled()
```

On pointer-up assert one `node.resizeMany` payload with both layouts. Add cancellation assertions restoring inline `left/top/width/height` and selection SVG. Assert no group handles for one node, cross-parent selection, or a locked selected node.

- [ ] **Step 2: Verify RED**

Run: `bunx vitest run packages/editor/test/editor-view.test.ts`

Expected: FAIL with missing `group-resize-se`.

- [ ] **Step 3: Implement editor integration**

Import `screenToWorld`, `worldToParentLocal`, and the group-resize API. Add an eligibility query that accepts only two or more visible rectangle nodes with one `parentId` and no transform lock. Extend `renderSelectionOverlay` with `group-selection-frame` plus fixed `9px` SVG rectangles bearing `data-group-resize-handle` for every direction.

Add an overlay `pointerdown` handler. It must capture the pointer, convert screen coordinates to the shared parent-local coordinates, snapshot layouts, and call `resizeGroup` per pointer move. Apply preview values using only `element.style.left/top/width/height`; redraw individual outlines, group frame, and handles from preview layouts. On cancel, remove those four temporary properties and redraw persistent state. On pointer-up, clear preview then dispatch `node.resizeMany` only if an item differs from its snapshot. Keep single-node `node.resize` untouched and remove the overlay listener in `destroy`.

- [ ] **Step 4: Add CSS and verify GREEN**

Add interactive group-handle styles while leaving the overlay itself `pointer-events: none`:

```css
.composeui-editor__selection-overlay [data-group-resize-handle] {
  fill: #ffffff;
  pointer-events: auto;
  stroke: var(--composeui-selection);
}
```

Map `n/s` to `ns-resize`, `e/w` to `ew-resize`, `ne/sw` to `nesw-resize`, and `nw/se` to `nwse-resize`.

Run: `bunx vitest run packages/editor/test/editor-view.test.ts packages/editor/test/group-resize.test.ts`

Expected: PASS.

Run: `bun run typecheck`

Expected: PASS.

Commit: `git add packages/editor/src/editor-view.ts packages/editor/src/editor.css packages/editor/test/editor-view.test.ts && git commit -m "feat(editor): resize multi-selection from eight handles"`.

### Task 4: Add Browser Coverage and Run Quality Gates

**Files:**
- Modify: `tests/e2e/m1-editor-spine.spec.ts`

- [ ] **Step 1: Write failing E2E tests**

Marquee-select `node-red` and `node-blue`, assert all eight group handles, drag `group-resize-se`, and verify both nodes change before mouse-up. Release, focus `editor-shell`, press `Meta+z`, and assert both original layouts return. Add a north-west test asserting the original south-east group corner remains fixed.

- [ ] **Step 2: Build the browser target**

Run: `bun run build`

Expected: PASS.

- [ ] **Step 3: Verify browser acceptance**

Run: `bun run test:e2e -- --grep "resizes a multi-selection"`

Expected: PASS.

- [ ] **Step 4: Run full verification and commit**

Run: `bun run check`

Expected: PASS for format, lint, typecheck, unit tests, and build.

Run: `bun run test:e2e`

Expected: PASS for all browser tests.

Commit: `git add tests/e2e/m1-editor-spine.spec.ts && git commit -m "test(editor): cover multi-selection resize workflow"`.

## Plan Self-Review

- Spec coverage: same-parent eligibility, eight handles, no flipping, preview-only state, cancellation, one transaction, undo, diagnostics, unit tests, and browser tests each map to a task.
- Placeholder scan: no `TODO`, `TBD`, or unspecified test activity remains.
- Type consistency: `ResizeManyNodeCommand`, `node.resizeMany`, `GroupResizeHandle`, `GroupResizeItem`, `GroupBounds`, `selectionBounds`, and `resizeGroup` use one spelling throughout.
