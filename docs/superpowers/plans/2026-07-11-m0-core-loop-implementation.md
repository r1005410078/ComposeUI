# M0 Core Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first runnable ComposeUI vertical slice: create a minimal document, execute `node.create` through an atomic transaction, serialize a canonical snapshot, and render the result in the Vite Playground.

**Architecture:** A framework-neutral `@composeui/core` package owns schema, normalized records, transactions, commands, diagnostics, and snapshots. A vanilla TypeScript Playground consumes only the public package API. Vitest protects domain behavior and a JSON golden; Playwright verifies the browser path.

**Tech Stack:** TypeScript, Bun Workspaces, Oxlint, Oxfmt, Vite, Vitest, Playwright

---

## Scope

This milestone implements only:

- Repository and toolchain scaffold.
- Minimal `PageDocument`, page board, and node records.
- Normalized immutable Record Store.
- Atomic transaction with forward/inverse patches.
- One `node.create` command.
- Canonical JSON snapshot and one reviewed golden file.
- One deterministic Playground scenario and one browser smoke test.

It does not implement selection, history UI, workspace pan/zoom, drag/resize, component tree, Auto Layout, Grid, framework adapters, component definitions, bindings, Figma, Yjs, or GPU rendering.

## File Map

```text
.
├── .gitignore                         Generated files and local artifacts
├── .oxfmtrc.json                      Repository formatter configuration
├── .oxlintrc.json                     Repository lint configuration
├── package.json                       Bun workspace and stable root scripts
├── playwright.config.ts               Browser test configuration
├── tsconfig.base.json                 Shared strict TypeScript rules
├── tsconfig.json                      Solution project references
├── vitest.config.ts                   Unit and golden test discovery
├── apps/playground/
│   ├── index.html                     Playground HTML entry
│   ├── package.json                   Private Vite workspace
│   ├── tsconfig.json                  Playground TypeScript project
│   ├── vite.config.ts                 Vite app configuration
│   └── src/
│       ├── main.ts                    Public-core API integration
│       └── styles.css                 Minimal deterministic presentation
├── packages/core/
│   ├── package.json                   Public package metadata and exports
│   ├── tsconfig.json                  Composite TypeScript project
│   ├── vite.config.ts                 ESM library build
│   ├── src/
│   │   ├── index.ts                   Public API surface
│   │   ├── schema.ts                  Record and document contracts
│   │   ├── diagnostics.ts             Structured diagnostics
│   │   ├── store.ts                   Normalized immutable Record Store
│   │   ├── transaction.ts             Atomic commit and patches
│   │   ├── commands.ts                Command registry and node.create
│   │   └── snapshot.ts                Canonical persisted document output
│   └── test/
│       ├── commands.test.ts            Core-loop unit test
│       ├── transaction.test.ts         Atomicity and inverse patch tests
│       ├── snapshot.golden.test.ts     File-golden assertion
│       └── goldens/basic-document.json Reviewed canonical output
└── tests/e2e/
    └── basic-document.spec.ts          Browser smoke test
```

### Task 1: Establish Git and the Bun workspace

