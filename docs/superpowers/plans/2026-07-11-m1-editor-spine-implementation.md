# M1 Editor Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a desktop free-layout editor spine in which users create, select, move, resize, reorder, delete, undo, redo, and inspect page nodes through a Workspace, SVG overlay, and Unity-style component tree.

**Architecture:** `@composeui/core` remains framework-neutral and owns the versioned page model, normalized record store, transactions, history, commands, canonical documents, and tree projections. A new framework-neutral `@composeui/editor` package owns only session state and DOM/SVG editor surfaces. `apps/playground` imports public APIs from both packages to host one deterministic M1 scenario.

**Tech Stack:** TypeScript, Bun Workspaces, Vite, Vitest, jsdom, fast-check, Playwright, DOM, SVG

---

## Scope and Guardrails

M1 implements Free Layout only. It must not introduce Auto Layout, Grid, framework adapters, business components, component definitions, bindings, Figma, Yjs, Worker, GPU, public host mounting APIs, or a full property panel.

The only persistent node visual is a rectangle. All view-specific state remains in `EditorSession`: viewport transform, selection, tree expansion, hover, drag preview, and active interaction. No M1 command writes any of those values to `PageDocument`.

## File Map

```text
packages/core/
├── src/schema.ts                  Page board, Free layout node and persistent flags
├── src/store.ts                   Immutable create/update/remove record operations
├── src/transaction.ts             Full record patch, inverse patch and commit events
├── src/history.ts                 Bounded undo/redo of committed transactions
├── src/commands.ts                Create/move/resize/delete/reorder/rename/visibility/lock commands
├── src/projections.ts             Tree and Free-layout read models
├── src/snapshot.ts                Canonical persisted PageDocument only
├── src/index.ts                   Public Core exports
└── test/
    ├── transaction-update.test.ts
    ├── history.test.ts
    ├── commands-free-layout.test.ts
    ├── projections.test.ts
    ├── properties.test.ts
    └── goldens/m1-free-layout.json

packages/editor/
├── package.json                   Private M1 editor workspace
├── tsconfig.json                  Composite project referencing Core
├── vite.config.ts                 ESM library build
└── src/
    ├── index.ts                   Public editor entry point
    ├── session.ts                 Ephemeral EditorSession store
    ├── coordinates.ts             Pure world/screen/local coordinate math
    ├── interactions.ts            Pointer interaction drafts and command commits
    ├── editor-view.ts             DOM page board and SVG overlay renderer
    ├── component-tree.ts          Unity-style tree renderer and DOM events
    └── editor.css                 Isolated M1 editor presentation

apps/playground/
├── package.json                   Add workspace dependency on @composeui/editor
├── src/main.ts                    Replace static M0 demonstration with scenario bootstrap
└── src/m1-free-layout-scenario.ts Deterministic document and test-facing actions

tests/e2e/
└── m1-editor-spine.spec.ts        Browser selection, drag, undo/redo and tree synchronization
```

### Task 1: Extend the persistent schema and normalized Store

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/store.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/store-update.test.ts`
- Modify: `packages/core/test/schema.test.ts`

- [ ] **Step 1: Write failing Store tests**

Create `packages/core/test/store-update.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore } from "../src/index"

