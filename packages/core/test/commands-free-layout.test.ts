import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "../src/index"

const createRectangle = (
  editor: ReturnType<typeof createEditor>,
  input: { id: string; parentId?: string; x?: number; y?: number },
) =>
  editor.dispatch({
    id: "node.create",
    payload: {
      id: input.id,
      parentId: input.parentId ?? "page-1",
      name: input.id,
      x: input.x ?? 5,
      y: input.y ?? 10,
      width: 100,
      height: 80,
      fill: "#111827",
    },
  })

describe("Free Layout commands", () => {
  it("executes all eight commands through one complete lifecycle", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))

    expect(createRectangle(editor, { id: "container" }).ok).toBe(true)
    expect(createRectangle(editor, { id: "child", x: 20, y: 30 }).ok).toBe(true)
    expect(
      editor.dispatch({
        id: "node.move",
        payload: { ids: ["child"], delta: { x: 10, y: -5 } },
      }).ok,
    ).toBe(true)
    expect(
      editor.dispatch({
        id: "node.resize",
        payload: { id: "child", width: 140, height: 90 },
      }).ok,
    ).toBe(true)
    expect(
      editor.dispatch({
        id: "node.reorder",
        payload: { id: "child", parentId: "container", index: "a0" },
      }).ok,
    ).toBe(true)
    expect(
      editor.dispatch({ id: "node.rename", payload: { id: "child", name: "Summary" } }).ok,
    ).toBe(true)
    expect(
      editor.dispatch({ id: "node.setVisible", payload: { id: "child", visible: false } }).ok,
    ).toBe(true)
    expect(
      editor.dispatch({ id: "node.setLocked", payload: { id: "child", locked: true } }).ok,
    ).toBe(true)

    expect(editor.getRecord("child")).toMatchObject({
      name: "Summary",
      parentId: "container",
      index: "a0",
      layout: { x: 30, y: 25, width: 140, height: 90 },
      visible: false,
      locked: true,
    })
    expect(editor.dispatch({ id: "node.delete", payload: { ids: ["container"] } }).ok).toBe(true)
    expect(editor.getRecord("container")).toBeUndefined()
    expect(editor.getRecord("child")).toBeUndefined()
  })

  it("rejects locked moves without changing store or history", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createRectangle(editor, { id: "free" })
    editor.dispatch({ id: "node.setLocked", payload: { id: "free", locked: true } })
    const before = canonicalizeDocument(editor.getStore())
    const result = editor.dispatch({
      id: "node.move",
      payload: { ids: ["free"], delta: { x: 20, y: 30 } },
    })

    expect(result).toMatchObject({ ok: false, diagnostics: [{ code: "NODE_LOCKED" }] })
    expect(canonicalizeDocument(editor.getStore())).toEqual(before)
    editor.undo()
    expect(editor.getRecord("free")).toMatchObject({ locked: false, layout: { x: 5, y: 10 } })
  })

  it("rejects direct transforms beneath a locked ancestor", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createRectangle(editor, { id: "parent" })
    createRectangle(editor, { id: "child", parentId: "parent" })
    editor.dispatch({ id: "node.setLocked", payload: { id: "parent", locked: true } })

    const move = editor.dispatch({
      id: "node.move",
      payload: { ids: ["child"], delta: { x: 10, y: 20 } },
    })
    const resize = editor.dispatch({
      id: "node.resize",
      payload: { id: "child", width: 120, height: 90 },
    })

    expect(move).toMatchObject({
      ok: false,
      diagnostics: [{ code: "NODE_LOCKED", recordId: "parent" }],
    })
    expect(resize).toMatchObject({
      ok: false,
      diagnostics: [{ code: "NODE_LOCKED", recordId: "parent" }],
    })
    expect(editor.getRecord("child")).toMatchObject({
      layout: { x: 5, y: 10, width: 100, height: 80 },
    })
  })

  it("rejects invalid targets and free-layout dimensions with structured diagnostics", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const pageMove = editor.dispatch({
      id: "node.move",
      payload: { ids: ["page-1"], delta: { x: 1, y: 1 } },
    })
    const missingRename = editor.dispatch({
      id: "node.rename",
      payload: { id: "missing", name: "Missing" },
    })
    createRectangle(editor, { id: "free" })
    const invalidResize = editor.dispatch({
      id: "node.resize",
      payload: { id: "free", width: 0, height: 20 },
    })

    expect(pageMove).toMatchObject({ ok: false, diagnostics: [{ code: "NODE_REQUIRED" }] })
    expect(missingRename).toMatchObject({ ok: false, diagnostics: [{ code: "NODE_NOT_FOUND" }] })
    expect(invalidResize).toMatchObject({
      ok: false,
      diagnostics: [{ code: "INVALID_FREE_LAYOUT_SIZE" }],
    })
    expect(editor.getRecord("free")).toMatchObject({ layout: { width: 100, height: 80 } })
  })

  it("keeps reparented coordinates parent-local and enforces tree constraints", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createRectangle(editor, { id: "parent", x: 100, y: 200 })
    createRectangle(editor, { id: "child", x: 7, y: 9 })

    expect(
      editor.dispatch({
        id: "node.reorder",
        payload: { id: "child", parentId: "parent", index: "a0" },
      }).ok,
    ).toBe(true)
    expect(editor.getRecord("child")).toMatchObject({
      parentId: "parent",
      layout: { x: 7, y: 9 },
    })
    const cycle = editor.dispatch({
      id: "node.reorder",
      payload: { id: "parent", parentId: "child", index: "a0" },
    })
    expect(cycle).toMatchObject({ ok: false, diagnostics: [{ code: "NODE_PARENT_CYCLE" }] })
  })

  it("deletes a subtree atomically and restores exact records with one undo", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createRectangle(editor, { id: "parent" })
    createRectangle(editor, { id: "child", parentId: "parent" })
    createRectangle(editor, { id: "grandchild", parentId: "child" })
    const beforeDelete = canonicalizeDocument(editor.getStore())

    const result = editor.dispatch({ id: "node.delete", payload: { ids: ["parent", "child"] } })
    expect(result.ok).toBe(true)
    expect(editor.getRecord("parent")).toBeUndefined()
    expect(editor.getRecord("child")).toBeUndefined()
    expect(editor.getRecord("grandchild")).toBeUndefined()

    expect(editor.undo().ok).toBe(true)
    expect(canonicalizeDocument(editor.getStore())).toEqual(beforeDelete)
  })

  it("rejects deleting the page board", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))

    const result = editor.dispatch({ id: "node.delete", payload: { ids: ["page-1"] } })

    expect(result).toMatchObject({
      ok: false,
      diagnostics: [{ code: "PAGE_REMOVE_FORBIDDEN", recordId: "page-1" }],
    })
    expect(editor.canUndo()).toBe(false)
  })
})
