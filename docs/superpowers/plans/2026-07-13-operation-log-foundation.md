# Operation Log Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the framework-neutral operation-log package and capture deterministic core and session operations in memory.

**Architecture:** Core and EditorSession declare narrow observer ports. `@composeui/operation-log` implements the core port, while a small editor-owned bridge adapts session observations into the recorder; events are normalized, hashed, and appended immutably without a dependency cycle.

**Tech Stack:** TypeScript, Vitest, Vite library mode, Bun workspaces

---

### Task 1: Scaffold `@composeui/operation-log`

**Files:**
- Create: `packages/operation-log/package.json`
- Create: `packages/operation-log/tsconfig.json`
- Create: `packages/operation-log/vite.config.ts`
- Create: `packages/operation-log/src/index.ts`
- Modify: `tsconfig.json`
- Modify: `vitest.config.ts`

- [ ] **Step 1: Add the workspace package files**

```json
{
  "name": "@composeui/operation-log",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": { "types": "./dist/index.d.ts", "import": "./dist/index.js" } },
  "scripts": { "build": "vite build" },
  "dependencies": { "@composeui/core": "workspace:*" }
}
```

Use the core package's Vite and TypeScript settings, with a project reference to `../core`. Add `packages/operation-log` between core and editor in root `tsconfig.json`, and add the Vitest alias:

```ts
"@composeui/operation-log": new URL(
  "./packages/operation-log/src/index.ts",
  import.meta.url,
).pathname
```

- [ ] **Step 2: Verify the package graph**

Run: `bun run typecheck && bun run --cwd packages/operation-log build`
Expected: PASS and `packages/operation-log/dist/index.js` exists.

- [ ] **Step 3: Commit**

```bash
git add packages/operation-log tsconfig.json vitest.config.ts
git commit -m "chore(operation-log): scaffold package"
```

### Task 2: Define events and an immutable memory store

**Files:**
- Create: `packages/operation-log/src/events.ts`
- Create: `packages/operation-log/src/store.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/store.test.ts`

- [ ] **Step 1: Write the failing store test**

```ts
it("appends events in sequence order and rejects duplicates", async () => {
  const store = new MemoryOperationLogStore()
  await store.append([event({ eventId: "e1", sequence: 1 })])
  await expect(store.append([event({ eventId: "e1", sequence: 2 })])).rejects.toThrow(
    "DUPLICATE_OPERATION_EVENT",
  )
  await expect(store.append([event({ eventId: "e2", sequence: 3 })])).rejects.toThrow(
    "NON_CONTIGUOUS_OPERATION_SEQUENCE",
  )
  expect(await store.query({ sessionId: "s1" })).toEqual([
    expect.objectContaining({ eventId: "e1", sequence: 1 }),
  ])
})
```

- [ ] **Step 2: Run the test and verify failure**

Run: `bunx vitest run packages/operation-log/test/store.test.ts`
Expected: FAIL because the event and store modules do not exist.

- [ ] **Step 3: Implement the public contracts and store**

```ts
export type OperationCategory =
  | "document" | "history" | "session" | "workspace" | "diagnostic" | "system"
export type OperationStatus = "observed" | "started" | "succeeded" | "failed"

export interface OperationEvent<T = unknown> {
  schemaVersion: 1
  eventId: string
  sessionId: string
  projectId: string
  sequence: number
  timestamp: string
  category: OperationCategory
  type: string
  status: OperationStatus
  transactionId?: string
  causationId?: string
  payload: T
  diagnostics?: readonly Diagnostic[]
  beforeHash?: string
  afterHash?: string
}

export interface OperationLogQuery { sessionId: string; afterSequence?: number }
export interface OperationLogStore {
  append(events: readonly OperationEvent[]): Promise<void>
  query(query: OperationLogQuery): Promise<OperationEvent[]>
  subscribe(listener: () => void): () => void
}
```

`MemoryOperationLogStore.append` must structured-clone input, enforce unique IDs and contiguous per-session sequences, commit the batch atomically, and notify listeners only after success. `query` returns cloned events sorted by sequence.

- [ ] **Step 4: Run the test and typecheck**

Run: `bunx vitest run packages/operation-log/test/store.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/operation-log
git commit -m "feat(operation-log): add event store contracts"
```

### Task 3: Add canonical hashing and redaction

**Files:**
- Create: `packages/operation-log/src/canonical.ts`
- Create: `packages/operation-log/src/redaction.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/canonical.test.ts`
- Test: `packages/operation-log/test/redaction.test.ts`

- [ ] **Step 1: Write failing deterministic tests**