**Files:**
- Create: `.gitignore`
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `.oxlintrc.json`
- Create: `.oxfmtrc.json`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`

- [ ] **Step 1: Initialize version control before generating artifacts**

Run:

```bash
git init
git add AGENTS.md docs
git commit -m "docs: establish ComposeUI architecture"
```

Expected: the existing design documents form the first commit and `git status --short` is empty.

- [ ] **Step 2: Create the root workspace manifest**

Create `package.json`:

```json
{
  "name": "composeui",
  "private": true,
  "type": "module",
  "workspaces": ["apps/*", "packages/*"],
  "scripts": {
    "dev": "bun --cwd apps/playground run dev",
    "build": "bun --filter '*' run build",
    "typecheck": "tsc -b --pretty false",
    "lint": "oxlint --deny-warnings .",
    "lint:fix": "oxlint --fix .",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check .",
    "test": "vitest run",
    "test:golden": "vitest run packages/core/test/snapshot.golden.test.ts",
    "test:e2e": "playwright test",
    "check": "bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build"
  },
  "devDependencies": {
    "@playwright/test": "latest",
    "oxfmt": "latest",
    "oxlint": "latest",
    "typescript": "latest",
    "vite": "latest",
    "vitest": "latest"
  },
  "engines": {
    "bun": ">=1.2"
  }
}
```

Use `latest` only in this bootstrap input. `bun install` resolves and records exact versions in `bun.lock`; before the first release, replace manifest ranges with reviewed compatible ranges.

- [ ] **Step 3: Create strict TypeScript solution configuration**

Create `tsconfig.base.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true
  }
}
```

Create `tsconfig.json`:

```json
{
  "files": [],
  "references": [
    { "path": "./packages/core" },
    { "path": "./apps/playground" }
  ]
}
```

- [ ] **Step 4: Create tool configuration**

Create `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "categories": { "correctness": "error", "suspicious": "warn" },
  "ignorePatterns": ["**/dist/**", "**/coverage/**", "**/test-results/**"]
}
```

Create `.oxfmtrc.json`:

```json
{
  "printWidth": 100,
  "semi": false,
  "singleQuote": false,
  "trailingComma": "all"
}
```

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
  },
})
```

Create `playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test"

export default defineConfig({
  testDir: "tests/e2e",
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "bun --cwd apps/playground run preview --host 127.0.0.1 --port 4173",
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
})
```

Create `.gitignore`:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
*.tsbuildinfo
.DS_Store
```

- [ ] **Step 5: Install and verify the toolchain**

Run:

```bash
bun install
bun --version
bunx tsc --version
bunx oxlint --version
bunx oxfmt --version
```

Expected: `bun.lock` is created and each command prints an installed version. Do not run the solution build until both referenced workspace projects exist.

- [ ] **Step 6: Commit the scaffold configuration**

```bash
git add .gitignore .oxfmtrc.json .oxlintrc.json package.json bun.lock playwright.config.ts tsconfig.base.json tsconfig.json vitest.config.ts
git commit -m "chore: configure Bun TypeScript and Oxc"
```

### Task 2: Define the public core schema and diagnostics

**Files:**
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vite.config.ts`
- Create: `packages/core/src/schema.ts`
- Create: `packages/core/src/diagnostics.ts`
- Create: `packages/core/src/index.ts`
- Test: `packages/core/test/schema.test.ts`

- [ ] **Step 1: Create package configuration**

Create `packages/core/package.json`:

```json
{
  "name": "@composeui/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  },
  "scripts": {
    "build": "vite build"
  }
}
```

Create `packages/core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "declarationMap": true,
    "emitDeclarationOnly": true,
    "outDir": "dist",
    "rootDir": "src",
    "tsBuildInfoFile": "dist/core.tsbuildinfo"
  },
  "include": ["src/**/*.ts"]
}
```

Create `packages/core/vite.config.ts`:

```ts
import { defineConfig } from "vite"

export default defineConfig({
  build: {
    lib: { entry: "src/index.ts", formats: ["es"], fileName: "index" },
  },
})
```

- [ ] **Step 2: Write a failing schema test**

Create `packages/core/test/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "../src/index"

describe("createEmptyDocument", () => {
  it("creates one page board with stable ids", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })

    expect(document.schemaVersion).toBe(1)
    expect(document.rootPageId).toBe("page-1")
    expect(document.records.map((record) => record.id)).toEqual(["doc-1", "page-1"])
  })
})
```

- [ ] **Step 3: Run the test and verify the red state**

Run:

```bash
bunx vitest run packages/core/test/schema.test.ts
```

Expected: FAIL because `packages/core/src/index.ts` does not exist.

- [ ] **Step 4: Implement schema and diagnostics**

Create `packages/core/src/schema.ts`:

```ts
export interface BaseRecord {
  id: string
  revision: number
}

export interface DocumentRecord extends BaseRecord {
  typeName: "document"
  schemaVersion: 1
  rootPageId: string
}

export interface PageRecord extends BaseRecord {
  typeName: "page"
  name: string
  width: number
  height: number
}

export interface NodeRecord extends BaseRecord {
  typeName: "node"
  nodeType: "rectangle"
  parentId: string
  index: string
  props: { x: number; y: number; width: number; height: number; fill: string }
}

export type EditorRecord = DocumentRecord | PageRecord | NodeRecord

export interface PageDocument {
  schemaVersion: 1
  rootPageId: string
  records: EditorRecord[]
}

export function createEmptyDocument(input: {
  documentId: string
  pageId: string
}): PageDocument {
  return {
    schemaVersion: 1,
    rootPageId: input.pageId,
    records: [
      {
        id: input.documentId,
        revision: 0,
        typeName: "document",
        schemaVersion: 1,
        rootPageId: input.pageId,
      },
      {
        id: input.pageId,
        revision: 0,
        typeName: "page",
        name: "Page 1",
        width: 1440,
        height: 900,
      },
    ],
  }
}
```

Create `packages/core/src/diagnostics.ts`:

```ts
export interface Diagnostic {
  code: string
  severity: "error" | "warning"
  message: string
  recordId?: string
}

export type Result<T> =
  | { ok: true; value: T; diagnostics: Diagnostic[] }
  | { ok: false; diagnostics: Diagnostic[] }
```

Create `packages/core/src/index.ts`:

```ts
export type { Diagnostic, Result } from "./diagnostics"
export { createEmptyDocument } from "./schema"
export type {
  BaseRecord,
  DocumentRecord,
  EditorRecord,
  NodeRecord,
  PageDocument,
  PageRecord,
} from "./schema"
```

- [ ] **Step 5: Run the test and typecheck**

```bash
bunx vitest run packages/core/test/schema.test.ts
bunx tsc -p packages/core --pretty false
```

Expected: the test passes and the core-only TypeScript check exits with code 0.

- [ ] **Step 6: Commit**

```bash
git add packages/core
git commit -m "feat(core): define minimal page document schema"
```

### Task 3: Implement the normalized Record Store

**Files:**
- Create: `packages/core/src/store.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/store.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `packages/core/test/store.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore } from "../src/index"

describe("RecordStore", () => {
  it("returns immutable snapshots and rejects duplicate ids", () => {
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )

    expect(store.get("page-1")?.typeName).toBe("page")
    expect(() => store.withCreated(store.get("page-1")!)).toThrow("DUPLICATE_RECORD_ID")
    expect(store.revision).toBe(0)
  })
})
```

- [ ] **Step 2: Verify the failure**

```bash
bunx vitest run packages/core/test/store.test.ts
```

Expected: FAIL because `RecordStore` is not exported.

- [ ] **Step 3: Implement the immutable store**

Create `packages/core/src/store.ts`:

```ts
import type { EditorRecord, PageDocument } from "./schema"

export class RecordStore {
  readonly revision: number
  readonly #records: ReadonlyMap<string, EditorRecord>

  private constructor(records: ReadonlyMap<string, EditorRecord>, revision: number) {
    this.#records = records
    this.revision = revision
  }

