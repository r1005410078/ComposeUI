// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { PageDocument } from "@composeui/core"
import { mountEditor } from "../src/index"
import {
  edgesForResizeHandle,
  shouldSnap,
  snapGroupResizeResult,
} from "../src/canvas/pointer"
import { selectionBounds } from "../src/canvas/group-resize"

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
    x?: number
    y?: number
    width?: number
    height?: number
  },
): void {
  const result = editor.dispatch({
    id: "node.create",
    payload: {
      id: input.id,
      parentId: "page-1",
      name: input.id,
      x: input.x ?? 20,
      y: input.y ?? 30,
      width: input.width ?? 120,
      height: input.height ?? 80,
      fill: "#2563eb",
    },
  })
  expect(result.ok).toBe(true)
}

function pointerEvent(
  type: string,
  x: number,
  y: number,
  options: { pointerId?: number; altKey?: boolean } = {},
): PointerEvent {
  const event = new MouseEvent(type, {
    bubbles: true,
    button: 0,
    clientX: x,
    clientY: y,
    altKey: options.altKey === true,
  }) as PointerEvent
  Object.defineProperty(event, "pointerId", { value: options.pointerId ?? 1 })
  return event
}

describe("shouldSnap", () => {
  it("requires snapEnabled and rejects Alt", () => {
    expect(shouldSnap({ snapEnabled: true }, {})).toBe(true)
    expect(shouldSnap({ snapEnabled: true }, { altKey: false })).toBe(true)
    expect(shouldSnap({ snapEnabled: true }, { altKey: true })).toBe(false)
    expect(shouldSnap({ snapEnabled: false }, {})).toBe(false)
    expect(shouldSnap({ snapEnabled: false }, { altKey: true })).toBe(false)
  })
})

describe("edgesForResizeHandle", () => {
  it("maps each handle to the moved edges", () => {
    expect(edgesForResizeHandle("se")).toEqual({
      left: false,
      right: true,
      top: false,
      bottom: true,
    })
    expect(edgesForResizeHandle("nw")).toEqual({
      left: true,
      right: false,
      top: true,
      bottom: false,
    })
    expect(edgesForResizeHandle("e")).toEqual({
      left: false,
      right: true,
      top: false,
      bottom: false,
    })
  })
})

describe("snapGroupResizeResult", () => {
  it("snaps a single item rect by handle edges with min size 1", () => {
    const items = [{ id: "node-1", x: 20, y: 30, width: 100, height: 80 }]
    const initial = selectionBounds(items)
    const resized = {
      bounds: { left: 20, top: 30, right: 133, bottom: 101 },
      items: [{ id: "node-1", x: 20, y: 30, width: 113, height: 71 }],
    }
    const snapped = snapGroupResizeResult(resized, "se", 8, initial, items)
    // right 133→136, bottom 101→104
    expect(snapped.items[0]).toEqual({ id: "node-1", x: 20, y: 30, width: 116, height: 74 })
    expect(snapped.bounds).toEqual({ left: 20, top: 30, right: 136, bottom: 104 })
  })

  it("snaps multi-select bounds then rescales children", () => {
    const items = [
      { id: "node-a", x: 16, y: 16, width: 80, height: 64 },
      { id: "node-b", x: 112, y: 96, width: 80, height: 64 },
    ]
    const initial = selectionBounds(items)
    const resized = {
      bounds: { left: 16, top: 16, right: 205, bottom: 173 },
      items: [
        { id: "node-a", x: 16, y: 16, width: 84, height: 70 },
        { id: "node-b", x: 118, y: 102, width: 84, height: 70 },
      ],
    }
    const snapped = snapGroupResizeResult(resized, "se", 8, initial, items)
    expect(snapped.bounds.right % 8).toBe(0)
    expect(snapped.bounds.bottom % 8).toBe(0)
    expect(snapped.bounds.left).toBe(16)
    expect(snapped.bounds.top).toBe(16)
    expect(snapped.items).toHaveLength(2)
    for (const item of snapped.items) {
      expect(item.width).toBeGreaterThanOrEqual(1)
      expect(item.height).toBeGreaterThanOrEqual(1)
    }
  })
})

