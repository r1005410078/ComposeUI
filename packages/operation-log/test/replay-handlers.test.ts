import { describe, expect, it, vi } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { OperationEvent } from "@composeui/operation-log"
import {
  handleDocumentCommand,
  handleHistoryOperation,
  handleSessionOperation,
  handleWorkspaceOperation,
} from "@composeui/operation-log"
import type {
  ReplayHandlerContext,
  ReplaySessionPort,
  ReplayWorkspacePort,
} from "@composeui/operation-log"

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
  return {
    editor: createEditor(document),
    session,
    workspace: workspacePort(),
    sideEffects: "disabled",
  }
}

function workspacePort(): ReplayWorkspacePort & { calls: unknown[][] } {
  const calls: unknown[][] = []
  return {
    calls,
    openPanel: (panelId) => calls.push(["open", panelId]),
    closePanel: (panelId) => calls.push(["close", panelId]),
    activatePanel: (panelId) => calls.push(["activate", panelId]),
    applyLayout: (layout) => calls.push(["apply", layout]),
    resetLayout: (layout) => calls.push(["reset", layout]),
    getState: () => structuredClone(calls),
  }
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

function workspaceEvent<T>(
  type: string,
  status: OperationEvent["status"],
  payload: T,
): OperationEvent<T> {
  return { ...event(type, status, payload), category: "workspace" }
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

  it("accepts open DispatchCommand envelopes without requiring EditorCommand payload shape", async () => {
    const replay = context()
    const openEnvelope = { id: "plugin.custom-command" }
    expect(
      await handleDocumentCommand(
        event("document.command", "started", { command: openEnvelope }),
        replay,
      ),
    ).toBeUndefined()
    expect(replay.editor.getHistory().entries).toHaveLength(0)

    await expect(
      handleDocumentCommand(
        event("document.command", "succeeded", {
          command: openEnvelope,
          transaction: {
            transactionId: "transaction-1",
            label: openEnvelope.id,
            forward: { created: [], updated: [], removed: [] },
            inverse: { created: [], updated: [], removed: [] },
          },
        }),
        replay,
      ),
    ).resolves.toEqual({
      type: "missing-handler",
      sequence: 1,
      eventType: "document.command:plugin.custom-command",
    })
  })

  it("converts COMMAND_NOT_REGISTERED dispatch failure to missing-handler", async () => {
    const replay = context()
    const command = { id: "plugin.unregistered", payload: { any: true } }
    await expect(
      handleDocumentCommand(event("document.command", "succeeded", { command }), replay),
    ).resolves.toEqual({
      type: "missing-handler",
      sequence: 1,
      eventType: "document.command:plugin.unregistered",
    })
    await expect(
      handleDocumentCommand(
        {
          ...event("document.command", "failed", { command }),
          diagnostics: [{ code: "COMMAND_NOT_REGISTERED", severity: "error", message: "missing" }],
        },
        replay,
      ),
    ).resolves.toEqual({
      type: "missing-handler",
      sequence: 1,
      eventType: "document.command:plugin.unregistered",
    })
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

  it("matches history transactions by direction and pre-operation index", async () => {
    const replay = context()
    const first = createCommand("first")
    const second = createCommand("second")
    expect(replay.editor.dispatch(first).ok).toBe(true)
    expect(replay.editor.dispatch(second).ok).toBe(true)
    const entries = replay.editor.getHistory().entries

    expect(
      await handleHistoryOperation(
        {
          ...event("history.undo", "succeeded", { currentIndex: 1 }),
          transactionId: entries[1]!.transactionId,
        },
        replay,
      ),
    ).toBeUndefined()
    expect(
      await handleHistoryOperation(
        {
          ...event("history.undo", "succeeded", { currentIndex: 0 }),
          transactionId: entries[0]!.transactionId,
        },
        replay,
      ),
    ).toBeUndefined()
    expect(
      await handleHistoryOperation(
        {
          ...event("history.redo", "succeeded", { currentIndex: 1 }),
          transactionId: entries[0]!.transactionId,
        },
        replay,
      ),
    ).toBeUndefined()
    expect(
      await handleHistoryOperation(
        {
          ...event("history.redo", "succeeded", { currentIndex: 2 }),
          transactionId: entries[1]!.transactionId,
        },
        replay,
      ),
    ).toBeUndefined()
    expect(
      await handleHistoryOperation(
        {
          ...event("history.jump", "succeeded", { currentIndex: 0 }),
          transactionId: entries[0]!.transactionId,
        },
        replay,
      ),
    ).toBeUndefined()
  })

  it("rejects missing or invalid jump indexes before changing history", async () => {
    const replay = context()
    expect(replay.editor.dispatch(createCommand()).ok).toBe(true)
    const before = replay.editor.getHistory()
    await expect(
      handleHistoryOperation(event("history.jump", "succeeded", {}), replay),
    ).resolves.toMatchObject({ type: "schema-incompatible" })
    await expect(
      handleHistoryOperation(event("history.jump", "succeeded", { currentIndex: 99 }), replay),
    ).resolves.toMatchObject({ type: "schema-incompatible" })
    expect(replay.editor.getHistory()).toEqual(before)
  })

  it("accepts a successful empty patch without requiring a history entry", async () => {
    const replay = context()
    expect(replay.editor.dispatch(createCommand()).ok).toBe(true)
    const command = { id: "node.rename" as const, payload: { id: "node-1", name: "node-1" } }
    const emptyPatch = { created: [], updated: [], removed: [] }
    const transaction = {
      transactionId: "transaction-empty",
      label: command.id,
      forward: emptyPatch,
      inverse: emptyPatch,
    }
    expect(
      await handleDocumentCommand(
        event("document.command", "succeeded", { command, transaction, patch: emptyPatch }),
        replay,
      ),
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

  it("routes workspace panel and versioned layout operations through the workspace port", async () => {
    const replay = context()
    const layout = { version: 1, modeId: "2d", layout: { panels: ["inspector"] } }

    await handleWorkspaceOperation(
      workspaceEvent("workspace.panel.opened", "observed", { panelId: "inspector" }),
      replay,
    )
    await handleWorkspaceOperation(
      workspaceEvent("workspace.panel.closed", "observed", { panelId: "signals" }),
      replay,
    )
    await handleWorkspaceOperation(
      workspaceEvent("workspace.panel.activated", "observed", { panelId: "canvas" }),
      replay,
    )
    await handleWorkspaceOperation(
      workspaceEvent("workspace.layout.changed", "observed", { layout }),
      replay,
    )
    await handleWorkspaceOperation(
      workspaceEvent("workspace.layout.loaded", "observed", { layout }),
      replay,
    )
    await handleWorkspaceOperation(
      workspaceEvent("workspace.layout.reset", "observed", { layout }),
      replay,
    )

    expect(replay.workspace.getState()).toEqual([
      ["open", "inspector"],
      ["close", "signals"],
      ["activate", "canvas"],
      ["apply", layout],
      ["apply", layout],
      ["reset", layout],
    ])
  })

  it("rejects malformed workspace payloads without changing workspace state", async () => {
    const replay = context()
    const invalidEvents = [
      workspaceEvent("workspace.panel.opened", "observed", { panelId: "" }),
      workspaceEvent("workspace.layout.changed", "observed", {
        layout: { version: 2, modeId: "2d", layout: {} },
      }),
      workspaceEvent("workspace.layout.reset", "observed", {
        layout: { version: 1, modeId: "3d", layout: {} },
      }),
    ]

    for (const invalid of invalidEvents) {
      await expect(handleWorkspaceOperation(invalid, replay)).resolves.toMatchObject({
        type: "schema-incompatible",
      })
    }
    expect(replay.workspace.getState()).toEqual([])
  })

  it("keeps diagnostics as workspace no-ops", async () => {
    const replay = context()
    expect(
      await handleWorkspaceOperation(
        event("diagnostic.reported", "observed", { panelId: "inspector" }),
        replay,
      ),
    ).toBeUndefined()
    expect(replay.workspace.getState()).toEqual([])
  })

  it("rejects workspace operations with a non-workspace envelope without mutation", async () => {
    const replay = context()
    await expect(
      handleWorkspaceOperation(
        event("workspace.panel.opened", "observed", { panelId: "inspector" }),
        replay,
      ),
    ).resolves.toMatchObject({ type: "schema-incompatible" })
    await expect(
      handleWorkspaceOperation(
        workspaceEvent("workspace.panel.opened", "started", { panelId: "inspector" }),
        replay,
      ),
    ).resolves.toMatchObject({ type: "schema-incompatible" })
    expect(replay.workspace.getState()).toEqual([])
  })
})
