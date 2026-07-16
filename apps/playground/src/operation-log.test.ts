// @vitest-environment jsdom

import { beforeEach, describe, expect, expectTypeOf, it, vi } from "vitest"
import { IDBFactory, indexedDB } from "fake-indexeddb"
import { IndexedDbOperationLogStore } from "@composeui/operation-log"
import type { DockviewFactory, EditorWorkspaceDockview } from "@composeui/editor"
import { createPlaygroundOperationRuntime, type PlaygroundOperationRuntime } from "./main"

function createDockviewFake(): DockviewFactory {
  return (_root, _options) => {
    const panels = new Map<string, { id: string; focus(): void }>()
    const layoutListeners = new Set<() => void>()
    const notifyLayout = (): void => {
      for (const listener of layoutListeners) listener()
    }
    const dockview: EditorWorkspaceDockview = {
      onDidLayoutChange: {
        subscribe(listener) {
          layoutListeners.add(listener)
          return { dispose: () => layoutListeners.delete(listener) }
        },
      },
      addPanel(options) {
        const panel = { id: options.id, focus: () => undefined }
        panels.set(options.id, panel)
        notifyLayout()
        return panel
      },
      getPanel(id) {
        return panels.get(id)
      },
      removePanel(panel) {
        panels.delete(panel.id)
        notifyLayout()
      },
      toJSON() {
        return { panels: [...panels.keys()] }
      },
      fromJSON() {},
      clear() {
        panels.clear()
        notifyLayout()
      },
      dispose() {},
    }
    return dockview
  }
}

describe("playground operation log runtime", () => {
  beforeEach(() => {
    indexedDB.deleteDatabase("composeui-playground-operation-log-test")
  })

  it("accepts a workspace mount without options", () => {
    expectTypeOf<PlaygroundOperationRuntime["mount"]>().toBeCallableWith(
      document.createElement("div"),
    )
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

  it("persists workspace panel events and includes the workspace snapshot in checkpoints", async () => {
    const runtime = await createPlaygroundOperationRuntime({
      databaseName: "composeui-playground-operation-log-workspace-test",
      indexedDB: new IDBFactory(),
      checkpointEveryEvents: 1,
    })
    const layoutStore = {
      load: async () => undefined,
      save: async () => undefined,
      remove: async () => undefined,
    }
    const workspace = runtime.mount(document.createElement("div"), {
      layoutStore,
      createDockview: createDockviewFake(),
      layoutChangeDelayMs: 0,
    })

    expect(workspace.api.closePanel("scene")).toBe(true)
    expect(workspace.api.openPanel("scene")).toBe(true)
    await workspace.api.flushLayout()
    runtime.scenario.createNode()
    await runtime.flush()

    const events = await runtime.store.query({ sessionId: runtime.recorder.sessionId })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "workspace.panel.closed", payload: { panelId: "scene" } }),
        expect.objectContaining({ type: "workspace.panel.opened", payload: { panelId: "scene" } }),
        expect.objectContaining({ type: "workspace.layout.changed" }),
      ]),
    )
    await expect(
      runtime.store.getNearestCheckpoint(runtime.recorder.sessionId, 100),
    ).resolves.toMatchObject({
      workspaceState: workspace.api.getLayoutSnapshot(),
      workspaceHash: expect.any(String),
    })

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

  it("initializes the recorder from the event table when session metadata is stale", async () => {
    const databaseName = "composeui-playground-operation-log-stale-session-test"
    const factory = new IDBFactory()
    const first = await createPlaygroundOperationRuntime({ databaseName, indexedDB: factory })
    first.scenario.createNode()
    await first.coordinator.flush()
    await first.dispose()

    const repairStore = await IndexedDbOperationLogStore.open({
      databaseName,
      indexedDB: factory,
    })
    const existingSession = await repairStore.getSession("playground-session")
    const events = await repairStore.query({ sessionId: "playground-session" })
    expect(existingSession).toBeDefined()
    expect(events.length).toBeGreaterThan(0)
    await repairStore.putSession({
      ...existingSession!,
      status: "active",
      eventCount: events.length - 1,
    })
    await repairStore.close()

    const second = await createPlaygroundOperationRuntime({ databaseName, indexedDB: factory })

    expect(second.recorder.sequence).toBe(events.at(-1)!.sequence + 1)
    expect((await second.store.query({ sessionId: "playground-session" })).at(-1)).toMatchObject({
      type: "system.sessionStarted",
      sequence: events.at(-1)!.sequence + 1,
    })
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
