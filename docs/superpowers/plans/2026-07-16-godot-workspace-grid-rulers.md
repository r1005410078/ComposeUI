# Godot-style Workspace Grid & Rulers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace CSS-only workspace grid with a Canvas2D underlay (infinite world grid + rulers/cursor readout), add session `gridSize`/`snapEnabled`, and apply real free-layout move/resize snapping without changing PageDocument or DOM node rendering.

**Architecture:** Pure snap math in `session/snap.ts`; session fields for visibility/size/snap; `canvas/workspace-canvas.ts` redraws from viewport; pointer applies snap on preview/commit; toolbar exposes controls. Spec: [2026-07-16-godot-workspace-grid-rulers-design.md](../specs/2026-07-16-godot-workspace-grid-rulers-design.md).

**Tech Stack:** TypeScript, Vitest (jsdom), existing `@composeui/editor` canvas mount stack, Playwright smoke optional

---

## File map

| Path | Role |
| --- | --- |
| Create `packages/editor/src/session/snap.ts` | `snapScalar`, `snapPoint`, `snapRect` |
| Modify `packages/editor/src/session/session.ts` | `gridSize`, `snapEnabled` + setters + session ops |
| Create `packages/editor/src/canvas/workspace-canvas.ts` | Canvas2D grid + rulers + cursor |
| Modify `packages/editor/src/canvas/mount.ts` | Replace CSS grid div with workspace-canvas; DPR/resize; redraw on session |
| Modify `packages/editor/src/canvas/pointer.ts` (and pan/marquee if needed) | Snap on move/resize preview+commit; Alt disables snap |
| Modify `packages/editor/src/workspace/toolbar.ts` | Snap toggle + grid size control |
| Modify `packages/editor/src/styles/editor.css` | Layout for canvas underlay + ruler chrome; retire CSS grid background as primary |
| Modify `packages/editor/src/index.ts` | Export snap helpers if useful for tests |
| Test `packages/editor/test/snap.test.ts` | Pure snap unit tests |
| Test `packages/editor/test/session.test.ts` | Extend for new fields |
| Test `packages/editor/test/workspace-canvas.test.ts` | Visible line range / redraw contract (jsdom canvas mock if needed) |
| Test `packages/editor/test/editor-view.test.ts` / interactions | Snap on commit behavior |
| Optional E2E `tests/e2e/m1-editor-spine.spec.ts` | Smoke grid/snap |
| Update `docs/current-architecture.md` | Session fields + canvas underlay |

**Constants (nail):**

```ts
export const DEFAULT_GRID_SIZE = 8
export const DEFAULT_SNAP_ENABLED = true
export const GRID_MAJOR_EVERY = 4
export const MIN_GRID_SIZE = 1
export const MAX_GRID_SIZE = 1024
```

---

### Task 1: Snap pure functions (TDD)

**Files:**
- Create: `packages/editor/src/session/snap.ts`
- Create: `packages/editor/test/snap.test.ts`
- Modify: `packages/editor/src/index.ts` (optional export)

- [ ] **Step 1: Write failing tests**

```ts
// packages/editor/test/snap.test.ts
import { describe, expect, it } from "vitest"
import { snapPoint, snapRect, snapScalar } from "../src/session/snap"

describe("snapScalar", () => {
  it("rounds to nearest step", () => {
    expect(snapScalar(0, 8)).toBe(0)
    expect(snapScalar(3, 8)).toBe(0)
    expect(snapScalar(4, 8)).toBe(8)
    expect(snapScalar(12, 8)).toBe(16)
    expect(snapScalar(-3, 8)).toBe(0)
    expect(snapScalar(-5, 8)).toBe(-8)
  })

  it("rejects non-positive or non-finite step", () => {
    expect(() => snapScalar(1, 0)).toThrowError("INVALID_GRID_SIZE")
    expect(() => snapScalar(1, -2)).toThrowError("INVALID_GRID_SIZE")
    expect(() => snapScalar(1, Number.NaN)).toThrowError("INVALID_GRID_SIZE")
  })
})

describe("snapRect", () => {
  it("snaps origin and keeps min size 1", () => {
    const r = snapRect({ x: 3, y: 5, width: 10, height: 10 }, 8)
    expect(r.x % 8).toBe(0)
    expect(r.y % 8).toBe(0)
    expect(r.width).toBeGreaterThanOrEqual(1)
    expect(r.height).toBeGreaterThanOrEqual(1)
  })

  it("snaps only requested edges on resize-like updates", () => {
    const r = snapRect(
      { x: 0, y: 0, width: 13, height: 20 },
      8,
      { right: true, bottom: true },
    )
    expect(r.x).toBe(0)
    expect(r.y).toBe(0)
    expect(r.width).toBe(16)
    expect(r.height).toBe(24)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `bunx vitest run packages/editor/test/snap.test.ts`  
Expected: FAIL module not found

- [ ] **Step 3: Implement `snap.ts`**

```ts
// packages/editor/src/session/snap.ts
export function assertValidGridSize(step: number): void {
  if (!Number.isFinite(step) || step <= 0 || step < 1 || step > 1024) {
    throw new Error("INVALID_GRID_SIZE")
  }
}

