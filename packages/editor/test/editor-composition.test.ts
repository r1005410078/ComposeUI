// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { PageDocument } from "@composeui/core"
import { mountComponentTree } from "../src/component-tree"
import { mountEditor } from "../src/editor-view"
import { EditorSession } from "../src/session"

function createDocumentWithNode(): PageDocument {
  return createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
}

function addNode(editor: ReturnType<typeof createEditor>): void {
  expect(
    editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "page-1",
        name: "Node 1",
        x: 20,
        y: 30,
        width: 120,
        height: 80,
        fill: "#2563eb",
      },
    }).ok,
  ).toBe(true)
}

describe("editor view composition", () => {
  it("mounts a canvas without the component-tree aside", () => {
    const root = document.createElement("div")
    const editor = createEditor(createDocumentWithNode())
    addNode(editor)

    mountEditor(root, editor, { pageId: "page-1", view: "canvas" })

    expect(root.querySelector("[data-testid='page-board']")).not.toBeNull()
    expect(root.querySelector("[aria-label='Component tree']")).toBeNull()
  })

  it("mounts a standalone tree that shares selection with the canvas", () => {
    const canvasRoot = document.createElement("div")
    const treeRoot = document.createElement("div")
    const editor = createEditor(createDocumentWithNode())
    const session = new EditorSession()
    addNode(editor)

    mountEditor(canvasRoot, editor, { pageId: "page-1", view: "canvas", session })
    mountComponentTree(treeRoot, editor, { pageId: "page-1", session })

    treeRoot.querySelector<HTMLElement>("[data-testid='tree-node-1']")!.click()

    expect(session.getState().selection).toEqual(["node-1"])
    expect(canvasRoot.querySelector("[data-testid='selection-node-1']")).not.toBeNull()
  })

  it("unsubscribes each mounted view exactly once when destroyed", () => {
    const canvasRoot = document.createElement("div")
    const treeRoot = document.createElement("div")
    const editor = createEditor(createDocumentWithNode())
    const session = new EditorSession()
    addNode(editor)
    const coreUnsubscribed = vi.fn()
    const sessionUnsubscribed = vi.fn()
    const originalEditorSubscribe = editor.subscribe.bind(editor)
    const originalSessionSubscribe = session.subscribe.bind(session)

    vi.spyOn(editor, "subscribe").mockImplementation((listener) => {
      const unsubscribe = originalEditorSubscribe(listener)
      return () => {
        unsubscribe()
        coreUnsubscribed()
      }
    })
    vi.spyOn(session, "subscribe").mockImplementation((listener) => {
      const unsubscribe = originalSessionSubscribe(listener)
      return () => {
        unsubscribe()
        sessionUnsubscribed()
      }
    })

    const canvas = mountEditor(canvasRoot, editor, { pageId: "page-1", view: "canvas", session })
    const tree = mountComponentTree(treeRoot, editor, { pageId: "page-1", session })

    canvas.destroy()
    canvas.destroy()
    tree.destroy()
    tree.destroy()

    expect(coreUnsubscribed).toHaveBeenCalledTimes(2)
    expect(sessionUnsubscribed).toHaveBeenCalledTimes(2)
  })
})