describe("RecordStore persistent operations", () => {
  it("updates a record without mutating the prior store", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const after = before.withUpdated("page-1", { name: "Dashboard" })

    expect(before.get("page-1")).toMatchObject({ name: "Page 1", revision: 0 })
    expect(after.get("page-1")).toMatchObject({ name: "Dashboard", revision: 1 })
    expect(after.revision).toBe(1)
  })

  it("removes a record only from the next store", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const after = before.withRemoved("page-1")

    expect(before.get("page-1")).toBeDefined()
    expect(after.get("page-1")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Verify the test fails**

Run:

```bash
bunx vitest run packages/core/test/store-update.test.ts
```

Expected: FAIL because `RecordStore.withUpdated` does not exist.

- [ ] **Step 3: Replace M0 record contracts with M1 contracts**

In `packages/core/src/schema.ts`, define the following persistent model. `PageRecord` is the one page board for M1; all nodes must be its descendants.

```ts
export interface FreeLayout {
  mode: "free"
  x: number
  y: number
  width: number
  height: number
}

export interface PageRecord extends BaseRecord {
  typeName: "page"
  name: string
  width: number
  height: number
  background: string
  overflow: "visible" | "hidden" | "scroll"
  layout: { mode: "free" }
}

export interface NodeRecord extends BaseRecord {
  typeName: "node"
  nodeType: "rectangle"
  name: string
  parentId: string
  index: string
  layout: FreeLayout
  visible: boolean
  locked: boolean
  props: { fill: string }
}

export type PersistentRecord = DocumentRecord | PageRecord | NodeRecord

export interface PageDocument {
  schemaVersion: 1
  rootPageId: string
  records: PersistentRecord[]
}
```

Update `createEmptyDocument` to set `background: "#ffffff"`, `overflow: "hidden"`, and `layout: { mode: "free" }` on the page. Update every M0 test fixture to use `name`, `layout`, `visible`, `locked`, and `props: { fill }`.

In `packages/core/src/store.ts`, add these methods. They must clone incoming and outgoing values and increment `RecordStore.revision` once per call:

```ts
withUpdated<T extends PersistentRecord["typeName"]>(
  id: string,
  patch: Partial<Extract<PersistentRecord, { typeName: T }>>,
): RecordStore

withRemovedMany(ids: readonly string[]): RecordStore
```

`withUpdated` must reject a missing id with `MISSING_RECORD_ID`, preserve `id` and `typeName`, increment the record revision by one, and never accept a patch that changes its discriminant. `withRemoved` delegates to `withRemovedMany`.

- [ ] **Step 4: Run the focused tests and typecheck**

```bash
bunx vitest run packages/core/test/schema.test.ts packages/core/test/store.test.ts packages/core/test/store-update.test.ts
bunx tsc -p packages/core --pretty false
```

Expected: all focused tests PASS and Core typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/store.ts packages/core/src/index.ts packages/core/test
git commit -m "feat(core): add free layout page schema and record updates"
```

### Task 2: Make transactions reversible for create, update, and remove

**Files:**
- Modify: `packages/core/src/transaction.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/transaction-update.test.ts`

- [ ] **Step 1: Write failing transaction tests**

Create `packages/core/test/transaction-update.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { applyPatch, createEmptyDocument, RecordStore, transact } from "../src/index"

describe("record transaction", () => {
  it("creates an exact inverse for an update", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = transact(before, { kind: "local-command", commandId: "page.rename" }, (tx) => {
      tx.update("page-1", { name: "Dashboard" })
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.updated[0]).toMatchObject({ id: "page-1", before: { name: "Page 1" } })
    expect(applyPatch(result.store, result.inverse).get("page-1")).toMatchObject({ name: "Page 1" })
  })

  it("rejects a transaction that removes the page board", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = transact(before, { kind: "local-command", commandId: "node.delete" }, (tx) => {
      tx.remove("page-1")
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe("PAGE_REMOVE_FORBIDDEN")
    expect(before.get("page-1")).toBeDefined()
  })
})
```

- [ ] **Step 2: Verify the red state**

```bash
bunx vitest run packages/core/test/transaction-update.test.ts
```

Expected: FAIL because `TransactionDraft.update`, `TransactionDraft.remove`, and `applyPatch` do not exist.

- [ ] **Step 3: Implement the transaction draft, patch, and policy**

Replace `TransactionPatch` in `packages/core/src/transaction.ts` with:

```ts
export interface UpdatedRecordPatch {
  id: string
  typeName: PersistentRecord["typeName"]
  before: Partial<PersistentRecord>
  after: Partial<PersistentRecord>
}

export interface TransactionPatch {
  created: PersistentRecord[]
  updated: UpdatedRecordPatch[]
  removed: PersistentRecord[]
}

export interface TransactionDraft {
  create(record: PersistentRecord): void
  update(id: string, patch: Partial<PersistentRecord>): void
  remove(id: string): void
}
```

Implement a draft map that begins with cloned records from the Store, applies all draft operations in memory, validates before commit, and calls Store batch methods exactly once. Validation must enforce:

- the `DocumentRecord.rootPageId` exists and identifies a `PageRecord`;
- the page board cannot be removed;
- every `NodeRecord.parentId` exists and identifies either the page board or another node;
- no node is its own parent;
- sibling `index` strings are unique.

On validation failure, return `{ ok: false, store: before, diagnostics }`; do not emit a transaction event or change Store revision. Add `applyPatch(store, patch)` for history. It must process `removed`, then `updated`, then `created`, validate the resulting record set, and return a new Store.

Use transaction origin types below so M1 data can later distinguish local commands from undo/redo without changing persisted documents:

```ts
export type TransactionOrigin =
  | { kind: "local-command"; commandId: string }
  | { kind: "history-undo"; transactionId: string }
  | { kind: "history-redo"; transactionId: string }
  | { kind: "system-init" }
```

- [ ] **Step 4: Run transaction tests**

```bash
bunx vitest run packages/core/test/transaction.test.ts packages/core/test/transaction-update.test.ts
```

Expected: all transaction tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transaction.ts packages/core/src/index.ts packages/core/test/transaction-update.test.ts
git commit -m "feat(core): support reversible record transactions"
```

### Task 3: Add bounded History and Free Layout commands

**Files:**
- Create: `packages/core/src/history.ts`
- Modify: `packages/core/src/commands.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/history.test.ts`
- Create: `packages/core/test/commands-free-layout.test.ts`

- [ ] **Step 1: Write failing command and History tests**

Create `packages/core/test/history.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "../src/index"

describe("Editor history", () => {
  it("undoes and redoes one move as one history item", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    editor.dispatch({ id: "node.create", payload: { id: "node-1", parentId: "page-1", name: "Card", x: 0, y: 0, width: 100, height: 80, fill: "#2563eb" } })
    editor.dispatch({ id: "node.move", payload: { ids: ["node-1"], delta: { x: 40, y: 20 } } })

    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 40, y: 20 } })
    editor.undo()
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 0, y: 0 } })
    editor.redo()
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 40, y: 20 } })
  })
})
```

Create `packages/core/test/commands-free-layout.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "../src/index"

describe("Free Layout commands", () => {
  it("moves selected nodes by parent-local deltas and ignores locked nodes", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    editor.dispatch({ id: "node.create", payload: { id: "free", parentId: "page-1", name: "Free", x: 5, y: 10, width: 100, height: 80, fill: "#111827" } })
    editor.dispatch({ id: "node.setLocked", payload: { id: "free", locked: true } })
    const result = editor.dispatch({ id: "node.move", payload: { ids: ["free"], delta: { x: 20, y: 30 } } })

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe("NODE_LOCKED")
    expect(editor.getRecord("free")).toMatchObject({ layout: { x: 5, y: 10 } })
  })
})
```

- [ ] **Step 2: Verify the red state**

```bash
bunx vitest run packages/core/test/history.test.ts packages/core/test/commands-free-layout.test.ts
```

Expected: FAIL because `undo`, `redo`, `node.move`, and `node.setLocked` do not exist.

- [ ] **Step 3: Implement History**

Create `packages/core/src/history.ts`:

```ts
import type { TransactionPatch } from "./transaction"

export interface HistoryEntry {
  transactionId: string
  label: string
  forward: TransactionPatch
  inverse: TransactionPatch
}

export class History {
  readonly #limit: number
  readonly #undo: HistoryEntry[] = []
  readonly #redo: HistoryEntry[] = []

  constructor(limit = 100) {
    this.#limit = limit
  }

  push(entry: HistoryEntry): void {
    this.#undo.push(entry)
    if (this.#undo.length > this.#limit) this.#undo.shift()
    this.#redo.length = 0
  }

  takeUndo(): HistoryEntry | undefined { return this.#undo.pop() }
  takeRedo(): HistoryEntry | undefined { return this.#redo.pop() }
  restoreUndo(entry: HistoryEntry): void { this.#undo.push(entry) }
  restoreRedo(entry: HistoryEntry): void { this.#redo.push(entry) }
  get canUndo(): boolean { return this.#undo.length > 0 }
  get canRedo(): boolean { return this.#redo.length > 0 }
}
```

- [ ] **Step 4: Expand the Editor command contract**

In `packages/core/src/commands.ts`, define these command payloads and add them to `EditorCommand`:

```ts
type CreateNodeCommand = { id: "node.create"; payload: { id: string; parentId: string; name: string; x: number; y: number; width: number; height: number; fill: string } }
type MoveNodeCommand = { id: "node.move"; payload: { ids: string[]; delta: { x: number; y: number } } }
type ResizeNodeCommand = { id: "node.resize"; payload: { id: string; width: number; height: number } }
type DeleteNodeCommand = { id: "node.delete"; payload: { ids: string[] } }
type ReorderNodeCommand = { id: "node.reorder"; payload: { id: string; parentId: string; index: string } }
type RenameNodeCommand = { id: "node.rename"; payload: { id: string; name: string } }
type SetNodeVisibleCommand = { id: "node.setVisible"; payload: { id: string; visible: boolean } }
type SetNodeLockedCommand = { id: "node.setLocked"; payload: { id: string; locked: boolean } }
```

`createEditor` owns one `History`. Its `dispatch` function must route every successful local command through one transaction, push exactly one history entry, and return `Result<void>`. Add these methods:

```ts
undo(): Result<void>
redo(): Result<void>
canUndo(): boolean
canRedo(): boolean
subscribe(listener: (event: EditorChangeEvent) => void): () => void
```

`EditorChangeEvent` contains `store`, `transaction`, and `origin`; `subscribe` invokes listeners only after a successful commit, undo, or redo. `node.delete` must reject the page board, delete selected descendants before ancestors, and remove all descendants of selected nodes in one transaction. `node.move` and `node.resize` reject missing/non-node/locked records and reject dimensions below `1` with `INVALID_FREE_LAYOUT_SIZE`.

- [ ] **Step 5: Verify and commit**

```bash
bunx vitest run packages/core/test/history.test.ts packages/core/test/commands-free-layout.test.ts
bunx tsc -p packages/core --pretty false
git add packages/core/src/history.ts packages/core/src/commands.ts packages/core/src/index.ts packages/core/test
git commit -m "feat(core): add free layout commands and history"
```

### Task 4: Add Session Scope, coordinate math, and projections

**Files:**
- Create: `packages/editor/package.json`
- Create: `packages/editor/tsconfig.json`
- Create: `packages/editor/vite.config.ts`
- Create: `packages/editor/src/session.ts`
- Create: `packages/editor/src/coordinates.ts`
- Create: `packages/core/src/projections.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/editor/test/session.test.ts`
- Create: `packages/editor/test/coordinates.test.ts`
- Create: `packages/editor/test/session-separation.test.ts`
- Create: `packages/core/test/projections.test.ts`

- [ ] **Step 1: Write failing pure-state tests**

Create `packages/editor/test/coordinates.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { screenToWorld, worldToScreen, worldToParentLocal, zoomAt } from "../src/coordinates"

describe("Workspace coordinates", () => {
  it("round-trips world and screen coordinates", () => {
    const viewport = { x: 120, y: -40, zoom: 1.5 }
    expect(screenToWorld(worldToScreen({ x: 30, y: 60 }, viewport), viewport)).toEqual({ x: 30, y: 60 })
  })

  it("keeps the world point beneath the pointer stable while zooming", () => {
    const before = { x: 0, y: 0, zoom: 1 }
    const pointer = { x: 200, y: 100 }
    const after = zoomAt(before, pointer, 2)
    expect(screenToWorld(pointer, before)).toEqual(screenToWorld(pointer, after))
  })

  it("derives parent-local coordinates without using workspace zoom", () => {
    expect(worldToParentLocal({ x: 160, y: 90 }, { x: 100, y: 50 })).toEqual({ x: 60, y: 40 })
  })
})
```

Create `packages/editor/test/session-separation.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "../src/index"
import { EditorSession } from "@composeui/editor"

describe("Document and Session scopes", () => {
  it("does not serialize viewport or selection", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const session = new EditorSession()
    session.setViewport({ x: 20, y: 30, zoom: 2 })
    session.setSelection(["page-1"])

    expect(JSON.stringify(canonicalizeDocument(editor.getStore()))).not.toContain("viewport")
    expect(JSON.stringify(canonicalizeDocument(editor.getStore()))).not.toContain("selection")
  })
})
```

- [ ] **Step 2: Verify the red state**

```bash
bunx vitest run packages/editor/test/coordinates.test.ts packages/editor/test/session-separation.test.ts
```

Expected: FAIL because `@composeui/editor`, coordinate functions, and `EditorSession` do not exist.

- [ ] **Step 3: Create the editor workspace and Session store**

Create `packages/editor/package.json`:

```json
{
  "name": "@composeui/editor",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@composeui/core": "workspace:*" },
  "scripts": { "build": "vite build" }
}
```

Create `packages/editor/tsconfig.json` with `composite`, `declaration`, `declarationMap`, `emitDeclarationOnly`, `outDir: "dist"`, `rootDir: "src"`, a `references` entry for `../core`, and `include: ["src/**/*.ts"]`. Create `packages/editor/test/tsconfig.json` matching the Core test configuration. Create `packages/editor/vite.config.ts` with:

```ts
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
  },
})
```

Modify root `tsconfig.json` by adding `{ "path": "./packages/editor" }` to `references`. Install browser-test support before adding the DOM test:

```bash
bun add -d jsdom
```

Create `packages/editor/src/session.ts`:

```ts
export interface Viewport { x: number; y: number; zoom: number }
export interface EditorSessionState {
  viewport: Viewport
  selection: string[]
  expanded: string[]
  hoveredId: string | null
}

export class EditorSession {
  #state: EditorSessionState = {
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [],
    expanded: [],
    hoveredId: null,
  }
  #listeners = new Set<(state: EditorSessionState) => void>()

  getState(): EditorSessionState { return structuredClone(this.#state) }
  setViewport(viewport: Viewport): void { this.#state = { ...this.#state, viewport }; this.#emit() }
  setSelection(selection: readonly string[]): void { this.#state = { ...this.#state, selection: [...new Set(selection)] }; this.#emit() }
  toggleExpanded(id: string): void { const expanded = new Set(this.#state.expanded); expanded.has(id) ? expanded.delete(id) : expanded.add(id); this.#state = { ...this.#state, expanded: [...expanded] }; this.#emit() }
  setHoveredId(hoveredId: string | null): void { this.#state = { ...this.#state, hoveredId }; this.#emit() }
  subscribe(listener: (state: EditorSessionState) => void): () => void { this.#listeners.add(listener); return () => this.#listeners.delete(listener) }
  #emit(): void { const state = this.getState(); for (const listener of this.#listeners) listener(state) }
}
```

Create `packages/editor/src/coordinates.ts`:

```ts
import type { Viewport } from "./session"
export interface Point { x: number; y: number }
export function worldToScreen(point: Point, viewport: Viewport): Point { return { x: point.x * viewport.zoom + viewport.x, y: point.y * viewport.zoom + viewport.y } }
export function screenToWorld(point: Point, viewport: Viewport): Point { return { x: (point.x - viewport.x) / viewport.zoom, y: (point.y - viewport.y) / viewport.zoom } }
export function worldToParentLocal(point: Point, parentWorldOrigin: Point): Point { return { x: point.x - parentWorldOrigin.x, y: point.y - parentWorldOrigin.y } }
export function zoomAt(viewport: Viewport, screenPoint: Point, nextZoom: number): Viewport { const world = screenToWorld(screenPoint, viewport); return { zoom: nextZoom, x: screenPoint.x - world.x * nextZoom, y: screenPoint.y - world.y * nextZoom } }
```

Export `EditorSession` from `@composeui/editor`. Export no Session type from `@composeui/core`; update the separation test to import `EditorSession` from `@composeui/editor`.

- [ ] **Step 4: Add Core tree projections**

Create `packages/core/src/projections.ts`:

```ts
import type { NodeRecord, PageRecord } from "./schema"
import type { RecordStore } from "./store"

export interface TreeItem { id: string; depth: number; parentId: string | null; name: string; typeName: "page" | "node"; visible: boolean; locked: boolean; hasChildren: boolean }

export function getChildren(store: RecordStore, parentId: string): NodeRecord[] {
  return store.all().filter((record): record is NodeRecord => record.typeName === "node" && record.parentId === parentId).sort((left, right) => left.index.localeCompare(right.index))
}

export function getTreeItems(store: RecordStore, pageId: string, expanded: ReadonlySet<string>): TreeItem[] {
  const page = store.get(pageId)
  if (page?.typeName !== "page") return []
  const walk = (parent: PageRecord | NodeRecord, depth: number): TreeItem[] => {
    const children = getChildren(store, parent.id)
    const item: TreeItem = { id: parent.id, depth, parentId: parent.typeName === "node" ? parent.parentId : null, name: parent.name, typeName: parent.typeName, visible: parent.typeName === "page" ? true : parent.visible, locked: parent.typeName === "page" ? false : parent.locked, hasChildren: children.length > 0 }
    return expanded.has(parent.id) ? [item, ...children.flatMap((child) => walk(child, depth + 1))] : [item]
  }
  return walk(page, 0)
}
```

Write `packages/core/test/projections.test.ts` to create siblings with indexes `a0` and `b0`, expand the page, and assert that `getTreeItems` returns page, `a0`, then `b0` with depths `0, 1, 1`.

- [ ] **Step 5: Verify and commit**

```bash
bun install
bunx vitest run packages/editor/test packages/core/test/projections.test.ts
bun run typecheck
git add packages/editor packages/core/src/projections.ts packages/core/src/index.ts packages/core/test package.json bun.lock tsconfig.json
git commit -m "feat(editor): add session state and tree projections"
```

### Task 5: Render the editor Workspace, page board, SVG selection overlay, and component tree

**Files:**
- Create: `packages/editor/src/editor-view.ts`
- Create: `packages/editor/src/component-tree.ts`
- Create: `packages/editor/src/editor.css`
- Create: `packages/editor/src/index.ts`
- Create: `packages/editor/test/editor-view.test.ts`
- Modify: `apps/playground/package.json`
- Modify: `apps/playground/src/main.ts`
- Create: `apps/playground/src/m1-free-layout-scenario.ts`

- [ ] **Step 1: Write the DOM-level rendering test**

Create `packages/editor/test/editor-view.test.ts` with Vitest `environment: "jsdom"` configured at the file top:

```ts
// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import { mountEditor } from "../src/index"

describe("mountEditor", () => {
  it("renders a page board, component tree and SVG selection box", () => {
    const root = document.createElement("div")
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    editor.dispatch({ id: "node.create", payload: { id: "node-1", parentId: "page-1", name: "Card", x: 20, y: 30, width: 120, height: 80, fill: "#2563eb" } })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-1"])

    expect(root.querySelector("[data-testid='page-board']")).not.toBeNull()
    expect(root.querySelector("[data-node-id='node-1']")).not.toBeNull()
    expect(root.querySelector("[data-testid='selection-node-1']")).not.toBeNull()
    expect(root.querySelector("[data-testid='tree-node-1']")).not.toBeNull()
  })
})
```

- [ ] **Step 2: Verify the red state**

```bash
bunx vitest run packages/editor/test/editor-view.test.ts
```

Expected: FAIL because `mountEditor` does not exist.

- [ ] **Step 3: Implement the editor renderer**

`mountEditor(root, coreEditor, { pageId })` creates an editor-local DOM tree. It must return:

```ts
export interface MountedEditor {
  session: EditorSession
  destroy(): void
}
```

`editor-view.ts` must render, using semantic roles and stable test ids:

```text
<section data-testid="editor-shell">
  <aside aria-label="Component tree">...</aside>
  <main data-testid="workspace" aria-label="Workspace">
    <div data-testid="world" style="transform: translate(...) scale(...)">
      <section data-testid="page-board" aria-label="Page board">...</section>
    </div>
    <svg data-testid="selection-overlay">...</svg>
  </main>
</section>
```

Rules:

- The DOM page board applies its persistent width, height, background, and overflow.
- A visible rectangle node renders as an absolute child with `data-node-id`; a hidden node remains in the tree but is not rendered into the board.
- The SVG overlay is in screen coordinates. It uses `worldToScreen` to render one `<rect data-testid="selection-<id>">` per selected visible node.
- `coreEditor.subscribe` and `session.subscribe` schedule one synchronous render function; `destroy()` unsubscribes both handlers and removes the DOM root.
- The editor shell CSS uses `--composeui-*` variables, avoids global selectors beyond its mounted root, and gives the component tree a fixed 260px column.
- `component-tree.ts` calls `getTreeItems`, uses one `button` per row with `data-testid="tree-<id>"`, and clicking a row calls `session.setSelection([id])`. Its expand button calls `session.toggleExpanded(id)` without changing selection.

`apps/playground/src/m1-free-layout-scenario.ts` exports `createM1Scenario()` that creates the M1 page, adds two rectangles (`node-red`, `node-blue`), and returns the Core editor and page id. Replace the static M0 DOM in `apps/playground/src/main.ts` with a call to `mountEditor` and expose only this development-only test handle:

```ts
if (import.meta.env.DEV) {
  Object.assign(window, { __composeuiM1: { editor, mounted } })
}
```

Add `@composeui/editor: "workspace:*"` to the Playground dependencies.

- [ ] **Step 4: Run editor rendering tests and build**

```bash
bun install
bunx vitest run packages/editor/test/editor-view.test.ts
bun run typecheck
bun run build
```

Expected: editor rendering test, typecheck, and both package builds PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/editor apps/playground package.json bun.lock tsconfig.json
git commit -m "feat(editor): render workspace board and component tree"
```

### Task 6: Commit pointer interactions as Free Layout commands

**Files:**
- Create: `packages/editor/src/interactions.ts`
- Modify: `packages/editor/src/editor-view.ts`
- Create: `packages/editor/test/interactions.test.ts`
- Create: `tests/e2e/m1-editor-spine.spec.ts`

- [ ] **Step 1: Write failing pointer-session tests**

Create `packages/editor/test/interactions.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createPointerMoveSession } from "../src/interactions"

describe("pointer move session", () => {
  it("keeps preview state ephemeral and emits one parent-local delta on commit", () => {
    const session = createPointerMoveSession({ x: 100, y: 50 }, { x: 10, y: 20 }, 2)
    session.update({ x: 140, y: 90 })

    expect(session.preview()).toEqual({ x: 30, y: 40 })
    expect(session.commit()).toEqual({ x: 20, y: 20 })
  })
})
```

- [ ] **Step 2: Verify the red state**

```bash
bunx vitest run packages/editor/test/interactions.test.ts
```

Expected: FAIL because `createPointerMoveSession` does not exist.

- [ ] **Step 3: Implement interaction drafts**

Create `packages/editor/src/interactions.ts`:

```ts
import type { Point } from "./coordinates"

export interface PointerMoveSession {
  update(screen: Point): void
  preview(): Point
  commit(): Point
}

export function createPointerMoveSession(startScreen: Point, startLocal: Point, zoom: number): PointerMoveSession {
  let current = startScreen
  const localAt = (screen: Point): Point => ({ x: startLocal.x + (screen.x - startScreen.x) / zoom, y: startLocal.y + (screen.y - startScreen.y) / zoom })
  return {
    update(screen) { current = screen },
    preview() { return localAt(current) },
    commit() { const next = localAt(current); return { x: next.x - startLocal.x, y: next.y - startLocal.y } },
  }
}
```

In `editor-view.ts`, attach `pointerdown` only to unlocked rectangle nodes when the editor is in stage-edit mode. During pointer movement, update a nonpersistent DOM preview transform. On `pointerup`, dispatch exactly one `node.move` with the committed delta. On `Escape` or `pointercancel`, remove the preview and dispatch nothing. Do not dispatch commands from `pointermove`.

Add one resize handle with `data-testid="resize-<id>-se"`; it uses the same draft rule and commits exactly one `node.resize` with dimensions clamped to `1` or greater.

- [ ] **Step 4: Add browser regression coverage**

Create `tests/e2e/m1-editor-spine.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("synchronizes selection, free-layout drag, undo and redo", async ({ page }) => {
  await page.goto("/")
  const node = page.locator("[data-node-id='node-red']")

  await node.click()
  await expect(page.locator("[data-testid='selection-node-red']")).toBeVisible()
  await expect(page.locator("[data-testid='tree-node-red']")).toHaveAttribute("aria-selected", "true")

  const box = await node.boundingBox()
  if (box === null) throw new Error("node-red was not rendered")
  await page.mouse.move(box.x + 10, box.y + 10)
  await page.mouse.down()
  await page.mouse.move(box.x + 50, box.y + 40)
  await page.mouse.up()

  await expect(node).toHaveCSS("left", "40px")
  await page.keyboard.press("Meta+z")
  await expect(node).toHaveCSS("left", "0px")
  await page.keyboard.press("Meta+Shift+z")
  await expect(node).toHaveCSS("left", "40px")
})
```

In `editor-view.ts`, handle `Meta+z`/`Control+z` and `Meta+Shift+z`/`Control+Shift+z` only while the editor shell has focus. Add `tabindex="0"` to the shell and call `coreEditor.undo()`/`redo()` accordingly.

- [ ] **Step 5: Run focused and browser tests**

```bash
bunx vitest run packages/editor/test/interactions.test.ts packages/editor/test/editor-view.test.ts
bun run test:e2e -- tests/e2e/m1-editor-spine.spec.ts
```

Expected: interaction unit tests and the M1 Playwright flow PASS without arbitrary waits.

- [ ] **Step 6: Commit**

```bash
git add packages/editor tests/e2e/m1-editor-spine.spec.ts
git commit -m "feat(editor): commit free layout pointer interactions"
```

### Task 7: Cover tree operations, Session separation, Golden, and completion gate

**Files:**
- Modify: `packages/core/test/projections.test.ts`
- Create: `packages/core/test/properties.test.ts`
- Create: `packages/core/test/goldens/m1-free-layout.json`
- Create: `packages/core/test/m1-free-layout.golden.test.ts`
- Modify: `tests/e2e/m1-editor-spine.spec.ts`
- Modify: `docs/superpowers/specs/2026-07-11-specification-roadmap-design.md`
- Modify: `AGENTS.md`
- Modify: `docs/project-overview.md`

- [ ] **Step 1: Add command-sequence property test**

Create `packages/core/test/properties.test.ts`:

```ts
import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "../src/index"

describe("M1 command invariants", () => {
  it("never produces dangling parents after valid move and delete sequences", () => {
    fc.assert(fc.property(fc.array(fc.constantFrom("move", "delete"), { minLength: 1, maxLength: 30 }), (steps) => {
      const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
      editor.dispatch({ id: "node.create", payload: { id: "node-1", parentId: "page-1", name: "Card", x: 0, y: 0, width: 10, height: 10, fill: "#000000" } })
      for (const step of steps) {
        if (step === "move") editor.dispatch({ id: "node.move", payload: { ids: ["node-1"], delta: { x: 1, y: 1 } } })
        if (step === "delete") editor.dispatch({ id: "node.delete", payload: { ids: ["node-1"] } })
      }
      for (const record of editor.getStore().all()) {
        if (record.typeName === "node") expect(editor.getStore().get(record.parentId)).toBeDefined()
      }
    }))
  })
})
```

Add `fast-check` to root `devDependencies` with `bun add -d fast-check` rather than editing `bun.lock` manually.

- [ ] **Step 2: Add the M1 canonical Golden**

Create a deterministic M1 scenario that creates `node-red` and `node-blue`, moves `node-red`, hides `node-blue`, and serializes with `canonicalizeDocument`. Add `packages/core/test/m1-free-layout.golden.test.ts` using `readFile(new URL("./goldens/m1-free-layout.json", import.meta.url), "utf8")` and compare exact JSON plus trailing newline.

The golden must contain page board fields (`background`, `overflow`, `layout`), both node persistent layout records, and no session keys such as `viewport`, `selection`, `expanded`, `hoveredId`, `dragPreview`, or `history`.

- [ ] **Step 3: Expand E2E tree coverage**

Append a second test to `tests/e2e/m1-editor-spine.spec.ts`:

```ts
test("synchronizes component tree selection and persistent node flags", async ({ page }) => {
  await page.goto("/")
  await page.locator("[data-testid='tree-node-blue']").click()
  await expect(page.locator("[data-testid='selection-node-blue']")).toBeVisible()

  await page.locator("[data-testid='tree-node-blue']").press("Delete")
  await expect(page.locator("[data-node-id='node-blue']")).toHaveCount(0)
  await page.keyboard.press("Meta+z")
  await expect(page.locator("[data-node-id='node-blue']")).toBeVisible()
})
```

Implement tree-row `Delete` handling through `node.delete`; do not directly remove DOM elements.

- [ ] **Step 4: Run the entire M1 quality gate**

```bash
bun run format
bun run check
bun run test:e2e
```

Expected: formatting, lint, TypeScript, all Core/editor Vitest tests, JSON Goldens, both Vite builds, and all Chromium E2E tests PASS.

- [ ] **Step 5: Update completed-milestone documentation and commit**

Update the M1 status in `docs/superpowers/specs/2026-07-11-specification-roadmap-design.md`, `AGENTS.md`, and `docs/project-overview.md` only after the quality gate passes. State precisely that M1 supports Free Layout editor interactions and that Auto Layout/Grid, adapters, bindings, Figma, Yjs, performance layers, and advanced vectors remain unimplemented.

```bash
git add AGENTS.md docs/project-overview.md docs/superpowers/specs/2026-07-11-specification-roadmap-design.md packages/core packages/editor apps/playground tests package.json bun.lock tsconfig.json
git commit -m "feat: complete M1 editor spine"
```

## M1 Exit Criteria

M1 is complete only when all statements are true:

- Page board configuration and Free Layout records persist in canonical `PageDocument`.
- Workspace viewport, selection, hover, tree expansion, pointer preview, and history remain Session Scope or editor-local state.
- Every create/update/remove/reorder command is atomic, produces a reversible patch, and adds one history item.
- Invalid commands leave Store, History, and canonical document unchanged while returning structured diagnostics.
- The component tree and SVG overlay remain synchronized with the same selected node ids.
- Pointer move and resize preview without persistent writes, then commit once on completion.
- M1 Golden is readable and deterministic; all tests and E2E pass through root scripts.
- No M2–M6 product dependency has been added; `jsdom` is limited to editor DOM tests and `fast-check` is limited to M1 invariants.
