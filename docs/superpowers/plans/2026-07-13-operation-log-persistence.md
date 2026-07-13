# Operation Log Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist operation sessions, events, checkpoints, and exportable bundles in IndexedDB with safe retention and recovery.

**Architecture:** Extend the operation-log store with explicit session and checkpoint repositories. The IndexedDB adapter owns browser transactions; a coordinator owns checkpoint cadence, flush lifecycle, retention, and bundle encoding.

**Tech Stack:** TypeScript, IndexedDB, fake-indexeddb, Vitest, Web Crypto

---

### Task 1: Add session and checkpoint contracts

**Files:**
- Create: `packages/operation-log/src/sessions.ts`
- Create: `packages/operation-log/src/checkpoints.ts`
- Modify: `packages/operation-log/src/store.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/lifecycle-store.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it("stores cloned session metadata and checkpoints", async () => {
  const store = new MemoryOperationLogStore()
  await store.putSession(session({ sessionId: "s1", status: "active" }))
  await store.putCheckpoint(checkpoint({ sessionId: "s1", sequence: 10 }))
  expect(await store.getSession("s1")).toMatchObject({ status: "active" })
  expect(await store.getNearestCheckpoint("s1", 12)).toMatchObject({ sequence: 10 })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/lifecycle-store.test.ts`
Expected: FAIL because lifecycle methods are missing.

- [ ] **Step 3: Extend the contracts and memory implementation**

```ts
export interface OperationSession { sessionId: string; projectId: string; status: "active" | "ended" | "abnormal"; startedAt: string; endedAt?: string; eventCount: number; finalHash?: string }
export interface OperationCheckpoint { sessionId: string; sequence: number; createdAt: string; document: PageDocument; sessionState: unknown; documentHash: string; sessionHash: string }
```

Add `putSession`, `getSession`, `listSessions`, `putCheckpoint`, `getNearestCheckpoint`, `deleteSession`, and `estimateUsage` to `OperationLogStore`. All writes clone input and all compound updates are atomic.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/lifecycle-store.test.ts`
Expected: PASS.

```bash
git add packages/operation-log
git commit -m "feat(operation-log): add session lifecycle storage"
```

### Task 2: Implement IndexedDB storage

**Files:**
- Modify: `package.json`
- Modify: `bun.lock`
- Create: `packages/operation-log/src/indexeddb-store.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/indexeddb-store.test.ts`

- [ ] **Step 1: Install the test IndexedDB implementation**

Run: `bun add --dev fake-indexeddb`
Expected: `fake-indexeddb` appears in root devDependencies and `bun.lock` changes.

- [ ] **Step 2: Write failing IndexedDB tests**

```ts
import "fake-indexeddb/auto"

it("reopens persisted events and rejects a non-contiguous batch atomically", async () => {
  const first = await IndexedDbOperationLogStore.open({ databaseName: "operation-log-test" })
  await first.append([event({ sequence: 1, eventId: "e1" })]); first.close()
  const second = await IndexedDbOperationLogStore.open({ databaseName: "operation-log-test" })
  expect(await second.query({ sessionId: "s1" })).toHaveLength(1)
  await expect(second.append([event({ sequence: 3, eventId: "e3" })])).rejects.toThrow(
    "NON_CONTIGUOUS_OPERATION_SEQUENCE",
  )
  expect(await second.query({ sessionId: "s1" })).toHaveLength(1)
})
```

- [ ] **Step 3: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/indexeddb-store.test.ts`
Expected: FAIL because the IndexedDB adapter is missing.

- [ ] **Step 4: Implement schema version 1**

Open object stores `sessions`, `events`, `checkpoints`, and `metadata`. Key events by `[sessionId, sequence]`, add unique `eventId`, `category`, `type`, and `status` indexes, and write each append batch in one readwrite transaction. Validate the last stored sequence before adding the batch. Implement `close()` and a versioned `upgrade` switch that aborts unknown downgrade/upgrade paths.

