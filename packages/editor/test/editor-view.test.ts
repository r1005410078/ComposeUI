// @vitest-environment jsdom

import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { PageDocument } from "@composeui/core"
import { mountEditor } from "../src/index"

function createDocumentWithPage(): PageDocument {
  const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
  return {
    ...document,
    records: document.records.map((record) =>
      record.typeName === "page"
        ? {
            ...record,
            width: 640,
            height: 480,
            background: "#fef3c7",
            overflow: "scroll" as const,
          }
        : record,
    ),
  }
}

function addRectangle(
  editor: ReturnType<typeof createEditor>,
  input: {
    id: string
    parentId?: string
    name?: string
    x?: number
    y?: number
    width?: number
    height?: number
    fill?: string
  },
): void {
  const result = editor.dispatch({
    id: "node.create",
    payload: {
      id: input.id,
      parentId: input.parentId ?? "page-1",
      name: input.name ?? input.id,
      x: input.x ?? 20,
      y: input.y ?? 30,
      width: input.width ?? 120,
      height: input.height ?? 80,
      fill: input.fill ?? "#2563eb",
    },
  })
  expect(result.ok).toBe(true)
}

describe("mountEditor", () => {
  it("renders persistent page styles, a Free rectangle, the tree and a screen-space selection", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", name: "Card" })

    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setViewport({ x: 10, y: 15, zoom: 2 })
    mounted.session.setSelection(["node-1"])

    const board = root.querySelector<HTMLElement>("[data-testid='page-board']")
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")
    const selection = root.querySelector<SVGRectElement>("[data-testid='selection-node-1']")

    expect(board).not.toBeNull()
    expect(board?.style.width).toBe("640px")
    expect(board?.style.height).toBe("480px")
    expect(board?.style.background).toBe("rgb(254, 243, 199)")
    expect(board?.style.overflow).toBe("scroll")
    expect(node?.style.position).toBe("absolute")
    expect(node?.style.left).toBe("20px")
    expect(node?.style.top).toBe("30px")
    expect(node?.style.width).toBe("120px")
    expect(node?.style.height).toBe("80px")
    expect(root.querySelector("[data-testid='tree-node-1']")?.textContent).toContain("Card")
    expect(selection?.getAttribute("x")).toBe("50")
    expect(selection?.getAttribute("y")).toBe("75")
    expect(selection?.getAttribute("width")).toBe("240")
    expect(selection?.getAttribute("height")).toBe("160")
  })

  it("keeps hidden nodes in the tree but omits them from the board and selection overlay", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-hidden", name: "Hidden rectangle" })
    editor.dispatch({ id: "node.setVisible", payload: { id: "node-hidden", visible: false } })

    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-hidden"])

    expect(root.querySelector("[data-testid='tree-node-hidden']")).not.toBeNull()
    expect(root.querySelector("[data-node-id='node-hidden']")).toBeNull()
    expect(root.querySelector("[data-testid='selection-node-hidden']")).toBeNull()
  })

  it("selects from tree rows while expand controls only change expansion", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "parent", name: "Parent" })
    addRectangle(editor, { id: "child", parentId: "parent", name: "Child" })

    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    root.querySelector<HTMLButtonElement>("[data-testid='tree-parent']")?.click()

    expect(mounted.session.getState().selection).toEqual(["parent"])
    expect(root.querySelector("[data-testid='selection-parent']")).not.toBeNull()
    expect(root.querySelector("[data-testid='tree-child']")).toBeNull()

    root.querySelector<HTMLButtonElement>("[data-testid='tree-toggle-parent']")?.click()

    expect(mounted.session.getState().selection).toEqual(["parent"])
    expect(root.querySelector("[data-testid='tree-child']")).not.toBeNull()
  })

  it("renders core and session changes synchronously and cleans up on destroy", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    const mounted = mountEditor(root, editor, { pageId: "page-1" })

    addRectangle(editor, { id: "node-later", name: "Before rename" })
    expect(root.querySelector("[data-node-id='node-later']")).not.toBeNull()

    editor.dispatch({ id: "node.rename", payload: { id: "node-later", name: "After rename" } })
    mounted.session.setSelection(["node-later"])
    expect(root.querySelector("[data-testid='tree-node-later']")?.textContent).toContain(
      "After rename",
    )
    expect(root.querySelector("[data-testid='selection-node-later']")).not.toBeNull()

    mounted.destroy()
    expect(root.childElementCount).toBe(0)

    addRectangle(editor, { id: "node-after-destroy" })
    mounted.session.setSelection(["node-after-destroy"])
    expect(root.childElementCount).toBe(0)
  })
})