  static fromDocument(document: PageDocument): RecordStore {
    const records = new Map<string, EditorRecord>()
    for (const record of document.records) {
      if (records.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
      records.set(record.id, structuredClone(record))
    }
    return new RecordStore(records, 0)
  }

  get(id: string): EditorRecord | undefined {
    const record = this.#records.get(id)
    return record === undefined ? undefined : structuredClone(record)
  }

  all(): EditorRecord[] {
    return [...this.#records.values()].map((record) => structuredClone(record))
  }

  withCreated(record: EditorRecord): RecordStore {
    if (this.#records.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
    const next = new Map(this.#records)
    next.set(record.id, structuredClone(record))
    return new RecordStore(next, this.revision + 1)
  }

  withRemoved(id: string): RecordStore {
    if (!this.#records.has(id)) throw new Error("MISSING_RECORD_ID")
    const next = new Map(this.#records)
    next.delete(id)
    return new RecordStore(next, this.revision + 1)
  }
}
```

Export it from `packages/core/src/index.ts`:

```ts
export { RecordStore } from "./store"
```

- [ ] **Step 4: Verify and commit**

```bash
bunx vitest run packages/core/test/store.test.ts
git add packages/core/src/store.ts packages/core/src/index.ts packages/core/test/store.test.ts
git commit -m "feat(core): add normalized record store"
```

Expected: PASS, then one focused commit.

### Task 4: Add atomic transactions and reversible patches

**Files:**
- Create: `packages/core/src/transaction.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/transaction.test.ts`

- [ ] **Step 1: Write failing transaction tests**

Create `packages/core/test/transaction.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore, transact } from "../src/index"

const rectangle = {
  id: "node-1",
  revision: 0,
  typeName: "node" as const,
  nodeType: "rectangle" as const,
  parentId: "page-1",
  index: "a0",
  props: { x: 40, y: 40, width: 160, height: 100, fill: "#2563eb" },
}

describe("transact", () => {
  it("returns forward and inverse patches", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.created).toEqual([rectangle])
    expect(result.inverse.removed).toEqual([rectangle])
    expect(result.store.get("node-1")).toEqual(rectangle)
  })

  it("does not commit a partial transaction", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle)
      tx.create(rectangle)
    })

    expect(result.ok).toBe(false)
    expect(before.get("node-1")).toBeUndefined()
    expect(before.revision).toBe(0)
  })
})
```

- [ ] **Step 2: Verify the red state**

```bash
bunx vitest run packages/core/test/transaction.test.ts
```

Expected: FAIL because `transact` does not exist.

- [ ] **Step 3: Implement create-only M0 transactions**

Create `packages/core/src/transaction.ts`:

```ts
import type { Diagnostic } from "./diagnostics"
import type { EditorRecord } from "./schema"
import { RecordStore } from "./store"

export type TransactionOrigin =
  | { kind: "local-command"; commandId: string }
  | { kind: "system-init" }

export interface TransactionPatch {
  created: EditorRecord[]
  updated: []
  removed: EditorRecord[]
}

export interface TransactionDraft {
  create(record: EditorRecord): void
}

export type TransactionResult =
  | {
      ok: true
      store: RecordStore
      origin: TransactionOrigin
      patch: TransactionPatch
      inverse: TransactionPatch
      diagnostics: Diagnostic[]
    }
  | { ok: false; store: RecordStore; diagnostics: Diagnostic[] }

export function transact(
  store: RecordStore,
  origin: TransactionOrigin,
  execute: (draft: TransactionDraft) => void,
): TransactionResult {
  const created: EditorRecord[] = []
  const ids = new Set<string>()

  try {
    execute({
      create(record) {
        if (store.get(record.id) !== undefined || ids.has(record.id)) {
          throw new Error("DUPLICATE_RECORD_ID")
        }
        ids.add(record.id)
        created.push(structuredClone(record))
      },
    })

    let next = store
    for (const record of created) next = next.withCreated(record)

    return {
      ok: true,
      store: next,
      origin,
      patch: { created, updated: [], removed: [] },
      inverse: { created: [], updated: [], removed: created },
      diagnostics: [],
    }
  } catch (error) {
    return {
      ok: false,
      store,
      diagnostics: [
        {
          code: error instanceof Error ? error.message : "TRANSACTION_FAILED",
          severity: "error",
          message: "Transaction was rejected before commit.",
        },
      ],
    }
  }
}
```

Export the transaction API from `packages/core/src/index.ts`.

- [ ] **Step 4: Run tests and commit**

```bash
bunx vitest run packages/core/test/transaction.test.ts
git add packages/core/src/transaction.ts packages/core/src/index.ts packages/core/test/transaction.test.ts
git commit -m "feat(core): add atomic create transaction"
```

Expected: both tests PASS.

### Task 5: Route node creation through a command

**Files:**
- Create: `packages/core/src/commands.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/commands.test.ts`

- [ ] **Step 1: Write the failing command test**

Create `packages/core/test/commands.test.ts`:

```ts
import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "../src/index"

