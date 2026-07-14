import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { OperationEvent } from "@composeui/operation-log"
import {
  handleDocumentCommand,
  handleHistoryOperation,
  handleSessionOperation,
} from "@composeui/operation-log"
import type { ReplayHandlerContext, ReplaySessionPort } from "@composeui/operation-log"

const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })

function context(
  session: ReplaySessionPort = {
    setSelection: vi.fn(),
    setViewport: vi.fn(),
    setInteractionMode: vi.fn(),
    setGridVisible: vi.fn(),
    setExpanded: vi.fn(),
    getState: vi.fn(() => ({})),
  },
): ReplayHandlerContext {
  return { editor: createEditor(document), session, sideEffects: "disabled" }
}

function event<T>(type: string, status: OperationEvent["status"], payload: T): OperationEvent<T> {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    sessionId: "session-1",
    projectId: "project-1",
    sequence: 1,
    timestamp: "2026-07-14T00:00:00.000Z",
    category: type.startsWith("session.")
      ? "session"
      : type.startsWith("history.")
        ? "history"
        : "document",
    type,
    status,
    payload,
  }
}

const createCommand = (id = "node-1") => ({
  id: "node.create" as const,
  payload: { id, parentId: "page-1", name: id, x: 0, y: 0, width: 100, height: 80, fill: "#f00" },
})

describe("built-in replay handlers", () => {
  it("replays a successful stored command and reports the first patch mismatch", async () => {
    const command = createCommand()
    const editor = createEditor(document)
    expect(editor.dispatch(command).ok).toBe(true)
    const transaction = editor.getHistory().entries[0]!
    const result = await handleDocumentCommand(
      event("document.command", "succeeded", {
        command,
        transaction,
        patch: transaction.forward,
      }),
      context(),
    )
    expect(result).toBeUndefined()

    const mismatch = await handleDocumentCommand(
      event("document.command", "succeeded", {
        command: { ...command, payload: { ...command.payload, width: 999 } },
        transaction,
        patch: transaction.forward,
      }),
      context(),
    )
    expect(mismatch).toMatchObject({
      type: "patch-mismatch",
      path: "forward.created[0].layout.width",
    })
  })

  it("validates started payload shape without dispatching", async () => {
    const replay = context()
    const result = await handleDocumentCommand(
      event("document.command", "started", { command: createCommand() }),
      replay,
    )
    expect(result).toBeUndefined()
    expect(replay.editor.getHistory().entries).toHaveLength(0)
  })

  it("requires failed commands to preserve state and diagnostic codes", async () => {
    const replay = context()
    const before = replay.editor.getStore().all()
    const result = await handleDocumentCommand(
      {
        ...event("document.command", "failed", {
          command: {
            ...createCommand("missing"),
            payload: { ...createCommand("missing").payload, parentId: "missing-page" },
          },
        }),
        diagnostics: [{ code: "PARENT_NOT_FOUND", severity: "error", message: "missing" }],
      },
      replay,
    )
    expect(result).toBeUndefined()
    expect(replay.editor.getStore().all()).toEqual(before)
  })

  it("replays history operations", async () => {
    const replay = context()
    expect(replay.editor.dispatch(createCommand()).ok).toBe(true)
    expect(
      await handleHistoryOperation(event("history.undo", "succeeded", { currentIndex: 0 }), replay),
    ).toBeUndefined()
    expect(
      await handleHistoryOperation(event("history.redo", "succeeded", { currentIndex: 1 }), replay),
    ).toBeUndefined()
    expect(
      await handleHistoryOperation(event("history.jump", "succeeded", { currentIndex: 0 }), replay),
    ).toBeUndefined()
  })

  it("routes session operations through the session port", async () => {
    const session = context().session
    const replay = context(session)
    await handleSessionOperation(event("session.selection", "observed", { ids: ["a"] }), replay)
    await handleSessionOperation(
      event("session.viewport", "observed", { x: 1, y: 2, zoom: 3 }),
      replay,
    )
    await handleSessionOperation(event("session.tool", "observed", { mode: "pan" }), replay)
    await handleSessionOperation(event("session.grid", "observed", { visible: true }), replay)
    await handleSessionOperation(
      event("session.treeDisclosure", "observed", { ids: ["a"] }),
      replay,
    )
    expect(session.setSelection).toHaveBeenCalledWith(["a"])
    expect(session.setViewport).toHaveBeenCalledWith({ x: 1, y: 2, zoom: 3 })
    expect(session.setInteractionMode).toHaveBeenCalledWith("pan")
    expect(session.setGridVisible).toHaveBeenCalledWith(true)
    expect(session.setExpanded).toHaveBeenCalledWith(["a"])
  })
})
