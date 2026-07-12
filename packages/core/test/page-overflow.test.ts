import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"

const setOverflow = (
  editor: ReturnType<typeof createEditor>,
  id: string,
  overflow: "visible" | "hidden" | "scroll",
) =>
  editor.dispatch({
    id: "page.setOverflow",
    payload: { id, overflow },
  } as never)

describe("page overflow", () => {
  it("defaults new pages to visible overflow", () => {
    const page = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }).records.find(
      (record) => record.id === "page-1",
    )

    expect(page).toMatchObject({ typeName: "page", overflow: "visible" })
  })

  it("persists overflow changes and restores them through undo and redo", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))

    expect(setOverflow(editor, "page-1", "hidden")).toMatchObject({ ok: true })
    expect(editor.getRecord("page-1")).toMatchObject({ overflow: "hidden" })
    expect(canonicalizeDocument(editor.getStore())).toMatchObject({
      records: expect.arrayContaining([
        expect.objectContaining({ id: "page-1", overflow: "hidden" }),
      ]),
    })

    expect(editor.undo()).toMatchObject({ ok: true })
    expect(editor.getRecord("page-1")).toMatchObject({ overflow: "visible" })
    expect(editor.redo()).toMatchObject({ ok: true })
    expect(editor.getRecord("page-1")).toMatchObject({ overflow: "hidden" })
  })

  it("does not create history for a no-op overflow update", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))

    expect(setOverflow(editor, "page-1", "visible")).toMatchObject({ ok: true })
    expect(editor.canUndo()).toBe(false)
  })

  it("returns structured diagnostics for missing and non-page records", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    expect(
      editor.dispatch({
        id: "node.create",
        payload: {
          id: "node-1",
          parentId: "page-1",
          name: "Node",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
          fill: "#000000",
        },
      }),
    ).toMatchObject({ ok: true })

    expect(setOverflow(editor, "missing", "hidden")).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "PAGE_NOT_FOUND", recordId: "missing" })],
    })
    expect(setOverflow(editor, "node-1", "hidden")).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "PAGE_REQUIRED", recordId: "node-1" })],
    })
    expect(
      editor.dispatch({
        id: "page.setOverflow",
        payload: { id: "page-1", overflow: "invalid" },
      } as never),
    ).toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "INVALID_PAGE_OVERFLOW", recordId: "page-1" })],
    })
  })
})