describe("node.create", () => {
  it("creates a rectangle under an existing page", () => {
    const editor = createEditor(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "page-1",
        x: 40,
        y: 40,
        width: 160,
        height: 100,
        fill: "#2563eb",
      },
    })

    expect(result.ok).toBe(true)
    expect(editor.getRecord("node-1")?.typeName).toBe("node")
  })

  it("returns a diagnostic for a missing parent", () => {
    const editor = createEditor(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "missing",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fill: "#000000",
      },
    })

    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe("PARENT_NOT_FOUND")
  })
})
```

- [ ] **Step 2: Verify failure, implement, and export**

Run `bunx vitest run packages/core/test/commands.test.ts`; expect a missing `createEditor` export.

Create `packages/core/src/commands.ts` with these public types and behavior:

```ts
import type { Diagnostic, Result } from "./diagnostics"
import type { NodeRecord, PageDocument } from "./schema"
import { RecordStore } from "./store"
import { transact } from "./transaction"

export interface CreateNodeCommand {
  id: "node.create"
  payload: {
    id: string
    parentId: string
    x: number
    y: number
    width: number
    height: number
    fill: string
  }
}

export type EditorCommand = CreateNodeCommand

export interface Editor {
  dispatch(command: EditorCommand): Result<void>
  getRecord(id: string): ReturnType<RecordStore["get"]>
  getStore(): RecordStore
}

export function createEditor(document: PageDocument): Editor {
  let store = RecordStore.fromDocument(document)

  return {
    dispatch(command) {
      const parent = store.get(command.payload.parentId)
      if (parent?.typeName !== "page" && parent?.typeName !== "node") {
        const diagnostic: Diagnostic = {
          code: "PARENT_NOT_FOUND",
          severity: "error",
          message: `Parent ${command.payload.parentId} does not exist.`,
          recordId: command.payload.parentId,
        }
        return { ok: false, diagnostics: [diagnostic] }
      }

      const node: NodeRecord = {
        id: command.payload.id,
        revision: 0,
        typeName: "node",
        nodeType: "rectangle",
        parentId: command.payload.parentId,
        index: "a0",
        props: {
          x: command.payload.x,
          y: command.payload.y,
          width: command.payload.width,
          height: command.payload.height,
          fill: command.payload.fill,
        },
      }
      const result = transact(store, { kind: "local-command", commandId: command.id }, (tx) => {
        tx.create(node)
      })
      if (!result.ok) return { ok: false, diagnostics: result.diagnostics }
      store = result.store
      return { ok: true, value: undefined, diagnostics: [] }
    },
    getRecord: (id) => store.get(id),
    getStore: () => store,
  }
}
```

Export `createEditor`, `Editor`, and command types from `packages/core/src/index.ts`.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run packages/core/test/commands.test.ts
git add packages/core/src/commands.ts packages/core/src/index.ts packages/core/test/commands.test.ts
git commit -m "feat(core): route node creation through command"
```

Expected: both command tests PASS.

### Task 6: Add canonical snapshot and a golden file

**Files:**
- Create: `packages/core/src/snapshot.ts`
- Modify: `packages/core/src/index.ts`
- Create: `packages/core/test/snapshot.golden.test.ts`
- Create: `packages/core/test/goldens/basic-document.json`

- [ ] **Step 1: Write the failing golden test**

Create `packages/core/test/snapshot.golden.test.ts`:

```ts
import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "../src/index"

describe("basic document golden", () => {
  it("matches the reviewed canonical JSON", async () => {
    const editor = createEditor(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "page-1",
        x: 40,
        y: 40,
        width: 160,
        height: 100,
        fill: "#2563eb",
      },
    })
    const actual = `${JSON.stringify(canonicalizeDocument(editor.getStore()), null, 2)}\n`
    const expected = await readFile(
      new URL("./goldens/basic-document.json", import.meta.url),
      "utf8",
    )

    expect(actual).toBe(expected)
  })
})
```

