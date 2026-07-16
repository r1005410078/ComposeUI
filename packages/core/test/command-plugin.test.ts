import { describe, expect, it } from "vitest"
import {
  createEditor,
  createEmptyDocument,
  type CommandPlugin,
  type EditorOperation,
} from "@composeui/core"

const emptyDoc = () => createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })

const hostNoopPlugin: CommandPlugin = {
  id: "host.demo",
  register(api) {
    api.registerCommand({
      id: "host.noop",
      prepare: () => ({ ok: true, value: () => undefined, diagnostics: [] }),
    })
  },
}

describe("command plugins via createEditor", () => {
  it("dispatches a host plugin command and observes it", () => {
    const seen: string[] = []
    const editor = createEditor(emptyDoc(), {
      plugins: [hostNoopPlugin],
      operationObserver: {
        observe(op: EditorOperation) {
          if (op.type === "document.command") {
            seen.push(`${op.status}:${op.command.id}`)
          }
        },
      },
    })

    expect(editor.dispatch({ id: "host.noop" }).ok).toBe(true)
    expect(seen).toContain("started:host.noop")
    expect(seen).toContain("succeeded:host.noop")

    editor.dispose()
    const disposed = editor.dispatch({ id: "host.noop" })
    expect(disposed.ok).toBe(false)
    expect(disposed.diagnostics[0]?.code).toBe("EDITOR_DISPOSED")
  })

  it("returns COMMAND_NOT_REGISTERED for unknown command ids", () => {
    const editor = createEditor(emptyDoc())
    const result = editor.dispatch({ id: "host.missing", payload: {} })
    expect(result.ok).toBe(false)
    expect(result.diagnostics[0]?.code).toBe("COMMAND_NOT_REGISTERED")
    editor.dispose()
  })

  it("keeps dispose idempotent and blocks mutation APIs after dispose", () => {
    const editor = createEditor(emptyDoc(), { plugins: [hostNoopPlugin] })
    const create = editor.dispatch({
      id: "node.create",
      payload: {
        id: "n1",
        parentId: "page-1",
        name: "Rect",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        fill: "#fff",
      },
    })
    expect(create.ok).toBe(true)

    editor.dispose()
    editor.dispose()

    expect(editor.dispatch({ id: "host.noop" }).diagnostics[0]?.code).toBe("EDITOR_DISPOSED")
    expect(editor.execute({ id: "host.noop" }).diagnostics[0]?.code).toBe("EDITOR_DISPOSED")
    expect(editor.undo().diagnostics[0]?.code).toBe("EDITOR_DISPOSED")
    expect(editor.redo().diagnostics[0]?.code).toBe("EDITOR_DISPOSED")
    expect(editor.jumpToHistory(0).diagnostics[0]?.code).toBe("EDITOR_DISPOSED")

    // 只读 API 在 dispose 后仍可读最后一致快照
    expect(editor.getStore().get("n1")?.typeName).toBe("node")
    expect(editor.getRecord("n1")?.typeName).toBe("node")
    expect(editor.canUndo()).toBe(true)
    expect(editor.getHistory().currentIndex).toBeGreaterThanOrEqual(0)
    expect(Array.isArray(editor.getDiagnostics())).toBe(true)
  })

  it("subscribe after dispose is a no-op and does not call onDiagnostic", () => {
    const diagnostics: string[] = []
    const editor = createEditor(emptyDoc(), {
      onDiagnostic: (d) => diagnostics.push(d.code),
    })
    editor.dispose()

    let called = false
    const unsub = editor.subscribe(() => {
      called = true
    })
    unsub()

    // 变更 API 失败但不应触发 onDiagnostic（dispose 后钩子静默）
    editor.dispatch({
      id: "node.create",
      payload: {
        id: "x",
        parentId: "page-1",
        name: "X",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        fill: "#000",
      },
    })
    expect(called).toBe(false)
    expect(diagnostics).toEqual([])
  })

  it("execute is an alias of dispatch", () => {
    const editor = createEditor(emptyDoc(), { plugins: [hostNoopPlugin] })
    expect(editor.execute({ id: "host.noop" }).ok).toBe(true)
    editor.dispose()
  })

  it("rejects host plugin id that conflicts with composeui.builtin", () => {
    expect(() =>
      createEditor(emptyDoc(), {
        plugins: [
          {
            id: "composeui.builtin",
            register() {},
          },
        ],
      }),
    ).toThrowError(expect.objectContaining({ code: "PLUGIN_ID_CONFLICT" }))
  })
})
