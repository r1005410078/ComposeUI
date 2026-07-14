import { beforeEach, describe, expect, it, vi } from "vitest"
import { IDBFactory, indexedDB } from "fake-indexeddb"
import { createPlaygroundOperationRuntime } from "./main"

describe("playground operation log runtime", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("composeui-playground-operation-log-test")
  })

  it("creates one recorder/coordinator and persists editor operations", async () => {
    const runtime = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-test",
      indexedDB: new IDBFactory(),
    })
    expect(runtime.replayController).toBe(runtime.controller.replayController)

    runtime.scenario.createNode()
    await runtime.coordinator.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await runtime.coordinator.flush()

    const rows = await runtime.controller.query({
      levels: [],
      categories: ["document"],
      search: "",
    })
    expect(rows.filter((event) => event.type === "document.command")).not.toHaveLength(0)

    await runtime.dispose()
  })

  it("restores the same session log after reopening the database", async () => {
    const first = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-test",
      indexedDB: new IDBFactory(),
    })
    first.scenario.createNode()
    await first.coordinator.flush()
    const before = await first.controller.query({ levels: [], categories: [], search: "" })
    await first.dispose()

    const second = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-test",
      indexedDB: first.indexedDB,
    })
    const after = await second.controller.query({ levels: [], categories: [], search: "" })
    expect(after.length).toBeGreaterThanOrEqual(before.length)
    expect(after.some((event) => event.type === "document.command")).toBe(true)
    await second.dispose()
  })

  it("connects successful document operations to checkpoint cadence", async () => {
    const runtime = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-checkpoint-test",
      indexedDB: new IDBFactory(),
      checkpointEveryEvents: 1,
    })

    runtime.scenario.createNode()
    await runtime.coordinator.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await runtime.coordinator.flush()

    const checkpoint = await runtime.store.getNearestCheckpoint(runtime.recorder.sessionId, 100)
    expect(checkpoint).toMatchObject({
      sequence: runtime.recorder.sequence,
      document: { rootPageId: "page-1" },
    })
    const events = await runtime.store.query({ sessionId: runtime.recorder.sessionId })
    expect(events.map((event) => event.sequence)).toEqual(
      Array.from({ length: events.length }, (_, index) => index + 1),
    )

    await runtime.dispose()
  })

  it("creates replay engines from an imported bundle without changing the active editor", async () => {
    const runtime = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-replay-test",
      indexedDB: new IDBFactory(),
      checkpointEveryEvents: 1,
    })
    runtime.scenario.createNode()
    await runtime.coordinator.flush()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await runtime.coordinator.flush()
    const rows = await runtime.controller.query({ levels: [], categories: [], search: "" })
    const target = rows.at(-1)?.sequence
    expect(target).toBeDefined()
    const activeBefore = runtime.scenario.editor.getStore().all()

    const result = await runtime.replayController.start(target!)

    expect(result.active).toBe(true)
    expect(runtime.scenario.editor.getStore().all()).toEqual(activeBefore)
    await runtime.dispose()
  })

  it("flushes on hidden visibility and makes disposal idempotent", async () => {
    const listeners = new Set<() => void>()
    const hostDocument = {
      visibilityState: "visible" as DocumentVisibilityState,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    }
    vi.stubGlobal("document", hostDocument)
    const runtime = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-visibility-test",
      indexedDB: new IDBFactory(),
    })
    const flush = vi.spyOn(runtime.coordinator, "flush")
    hostDocument.visibilityState = "hidden"
    for (const listener of listeners) listener()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(flush).toHaveBeenCalled()

    await expect(runtime.dispose()).resolves.toBeUndefined()
    await expect(runtime.dispose()).resolves.toBeUndefined()
    vi.unstubAllGlobals()
  })
})