- [ ] **Step 2: Verify the red state**

Run `bun run test:golden`; expect failure because `canonicalizeDocument` and the golden are missing.

- [ ] **Step 3: Implement canonical output**

Create `packages/core/src/snapshot.ts`:

```ts
import type { PageDocument } from "./schema"
import type { RecordStore } from "./store"

export function canonicalizeDocument(store: RecordStore): PageDocument {
  const records = store.all().sort((left, right) => left.id.localeCompare(right.id))
  const document = records.find((record) => record.typeName === "document")
  if (document?.typeName !== "document") throw new Error("DOCUMENT_RECORD_NOT_FOUND")
  return { schemaVersion: document.schemaVersion, rootPageId: document.rootPageId, records }
}
```

Export `canonicalizeDocument` from `packages/core/src/index.ts`.

- [ ] **Step 4: Create and review the expected golden**

Create `packages/core/test/goldens/basic-document.json` with sorted records and a trailing newline:

```json
{
  "schemaVersion": 1,
  "rootPageId": "page-1",
  "records": [
    {
      "id": "doc-1",
      "revision": 0,
      "typeName": "document",
      "schemaVersion": 1,
      "rootPageId": "page-1"
    },
    {
      "id": "node-1",
      "revision": 0,
      "typeName": "node",
      "nodeType": "rectangle",
      "parentId": "page-1",
      "index": "a0",
      "props": {
        "x": 40,
        "y": 40,
        "width": 160,
        "height": 100,
        "fill": "#2563eb"
      }
    },
    {
      "id": "page-1",
      "revision": 0,
      "typeName": "page",
      "name": "Page 1",
      "width": 1440,
      "height": 900
    }
  ]
}
```

- [ ] **Step 5: Verify and commit**

```bash
bun run test:golden
git add packages/core/src/snapshot.ts packages/core/src/index.ts packages/core/test
git commit -m "test(core): protect basic document golden"
```

Expected: PASS; the golden diff is human-readable.

### Task 7: Build the deterministic Vite Playground path

**Files:**
- Create: `apps/playground/package.json`
- Create: `apps/playground/tsconfig.json`
- Create: `apps/playground/vite.config.ts`
- Create: `apps/playground/index.html`
- Create: `apps/playground/src/main.ts`
- Create: `apps/playground/src/styles.css`

- [ ] **Step 1: Create the Playground workspace**

Create `apps/playground/package.json`:

```json
{
  "name": "@composeui/playground",
  "private": true,
  "type": "module",
  "dependencies": { "@composeui/core": "workspace:*" },
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

Create `apps/playground/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "noEmit": true,
    "tsBuildInfoFile": "../../node_modules/.cache/playground.tsbuildinfo"
  },
  "references": [{ "path": "../../packages/core" }],
  "include": ["src/**/*.ts", "vite.config.ts"]
}
```

Create `apps/playground/vite.config.ts`:

```ts
import { defineConfig } from "vite"

export default defineConfig({})
```

- [ ] **Step 2: Create the host page**

Create `apps/playground/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>ComposeUI Playground</title>
  </head>
  <body>
    <main id="app"></main>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 3: Render the core result through public APIs**

Create `apps/playground/src/main.ts`:

```ts
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import "./styles.css"

const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
editor.dispatch({
  id: "node.create",
  payload: {
    id: "node-1",
    parentId: "page-1",
    x: 40,
    y: 40,
    width: 160,
    height: 100,
    fill: "#2563eb",
  },
})

const pageDocument = canonicalizeDocument(editor.getStore())
const node = pageDocument.records.find((record) => record.id === "node-1")
const app = document.querySelector<HTMLElement>("#app")
if (app === null || node?.typeName !== "node") throw new Error("PLAYGROUND_INIT_FAILED")

app.innerHTML = `
  <header><strong>ComposeUI</strong><span>M0 Core Loop</span></header>
  <section aria-label="Page board" class="page-board">
    <div data-node-id="${node.id}" class="node"></div>
  </section>
  <pre aria-label="Page document"></pre>