export function snapScalar(value: number, step: number): number {
  assertValidGridSize(step)
  if (!Number.isFinite(value)) throw new Error("INVALID_COORDINATE")
  return Math.round(value / step) * step
}

export function snapPoint(
  point: { x: number; y: number },
  step: number,
): { x: number; y: number } {
  return { x: snapScalar(point.x, step), y: snapScalar(point.y, step) }
}

export function snapRect(
  rect: { x: number; y: number; width: number; height: number },
  step: number,
  edges: { left?: boolean; top?: boolean; right?: boolean; bottom?: boolean } = {
    left: true,
    top: true,
    right: true,
    bottom: true,
  },
): { x: number; y: number; width: number; height: number } {
  assertValidGridSize(step)
  let { x, y, width, height } = rect
  let right = x + width
  let bottom = y + height
  if (edges.left) x = snapScalar(x, step)
  if (edges.top) y = snapScalar(y, step)
  if (edges.right) right = snapScalar(right, step)
  if (edges.bottom) bottom = snapScalar(bottom, step)
  width = Math.max(1, right - x)
  height = Math.max(1, bottom - y)
  // If only size edges snapped, re-derive from snapped right/bottom
  if (edges.right && !edges.left) x = right - width
  if (edges.bottom && !edges.top) y = bottom - height
  return { x, y, width, height }
}
```

Tune edge logic so unit tests pass; if `right: true, bottom: true` only, snap width/height endpoints as in test.

- [ ] **Step 4: Tests PASS**

Run: `bunx vitest run packages/editor/test/snap.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/session/snap.ts packages/editor/test/snap.test.ts
git commit -m "feat(editor): add pure grid snap helpers"
```

---

### Task 2: Session gridSize + snapEnabled

**Files:**
- Modify: `packages/editor/src/session/session.ts`
- Modify: `packages/editor/test/session.test.ts`
- Modify: `packages/editor/src/workspace/replay-preview-source.ts` (readSession validation)
- Modify: any type that clones full `EditorSessionState` (operation-log session payloads)

- [ ] **Step 1: Failing session tests**

```ts
it("sets grid size and snap enabled", () => {
  const session = new EditorSession()
  session.setGridSize(16)
  session.setSnapEnabled(false)
  expect(session.getState().gridSize).toBe(16)
  expect(session.getState().snapEnabled).toBe(false)
})

it("rejects invalid grid size", () => {
  const session = new EditorSession()
  expect(() => session.setGridSize(0)).toThrowError("INVALID_GRID_SIZE")
})
```

- [ ] **Step 2: Extend state**

```ts
export interface EditorSessionState {
  // existing fields...
  gridVisible: boolean
  gridSize: number      // default 8
  snapEnabled: boolean  // default true
  interactionMode: InteractionMode
}

export type SessionOperation =
  // existing...
  | { type: "session.gridSize"; gridSize: number }
  | { type: "session.snapEnabled"; snapEnabled: boolean }
```

Add `setGridSize` / `setSnapEnabled` with short-circuit + `#observe` + `#emit`, mirroring `setGridVisible`.

- [ ] **Step 3: Update replay-preview-source `readSession`**

Require `typeof gridSize === "number" && gridSize > 0` and `typeof snapEnabled === "boolean"` when present; for backward compatibility with old checkpoints missing fields, default `gridSize: 8`, `snapEnabled: true` if absent (document choice: **defaults for missing** so old logs still load).

