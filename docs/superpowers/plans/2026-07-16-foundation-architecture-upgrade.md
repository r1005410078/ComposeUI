# Foundation Architecture Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver M1.5 foundation upgrade — dependency guards, Command plugin kernel with dispose/`DispatchCommand`, canvas split, and Query/LayoutProjection type seams — without Auto/Grid or multi-contribution plugins.

**Architecture:** Keep Document write path as `dispatch → prepare → transact → history`. Replace the command `switch` with a registry filled by builtin + host `CommandPlugin`s installed only at `createEditor`. Editor canvas becomes focused modules under `canvas/`. Enforce package import boundaries with a check script. Spec: [2026-07-16-foundation-architecture-upgrade-design.md](../specs/2026-07-16-foundation-architecture-upgrade-design.md).

**Tech Stack:** TypeScript, Bun workspaces, Vitest, Vite lib builds, Oxlint, Playwright (smoke only)

**Tracks:** P0 (guards/docs) → P1 (command plugins + operation-log) → P2 (canvas split + query types)

---

## File map (target)

### P0

| Path | Role |
| --- | --- |
| `scripts/check-package-boundaries.mjs` | Fail on illegal cross-package / core layer imports |
| `package.json` | Wire `boundaries` into `check` |
| `docs/current-architecture.md` | Align with guards + post-layout tree |
| `packages/core/src/README.md` / `packages/editor/src/README.md` | Already exist; touch if drift |

### P1

| Path | Role |
| --- | --- |
| `packages/core/src/kernel/commands/types.ts` | `DispatchCommand`, command unions, plugin types |
| `packages/core/src/kernel/commands/registry.ts` | Command id → contribution map |
| `packages/core/src/kernel/commands/plugin.ts` | Install plugins, rollback, dispose bookkeeping |
| `packages/core/src/kernel/commands/editor.ts` | `createEditor`, `dispatch`/`execute`, history, dispose |
| `packages/core/src/kernel/commands/errors.ts` | `EditorInitializationError` |
| `packages/core/src/kernel/commands/builtin/index.ts` | Plugin `composeui.builtin` |
| `packages/core/src/kernel/commands/builtin/*.ts` | One file or small groups per command prepare |
| `packages/core/src/kernel/commands/index.ts` | Barrel for command public surface |
| Delete or thin: `packages/core/src/kernel/commands.ts` | After move |
| `packages/core/src/kernel/operations.ts` | `EditorOperation.command` → `DispatchCommand` |
| `packages/core/src/index.ts` | Export new types/errors |
| `packages/core/test/command-plugin.test.ts` | Registry/plugin/dispose tests |
| `packages/operation-log/src/replay/builtin-handlers.ts` | Accept `DispatchCommand` envelope |
| `packages/operation-log/test/*` | Adjust command type guards / missing-handler |

### P2

| Path | Role |
| --- | --- |
| `packages/core/src/query/tree.ts` | Move from `projections.ts` |
| `packages/core/src/query/types.ts` | `ResolvedBox`, `LayoutProjection`, `CreateLayoutProjection` |
| `packages/editor/src/canvas/mount.ts` | `mountEditor` assembly |
| `packages/editor/src/canvas/board-render.ts` | Page + nodes DOM |
| `packages/editor/src/canvas/overlay.ts` | SVG selection/handles |
| `packages/editor/src/canvas/pointer.ts` | Pointer state machine → dispatch |
| `packages/editor/src/canvas/preview.ts` | Preview source binding |
| Thin or delete `packages/editor/src/canvas/editor-view.ts` | Re-exports only if needed |
| `packages/editor/src/index.ts` | Export `mountEditor` from new path |
| Tests under `packages/editor/test/*` | Import path updates |

---

## P0 — Boundaries and docs

### Task 1: Package boundary check script

**Files:**
- Create: `scripts/check-package-boundaries.mjs`
- Modify: `package.json`
- Create: `scripts/fixtures/boundary-violations/` only if using file fixtures; prefer scanning real tree + unit-test the rules with synthetic paths in the script's self-check

- [ ] **Step 1: Add the checker script**