`

const renderedNode = app.querySelector<HTMLElement>("[data-node-id='node-1']")
const output = app.querySelector<HTMLElement>("pre")
if (renderedNode === null || output === null) throw new Error("PLAYGROUND_RENDER_FAILED")
Object.assign(renderedNode.style, {
  left: `${node.props.x}px`,
  top: `${node.props.y}px`,
  width: `${node.props.width}px`,
  height: `${node.props.height}px`,
  background: node.props.fill,
})
output.textContent = JSON.stringify(pageDocument, null, 2)
```

Create `apps/playground/src/styles.css`:

```css
:root {
  color: #18181b;
  background: #f4f4f5;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
}

body {
  margin: 0;
}

header {
  align-items: center;
  background: #ffffff;
  border-bottom: 1px solid #d4d4d8;
  display: flex;
  gap: 16px;
  height: 48px;
  padding: 0 20px;
}

.page-board {
  background: #ffffff;
  border: 1px solid #a1a1aa;
  height: 450px;
  margin: 24px;
  overflow: hidden;
  position: relative;
  width: 720px;
}

.node {
  position: absolute;
}

pre {
  background: #18181b;
  color: #f4f4f5;
  margin: 24px;
  max-height: 320px;
  overflow: auto;
  padding: 16px;
}
```

- [ ] **Step 4: Install workspace links, build, and commit**

```bash
bun install
bun run typecheck
bun run build
git add apps package.json bun.lock tsconfig.json
git commit -m "feat(playground): render first core document"
```

Expected: typecheck and both workspace builds pass.

### Task 8: Add browser verification and close M0

**Files:**
- Create: `tests/e2e/basic-document.spec.ts`
- Modify only if required by verified tool output: root configuration files

- [ ] **Step 1: Write the browser test**

Create `tests/e2e/basic-document.spec.ts`:

```ts
import { expect, test } from "@playwright/test"

test("renders the canonical M0 document", async ({ page }) => {
  await page.goto("/")

  await expect(page.getByRole("region", { name: "Page board" })).toBeVisible()
  await expect(page.locator("[data-node-id='node-1']")).toHaveCSS(
    "background-color",
    "rgb(37, 99, 235)",
  )
  await expect(page.getByLabel("Page document")).toContainText('"id": "node-1"')
})
```

- [ ] **Step 2: Install Chromium and verify E2E**

```bash
bunx playwright install chromium
bun run test:e2e
```

Expected: one Chromium test passes without arbitrary sleeps.

- [ ] **Step 3: Run the complete repository gate**

```bash
bun run format
bun run check
bun run test:e2e
```

Expected: formatting, lint, typecheck, all Vitest tests, both builds, and Playwright pass.

- [ ] **Step 4: Inspect generated artifacts**

Run:

```bash
find packages/core/dist apps/playground/dist -maxdepth 2 -type f | sort
git status --short
```

Expected: core contains ESM JavaScript and declarations, Playground contains a static Vite build, and only intentional source/config changes remain.

- [ ] **Step 5: Commit the completed milestone**

```bash
git add tests package.json bun.lock
git commit -m "test: verify M0 core loop in browser"
```

## M0 Exit Criteria

M0 is complete only when all statements are true:

- `bun run check` passes from a clean checkout after `bun install --frozen-lockfile`.
- `bun run test:e2e` passes in Chromium.
- Duplicate IDs cause a failed transaction with no partial state.
- `node.create` is invoked through `editor.dispatch`, not a direct Store mutation.
- The canonical golden is readable and reviewed.
- Playground imports only the public `@composeui/core` entry point.
- The built core package contains no Bun runtime imports.
- No Auto Layout, Grid, framework adapter, Yjs, Figma, GPU, Storybook, ESLint, Prettier, Nx, or Turborepo dependency has entered the milestone.

## Next Plan After M0

After M0 passes, write a separate M1 plan for Workspace, Page Board, session-scoped selection, component tree projection, Free Layout, history, and pointer interaction. Do not begin M1 by expanding M0 tasks.