- [ ] **Step 4: Run session + related tests**

Run: `bunx vitest run packages/editor/test/session.test.ts packages/editor/test/replay-preview-source.test.ts packages/editor/test/session-properties.test.ts`  
Expected: PASS (fix any property tests that construct full state)

- [ ] **Step 5: Commit**

```bash
git add packages/editor/src/session packages/editor/test packages/editor/src/workspace/replay-preview-source.ts
git commit -m "feat(editor): session gridSize and snapEnabled"
```

---

### Task 3: Workspace Canvas2D grid layer

**Files:**
- Create: `packages/editor/src/canvas/workspace-canvas.ts`
- Create: `packages/editor/test/workspace-canvas.test.ts`
- Modify: `packages/editor/src/canvas/mount.ts`
- Modify: `packages/editor/src/styles/editor.css`

- [ ] **Step 1: API sketch + pure “visible line indices” helper (testable without full canvas)**

```ts
// workspace-canvas.ts
export const GRID_MAJOR_EVERY = 4

export function visibleGridLines(
  worldMin: number,
  worldMax: number,
  step: number,
): number[] {
  // return world coordinates of lines from floor(min/step)*step .. ceil(max/step)*step
}

export interface WorkspaceCanvas {
  element: HTMLCanvasElement
  setSize(cssWidth: number, cssHeight: number, dpr: number): void
  redraw(input: {
    viewport: Viewport
    gridVisible: boolean
    gridSize: number
    cursorWorld: { x: number; y: number } | null
    showRulers: boolean
  }): void
  destroy(): void
}

export function createWorkspaceCanvas(): WorkspaceCanvas
```

- [ ] **Step 2: Unit test line range**

```ts
it("lists grid lines covering the visible world span", () => {
  expect(visibleGridLines(-5, 20, 8)).toEqual([-8, 0, 8, 16, 24])
})
```

- [ ] **Step 3: Implement Canvas drawing**

- Full-size canvas under the `world` layer (sibling before world in `workspace`), `position:absolute; inset:0; pointer-events:none` (rulers may need a separate hit-test none chrome strip if drawn on same canvas).
- `redraw`: clear; if `gridVisible`, for each vertical/horizontal line in expanded world AABB of viewport, stroke minor/major colors from CSS variables (`getComputedStyle` on host for `--composeui-canvas-grid-minor/major`).
- Transform: world point → screen via existing `worldToScreen`.
- When `zoom * gridSize < ~4` CSS px, skip minor lines (only majors) — constant documented in code.
- Rulers: reserve top ~20px and left ~20px of canvas (or draw rulers in padded area); tick marks + labels for world coords; if `cursorWorld`, draw cursor lines on rulers and text readout.

- [ ] **Step 4: Wire mount.ts**

- Remove reliance on CSS `backgroundSize` grid as primary (keep class removable or hide old `workspace-grid` div).
- Create `createWorkspaceCanvas()`, append as first child of `workspace`.
- On session change (viewport / gridVisible / gridSize) and `ResizeObserver` on workspace: `setSize` + `redraw`.
- Track last pointer world position for cursor (from pointer layer or mousemove on workspace with `pointer-events` on a transparent overlay only for cursor tracking — **or** have pointer controller report cursor via callback; simplest: `workspace.addEventListener("pointermove")` in mount for cursor only).

- [ ] **Step 5: CSS**

```css
.composeui-editor__workspace-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  z-index: 0;
}
.composeui-editor__workspace-world {
  z-index: 1;
}
.composeui-editor__workspace-overlay {
  z-index: 2;
}
```

Ensure workspace is `position: relative`.

- [ ] **Step 6: Tests**

Run: `bunx vitest run packages/editor/test/workspace-canvas.test.ts packages/editor/test/editor-view.test.ts`  
Expected: PASS (update any test that queried CSS background grid)

- [ ] **Step 7: Commit**

```bash
git add packages/editor/src/canvas/workspace-canvas.ts packages/editor/src/canvas/mount.ts packages/editor/src/styles/editor.css packages/editor/test
git commit -m "feat(editor): Canvas2D workspace grid and rulers underlay"
```

---

