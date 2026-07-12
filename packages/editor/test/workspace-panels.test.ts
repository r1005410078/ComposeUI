// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import { EditorSession } from "../src/index"
import type { WorkspaceContext } from "../src/workspace/types"
import { createWorkspacePanels, type PanelId } from "../src/workspace/panels"

function createContext(resources?: WorkspaceContext["resources"]): WorkspaceContext {
  const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
  editor.dispatch({
    id: "node.create",
    payload: {
      id: "node-1",
      parentId: "page-1",
      name: "Rectangle",
      x: 20,
      y: 30,
      width: 120,
      height: 80,
      fill: "#2563eb",
    },
  })
  return {
    editor,
    session: new EditorSession(),
    pageId: "page-1",
    resources,
    api: {
      execute: vi.fn(),
      undo: vi.fn(),
      redo: vi.fn(),
      openPanel: vi.fn(),
      closePanel: vi.fn(),
      resetLayout: vi.fn(),
    },
    emit: vi.fn(),
  }
}

function panel(id: PanelId) {
  const descriptor = createWorkspacePanels().find((candidate) => candidate.id === id)
  if (descriptor === undefined) throw new Error(`Missing panel ${id}`)
  return descriptor
}

describe("workspace panel renderers", () => {
  it("mounts Scene and Canvas with the shared session", () => {
    const context = createContext()
    const sceneRoot = document.createElement("div")
    const canvasRoot = document.createElement("div")

    const disposeScene = panel("scene").mount(sceneRoot, context)
    const disposeCanvas = panel("canvas").mount(canvasRoot, context)

    expect(sceneRoot.querySelector("[aria-label='节点树']")).not.toBeNull()
    expect(canvasRoot.querySelector("[data-testid='page-board']")).not.toBeNull()
    context.session.setSelection(["node-1"])
    expect(canvasRoot.querySelector("[data-testid='selection-node-1']")).not.toBeNull()

    expect(() => {
      if (typeof disposeScene === "function") disposeScene()
      if (typeof disposeScene === "function") disposeScene()
      if (typeof disposeCanvas === "function") disposeCanvas()
      if (typeof disposeCanvas === "function") disposeCanvas()
    }).not.toThrow()
  })

  it("renders and updates the selected record in 检查器", () => {
    const context = createContext()
    const root = document.createElement("div")
    const dispose = panel("inspector").mount(root, context)

    context.session.setSelection(["node-1"])
    const nameInput = root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")
    expect(nameInput?.value).toBe("Rectangle")
    expect(root.querySelector("[data-testid='inspector-type']")?.textContent).toBe("node")

    nameInput!.value = "Renamed"
    nameInput!.dispatchEvent(new Event("change", { bubbles: true }))
    expect(context.editor.getRecord("node-1")).toMatchObject({ name: "Renamed" })
    expect(root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")?.value).toBe(
      "Renamed",
    )

    context.editor.undo()
    expect(root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")?.value).toBe(
      "Rectangle",
    )

    context.editor.redo()
    expect(root.querySelector<HTMLInputElement>("[data-testid='inspector-name']")?.value).toBe(
      "Renamed",
    )

    if (typeof dispose === "function") {
      dispose()
      dispose()
    }
  })

  it("renders core history and wires accessible undo and redo actions", () => {
    const context = createContext()
    const root = document.createElement("div")
    const dispose = panel("history").mount(root, context)

    expect(root.querySelector("[aria-label='历史']")).not.toBeNull()
    expect(root.querySelectorAll("[data-testid='history-entry']")).toHaveLength(1)
    expect(root.querySelector("[data-testid='history-entry']")?.textContent).toBe("node.create")

    const undo = root.querySelector<HTMLButtonElement>("[data-testid='history-undo']")
    const redo = root.querySelector<HTMLButtonElement>("[data-testid='history-redo']")
    expect(undo?.disabled).toBe(false)
    expect(redo?.disabled).toBe(true)
    undo!.click()
    expect(context.editor.getRecord("node-1")).toBeUndefined()
    const undoAfter = root.querySelector<HTMLButtonElement>("[data-testid='history-undo']")
    const redoAfter = root.querySelector<HTMLButtonElement>("[data-testid='history-redo']")
    expect(undoAfter?.disabled).toBe(true)
    expect(redoAfter?.disabled).toBe(false)
    redoAfter!.click()
    expect(context.editor.getRecord("node-1")).toBeDefined()
    expect(root.querySelector<HTMLButtonElement>("[data-testid='history-undo']")?.disabled).toBe(
      false,
    )
    expect(root.querySelector<HTMLButtonElement>("[data-testid='history-redo']")?.disabled).toBe(
      true,
    )

    if (typeof dispose === "function") dispose()
  })

  it("renders resources or an honest empty state", async () => {
    const resources = { list: vi.fn().mockResolvedValue([{ id: "asset-1", name: "Logo" }]) }
    const context = createContext(resources)
    const root = document.createElement("div")
    const dispose = panel("resources").mount(root, context)

    await vi.waitFor(() => expect(root.textContent).toContain("Logo"))
    expect(root.querySelector("[data-testid='empty-resources']")).toBeNull()
    if (typeof dispose === "function") dispose()

    const emptyRoot = document.createElement("div")
    panel("resources").mount(emptyRoot, createContext())
    expect(emptyRoot.querySelector("[data-testid='empty-resources']")).not.toBeNull()
  })

  it("renders a resource error and emits panel-failure when listing throws synchronously", () => {
    const error = new Error("resource service unavailable")
    const context = createContext({
      list: () => {
        throw error
      },
    })
    const root = document.createElement("div")

    expect(() => panel("resources").mount(root, context)).not.toThrow()
    expect(root.querySelector("[data-testid='resource-error']")?.textContent).toBe("无法加载资源。")
    expect(root.querySelector("[data-testid='empty-resources']")).toBeNull()
    expect(context.emit).toHaveBeenCalledWith({
      type: "panel-failure",
      panelId: "resources",
      error,
    })
  })

  it("renders a resource error and emits panel-failure when listing rejects", async () => {
    const error = new Error("resource request failed")
    const context = createContext({ list: () => Promise.reject(error) })
    const root = document.createElement("div")

    panel("resources").mount(root, context)
    await vi.waitFor(() => {
      expect(root.querySelector("[data-testid='resource-error']")?.textContent).toBe(
        "无法加载资源。",
      )
    })
    expect(context.emit).toHaveBeenCalledWith({
      type: "panel-failure",
      panelId: "resources",
      error,
    })
  })

  it("provides named empty states for remaining utility panels", () => {
    const context = createContext()
    for (const id of ["signals", "output"] satisfies PanelId[]) {
      const root = document.createElement("div")
      panel(id).mount(root, context)
      expect(root.querySelector(`[data-testid='empty-${id}']`)).not.toBeNull()
    }
  })

  it("returns all first-party panel descriptors with stable ids", () => {
    const ids: PanelId[] = createWorkspacePanels().map((descriptor) => descriptor.id)
    expect(ids).toEqual([
      "scene",
      "resources",
      "history",
      "canvas",
      "inspector",
      "signals",
      "output",
    ])
  })
})