```ts
it("hashes equivalent key orders identically", async () => {
  expect(await hashCanonical({ b: 2, a: 1 })).toBe(await hashCanonical({ a: 1, b: 2 }))
})

it("masks sensitive values without mutating input", () => {
  const input = { node: "Card", authorization: "Bearer secret", url: "/x?token=secret" }
  expect(defaultRedactor(input)).toEqual({ node: "Card", authorization: "[REDACTED]", url: "/x" })
  expect(input.authorization).toBe("Bearer secret")
})
```

- [ ] **Step 2: Run tests and verify failure**

Run: `bunx vitest run packages/operation-log/test/canonical.test.ts packages/operation-log/test/redaction.test.ts`
Expected: FAIL because helpers are missing.

- [ ] **Step 3: Implement deterministic serialization, SHA-256, and redaction**

```ts
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  throw new Error("UNSUPPORTED_CANONICAL_VALUE")
}
```

Implement `hashCanonical` with `crypto.subtle.digest("SHA-256", new TextEncoder().encode(...))`. Implement `defaultRedactor` as a recursive clone that masks keys matching `authorization|token|password|secret`, strips URL query/hash, and rejects cycles with `UNSERIALIZABLE_OPERATION_PAYLOAD`.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run packages/operation-log/test/canonical.test.ts packages/operation-log/test/redaction.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/operation-log
git commit -m "feat(operation-log): add hashing and redaction"
```

### Task 4: Implement the recorder

**Files:**
- Create: `packages/operation-log/src/recorder.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/recorder.test.ts`

- [ ] **Step 1: Write the failing recorder test**

```ts
it("assigns sequence, causation and sanitized payload", async () => {
  const store = new MemoryOperationLogStore()
  const recorder = new OperationRecorder({ sessionId: "s1", projectId: "p1", store })
  const first = await recorder.record({ category: "system", type: "system.sessionStarted", status: "observed", payload: {} })
  await recorder.record({ category: "document", type: "document.command", status: "failed", causationId: first.eventId, payload: { token: "secret" } })
  await recorder.flush()
  expect(await store.query({ sessionId: "s1" })).toMatchObject([
    { sequence: 1 },
    { sequence: 2, causationId: first.eventId, payload: { token: "[REDACTED]" } },
  ])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/recorder.test.ts`
Expected: FAIL because `OperationRecorder` is missing.

- [ ] **Step 3: Implement recorder queueing**

```ts
export type RecordOperationInput<T> = Omit<OperationEvent<T>,
  "schemaVersion" | "eventId" | "sessionId" | "projectId" | "sequence" | "timestamp">

export class OperationRecorder {
  #sequence = 0
  #pending = Promise.resolve()
  async record<T>(input: RecordOperationInput<T>): Promise<OperationEvent<T>> {
    const event = { ...input, schemaVersion: 1 as const, eventId: crypto.randomUUID(),
      sessionId: this.sessionId, projectId: this.projectId, sequence: ++this.#sequence,
      timestamp: new Date().toISOString(), payload: this.redactor(input.payload) as T }
    this.#pending = this.#pending.then(() => this.store.append([event]))
    await this.#pending
    return structuredClone(event)
  }
  async flush(): Promise<void> { await this.#pending }
}
```

Constructor options must expose `sessionId`, `projectId`, `store`, optional `redactor`, `clock`, and `idFactory` for deterministic tests. Catch store failures into a bounded diagnostic callback without rejecting editor operations.

- [ ] **Step 4: Run tests**

Run: `bunx vitest run packages/operation-log/test/recorder.test.ts`
Expected: PASS including a test proving store failure calls `onDegraded` and does not reject `record`.

- [ ] **Step 5: Commit**

```bash
git add packages/operation-log
git commit -m "feat(operation-log): add operation recorder"
```

### Task 5: Emit core command and history observations

**Files:**
- Create: `packages/core/src/operations.ts`
- Modify: `packages/core/src/commands.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/operation-observer.test.ts`

- [ ] **Step 1: Write failing observer tests**

```ts
it("reports command attempts, success, failure and history operations", () => {
  const operations: EditorOperation[] = []
  const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }), {
    operationObserver: { observe: (operation) => operations.push(operation) },
  })
  editor.dispatch(createNodeCommand("node-1"))
  editor.dispatch(createNodeCommand("node-1"))
  editor.undo(); editor.redo(); editor.jumpToHistory(0)
  expect(operations.map(({ type, status }) => `${type}:${status}`)).toEqual([
    "document.command:started", "document.command:succeeded",
    "document.command:started", "document.command:failed",
    "history.undo:succeeded", "history.redo:succeeded", "history.jump:succeeded",
  ])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/core/test/operation-observer.test.ts`
Expected: FAIL because `operationObserver` is not an Editor option.

- [ ] **Step 3: Add the narrow core observer port**

```ts
export type EditorOperation =
  | { type: "document.command"; status: "started"; command: EditorCommand }
  | { type: "document.command"; status: "succeeded"; command: EditorCommand; transaction: HistoryEntry; before: PageDocument; after: PageDocument }
  | { type: "document.command"; status: "failed"; command: EditorCommand; diagnostics: Diagnostic[] }
  | { type: "history.undo" | "history.redo" | "history.jump"; status: "succeeded" | "failed"; transactionId?: string; currentIndex: number; diagnostics?: Diagnostic[] }

export interface EditorOperationObserver { observe(operation: EditorOperation): void }
```

Add `operationObserver?: EditorOperationObserver` to `EditorOptions`. In `dispatch`, clone the command and canonical documents before and after execution. Emit failures before returning. Instrument undo, redo, and jump including empty-history failures. Wrap observer calls in `try/catch` and report `EDITOR_OPERATION_OBSERVER_ERROR` through the existing diagnostic path.

- [ ] **Step 4: Run focused and regression tests**

Run: `bunx vitest run packages/core/test/operation-observer.test.ts packages/core/test/history.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core
git commit -m "feat(core): expose operation observer"
```

### Task 6: Adapt core and session operations into the recorder

**Files:**
- Create: `packages/operation-log/src/adapters/core-observer.ts`
- Create: `packages/editor/src/operation-log-adapter.ts`
- Modify: `packages/editor/package.json`
- Modify: `packages/editor/tsconfig.json`
- Modify: `packages/editor/src/session.ts`
- Modify: `packages/editor/src/index.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/core-observer.test.ts`
- Test: `packages/editor/test/session.test.ts`

- [ ] **Step 1: Write failing adapter and session tests**

```ts
it("records a successful core command with hashes and patch", async () => {
  const { recorder, store } = fixture()
  const observer = createCoreOperationObserver(recorder)
  const editor = createEditor(emptyDocument(), { operationObserver: observer })
  editor.dispatch(createNodeCommand("node-1"))
  await recorder.flush()
  expect(await store.query({ sessionId: "s1" })).toContainEqual(expect.objectContaining({
    type: "document.command", status: "succeeded",
    beforeHash: expect.any(String), afterHash: expect.any(String),
    payload: expect.objectContaining({ command: createNodeCommand("node-1") }),
  }))
})

it("emits typed session changes", () => {
  const events: SessionOperation[] = []
  const session = new EditorSession({ operationObserver: { observe: (event) => events.push(event) } })
  session.setSelection(["node-1"]); session.setViewport({ x: 1, y: 2, zoom: 2 })
  expect(events.map((event) => event.type)).toEqual(["session.selection", "session.viewport"])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/core-observer.test.ts packages/editor/test/session.test.ts`
Expected: FAIL because adapters and session observer options are missing.

- [ ] **Step 3: Implement adapters**

`createCoreOperationObserver(recorder)` maps core operations to recorder events, computes canonical before/after hashes, includes successful transaction patches, and serializes its async hashing/recording chain so observer callback timing cannot reorder events. Add `EditorSessionOptions.operationObserver`, emit only when a field actually changes, and define `SessionOperation` unions for selection, viewport, expanded tree, grid visibility, interaction mode, and hovered ID.

Add `@composeui/operation-log` as an editor workspace dependency and TypeScript project reference. Put `createSessionOperationObserver(recorder)` in `packages/editor/src/operation-log-adapter.ts`, not in the operation-log package, so operation-log never imports editor. The adapter coalesces viewport events and retains exact final values.

```ts
export function createCoreOperationObserver(recorder: OperationRecorder): EditorOperationObserver {
  return { observe(operation) { void recordCoreOperation(recorder, structuredClone(operation)) } }
}
```

- [ ] **Step 4: Run package tests and checks**

Run: `bunx vitest run packages/core/test packages/operation-log/test packages/editor/test/session.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core packages/editor packages/operation-log
git commit -m "feat(operation-log): capture core and session operations"
```

### Task 7: Verify the foundation

**Files:**
- Modify only if verification exposes a defect in files from Tasks 1-6.

- [ ] **Step 1: Run complete verification**

Run: `bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build`
Expected: all commands PASS.

- [ ] **Step 2: Confirm repository state**

Run: `git status --short`
Expected: no output.
