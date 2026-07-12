// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { PageDocument } from "@composeui/core"
import { mountEditor } from "../src/index"
import { EditorSession } from "../src/session"

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

  it("keeps expand controls out of the tab order and in the roving keyboard model", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "parent", name: "Parent" })
    addRectangle(editor, { id: "child", parentId: "parent", name: "Child" })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })

    expect(
      [...root.querySelectorAll<HTMLButtonElement>("[data-tree-control='toggle']")].every(
        (button) => button.tabIndex === -1,
      ),
    ).toBe(true)
    expect(root.querySelector<HTMLButtonElement>("[data-testid='tree-page-1']")?.tabIndex).toBe(0)

    root.querySelector<HTMLButtonElement>("[data-testid='tree-parent']")?.click()
    expect(mounted.session.getState().selection).toEqual(["parent"])
    const toggle = root.querySelector<HTMLButtonElement>("[data-testid='tree-toggle-parent']")!
    toggle.focus()
    toggle.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    expect(mounted.session.getState().selection).toEqual(["parent"])
    expect(root.querySelector("[data-testid='tree-child']")).not.toBeNull()
    expect(document.activeElement?.getAttribute("data-testid")).toBe("tree-toggle-parent")

    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    expect(document.activeElement?.getAttribute("data-testid")).toBe("tree-child")
    root.remove()
  })

  it("keeps tree focus and supports keyboard navigation and selection", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", name: "A" })
    addRectangle(editor, { id: "node-b", name: "B" })
    addRectangle(editor, { id: "node-c", name: "C" })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    document.body.append(root)

    const first = root.querySelector<HTMLButtonElement>("[data-testid='tree-page-1']")!
    first.focus()
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }))
    expect(document.activeElement?.getAttribute("data-testid")).toBe("tree-node-a")
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "End", bubbles: true }),
    )
    expect(document.activeElement?.getAttribute("data-testid")).toBe("tree-node-c")
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Home", bubbles: true }),
    )
    expect(document.activeElement?.getAttribute("data-testid")).toBe("tree-page-1")
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
    )
    document.activeElement?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    )
    expect(mounted.session.getState().selection).toEqual(["node-a"])

    const focusedBeforeRename = root.querySelector<HTMLButtonElement>(
      "[data-testid='tree-node-a']",
    )!
    focusedBeforeRename.focus()
    editor.dispatch({ id: "node.rename", payload: { id: "node-a", name: "Renamed" } })
    expect(document.activeElement?.getAttribute("data-testid")).toBe("tree-node-a")
    expect(root.querySelector("[data-testid='tree-node-a']")?.textContent).toContain("Renamed")
    root.remove()
  })

  it("updates rendering partitions without replacing stable editor surfaces", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1" })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const shell = root.querySelector("[data-testid='editor-shell']")!
    const aside = root.querySelector("aside")!
    const workspace = root.querySelector("[data-testid='workspace']")!
    const world = root.querySelector("[data-testid='world']")!
    const board = root.querySelector("[data-testid='page-board']")!
    const overlay = root.querySelector("[data-testid='selection-overlay']")!
    const node = root.querySelector("[data-node-id='node-1']")!

    mounted.session.setSelection(["node-1"])
    expect(root.querySelector("[data-testid='editor-shell']")).toBe(shell)
    expect(root.querySelector("aside")).toBe(aside)
    expect(root.querySelector("[data-testid='workspace']")).toBe(workspace)
    expect(root.querySelector("[data-testid='world']")).toBe(world)
    expect(root.querySelector("[data-testid='page-board']")).toBe(board)
    expect(root.querySelector("[data-testid='selection-overlay']")).toBe(overlay)

    mounted.session.setViewport({ x: 12, y: 20, zoom: 2 })
    expect(root.querySelector("[data-testid='world']")).toBe(world)
    expect(root.querySelector("[data-testid='page-board']")).toBe(board)
    expect(root.querySelector("[data-node-id='node-1']")).toBe(node)
    expect(world.getAttribute("style")).toContain("translate(12px, 20px) scale(2)")

    editor.dispatch({ id: "node.move", payload: { ids: ["node-1"], delta: { x: 5, y: 6 } } })
    expect(root.querySelector("[data-node-id='node-1']")).toBe(node)
    expect(node.getAttribute("style")).toContain("left: 25px")
  })

  it("uses safe color fallbacks for invalid persisted CSS colors", () => {
    const documentWithUnsafeColors = createDocumentWithPage()
    documentWithUnsafeColors.records = documentWithUnsafeColors.records.map((record) =>
      record.typeName === "page"
        ? { ...record, background: "url(https://evil.invalid/image)" }
        : record,
    )
    const editor = createEditor(documentWithUnsafeColors)
    addRectangle(editor, { id: "unsafe-node", fill: "#fff; color: red" })
    const root = document.createElement("div")
    mountEditor(root, editor, { pageId: "page-1" })

    expect(root.querySelector<HTMLElement>("[data-testid='page-board']")?.style.background).toBe(
      "rgb(255, 255, 255)",
    )
    expect(root.querySelector<HTMLElement>("[data-node-id='unsafe-node']")?.style.background).toBe(
      "rgb(37, 99, 235)",
    )
  })

  it("renders core and session changes synchronously and cleans up on destroy", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    let coreUnsubscribed = 0
    const coreSubscribe = editor.subscribe
    editor.subscribe = (listener) => {
      const unsubscribe = coreSubscribe(listener)
      return () => {
        coreUnsubscribed += 1
        unsubscribe()
      }
    }
    let sessionUnsubscribed = 0
    const originalSessionSubscribe = EditorSession.prototype.subscribe
    const sessionSubscribe = vi.spyOn(EditorSession.prototype, "subscribe")
    sessionSubscribe.mockImplementation(function (listener) {
      const unsubscribe = originalSessionSubscribe.call(this, listener)
      return () => {
        sessionUnsubscribed += 1
        unsubscribe()
      }
    })

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
    expect(coreUnsubscribed).toBe(1)
    expect(sessionUnsubscribed).toBe(1)

    addRectangle(editor, { id: "node-after-destroy" })
    mounted.session.setSelection(["node-after-destroy"])
    expect(root.childElementCount).toBe(0)
    sessionSubscribe.mockRestore()
  })
})
