// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import type { PageDocument } from "@composeui/core"
import { reorderTreeItem } from "../src/component-tree"
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
    locked?: boolean
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
  if (input.locked === true) {
    expect(
      editor.dispatch({ id: "node.setLocked", payload: { id: input.id, locked: true } }).ok,
    ).toBe(true)
  }
}

function pointerEvent(type: string, x: number, y: number, pointerId = 1): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
  }) as PointerEvent
  Object.defineProperty(event, "pointerId", { value: pointerId })
  return event
}

function modifiedPointerEvent(
  type: string,
  x: number,
  y: number,
  modifiers: { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean } = {},
  pointerId = 1,
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
    ...modifiers,
  }) as PointerEvent
  Object.defineProperty(event, "pointerId", { value: pointerId })
  return event
}

function dragEvent(type: string, dataTransfer: DataTransfer): Event {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer })
  return event
}

function createDataTransfer(): DataTransfer {
  const data = new Map<string, string>()
  return {
    dropEffect: "none",
    effectAllowed: "uninitialized",
    getData: (format) => data.get(format) ?? "",
    setData: (format, value) => data.set(format, value),
  } as DataTransfer
}

describe("mountEditor", () => {
  it("updates page clipping from the persisted overflow command", () => {
    const root = document.createElement("div")
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    addRectangle(editor, { id: "outside", x: 1500, y: 20 })
    mountEditor(root, editor, { pageId: "page-1" })
    const board = root.querySelector<HTMLElement>("[data-testid='page-board']")!

    expect(board.style.overflow).toBe("visible")
    expect(root.querySelector("[data-node-id='outside']")).not.toBeNull()
    expect(
      editor.dispatch({
        id: "page.setOverflow",
        payload: { id: "page-1", overflow: "hidden" },
      }),
    ).toMatchObject({ ok: true })
    expect(board.style.overflow).toBe("hidden")
  })

  it("zooms at the pointer, pans with the middle button and renders a session grid", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const workspace = root.querySelector<HTMLElement>("[data-testid='workspace']")!
    const grid = root.querySelector<HTMLElement>("[data-testid='workspace-grid']")!
    workspace.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect

    workspace.dispatchEvent(
      new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        clientX: 210,
        clientY: 120,
        deltaY: -100,
      }),
    )

    const zoomed = mounted.session.getState().viewport
    expect(zoomed.zoom).toBeGreaterThan(1)
    expect((200 - zoomed.x) / zoomed.zoom).toBeCloseTo(200)
    expect((100 - zoomed.y) / zoomed.zoom).toBeCloseTo(100)
    expect(grid.style.backgroundSize).toBe(`${16 * zoomed.zoom}px ${16 * zoomed.zoom}px`)

    workspace.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 1, clientX: 50, clientY: 60 }),
    )
    window.dispatchEvent(
      new MouseEvent("pointermove", { bubbles: true, button: 1, clientX: 80, clientY: 95 }),
    )
    window.dispatchEvent(
      new MouseEvent("pointerup", { bubbles: true, button: 1, clientX: 80, clientY: 95 }),
    )

    expect(mounted.session.getState().viewport).toMatchObject({
      x: zoomed.x + 30,
      y: zoomed.y + 35,
      zoom: zoomed.zoom,
    })
    mounted.session.setGridVisible(false)
    expect(grid.hidden).toBe(true)
  })

  it("pans with space plus left drag without starting marquee selection", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const shell = root.querySelector<HTMLElement>("[data-testid='editor-shell']")!
    const workspace = root.querySelector<HTMLElement>("[data-testid='workspace']")!

    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: " ", code: "Space" }))
    expect(shell.dataset.panning).toBe("true")
    workspace.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, button: 0, clientX: 40, clientY: 50 }),
    )
    expect(workspace.dataset.panActive).toBe("true")
    expect(shell.dataset.panActive).toBe("true")
    window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 90, clientY: 80 }))
    window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, clientX: 90, clientY: 80 }))

    expect(mounted.session.getState().viewport).toMatchObject({ x: 50, y: 30, zoom: 1 })
    expect(root.querySelector("[data-testid='marquee-selection']")).toBeNull()
    expect(workspace.dataset.panActive).toBeUndefined()
    expect(shell.dataset.panActive).toBeUndefined()
    window.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space" }))
    expect(shell.dataset.panning).toBeUndefined()
  })

  it("supports modifier multi-selection and renders one SVG outline per selected node", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", x: 20, y: 30 })
    addRectangle(editor, { id: "node-b", x: 200, y: 160 })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const first = root.querySelector<HTMLElement>("[data-node-id='node-a']")!
    const second = root.querySelector<HTMLElement>("[data-node-id='node-b']")!

    first.dispatchEvent(modifiedPointerEvent("pointerdown", 25, 35))
    window.dispatchEvent(modifiedPointerEvent("pointerup", 25, 35))
    second.dispatchEvent(modifiedPointerEvent("pointerdown", 205, 165, { shiftKey: true }))
    window.dispatchEvent(modifiedPointerEvent("pointerup", 205, 165, { shiftKey: true }))

    expect(mounted.session.getState().selection).toEqual(["node-a", "node-b"])
    expect(root.querySelector("[data-testid='selection-node-a']")).not.toBeNull()
    expect(root.querySelector("[data-testid='selection-node-b']")).not.toBeNull()

    first.dispatchEvent(modifiedPointerEvent("pointerdown", 25, 35, { metaKey: true }))
    expect(mounted.session.getState().selection).toEqual(["node-b"])
  })

  it("previews a marquee in SVG and commits intersecting nodes only to Session", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "inside", x: 20, y: 30, width: 40, height: 40 })
    addRectangle(editor, { id: "outside", x: 300, y: 300, width: 40, height: 40 })
    const before = JSON.stringify(canonicalizeDocument(editor.getStore()))
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const workspace = root.querySelector<HTMLElement>("[data-testid='workspace']")!

    workspace.dispatchEvent(modifiedPointerEvent("pointerdown", 0, 0))
    window.dispatchEvent(modifiedPointerEvent("pointermove", 100, 100))
    expect(root.querySelector("[data-testid='marquee-selection']")).not.toBeNull()
    window.dispatchEvent(modifiedPointerEvent("pointerup", 100, 100))

    expect(root.querySelector("[data-testid='marquee-selection']")).toBeNull()
    expect(mounted.session.getState().selection).toEqual(["inside"])
    expect(root.querySelector("[data-testid='selection-inside']")).not.toBeNull()
    expect(JSON.stringify(canonicalizeDocument(editor.getStore()))).toBe(before)
  })

  it("selects intersecting nodes when the marquee is dragged from bottom-right to top-left", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "inside", x: 20, y: 30, width: 40, height: 40 })
    addRectangle(editor, { id: "outside", x: 300, y: 300, width: 40, height: 40 })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const workspace = root.querySelector<HTMLElement>("[data-testid='workspace']")!

    workspace.dispatchEvent(modifiedPointerEvent("pointerdown", 100, 100))
    window.dispatchEvent(modifiedPointerEvent("pointermove", 0, 0))

    const marquee = root.querySelector<SVGRectElement>("[data-testid='marquee-selection']")!
    expect(marquee.getAttribute("x")).toBe("0")
    expect(marquee.getAttribute("y")).toBe("0")
    expect(marquee.getAttribute("width")).toBe("100")
    expect(marquee.getAttribute("height")).toBe("100")

    window.dispatchEvent(modifiedPointerEvent("pointerup", 0, 0))

    expect(mounted.session.getState().selection).toEqual(["inside"])
  })

  it("routes tree rename, visibility, lock and sibling reorder through commands", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", name: "A" })
    addRectangle(editor, { id: "node-b", name: "B" })
    const dispatch = vi.spyOn(editor, "dispatch")
    mountEditor(root, editor, { pageId: "page-1" })

    root
      .querySelector<HTMLButtonElement>("[data-testid='tree-node-a']")
      ?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))
    const rename = root.querySelector<HTMLInputElement>("[data-testid='tree-rename-node-a']")!
    rename.value = "Renamed A"
    rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
    root.querySelector<HTMLButtonElement>("[data-testid='tree-visibility-node-a']")?.click()
    root.querySelector<HTMLButtonElement>("[data-testid='tree-lock-node-a']")?.click()
    root.querySelector<HTMLButtonElement>("[data-testid='tree-move-up-node-b']")?.click()

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.rename",
      payload: { id: "node-a", name: "Renamed A" },
    })
    expect(dispatch).toHaveBeenCalledWith({
      id: "node.setVisible",
      payload: { id: "node-a", visible: false },
    })
    expect(dispatch).toHaveBeenCalledWith({
      id: "node.setLocked",
      payload: { id: "node-a", locked: true },
    })
    expect(editor.getRecord("node-a")).toMatchObject({
      name: "Renamed A",
      visible: false,
      locked: true,
    })
    expect(
      [...root.querySelectorAll("[data-tree-control='select']")].map(
        (element) => (element as HTMLElement).dataset.treeId,
      ),
    ).toEqual(["page-1", "node-b", "node-a"])
    expect(dispatch.mock.calls.filter(([command]) => command.id === "node.reorder")).toHaveLength(1)

    editor.undo()
    expect(
      [...root.querySelectorAll("[data-tree-control='select']")].map(
        (element) => (element as HTMLElement).dataset.treeId,
      ),
    ).toEqual(["page-1", "node-a", "node-b"])
  })

  it("drag-reorders sibling tree rows through one command and preserves undo", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", name: "A" })
    addRectangle(editor, { id: "node-b", name: "B" })
    const dispatch = vi.spyOn(editor, "dispatch")
    mountEditor(root, editor, { pageId: "page-1" })
    const source = root.querySelector<HTMLElement>("[data-testid='tree-row-node-a']")!
    const target = root.querySelector<HTMLElement>("[data-testid='tree-row-node-b']")!
    const transfer = createDataTransfer()

    expect(source.draggable).toBe(true)
    expect(target.draggable).toBe(true)
    source.dispatchEvent(dragEvent("dragstart", transfer))
    expect(target.dispatchEvent(dragEvent("dragover", transfer))).toBe(false)
    target.dispatchEvent(dragEvent("drop", transfer))

    expect(dispatch.mock.calls.filter(([command]) => command.id === "node.reorder")).toEqual([
      [{ id: "node.reorder", payload: { id: "node-a", parentId: "page-1", index: "a1" } }],
    ])
    expect(
      [...root.querySelectorAll("[data-tree-control='select']")].map(
        (element) => (element as HTMLElement).dataset.treeId,
      ),
    ).toEqual(["page-1", "node-b", "node-a"])

    editor.undo()
    expect(
      [...root.querySelectorAll("[data-tree-control='select']")].map(
        (element) => (element as HTMLElement).dataset.treeId,
      ),
    ).toEqual(["page-1", "node-a", "node-b"])
  })

  it("rejects page-root, cross-parent and locked tree drops with diagnostics", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "parent-a" })
    addRectangle(editor, { id: "parent-b" })
    addRectangle(editor, { id: "child-a", parentId: "parent-a" })
    addRectangle(editor, { id: "child-b", parentId: "parent-b" })
    addRectangle(editor, { id: "locked", locked: true })
    addRectangle(editor, { id: "unlocked" })
    const dispatch = vi.spyOn(editor, "dispatch")
    mountEditor(root, editor, { pageId: "page-1" })

    expect(root.querySelector<HTMLElement>("[data-testid='tree-row-page-1']")?.draggable).toBe(
      false,
    )
    expect(root.querySelector<HTMLElement>("[data-testid='tree-row-locked']")?.draggable).toBe(
      false,
    )
    expect(root.querySelector<HTMLElement>("[data-testid='tree-row-unlocked']")?.draggable).toBe(
      true,
    )

    expect(reorderTreeItem(editor, editor.getStore(), "page-1", "unlocked")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "TREE_REORDER_NODE_REQUIRED", recordId: "page-1" }],
    })
    expect(reorderTreeItem(editor, editor.getStore(), "child-a", "child-b")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "TREE_REORDER_PARENT_MISMATCH", recordId: "child-a" }],
    })
    expect(reorderTreeItem(editor, editor.getStore(), "locked", "unlocked")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "NODE_LOCKED", recordId: "locked" }],
    })
    expect(reorderTreeItem(editor, editor.getStore(), "unlocked", "locked")).toMatchObject({
      ok: false,
      diagnostics: [{ code: "NODE_LOCKED", recordId: "locked" }],
    })
    expect(dispatch).not.toHaveBeenCalled()
  })

  it("selects and previews an unlocked rectangle before dispatching one parent-local move", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 20, y: 30 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setViewport({ x: 0, y: 0, zoom: 2 })
    const shell = root.querySelector<HTMLElement>("[data-testid='editor-shell']")!
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!

    node.dispatchEvent(pointerEvent("pointerdown", 100, 50))
    window.dispatchEvent(pointerEvent("pointermove", 140, 90))
    const outline = root.querySelector<SVGRectElement>("[data-testid='selection-node-1']")!

    expect(document.activeElement).toBe(shell)
    expect(mounted.session.getState().selection).toEqual(["node-1"])
    expect(node.style.transform).toBe("translate(20px, 20px)")
    expect(outline.getAttribute("transform")).toBe("translate(40 40)")
    expect(dispatch).not.toHaveBeenCalled()

    window.dispatchEvent(pointerEvent("pointerup", 140, 90))

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 20, y: 20 } },
    })
    expect(node.style.transform).toBe("")
    expect(
      root.querySelector("[data-testid='selection-node-1']")?.getAttribute("transform"),
    ).toBeNull()
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 40, y: 50 } })
    root.remove()
  })

  it("previews and commits all selected sibling nodes in one move command", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", x: 20, y: 30 })
    addRectangle(editor, { id: "node-b", x: 200, y: 160 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-a", "node-b"])
    const first = root.querySelector<HTMLElement>("[data-node-id='node-a']")!
    const second = root.querySelector<HTMLElement>("[data-node-id='node-b']")!
    const firstOutline = root.querySelector<SVGRectElement>("[data-testid='selection-node-a']")!
    const secondOutline = root.querySelector<SVGRectElement>("[data-testid='selection-node-b']")!
    const groupFrame = root.querySelector<SVGRectElement>("[data-testid='group-selection-frame']")!
    const groupHandle = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!

    first.dispatchEvent(pointerEvent("pointerdown", 100, 50))
    window.dispatchEvent(pointerEvent("pointermove", 140, 90))

    expect(first.style.transform).toBe("translate(40px, 40px)")
    expect(second.style.transform).toBe("translate(40px, 40px)")
    expect(firstOutline.getAttribute("transform")).toBe("translate(40 40)")
    expect(secondOutline.getAttribute("transform")).toBe("translate(40 40)")
    expect(groupFrame.getAttribute("transform")).toBe("translate(40 40)")
    expect(groupHandle.getAttribute("transform")).toBe("translate(40 40)")
    expect(dispatch).not.toHaveBeenCalled()

    window.dispatchEvent(pointerEvent("pointerup", 140, 90))

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      id: "node.move",
      payload: { ids: ["node-a", "node-b"], delta: { x: 40, y: 40 } },
    })
    expect(first.style.transform).toBe("")
    expect(second.style.transform).toBe("")
    expect(
      root.querySelector("[data-testid='selection-node-a']")?.getAttribute("transform"),
    ).toBeNull()
    expect(
      root.querySelector("[data-testid='selection-node-b']")?.getAttribute("transform"),
    ).toBeNull()
    expect(editor.getRecord("node-a")).toMatchObject({ layout: { x: 60, y: 70 } })
    expect(editor.getRecord("node-b")).toMatchObject({ layout: { x: 240, y: 200 } })
    root.remove()
  })

  it.each(["pointercancel", "Escape"])("cancels a move on %s without dispatching", (reason) => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1" })
    const dispatch = vi.spyOn(editor, "dispatch")
    mountEditor(root, editor, { pageId: "page-1" })
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!

    node.dispatchEvent(pointerEvent("pointerdown", 10, 20))
    window.dispatchEvent(pointerEvent("pointermove", 30, 40))
    expect(node.style.transform).toBe("translate(20px, 20px)")
    if (reason === "pointercancel") window.dispatchEvent(pointerEvent("pointercancel", 30, 40))
    else window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))

    expect(dispatch).not.toHaveBeenCalled()
    expect(node.style.transform).toBe("")
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 20, y: 30 } })
    root.remove()
  })

  it.each(["lostpointercapture", "blur", "destroy"])(
    "cleans an active move on %s without committing or leaving listeners",
    (reason) => {
      const root = document.createElement("div")
      document.body.append(root)
      const editor = createEditor(createDocumentWithPage())
      addRectangle(editor, { id: "node-1" })
      const dispatch = vi.spyOn(editor, "dispatch")
      const mounted = mountEditor(root, editor, { pageId: "page-1" })
      const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!
      const setPointerCapture = vi.fn()
      const releasePointerCapture = vi.fn()
      node.setPointerCapture = setPointerCapture
      node.releasePointerCapture = releasePointerCapture

      node.dispatchEvent(pointerEvent("pointerdown", 10, 20, 7))
      window.dispatchEvent(pointerEvent("pointermove", 30, 40, 7))
      expect(node.style.transform).toBe("translate(20px, 20px)")

      if (reason === "lostpointercapture") {
        node.dispatchEvent(pointerEvent("lostpointercapture", 30, 40, 7))
      } else if (reason === "blur") {
        window.dispatchEvent(new Event("blur"))
      } else {
        mounted.destroy()
      }

      expect(setPointerCapture).toHaveBeenCalledOnce()
      expect(setPointerCapture).toHaveBeenCalledWith(7)
      expect(releasePointerCapture).toHaveBeenCalledOnce()
      expect(releasePointerCapture).toHaveBeenCalledWith(7)
      expect(dispatch).not.toHaveBeenCalled()
      expect(node.style.transform).toBe("")

      window.dispatchEvent(pointerEvent("pointermove", 50, 60, 7))
      window.dispatchEvent(pointerEvent("pointerup", 50, 60, 7))
      expect(node.style.transform).toBe("")
      expect(dispatch).not.toHaveBeenCalled()
      expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 20, y: 30 } })
      mounted.destroy()
      root.remove()
    },
  )

  it("does not start transforms for locked rectangles", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", locked: true })
    addRectangle(editor, { id: "node-2" })
    const dispatch = vi.spyOn(editor, "dispatch")
    mountEditor(root, editor, { pageId: "page-1" })
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!

    expect(root.querySelector("[data-testid='resize-node-1-se']")).toBeNull()
    expect(root.querySelector("[data-testid='resize-node-2-se']")).not.toBeNull()
    node.dispatchEvent(pointerEvent("pointerdown", 10, 20))
    window.dispatchEvent(pointerEvent("pointermove", 30, 40))
    window.dispatchEvent(pointerEvent("pointerup", 30, 40))

    expect(dispatch).not.toHaveBeenCalled()
    expect(node.style.transform).toBe("")
  })

  it("previews resize ephemerally and dispatches one resize clamped to one pixel", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", width: 120, height: 80 })
    const dispatch = vi.spyOn(editor, "dispatch")
    mountEditor(root, editor, { pageId: "page-1" })
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!
    const handle = root.querySelector<HTMLElement>("[data-testid='resize-node-1-se']")!
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    handle.setPointerCapture = setPointerCapture
    handle.releasePointerCapture = releasePointerCapture

    handle.dispatchEvent(pointerEvent("pointerdown", 120, 80, 9))
    window.dispatchEvent(pointerEvent("pointermove", -20, -40, 9))

    expect(node.style.width).toBe("1px")
    expect(node.style.height).toBe("1px")
    expect(dispatch).not.toHaveBeenCalled()

    window.dispatchEvent(pointerEvent("pointerup", -20, -40, 9))
    window.dispatchEvent(pointerEvent("pointerup", -20, -40, 9))

    expect(setPointerCapture).toHaveBeenCalledOnce()
    expect(setPointerCapture).toHaveBeenCalledWith(9)
    expect(releasePointerCapture).toHaveBeenCalledOnce()
    expect(releasePointerCapture).toHaveBeenCalledWith(9)
    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      id: "node.resize",
      payload: { id: "node-1", width: 1, height: 1 },
    })
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { width: 1, height: 1 } })
  })

  it("resizes all selected sibling rectangles from the group southeast handle", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", x: 20, y: 30, width: 100, height: 80 })
    addRectangle(editor, { id: "node-b", x: 200, y: 160, width: 120, height: 80 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-a", "node-b"])

    const handles = [...root.querySelectorAll<SVGRectElement>("[data-group-resize-handle]")]
    expect(handles.map((handle) => handle.dataset.testid)).toEqual([
      "group-resize-n",
      "group-resize-ne",
      "group-resize-e",
      "group-resize-se",
      "group-resize-s",
      "group-resize-sw",
      "group-resize-w",
      "group-resize-nw",
    ])
    expect(handles.every((handle) => handle.getAttribute("width") === "8")).toBe(true)
    const southeast = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!
    const first = root.querySelector<HTMLElement>("[data-node-id='node-a']")!
    const second = root.querySelector<HTMLElement>("[data-node-id='node-b']")!
    const frame = root.querySelector<SVGRectElement>("[data-testid='group-selection-frame']")!
    const firstOutline = root.querySelector<SVGRectElement>("[data-testid='selection-node-a']")!
    const initialFrameWidth = frame.getAttribute("width")
    const initialOutlineX = firstOutline.getAttribute("x")

    southeast.dispatchEvent(pointerEvent("pointerdown", 320, 240, 11))
    window.dispatchEvent(pointerEvent("pointermove", 360, 280, 11))

    expect(first.style.width).not.toBe("100px")
    expect(second.style.width).not.toBe("120px")
    const previewFrame = root.querySelector<SVGRectElement>(
      "[data-testid='group-selection-frame']",
    )!
    const previewOutline = root.querySelector<SVGRectElement>("[data-testid='selection-node-a']")!
    expect(previewFrame.getAttribute("width")).not.toBe(initialFrameWidth)
    expect(previewOutline.getAttribute("x")).toBe(initialOutlineX)
    expect(dispatch).not.toHaveBeenCalled()

    window.dispatchEvent(pointerEvent("pointerup", 360, 280, 11))

    expect(dispatch).toHaveBeenCalledTimes(1)
    expect(dispatch).toHaveBeenCalledWith({
      id: "node.resizeMany",
      payload: {
        items: [
          { id: "node-a", x: 20, y: 30, width: 113.33333333333333, height: 95.23809523809524 },
          { id: "node-b", x: 224, y: 184.76190476190476, width: 136, height: 95.23809523809524 },
        ],
      },
    })
    expect(editor.getRecord("node-a")).toMatchObject({ layout: { width: 113.33333333333333 } })
    expect(editor.getRecord("node-b")).toMatchObject({ layout: { width: 136 } })
    mounted.destroy()
    root.remove()
  })

  it("hides node resize handles while a valid multi-selection is active", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a" })
    addRectangle(editor, { id: "node-b", x: 200 })
    const mounted = mountEditor(root, editor, { pageId: "page-1" })

    expect(root.querySelectorAll("[data-resize-node-id]")).toHaveLength(2)

    mounted.session.setSelection(["node-a", "node-b"])

    const hiddenHandles = [...root.querySelectorAll<HTMLElement>("[data-resize-node-id]")]
    expect(hiddenHandles).toHaveLength(2)
    expect(hiddenHandles.every((handle) => handle.hidden)).toBe(true)
    expect(root.querySelectorAll("[data-group-resize-handle]")).toHaveLength(8)

    const dispatch = vi.spyOn(editor, "dispatch")
    hiddenHandles[0]!.dispatchEvent(pointerEvent("pointerdown", 140, 110, 31))
    window.dispatchEvent(pointerEvent("pointermove", 180, 150, 31))
    window.dispatchEvent(pointerEvent("pointerup", 180, 150, 31))
    expect(dispatch).not.toHaveBeenCalled()

    mounted.session.setSelection(["node-a"])

    expect(root.querySelectorAll("[data-resize-node-id]:not([hidden])")).toHaveLength(0)
    expect(root.querySelectorAll("[data-group-resize-handle]")).toHaveLength(8)
    mounted.destroy()
    root.remove()
  })

  it("renders eight resize handles for a single selected rectangle", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 20, y: 30, width: 100, height: 80 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-1"])

    expect(root.querySelectorAll("[data-group-resize-handle]")).toHaveLength(8)
    expect(root.querySelector("[data-testid='resize-node-1-se']")).toHaveProperty("hidden", true)

    const northwest = root.querySelector<SVGRectElement>("[data-testid='group-resize-nw']")!
    northwest.dispatchEvent(pointerEvent("pointerdown", 21, 30, 14))
    window.dispatchEvent(pointerEvent("pointermove", 0, 20, 14))
    window.dispatchEvent(pointerEvent("pointerup", 0, 20, 14))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.resize",
      payload: { id: "node-1", x: 0, y: 20, width: 120, height: 90 },
    })
    expect(editor.getRecord("node-1")).toMatchObject({
      layout: { x: 0, y: 20, width: 120, height: 90 },
    })
    mounted.destroy()
    root.remove()
  })

  it("converts group resize pointers from workspace-local coordinates", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-a", x: 20, y: 30 })
    addRectangle(editor, { id: "node-b", x: 200, y: 160 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const workspace = root.querySelector<HTMLElement>("[data-testid='workspace']")!
    workspace.getBoundingClientRect = () =>
      ({ left: 50, top: 40, right: 1050, bottom: 840, width: 1000, height: 800 }) as DOMRect
    workspace.scrollLeft = 120
    workspace.scrollTop = 80
    mounted.session.setViewport({ x: 0, y: 0, zoom: 2 })
    mounted.session.setSelection(["node-a", "node-b"])

    const startClient = { x: 50 + 320 * 2 - 120, y: 40 + 240 * 2 - 80 }
    let handle = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!
    handle.dispatchEvent(pointerEvent("pointerdown", startClient.x, startClient.y, 21))
    window.dispatchEvent(pointerEvent("pointerup", startClient.x, startClient.y, 21))

    expect(dispatch).not.toHaveBeenCalled()

    handle = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!
    handle.dispatchEvent(pointerEvent("pointerdown", startClient.x, startClient.y, 22))
    window.dispatchEvent(pointerEvent("pointermove", startClient.x + 40, startClient.y, 22))
    window.dispatchEvent(pointerEvent("pointerup", startClient.x + 40, startClient.y, 22))

    expect(dispatch).toHaveBeenCalledTimes(1)
    const command = dispatch.mock.calls[0]?.[0]
    expect(command).toMatchObject({ id: "node.resizeMany" })
    if (command?.id !== "node.resizeMany") throw new Error("Expected node.resizeMany")
    expect(command.payload.items).toHaveLength(2)
    expect(command.payload.items[0]).toMatchObject({ id: "node-a", x: 20, y: 30 })
    expect(command.payload.items[0]?.width).toBeCloseTo(128)
    expect(command.payload.items[0]?.height).toBeCloseTo(80)
    expect(command.payload.items[1]).toMatchObject({ id: "node-b", y: 160 })
    expect(command.payload.items[1]?.x).toBeCloseTo(212)
    expect(command.payload.items[1]?.width).toBeCloseTo(128)
    expect(command.payload.items[1]?.height).toBeCloseTo(80)
    expect(editor.getRecord("node-a")).toMatchObject({ layout: { x: 20, y: 30, width: 128 } })
    expect(editor.getRecord("node-b")).toMatchObject({ layout: { x: 212, y: 160, width: 128 } })
    mounted.destroy()
    root.remove()
  })

  it.each([
    "same-parent selection containing a locked node",
    "same-parent selection containing a locked ancestor",
    "cross-parent selection",
    "selection containing a page record",
  ] as const)("does not render group resize controls for %s", (caseName) => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    let selection: string[]

    if (caseName === "same-parent selection containing a locked node") {
      addRectangle(editor, { id: "node-a", locked: true })
      addRectangle(editor, { id: "node-b", x: 200 })
      selection = ["node-a", "node-b"]
    } else if (caseName === "same-parent selection containing a locked ancestor") {
      addRectangle(editor, { id: "parent", locked: true })
      addRectangle(editor, { id: "node-a", parentId: "parent" })
      addRectangle(editor, { id: "node-b", parentId: "parent", x: 200 })
      selection = ["node-a", "node-b"]
    } else if (caseName === "cross-parent selection") {
      addRectangle(editor, { id: "parent-a" })
      addRectangle(editor, { id: "parent-b", x: 300 })
      addRectangle(editor, { id: "node-a", parentId: "parent-a" })
      addRectangle(editor, { id: "node-b", parentId: "parent-b" })
      selection = ["node-a", "node-b"]
    } else {
      addRectangle(editor, { id: "node-a" })
      addRectangle(editor, { id: "node-b", x: 200 })
      // NodeRecord.nodeType is currently the literal "rectangle". A page record is
      // the closest supported non-node type guard that can be represented in a selection.
      selection = ["page-1", "node-a", "node-b"]
    }

    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(selection)

    expect(root.querySelector("[data-testid='group-selection-frame']")).toBeNull()
    expect(root.querySelectorAll("[data-group-resize-handle]")).toHaveLength(0)
    mounted.destroy()
    root.remove()
  })

  it.each(["pointercancel", "Escape", "blur"] as const)(
    "cancels group resize on %s and restores persisted layouts",
    (reason) => {
      const root = document.createElement("div")
      document.body.append(root)
      const editor = createEditor(createDocumentWithPage())
      addRectangle(editor, { id: "node-a", x: 20, y: 30 })
      addRectangle(editor, { id: "node-b", x: 200, y: 160 })
      const dispatch = vi.spyOn(editor, "dispatch")
      const mounted = mountEditor(root, editor, { pageId: "page-1" })
      mounted.session.setSelection(["node-a", "node-b"])
      const handle = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!
      const first = root.querySelector<HTMLElement>("[data-node-id='node-a']")!
      const frame = root.querySelector<SVGRectElement>("[data-testid='group-selection-frame']")!

      handle.dispatchEvent(pointerEvent("pointerdown", 320, 240, 12))
      window.dispatchEvent(pointerEvent("pointermove", 360, 280, 12))
      expect(first.style.width).not.toBe("120px")

      if (reason === "pointercancel") window.dispatchEvent(pointerEvent(reason, 360, 280, 12))
      else if (reason === "Escape")
        window.dispatchEvent(new KeyboardEvent("keydown", { key: reason }))
      else window.dispatchEvent(new Event(reason))

      expect(dispatch).not.toHaveBeenCalled()
      expect(first.style.left).toBe("20px")
      expect(first.style.top).toBe("30px")
      expect(first.style.width).toBe("120px")
      expect(first.style.height).toBe("80px")
      expect(frame.getAttribute("transform")).toBeNull()
      expect(editor.getRecord("node-a")).toMatchObject({
        layout: { x: 20, y: 30, width: 120, height: 80 },
      })
      mounted.destroy()
      root.remove()
    },
  )

  it("handles undo and redo only when the shell itself has focus", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1" })
    editor.dispatch({ id: "node.move", payload: { ids: ["node-1"], delta: { x: 5, y: 0 } } })
    const undo = vi.spyOn(editor, "undo")
    const redo = vi.spyOn(editor, "redo")
    mountEditor(root, editor, { pageId: "page-1" })
    const shell = root.querySelector<HTMLElement>("[data-testid='editor-shell']")!
    const treeRow = root.querySelector<HTMLButtonElement>("[data-testid='tree-node-1']")!

    expect(shell.tabIndex).toBe(0)
    treeRow.focus()
    treeRow.dispatchEvent(new KeyboardEvent("keydown", { key: "z", metaKey: true, bubbles: true }))
    expect(undo).not.toHaveBeenCalled()

    shell.focus()
    shell.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }))
    expect(undo).toHaveBeenCalledTimes(1)
    shell.dispatchEvent(
      new KeyboardEvent("keydown", { key: "z", metaKey: true, shiftKey: true, bubbles: true }),
    )
    expect(redo).toHaveBeenCalledTimes(1)
    shell.dispatchEvent(new KeyboardEvent("keydown", { key: "y", ctrlKey: true, bubbles: true }))
    expect(redo).toHaveBeenCalledTimes(2)
    root.remove()
  })

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
