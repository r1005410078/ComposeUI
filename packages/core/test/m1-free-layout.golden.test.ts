import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"

describe("M1 Free Layout golden", () => {
  it("matches the reviewed persistent document without Session state", async () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-red",
        parentId: "page-1",
        name: "Red rectangle",
        x: 80,
        y: 72,
        width: 240,
        height: 160,
        fill: "#dc2626",
      },
    })
    editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-blue",
        parentId: "page-1",
        name: "Blue rectangle",
        x: 380,
        y: 240,
        width: 280,
        height: 180,
        fill: "#2563eb",
      },
    })
    editor.dispatch({
      id: "node.move",
      payload: { ids: ["node-red"], delta: { x: 40, y: 30 } },
    })
    editor.dispatch({ id: "node.setVisible", payload: { id: "node-blue", visible: false } })

    const actual = `${JSON.stringify(canonicalizeDocument(editor.getStore()), null, 2)}\n`
    const expected = await readFile(
      new URL("./goldens/m1-free-layout.json", import.meta.url),
      "utf8",
    )

    expect(actual).toBe(expected)
  })
})
