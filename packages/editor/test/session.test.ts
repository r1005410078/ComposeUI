import { describe, expect, it, vi } from "vitest"
import { createSessionOperationObserver, EditorSession } from "@composeui/editor"
import type { SessionOperation } from "@composeui/editor"
import { MemoryOperationLogStore, OperationRecorder } from "@composeui/operation-log"

describe("EditorSession", () => {
  it("returns immutable state snapshots and deduplicates selection", () => {
    const session = new EditorSession()

    session.setViewport({ x: 20, y: 30, zoom: 2 })
    session.setSelection(["node-1", "node-1", "node-2"])
    session.toggleExpanded("node-1")
    session.setHoveredId("node-2")
    session.setGridVisible(false)
    session.setInteractionMode("pan")

    const snapshot = session.getState()
    snapshot.viewport.x = 999
    snapshot.selection.push("node-3")
    snapshot.expanded.length = 0

    expect(session.getState()).toEqual({
      viewport: { x: 20, y: 30, zoom: 2 },
      selection: ["node-1", "node-2"],
      expanded: ["node-1"],
      hoveredId: "node-2",
      gridVisible: false,
      interactionMode: "pan",
    })
  })

  it("toggles expanded ids and releases subscriptions", () => {
    const session = new EditorSession()
    const listener = vi.fn()
    const unsubscribe = session.subscribe(listener)

    session.toggleExpanded("node-1")
    session.toggleExpanded("node-2")
    session.toggleExpanded("node-1")
    unsubscribe()
    session.setHoveredId("node-2")

    expect(session.getState().expanded).toEqual(["node-2"])
    expect(listener).toHaveBeenCalledTimes(3)
    expect(listener).toHaveBeenLastCalledWith({
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      expanded: ["node-2"],
      hoveredId: null,
      gridVisible: true,
      interactionMode: "select",
    })
  })

  it("rejects non-positive and non-finite viewport zoom", () => {
    const session = new EditorSession()

    expect(() => session.setViewport({ x: 0, y: 0, zoom: 0 })).toThrow("INVALID_ZOOM")
    expect(() => session.setViewport({ x: 0, y: 0, zoom: Number.NaN })).toThrow("INVALID_ZOOM")
    expect(() => session.setViewport({ x: Number.NaN, y: 0, zoom: 1 })).toThrow(
      "INVALID_COORDINATE",
    )
    expect(() => session.setViewport({ x: 0, y: Number.POSITIVE_INFINITY, zoom: 1 })).toThrow(
      "INVALID_COORDINATE",
    )
    expect(session.getState().viewport).toEqual({ x: 0, y: 0, zoom: 1 })
  })

  it("isolates listener failures and preserves queued notification order", () => {
    const session = new EditorSession()
    const events: string[] = []
    let reentered = false

    session.subscribe((state) => {
      events.push(`first:${state.hoveredId ?? state.selection[0] ?? "empty"}`)
      state.selection.push("mutated-by-first")
      if (!reentered) {
        reentered = true
        session.setHoveredId("node-2")
      }
    })
    session.subscribe(() => {
      throw new Error("listener failure")
    })
    session.subscribe((state) => {
      events.push(`last:${state.hoveredId ?? state.selection[0] ?? "empty"}`)
      expect(state.selection).toEqual(["node-1"])
    })

    expect(() => session.setSelection(["node-1"])).not.toThrow()
    expect(events).toEqual(["first:node-1", "last:node-1", "first:node-2", "last:node-2"])
  })

  it("emits only changed fields", () => {
    const events: SessionOperation[] = []
    const session = new EditorSession({
      operationObserver: { observe: (event) => events.push(event) },
    })

    session.setSelection([])
    session.setSelection(["node-1"])
    session.setSelection(["node-1"])
    session.setViewport({ x: 1, y: 2, zoom: 1 })
    session.setViewport({ x: 3, y: 4, zoom: 2 })
    session.setGridVisible(false)

    expect(events).toEqual([
      { type: "session.selection", selection: ["node-1"] },
      { type: "session.viewport", viewport: { x: 1, y: 2, zoom: 1 } },
      { type: "session.viewport", viewport: { x: 3, y: 4, zoom: 2 } },
      { type: "session.gridVisibility", gridVisible: false },
    ])
  })

  it("coalesces viewport events in the recorder adapter", async () => {
    const store = new MemoryOperationLogStore()
    const recorder = new OperationRecorder({ sessionId: "s1", projectId: "p1", store })
    const session = new EditorSession({
      operationObserver: createSessionOperationObserver(recorder),
    })

    session.setViewport({ x: 1, y: 2, zoom: 1 })
    session.setViewport({ x: 3, y: 4, zoom: 2 })
    await recorder.flush()

    expect((await store.query({ sessionId: "s1" })).map((event) => event.payload)).toEqual([
      { type: "session.viewport", viewport: { x: 3, y: 4, zoom: 2 } },
    ])
  })

  it("emits expanded tree, interaction mode, and hovered id changes", () => {
    const events: SessionOperation[] = []
    const session = new EditorSession({
      operationObserver: { observe: (event) => events.push(event) },
    })

    session.toggleExpanded("page-1")
    session.setInteractionMode("pan")
    session.setHoveredId("node-1")

    expect(events.map((event) => event.type)).toEqual([
      "session.expandedTree",
      "session.interactionMode",
      "session.hoveredId",
    ])
  })
})