describe("pointer move snap", () => {
  it("snaps absolute parent-local position and matches preview transform", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 20, y: 30 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    expect(mounted.session.getState().snapEnabled).toBe(true)
    expect(mounted.session.getState().gridSize).toBe(8)

    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!
    // unsnapped target (30, 40) → snap to (32, 40); delta (12, 10)
    node.dispatchEvent(pointerEvent("pointerdown", 25, 35))
    window.dispatchEvent(pointerEvent("pointermove", 35, 45))

    expect(node.style.transform).toBe("translate(12px, 10px)")
    expect(dispatch).not.toHaveBeenCalled()

    window.dispatchEvent(pointerEvent("pointerup", 35, 45))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 12, y: 10 } },
    })
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 32, y: 40 } })
    expect(node.style.transform).toBe("")
    mounted.destroy()
    root.remove()
  })

  it("does not snap while Alt is held", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 20, y: 30 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!

    node.dispatchEvent(pointerEvent("pointerdown", 25, 35, { altKey: true }))
    window.dispatchEvent(pointerEvent("pointermove", 35, 45, { altKey: true }))
    expect(node.style.transform).toBe("translate(10px, 10px)")
    window.dispatchEvent(pointerEvent("pointerup", 35, 45, { altKey: true }))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 10, y: 10 } },
    })
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 30, y: 40 } })
    mounted.destroy()
    root.remove()
  })

  it("does not snap when snapEnabled is false even if grid is visible", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 20, y: 30 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSnapEnabled(false)
    mounted.session.setGridVisible(true)
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!

    node.dispatchEvent(pointerEvent("pointerdown", 25, 35))
    window.dispatchEvent(pointerEvent("pointermove", 35, 45))
    window.dispatchEvent(pointerEvent("pointerup", 35, 45))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 10, y: 10 } },
    })
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 30, y: 40 } })
    mounted.destroy()
    root.remove()
  })

  it("still snaps when gridVisible is false", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 20, y: 30 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setGridVisible(false)
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!

    node.dispatchEvent(pointerEvent("pointerdown", 25, 35))
    window.dispatchEvent(pointerEvent("pointermove", 35, 45))
    window.dispatchEvent(pointerEvent("pointerup", 35, 45))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 12, y: 10 } },
    })
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 32, y: 40 } })
    mounted.destroy()
    root.remove()
  })
})

describe("pointer resize snap", () => {
  it("snaps southeast resize to grid and keeps preview aligned with commit", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 16, y: 24, width: 100, height: 80 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-1"])
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!
    const handle = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!

    // SE from (116, 104) → (125, 111): unsnapped 109×87 → snap right/bottom → 112×88
    handle.dispatchEvent(pointerEvent("pointerdown", 116, 104, { pointerId: 3 }))
    window.dispatchEvent(pointerEvent("pointermove", 125, 111, { pointerId: 3 }))

    expect(node.style.width).toBe("112px")
    expect(node.style.height).toBe("88px")
    expect(dispatch).not.toHaveBeenCalled()

    window.dispatchEvent(pointerEvent("pointerup", 125, 111, { pointerId: 3 }))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.resize",
      payload: { id: "node-1", x: 16, y: 24, width: 112, height: 88 },
    })
    expect(editor.getRecord("node-1")).toMatchObject({
      layout: { x: 16, y: 24, width: 112, height: 88 },
    })
    mounted.destroy()
    root.remove()
  })

  it("does not snap resize while Alt is held", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 16, y: 24, width: 100, height: 80 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-1"])
    const node = root.querySelector<HTMLElement>("[data-node-id='node-1']")!
    const handle = root.querySelector<SVGRectElement>("[data-testid='group-resize-se']")!

    handle.dispatchEvent(pointerEvent("pointerdown", 116, 104, { pointerId: 4, altKey: true }))
    window.dispatchEvent(pointerEvent("pointermove", 125, 111, { pointerId: 4, altKey: true }))
    expect(Number.parseFloat(node.style.width)).toBeCloseTo(109, 5)
    expect(Number.parseFloat(node.style.height)).toBeCloseTo(87, 5)
    window.dispatchEvent(pointerEvent("pointerup", 125, 111, { pointerId: 4, altKey: true }))

    expect(dispatch).toHaveBeenCalledTimes(1)
    const command = dispatch.mock.calls[0]?.[0]
    expect(command).toMatchObject({ id: "node.resize", payload: { id: "node-1", x: 16, y: 24 } })
    if (command?.id !== "node.resize") throw new Error("Expected node.resize")
    expect(command.payload.width).toBeCloseTo(109, 5)
    expect(command.payload.height).toBeCloseTo(87, 5)
    // Not snapped to gridSize 8
    expect(command.payload.width % 8).not.toBe(0)
    expect(command.payload.height % 8).not.toBe(0)
    mounted.destroy()
    root.remove()
  })

  it("snaps northwest handle origin edges", () => {
    const root = document.createElement("div")
    document.body.append(root)
    const editor = createEditor(createDocumentWithPage())
    addRectangle(editor, { id: "node-1", x: 40, y: 48, width: 100, height: 80 })
    const dispatch = vi.spyOn(editor, "dispatch")
    const mounted = mountEditor(root, editor, { pageId: "page-1" })
    mounted.session.setSelection(["node-1"])
    const handle = root.querySelector<SVGRectElement>("[data-testid='group-resize-nw']")!

    // NW from (40, 48) → (23, 35): unsnapped x=23,y=35,w=117,h=93
    // snap left/top: x=24,y=32; right/bottom fixed → w=116,h=96
    handle.dispatchEvent(pointerEvent("pointerdown", 40, 48, { pointerId: 5 }))
    window.dispatchEvent(pointerEvent("pointermove", 23, 35, { pointerId: 5 }))
    window.dispatchEvent(pointerEvent("pointerup", 23, 35, { pointerId: 5 }))

    expect(dispatch).toHaveBeenCalledWith({
      id: "node.resize",
      payload: { id: "node-1", x: 24, y: 32, width: 116, height: 96 },
    })
    expect(editor.getRecord("node-1")).toMatchObject({
      layout: { x: 24, y: 32, width: 116, height: 96 },
    })
    mounted.destroy()
    root.remove()
  })
})
