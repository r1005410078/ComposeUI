import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { EditorOperation } from "@composeui/core"

const createNodeCommand = (id: string) => ({
  id: "node.create" as const,
  payload: {
    id,
    parentId: "page-1",
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    fill: "#2563eb",
  },
})

describe("editor operation observer", () => {
  it("reports command attempts, success, failure and history operations", () => {
    const operations: EditorOperation[] = []
    const editor = createEditor(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
      { operationObserver: { observe: (operation) => operations.push(operation) } },
    )

    editor.dispatch(createNodeCommand("node-1"))
    editor.dispatch(createNodeCommand("node-1"))
    editor.undo()
    editor.redo()
    editor.jumpToHistory(0)

    expect(operations.map(({ type, status }) => `${type}:${status}`)).toEqual([
      "document.command:started",
      "document.command:succeeded",
      "document.command:started",
      "document.command:failed",
      "history.undo:succeeded",
      "history.redo:succeeded",
      "history.jump:succeeded",
    ])
  })

  it("reports failed empty history operations and clones command/document snapshots", () => {
    const operations: EditorOperation[] = []
    const editor = createEditor(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
      { operationObserver: { observe: (operation) => operations.push(operation) } },
    )

    expect(editor.undo().ok).toBe(false)
    expect(editor.redo().ok).toBe(false)
    expect(editor.jumpToHistory(1).ok).toBe(false)

    const command = createNodeCommand("node-2")
    editor.dispatch(command)
    command.payload.name = "mutated after dispatch"

    const success = operations.find(
      (operation): operation is Extract<EditorOperation, { type: "document.command"; status: "succeeded" }> =>
        operation.type === "document.command" && operation.status === "succeeded",
    )
    expect(success?.command.payload.name).toBe("node-2")
    if (success?.type === "document.command" && success.status === "succeeded") {
      success.after.records.find((record) => record.id === "node-2")!.id = "mutated"
    }
    expect(editor.getRecord("node-2")?.id).toBe("node-2")

    expect(operations.filter((operation) => operation.type.startsWith("history."))).toMatchObject([
      { type: "history.undo", status: "failed", diagnostics: [{ code: "HISTORY_UNDO_EMPTY" }] },
      { type: "history.redo", status: "failed", diagnostics: [{ code: "HISTORY_REDO_EMPTY" }] },
      { type: "history.jump", status: "failed", diagnostics: [{ code: "HISTORY_INDEX_INVALID" }] },
    ])
  })

  it("isolates observer failures and reports a diagnostic", () => {
    const diagnostics: string[] = []
    const editor = createEditor(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
      {
        operationObserver: { observe: () => { throw new Error("observer exploded") } },
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
      },
    )

    expect(editor.dispatch(createNodeCommand("node-1")).ok).toBe(true)
    expect(editor.getRecord("node-1")).toBeDefined()
    expect(diagnostics).toContain("EDITOR_OPERATION_OBSERVER_ERROR")
  })
})