```js
// scripts/check-package-boundaries.mjs
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const root = new URL("..", import.meta.url).pathname
const errors = []

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === ".git") continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx|mjs|js)$/.test(name) && !name.endsWith(".d.ts")) out.push(p)
  }
  return out
}

const importRe = /from\s+["']([^"']+)["']/g

function checkFile(file) {
  const rel = relative(root, file)
  const text = readFileSync(file, "utf8")
  let m
  while ((m = importRe.exec(text))) {
    const spec = m[1]
    // Rule 1: no deep core imports from editor, operation-log, apps
    if (
      (rel.startsWith("packages/editor/") ||
        rel.startsWith("packages/operation-log/") ||
        rel.startsWith("apps/")) &&
      (spec.startsWith("@composeui/core/") ||
        spec.includes("packages/core/src/") ||
        /from\s+["']\.\.\/.*core\/src/.test(m[0]))
    ) {
      if (spec !== "@composeui/core") {
        errors.push(`${rel}: illegal core import ${spec}`)
      }
    }
    // Relative cross into core/src
    if (
      (rel.startsWith("packages/editor/") ||
        rel.startsWith("packages/operation-log/") ||
        rel.startsWith("apps/")) &&
      spec.includes("/core/src/")
    ) {
      errors.push(`${rel}: illegal relative core path ${spec}`)
    }
    // Rule 2: query must not import kernel commands/plugin
    if (rel.startsWith("packages/core/src/query/")) {
      if (
        spec.includes("kernel/commands") ||
        spec.includes("kernel/plugin") ||
        spec.endsWith("/commands") ||
        spec.includes("/commands/")
      ) {
        errors.push(`${rel}: query must not import commands/plugin (${spec})`)
      }
    }
  }
}

for (const file of walk(join(root, "packages")).concat(walk(join(root, "apps")))) {
  checkFile(file)
}

if (errors.length > 0) {
  console.error("Package boundary violations:\n" + errors.join("\n"))
  process.exit(1)
}
console.log("Package boundaries OK")
```

Tune the regex so legitimate `@composeui/core` passes and `@composeui/core/src/foo` fails. Also flag relative imports that resolve into another package's `src` if present in repo.

- [ ] **Step 2: Wire scripts**

In root `package.json`:

```json
"boundaries": "node scripts/check-package-boundaries.mjs",
"check": "bun run format:check && bun run lint && bun run boundaries && bun run typecheck && bun run test && bun run build"
```

- [ ] **Step 3: Run on clean tree**

Run: `bun run boundaries`
Expected: `Package boundaries OK` (exit 0). If failures, fix real illegal imports first.

- [ ] **Step 4: Negative check**

Temporarily add to a throwaway line in `packages/editor/src/index.ts`:

```ts
// import type { RecordStore } from "@composeui/core/src/store/store"
```

Run: `bun run boundaries`  
Expected: exit 1 mentioning illegal core import.  
Remove the throwaway line.

- [ ] **Step 5: Commit**

```bash
git add scripts/check-package-boundaries.mjs package.json
git commit -m "chore: add package boundary check to CI gate"
```

### Task 2: Align architecture docs for P0

**Files:**
- Modify: `docs/current-architecture.md`
- Modify: `packages/core/src/README.md` (note: `commands/` target lands in P1)
- Modify: `packages/editor/src/README.md` if canvas tree still lists only `editor-view.ts`

- [ ] **Step 1: Document P0 reality**

In `docs/current-architecture.md` §2.1, add:

```markdown
依赖守卫：`bun run boundaries`（见 `scripts/check-package-boundaries.mjs`）。
editor / operation-log / apps 只能 `from "@composeui/core"`。
Query 层不得依赖 commands。M1.5 Command 插件见 foundation 设计文档。
```

- [ ] **Step 2: Run check subset**

Run: `bun run boundaries && bun run typecheck && bun run test packages/core packages/editor`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add docs/current-architecture.md packages/core/src/README.md packages/editor/src/README.md
git commit -m "docs: note package boundaries and M1.5 foundation status"
```

---

## P1 — Command plugin kernel

### Task 3: Types and registry (TDD)

**Files:**
- Create: `packages/core/src/kernel/commands/types.ts`
- Create: `packages/core/src/kernel/commands/registry.ts`
- Create: `packages/core/src/kernel/commands/errors.ts`
- Test: `packages/core/test/command-registry.test.ts`

- [ ] **Step 1: Write failing registry tests**

```ts
// packages/core/test/command-registry.test.ts
import { describe, expect, it } from "vitest"
import { CommandRegistry } from "../src/kernel/commands/registry"
import type { CommandContribution, DispatchCommand } from "../src/kernel/commands/types"
import type { RecordStore } from "../src/store/store"

