import { describe, expect, it, vi } from "vitest"
import { EditorSession } from "@composeui/editor"

describe("EditorSession", () => {
  it("returns immutable state snapshots and deduplicates selection", () => {
    const session = new EditorSession()

    session.setViewport({ x: 20, y: 30, zoom: 2 })
    session.setSelection(["node-1", "node-1", "node-2"])
    session.toggleExpanded("node-1")
    session.setHoveredId("node-2")
    session.setGridVisible(false)

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
})
