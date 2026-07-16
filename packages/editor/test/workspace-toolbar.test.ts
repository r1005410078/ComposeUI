// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import { EditorSession } from "../src/index"
import type { EditorPreviewFrame, EditorPreviewSource } from "../src/editor-view"
import { mountWorkspaceToolbar } from "../src/workspace/toolbar"

function createToolbarContext() {
  const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
  editor.dispatch({
    id: "node.create",
    payload: {
      id: "node-1",
      parentId: "page-1",
      name: "Rectangle",
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      fill: "#2563eb",
    },
  })
  const session = new EditorSession()
  const api = {
    execute: vi.fn(),
    undo: vi.fn(() => editor.undo()),
    redo: vi.fn(() => editor.redo()),
    openPanel: vi.fn(() => true),
    closePanel: vi.fn(() => true),
    resetLayout: vi.fn(),
  }
  return { editor, session, api }
}

describe("workspace toolbar", () => {
  it("renders accessible Lucide controls and toggles the 2D tool state", () => {
    const context = createToolbarContext()
    const root = document.createElement("div")
    mountWorkspaceToolbar(root, {
      ...context,
      panels: [{ id: "resources", title: "资源", closable: true }],
    })

    const grid = root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-grid']")!
    const select = root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-select']")!
    const pan = root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-pan']")!
    expect(grid.getAttribute("aria-label")).toBe("切换网格")
    expect(grid.title).toBe("切换网格")
    expect(grid.querySelector("svg")).not.toBeNull()
    expect(select.getAttribute("aria-pressed")).toBe("true")
    expect(root.querySelectorAll("[data-testid='workspace-toolbar-divider']")).toHaveLength(4)
    expect(root.querySelectorAll(".composeui-editor__toolbar-group")).toHaveLength(5)
    for (const id of ["move", "rotate", "scale", "snap", "lock", "view"]) {
      const button = root.querySelector<HTMLButtonElement>(`[data-testid='workspace-tool-${id}']`)
      expect(button?.disabled).toBe(true)
      expect(button?.getAttribute("aria-label")).toBeTruthy()
      expect(button?.title).toBeTruthy()
    }

    pan.click()
    expect(pan.getAttribute("aria-pressed")).toBe("true")
    expect(select.getAttribute("aria-pressed")).toBe("false")
    expect(context.session.getState().interactionMode).toBe("pan")
    context.session.setInteractionMode("select")
    expect(select.getAttribute("aria-pressed")).toBe("true")
    grid.click()
    expect(context.session.getState().gridVisible).toBe(false)
    expect(grid.getAttribute("aria-pressed")).toBe("false")
  })

  it("enables history controls from editor history without rendering the panel menu", () => {
    const context = createToolbarContext()
    const root = document.createElement("div")
    mountWorkspaceToolbar(root, {
      ...context,
      panels: [{ id: "resources", title: "资源", closable: true }],
    })

    const undo = root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-undo']")!
    const redo = root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-redo']")!
    expect(undo.disabled).toBe(false)
    expect(redo.disabled).toBe(true)
    undo.click()
    expect(redo.disabled).toBe(false)
    expect(root.querySelector("[data-testid='workspace-panel-menu']")).toBeNull()
    expect(root.querySelector("[role='menu']")).toBeNull()
  })

  it("locks source-session toolbar actions while preview is active", () => {
    const context = createToolbarContext()
    const root = document.createElement("div")
    let frame: EditorPreviewFrame = { active: true }
    const listeners = new Set<(next: EditorPreviewFrame) => void>()
    const preview: EditorPreviewSource = {
      getState: () => frame,
      subscribe(listener) {
        listeners.add(listener)
        listener(frame)
        return () => listeners.delete(listener)
      },
    }
    const dispose = mountWorkspaceToolbar(root, {
      ...context,
      panels: [],
      preview,
    })

    for (const id of ["select", "pan", "grid", "undo", "redo"]) {
      expect(
        root.querySelector<HTMLButtonElement>(`[data-testid='workspace-tool-${id}']`)?.disabled,
      ).toBe(true)
    }
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-pan']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-grid']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-undo']")!.click()
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-redo']")!.click()
    expect(context.session.getState().interactionMode).toBe("select")
    expect(context.session.getState().gridVisible).toBe(true)
    expect(context.api.undo).not.toHaveBeenCalled()
    expect(context.api.redo).not.toHaveBeenCalled()

    frame = { active: false }
    for (const listener of listeners) listener(frame)
    expect(
      root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-pan']")?.disabled,
    ).toBe(false)
    root.querySelector<HTMLButtonElement>("[data-testid='workspace-tool-pan']")!.click()
    expect(context.session.getState().interactionMode).toBe("pan")
    dispose()
    expect(listeners).toHaveLength(0)
  })
})
