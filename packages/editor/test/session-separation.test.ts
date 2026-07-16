import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import { EditorSession } from "@composeui/editor"

describe("Document and Session scopes", () => {
  it("does not serialize viewport or selection", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const session = new EditorSession()
    session.setViewport({ x: 20, y: 30, zoom: 2 })
    session.setSelection(["page-1"])
    session.setGridVisible(false)

    const serialized = JSON.stringify(canonicalizeDocument(editor.getStore()))
    expect(serialized).not.toContain("viewport")
    expect(serialized).not.toContain("selection")
    expect(serialized).not.toContain("gridVisible")
    expect(serialized).not.toContain("gridSize")
    expect(serialized).not.toContain("snapEnabled")
  })

  it("isolates state and listeners between session instances", () => {
    const first = new EditorSession()
    const second = new EditorSession()
    let secondNotifications = 0
    second.subscribe(() => secondNotifications++)

    first.setSelection(["node-1"])
    first.setViewport({ x: 10, y: 20, zoom: 2 })

    expect(second.getState()).toEqual({
      viewport: { x: 0, y: 0, zoom: 1 },
      selection: [],
      expanded: [],
      hoveredId: null,
      gridVisible: true,
      gridSize: 8,
      snapEnabled: true,
      interactionMode: "select",
    })
    expect(secondNotifications).toBe(0)
  })
})
