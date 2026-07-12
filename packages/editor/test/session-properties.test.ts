import fc from "fast-check"
import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import { EditorSession } from "@composeui/editor"

describe("Editor Session properties", () => {
  it("never changes canonical JSON for arbitrary valid viewport and selection state", () => {
    fc.assert(
      fc.property(
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: -10_000, max: 10_000, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0.1, max: 4, noNaN: true, noDefaultInfinity: true }),
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), { maxLength: 12 }),
        fc.boolean(),
        (x, y, zoom, selection, gridVisible) => {
          const editor = createEditor(
            createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
          )
          const before = canonicalizeDocument(editor.getStore())
          const session = new EditorSession()

          session.setViewport({ x, y, zoom })
          session.setSelection(selection)
          session.setGridVisible(gridVisible)

          expect(canonicalizeDocument(editor.getStore())).toEqual(before)
        },
      ),
      { numRuns: 200 },
    )
  })
})
