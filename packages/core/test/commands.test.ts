import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"

describe("node.create", () => {
  it("creates a rectangle under an existing page", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const result = editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "page-1",
        name: "Rectangle",
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
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const result = editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "missing",
        name: "Rectangle",
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