function noopContribution(id: string): CommandContribution {
  return {
    id,
    prepare: () => ({
      ok: true,
      value: () => undefined,
      diagnostics: [],
    }),
  }
}

describe("CommandRegistry", () => {
  it("registers and looks up by id", () => {
    const reg = new CommandRegistry()
    const unregister = reg.register("plugin.a", noopContribution("demo.ping"))
    expect(reg.get("demo.ping")?.id).toBe("demo.ping")
    unregister()
    expect(reg.get("demo.ping")).toBeUndefined()
  })

  it("rejects duplicate command ids", () => {
    const reg = new CommandRegistry()
    reg.register("plugin.a", noopContribution("demo.ping"))
    expect(() => reg.register("plugin.b", noopContribution("demo.ping"))).toThrowError(
      expect.objectContaining({ code: "COMMAND_ID_CONFLICT" }),
    )
  })

  it("unregister is idempotent", () => {
    const reg = new CommandRegistry()
    const unregister = reg.register("plugin.a", noopContribution("demo.ping"))
    unregister()
    unregister()
    expect(reg.get("demo.ping")).toBeUndefined()
  })

  it("removes all commands for a plugin id", () => {
    const reg = new CommandRegistry()
    reg.register("plugin.a", noopContribution("a.1"))
    reg.register("plugin.a", noopContribution("a.2"))
    reg.removePlugin("plugin.a")
    expect(reg.get("a.1")).toBeUndefined()
    expect(reg.get("a.2")).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `bunx vitest run packages/core/test/command-registry.test.ts`
Expected: FAIL (modules missing)

- [ ] **Step 3: Implement types, errors, registry**

```ts
// types.ts (essential exports)
export type CommandId = string
export interface DispatchCommand {
  id: CommandId
  payload?: unknown
}
export interface CommandContribution {
  id: CommandId
  prepare(
    store: RecordStore,
    command: DispatchCommand,
  ): Result<(draft: TransactionDraft) => void>
  label?: string
}
export interface CommandPluginApi {
  registerCommand(contribution: CommandContribution): () => void
}
export interface CommandPlugin {
  id: string
  register(api: CommandPluginApi): void | (() => void)
}
// Re-export / keep EditorCommand union from existing commands module during migration
```

```ts
// errors.ts
export class EditorInitializationError extends Error {
  readonly code: "PLUGIN_ID_CONFLICT" | "COMMAND_ID_CONFLICT" | "PLUGIN_INSTALL_FAILED"
  constructor(code: EditorInitializationError["code"], message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "EditorInitializationError"
    this.code = code
  }
}
```

```ts
// registry.ts
export class CommandRegistry {
  #byId = new Map<string, { pluginId: string; contribution: CommandContribution }>()
  register(pluginId: string, contribution: CommandContribution): () => void {
    if (this.#byId.has(contribution.id)) {
      throw new EditorInitializationError(
        "COMMAND_ID_CONFLICT",
        `Command id already registered: ${contribution.id}`,
      )
    }
    this.#byId.set(contribution.id, { pluginId, contribution })
    return () => {
      const cur = this.#byId.get(contribution.id)
      if (cur?.contribution === contribution) this.#byId.delete(contribution.id)
    }
  }
  get(id: string): CommandContribution | undefined {
    return this.#byId.get(id)?.contribution
  }
  removePlugin(pluginId: string): void {
    for (const [id, entry] of this.#byId) {
      if (entry.pluginId === pluginId) this.#byId.delete(id)
    }
  }
  clear(): void {
    this.#byId.clear()
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `bunx vitest run packages/core/test/command-registry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/kernel/commands packages/core/test/command-registry.test.ts
git commit -m "feat(core): add command registry and dispatch types"
```

### Task 4: Plugin installer with rollback

**Files:**
- Create: `packages/core/src/kernel/commands/plugin.ts`
- Test: `packages/core/test/command-plugin-install.test.ts`

- [ ] **Step 1: Failing install tests**

```ts
it("rolls back earlier plugins when a later plugin conflicts", () => {
  const reg = new CommandRegistry()
  const disposed: string[] = []
  const plugins = [
    {
      id: "first",
      register(api) {
        api.registerCommand(noopContribution("shared.id"))
        return () => disposed.push("first")
      },
    },
    {
      id: "second",
      register(api) {
        api.registerCommand(noopContribution("shared.id")) // conflict
      },
    },
  ]
  expect(() => installCommandPlugins(reg, plugins)).toThrowError(
    expect.objectContaining({ code: "COMMAND_ID_CONFLICT" }),
  )
  expect(reg.get("shared.id")).toBeUndefined()
  expect(disposed).toEqual(["first"])
})

it("rejects duplicate plugin ids", () => {
  const reg = new CommandRegistry()
  const plugins = [
    { id: "dup", register() {} },
    { id: "dup", register() {} },
  ]
  expect(() => installCommandPlugins(reg, plugins)).toThrowError(
    expect.objectContaining({ code: "PLUGIN_ID_CONFLICT" }),
  )
})
```

- [ ] **Step 2: Implement `installCommandPlugins`**

Semantics per spec §6.3–6.4:

- Track installed `{ pluginId, disposer?, commandUnregisters }`
- On failure: reverse-order call disposers, `reg.removePlugin` / `clear` as designed, rethrow `EditorInitializationError`
- Return handle: `{ disposeAll(): void }` used by `Editor.dispose`

- [ ] **Step 3: Tests PASS + commit**

```bash
git add packages/core/src/kernel/commands/plugin.ts packages/core/test/command-plugin-install.test.ts
git commit -m "feat(core): install command plugins with reverse rollback"
```

### Task 5: Move builtin prepares into plugin + createEditor on registry

**Files:**
- Create: `packages/core/src/kernel/commands/builtin/*.ts` (split by command family: `node-create.ts`, `node-transform.ts`, `node-tree.ts`, `page.ts`, `index.ts`)
- Create: `packages/core/src/kernel/commands/editor.ts`
- Create: `packages/core/src/kernel/commands/index.ts`
- Modify: `packages/core/src/kernel/operations.ts` — `command: DispatchCommand`
- Modify: `packages/core/src/index.ts`
- Remove: `packages/core/src/kernel/commands.ts` after re-exports work
- Test: existing `packages/core/test/commands*.ts`, `history.test.ts`, new dispose tests

- [ ] **Step 1: Extract prepare functions without behavior change**

Move each `prepare*` from old `commands.ts` into `builtin/` files. Each exports a `CommandContribution` or a function `register(api: CommandPluginApi)`.

```ts
// builtin/index.ts
export const builtinCommandPlugin: CommandPlugin = {
  id: "composeui.builtin",
  register(api) {
    api.registerCommand(nodeCreateContribution)
    api.registerCommand(nodeMoveContribution)
    // ... all current EditorCommand ids
  },
}
```

`prepare` signature uses `DispatchCommand`; inside, narrow:

```ts
prepare(store, command) {
  if (command.id !== "node.move") {
    return { ok: false, diagnostics: [{ code: "COMMAND_PAYLOAD_INVALID", severity: "error", message: "..." }] }
  }
  return prepareMove(store, command as MoveNodeCommand)
}
```

Prefer: registry only invokes contribution for matching id, so prepare can cast after id check.

- [ ] **Step 2: Implement `createEditor` in `editor.ts`**

Key behaviors:

```ts
export function createEditor(document: PageDocument, options: EditorOptions = {}): Editor {
  let store = RecordStore.fromDocument(document)
  const registry = new CommandRegistry()
  const plugins = [builtinCommandPlugin, ...(options.plugins ?? [])]
  const installation = installCommandPlugins(registry, plugins) // throws on conflict
  let disposed = false

  const disposedResult = (): Result<void> => ({
    ok: false,
    diagnostics: [{ code: "EDITOR_DISPOSED", severity: "error", message: "Editor is disposed." }],
  })

  const dispatch = (command: DispatchCommand): Result<void> => {
    if (disposed) return disposedResult()
    const contribution = registry.get(command.id)
    if (contribution === undefined) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "COMMAND_NOT_REGISTERED",
            severity: "error",
            message: `No command registered for id ${command.id}`,
          },
        ],
      }
    }
    // observe started → prepare → transact → history (copy logic from old createEditor)
    ...
  }

  return {
    get store() { return store },
    dispatch,
    execute: dispatch,
    dispose() {
      if (disposed) return
      disposed = true
      installation.disposeAll()
      listeners.clear()
      // do not call onDiagnostic after dispose completes
    },
    undo: () => (disposed ? disposedResult() : applyHistory("undo")),
    redo: () => (disposed ? disposedResult() : applyHistory("redo")),
    jumpToHistory: (index) => (disposed ? disposedResult() : jumpToHistory(index)),
    // read-only getters still work after dispose
    subscribe(listener) {
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    ...
  }
}
```

- [ ] **Step 3: Export surface**

```ts
// packages/core/src/index.ts — add
export type {
  DispatchCommand,
  CommandPlugin,
  CommandPluginApi,
  CommandContribution,
  CommandId,
} from "./kernel/commands/types"
export { EditorInitializationError } from "./kernel/commands/errors"
export { createEditor } from "./kernel/commands/editor"
// keep exporting EditorCommand variants and Editor type from commands barrel
```

- [ ] **Step 4: Run core tests**

Run: `bunx vitest run packages/core`
Expected: PASS (update any imports of old path)

- [ ] **Step 5: Add dispose + host plugin integration tests**

```ts
it("dispatches a host plugin command and observes it", () => {
  const seen: string[] = []
  const editor = createEditor(createEmptyDocument({ documentId: "d", pageId: "p" }), {
    plugins: [
      {
        id: "host.demo",
        register(api) {
          api.registerCommand({
            id: "host.noop",
            prepare: () => ({ ok: true, value: () => undefined, diagnostics: [] }),
          })
        },
      },
    ],
    operationObserver: {
      observe(op) {
        if (op.type === "document.command") seen.push(`${op.status}:${op.command.id}`)
      },
    },
  })
  expect(editor.dispatch({ id: "host.noop" }).ok).toBe(true)
  expect(seen.some((s) => s.includes("host.noop"))).toBe(true)
  editor.dispose()
  expect(editor.dispatch({ id: "host.noop" }).ok).toBe(false)
  expect(editor.dispatch({ id: "host.noop" }).diagnostics[0]?.code).toBe("EDITOR_DISPOSED")
})
```

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): route commands through plugin registry"
```

### Task 6: Operation-log accepts DispatchCommand + replay missing handler

**Files:**
- Modify: `packages/operation-log/src/replay/builtin-handlers.ts`
- Modify: any type guards that require full `EditorCommand`
- Test: `packages/operation-log/test/replay-handlers.test.ts` (or new case)

- [ ] **Step 1: Relax command extraction**

Replace `isEditorCommand` narrow check for replay of document commands with:

```ts
function commandFrom(event: OperationEvent): DispatchCommand | undefined {
  const payload = asRecord(event.payload)
  const command = asRecord(payload?.command)
  if (command === undefined || typeof command.id !== "string") return undefined
  return {
    id: command.id,
    ...(Object.prototype.hasOwnProperty.call(command, "payload")
      ? { payload: command.payload }
      : {}),
  }
}
```

Call `editor.dispatch(command)` — if result not ok and code `COMMAND_NOT_REGISTERED`, produce `missing-handler` difference with `eventType: \`document.command:${command.id}\``. Do not skip silently.

- [ ] **Step 2: Run operation-log tests**

Run: `bunx vitest run packages/operation-log`
Expected: PASS (update fixtures only if type assertions break)

- [ ] **Step 3: Commit**

```bash
git add packages/operation-log
git commit -m "feat(operation-log): replay open DispatchCommand envelopes"
```

### Task 7: P1 regression gate

- [ ] **Step 1: Full gate**

Run: `bun run check`
Expected: PASS

- [ ] **Step 2: Golden smoke**

Run: `bun run test:golden`
Expected: PASS (byte-identical document goldens)

- [ ] **Step 3: Empty commit note only if needed** — otherwise proceed to P2 after tag/message:

```bash
git commit --allow-empty -m "chore: P1 foundation command plugin track complete"
```

(Only if you need a marker; skip if last commit already marks completion.)

---

## P2 — Canvas split + Query types

### Task 8: Query module rename + LayoutProjection types

**Files:**
- Create: `packages/core/src/query/tree.ts` (move body from `projections.ts`)
- Create: `packages/core/src/query/types.ts`
- Delete or re-export: `packages/core/src/query/projections.ts` → re-export from `tree.ts` briefly then delete
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add types only**

```ts
// packages/core/src/query/types.ts
import type { RecordStore } from "../store/store"

export interface ResolvedBox {
  x: number
  y: number
  width: number
  height: number
}

export interface LayoutProjection {
  resolveNodeBox(nodeId: string): ResolvedBox | undefined
}

export type CreateLayoutProjection = (store: RecordStore) => LayoutProjection
```

Do **not** implement a default free-layout projection class.

- [ ] **Step 2: Move tree projections**

```ts
// tree.ts — same exports getChildren, getTreeItems, TreeItem
```

- [ ] **Step 3: Tests**

Run: `bunx vitest run packages/core/test/projections.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/query packages/core/src/index.ts
git commit -m "refactor(core): query tree module and LayoutProjection types"
```

### Task 9: Split editor-view (behavior-preserving)

**Strategy:** Move code in slices; keep tests green after each slice. Prefer extract-function then extract-file.

**Files:**
- Create: `packages/editor/src/canvas/board-render.ts`
- Create: `packages/editor/src/canvas/overlay.ts`
- Create: `packages/editor/src/canvas/pointer.ts`
- Create: `packages/editor/src/canvas/preview.ts`
- Create: `packages/editor/src/canvas/mount.ts`
- Modify/Delete: `packages/editor/src/canvas/editor-view.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: tests importing `../src/canvas/editor-view`

- [ ] **Step 1: Extract `board-render`**

Move pure DOM sync helpers (`indexChildren`, `applyNodeStyle`, `applyPageStyle`, `createNodeElement`, canvas board update loop) into `board-render.ts`. Export factory `createBoardRenderer(...)` used by mount.

Run: `bunx vitest run packages/editor/test/editor-view.test.ts`
Expected: PASS

- [ ] **Step 2: Extract `overlay`**

Move SVG selection/handle rendering into `overlay.ts`.

Run: same test file — PASS

- [ ] **Step 3: Extract `pointer`**

Move pointer down/move/up, marquee, resize sessions into `pointer.ts`. It may call into board/overlay for hit testing via injected deps (do not create circular imports).

Run: editor-view + interactions tests — PASS

- [ ] **Step 4: Extract `preview`**

Move `EditorPreviewSource` subscription and frame application into `preview.ts`.

- [ ] **Step 5: `mount.ts` owns `mountEditor`**

```ts
export function mountEditor(root, coreEditor, options): MountedEditor {
  // wire session, board, overlay, pointer, preview, destroy
}
```

`editor-view.ts` either deleted or:

```ts
/** @deprecated thin re-export — no state */
export { mountEditor } from "./mount"
export type { ... } from "./mount"
```

Prefer **delete** if all imports updated.

- [ ] **Step 6: Full editor tests**

Run: `bunx vitest run packages/editor`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/editor
git commit -m "refactor(editor): split canvas mount, board, overlay, pointer, preview"
```

### Task 10: P2 docs + final gate

**Files:**
- Modify: `docs/current-architecture.md`
- Modify: `packages/editor/src/README.md`
- Modify: `packages/core/src/README.md` (commands/ tree)
- Modify: `AGENTS.md` if source paths listed

- [ ] **Step 1: Update docs to final tree**

Document:

- `kernel/commands/{registry,plugin,editor,builtin}`
- `canvas/{mount,board-render,overlay,pointer,preview}`
- Query `tree.ts` + LayoutProjection types only

- [ ] **Step 2: Full check + golden + optional e2e**

```bash
bun run check
bun run test:golden
bun run test:e2e
```

Expected: all PASS (e2e if environment has browsers)

- [ ] **Step 3: Commit**

```bash
git add docs packages/core/src/README.md packages/editor/src/README.md AGENTS.md
git commit -m "docs: complete M1.5 foundation architecture map"
```

---

## Spec coverage checklist (self-review)

| Spec requirement | Task |
| --- | --- |
| Package boundary guards + check | Task 1–2 |
| Command registry + plugin install/rollback | Task 3–4 |
| Builtin plugin `composeui.builtin` | Task 5 |
| `DispatchCommand` + dispatch/execute | Task 5 |
| `Editor.dispose` + post-dispose API | Task 5 |
| operation-log / replay open envelope | Task 6 |
| No product behavior change / goldens | Task 7, 10 |
| Query tree + LayoutProjection types, no fake impl | Task 8 |
| Canvas split, thin/no editor-view | Task 9 |
| Docs sync | Task 2, 10 |
| No Auto/Grid/Adapter | All tasks (out of scope) |

## Out of scope (do not implement)

- Runtime `installPlugin` / multi contribution points
- Default `LayoutProjection` free implementation
- PanelRegistry → plugin system
- M2 layout engines

---

## Execution notes for agents

1. Prefer **TDD** on P1 registry/plugin before moving all prepare functions.
2. Keep commits small; never mix P2 canvas moves into P1 commits.
3. If `bun run check` fails on format, run `bun run format` then re-check.
4. When unsure of dispose semantics, re-read design §6.4 (formal).