### Task 4: Toolbar snap + grid size

**Files:**
- Modify: `packages/editor/src/workspace/toolbar.ts`
- Modify: `packages/editor/test/workspace-toolbar.test.ts`

- [ ] **Step 1: UI**

Beside existing grid toggle:

- Button `workspace-tool-snap` toggles `snapEnabled` (pressed = on)
- Control for grid size: `<select data-testid="workspace-grid-size">` options 8,16,32 + optional number input; on change `session.setGridSize(n)`

- [ ] **Step 2: Tests**

```ts
it("toggles snap and sets grid size", () => {
  // mount toolbar, click snap, change select, assert session state
})
```

- [ ] **Step 3: Commit**

```bash
git add packages/editor/src/workspace/toolbar.ts packages/editor/test/workspace-toolbar.test.ts
git commit -m "feat(editor): toolbar controls for snap and grid size"
```

---

### Task 5: Pointer snap on move/resize

**Files:**
- Modify: `packages/editor/src/canvas/pointer.ts`
- Possibly `packages/editor/src/canvas/pointer-pan.ts` (no snap)
- Test: extend `packages/editor/test/editor-view.test.ts` or new `pointer-snap.test.ts`

- [ ] **Step 1: Helper inside pointer**

```ts
function shouldSnap(session: EditorSessionState, event: { altKey?: boolean }): boolean {
  return session.snapEnabled && event.altKey !== true
}
```

- [ ] **Step 2: Move commit**

When computing final delta for `node.move`:

1. For each top-level moved node, compute unsnapped target `x,y`
2. If shouldSnap: `snapPoint({x,y}, gridSize)`
3. Derive delta from snapped target − start layout (or snap delta components — prefer **snap absolute position** then delta = snapped − original)

Preview transforms must use the same snapped geometry.

- [ ] **Step 3: Resize / group resize**

On commit of `node.resize` / `node.resizeMany`, run `snapRect` with edges matching the active handle (map n/e/s/w/ne/... to left/right/top/bottom flags). Preview uses snapped rect.

- [ ] **Step 4: Tests**

- Mock or drive pointer sessions with known start and end; assert dispatch payload positions multiples of gridSize when snap on
- Alt held → not snapped
- snapEnabled false → not snapped

- [ ] **Step 5: Run editor tests**

Run: `bunx vitest run packages/editor`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/editor/src/canvas/pointer.ts packages/editor/test
git commit -m "feat(editor): snap free-layout move and resize to grid"
```

---

### Task 6: Docs + regression gate

**Files:**
- Modify: `docs/current-architecture.md` (session fields, canvas underlay)
- Modify: `packages/editor/src/README.md` (list snap.ts, workspace-canvas.ts)

- [ ] **Step 1: Update docs** briefly

- [ ] **Step 2: Full gate**

```bash
bun run check
bun run test:golden
```

Expected: PASS. Golden documents unchanged for scenarios that do not move nodes.

- [ ] **Step 3: Optional E2E**

Add or extend smoke: toggle grid, set size 16, create/move node, assert position % 16 === 0 (via test API or data attributes if available). Skip if too flaky; unit coverage is required.

- [ ] **Step 4: Commit**

```bash
git add docs packages/editor/src/README.md
git commit -m "docs: document workspace grid snap and canvas underlay"
```

---

## Spec coverage checklist

| Spec requirement | Task |
| --- | --- |
| snap pure functions | Task 1 |
| Session gridSize / snapEnabled | Task 2 |
| Canvas2D infinite grid | Task 3 |
| Rulers + cursor readout | Task 3 |
| Replace CSS grid as primary | Task 3 |
| Toolbar controls | Task 4 |
| Move/resize snap + Alt | Task 5 |
| Not in PageDocument | Task 2 + 6 (golden) |
| Nodes stay DOM | All (no board-render rewrite) |
| Page board reference frame | Task 3 (grid not clipped to board) |

## Out of scope

- Guides, measure tool, node-to-node snap  
- WebGL  
- M2 Auto/Grid layout modes  
- Full scene canvas node rendering  

---

## Execution notes

1. Prefer TDD on snap and session before canvas.
2. Keep `DispatchCommand` / core plugins untouched.
3. When in doubt on board origin, match existing `board-render` / viewport transforms.
