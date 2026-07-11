import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "../src/index"

describe("basic document golden", () => {
  it("matches the reviewed canonical JSON", async () => {
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
    const actual = `${JSON.stringify(canonicalizeDocument(editor.getStore()), null, 2)}\n`
    const expected = await readFile(
      new URL("./goldens/basic-document.json", import.meta.url),
      "utf8",
    )

    expect(actual).toBe(expected)
  })
})