- [ ] **Step 5: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/indexeddb-store.test.ts && bun run typecheck`
Expected: PASS.

```bash
git add package.json bun.lock packages/operation-log
git commit -m "feat(operation-log): persist logs in indexeddb"
```

### Task 3: Add checkpoints and lifecycle flushing

**Files:**
- Create: `packages/operation-log/src/coordinator.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/coordinator.test.ts`

- [ ] **Step 1: Write failing cadence and shutdown tests**

```ts
it("checkpoints at the first configured threshold and marks unclosed sessions abnormal", async () => {
  const clock = fakeClock()
  const coordinator = await OperationLogCoordinator.start({ store, recorder, snapshot, clock, checkpointEveryEvents: 2, checkpointEveryMs: 30_000 })
  await coordinator.documentEvent(); await coordinator.documentEvent()
  expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({ sequence: 2 })
  await OperationLogCoordinator.recover(store, clock.now())
  expect(await store.getSession("s1")).toMatchObject({ status: "abnormal" })
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/coordinator.test.ts`
Expected: FAIL because coordinator is missing.

- [ ] **Step 3: Implement coordinator**

`start` creates `system.sessionStarted`, persists active metadata, and installs optional `visibilitychange` and disposal flush hooks through injected lifecycle ports. `documentEvent` checkpoints after the event or elapsed-time threshold. `end` flushes, writes `system.sessionEnded`, and marks the session ended. `recover` changes stale active sessions to abnormal without inventing missing events.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/coordinator.test.ts`
Expected: PASS.

```bash
git add packages/operation-log
git commit -m "feat(operation-log): coordinate checkpoints and lifecycle"
```

### Task 4: Implement retention cleanup

**Files:**
- Create: `packages/operation-log/src/retention.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/retention.test.ts`

- [ ] **Step 1: Write the failing retention test**

```ts
it("removes oldest completed sessions but preserves active and newest complete sessions", async () => {
  await seedSessions(store, [ended("old"), ended("new"), active("current")])
  await enforceRetention(store, { now: date("2026-07-13"), maxAgeMs: 1, maxBytes: 1 })
  expect((await store.listSessions("p1")).map((item) => item.sessionId)).toEqual(["new", "current"])
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/retention.test.ts`
Expected: FAIL because retention is missing.

- [ ] **Step 3: Implement deterministic cleanup**

Sort completed sessions by `endedAt` then `sessionId`, preserve the active session and newest complete session, and delete whole sessions until both 30-day and 50 MB defaults are satisfied. Never delete individual checkpoints without their session.

- [ ] **Step 4: Run tests and commit**

Run: `bunx vitest run packages/operation-log/test/retention.test.ts`
Expected: PASS.

```bash
git add packages/operation-log
git commit -m "feat(operation-log): enforce local retention"
```

### Task 5: Add versioned bundle export and import validation

**Files:**
- Create: `packages/operation-log/src/bundle.ts`
- Modify: `packages/operation-log/src/index.ts`
- Test: `packages/operation-log/test/bundle.test.ts`

- [ ] **Step 1: Write failing round-trip and tamper tests**

```ts
it("round-trips a redacted bundle and rejects tampering", async () => {
  const encoded = await exportLogBundle(store, { sessionId: "s1", productVersion: "0.0.0" })
  const bundle = await importLogBundle(encoded)
  expect(bundle.manifest.schemaVersion).toBe(1)
  const tampered = encoded.replace("node.create", "node.delete")
  await expect(importLogBundle(tampered)).rejects.toThrow("LOG_BUNDLE_INTEGRITY_FAILED")
})
```

- [ ] **Step 2: Run and verify failure**

Run: `bunx vitest run packages/operation-log/test/bundle.test.ts`
Expected: FAIL because bundle codec is missing.

- [ ] **Step 3: Implement codec**

Define `LogBundleV1` with manifest, session, checkpoints, and ordered events. Export canonical JSON after applying export redaction and include SHA-256 for each section plus a manifest hash. Import enforces a configurable byte limit, exact sequence continuity, supported schema/hash versions, section hashes, unique event IDs, and valid checkpoint ranges.

- [ ] **Step 4: Run package and full verification**

Run: `bunx vitest run packages/operation-log/test && bun run format:check && bun run lint && bun run typecheck && bun run build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/operation-log
git commit -m "feat(operation-log): export validated log bundles"
```

