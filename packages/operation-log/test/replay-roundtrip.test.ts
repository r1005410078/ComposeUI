import { describe, expect, it } from "vitest"
import { canonicalizeDocument, createEditor, createEmptyDocument } from "@composeui/core"
import {
  MemoryOperationLogStore,
  OperationRecorder,
  ReplayEngine,
  createCoreOperationObserver,
  exportLogBundle,
  hashCanonical,
  importLogBundle,
  type ReplaySessionPort,
  type ReplayWorkspacePort,
} from "../src/index"

function createSession(): ReplaySessionPort {
  let state = {
    viewport: { x: 0, y: 0, zoom: 1 },
    selection: [] as string[],
    expanded: [] as string[],
    gridVisible: true,
    interactionMode: "select" as const,
  }
  return {
    setSelection(ids) {
      state = { ...state, selection: [...ids] }
    },
    setViewport(viewport) {
      state = { ...state, viewport: { ...viewport } }
    },
    setExpanded(ids) {
      state = { ...state, expanded: [...ids] }
    },
    setGridVisible(gridVisible) {
      state = { ...state, gridVisible }
    },
    setInteractionMode(interactionMode) {
      state = { ...state, interactionMode }
    },
    getState() {
      return structuredClone(state)
    },
  }
}

function createWorkspace(initialState: unknown): ReplayWorkspacePort {
  let state = initialState
  return {
    openPanel(panelId) {
      state = { ...(state as Record<string, unknown> | undefined), activePanelId: panelId }
    },
    closePanel(panelId) {
      state = { ...(state as Record<string, unknown> | undefined), closedPanelId: panelId }
    },
    activatePanel(panelId) {
      state = { ...(state as Record<string, unknown> | undefined), activePanelId: panelId }
    },
    applyLayout(layout) {
      state = layout
    },
    resetLayout(layout) {
      state = layout
    },
    getState() {
      return structuredClone(state)
    },
  }
}

async function recordScenario(options: { includeWorkspace?: boolean } = {}) {
  const store = new MemoryOperationLogStore()
  const recorder = new OperationRecorder({
    sessionId: "roundtrip-session",
    projectId: "roundtrip-project",
    store,
    redactor: <T>(value: T) => structuredClone(value),
  })
  const initialDocument = createEmptyDocument({ documentId: "document-1", pageId: "page-1" })
  const session = createSession()
  const initialWorkspace = { version: 1, modeId: "2d", layout: { panels: [] } }
  await store.putCheckpoint({
    sessionId: recorder.sessionId,
    sequence: 0,
    createdAt: "2026-07-14T00:00:00.000Z",
    document: initialDocument,
    sessionState: session.getState(),
    documentHash: await hashCanonical(initialDocument),
    sessionHash: await hashCanonical(session.getState()),
    ...(options.includeWorkspace === false
      ? {}
      : {
          workspaceState: initialWorkspace,
          workspaceHash: await hashCanonical(initialWorkspace),
        }),
  })
  const editor = createEditor(initialDocument, {
    operationObserver: createCoreOperationObserver(recorder),
  })
  await recorder.record({
    category: "system",
    type: "system.sessionStarted",
    status: "observed",
    payload: {},
  })
  if (options.includeWorkspace !== false) {
    await recorder.record({
      category: "workspace",
      type: "workspace.panel.opened",
      status: "observed",
      payload: { panelId: "inspector" },
    })
    await recorder.record({
      category: "workspace",
      type: "workspace.layout.changed",
      status: "observed",
      payload: { layout: { version: 1, modeId: "2d", layout: { panels: ["inspector"] } } },
    })
  }
  session.setSelection(["node-1"])
  await recorder.record({
    category: "session",
    type: "session.selection",
    status: "observed",
    payload: { ids: ["node-1"] },
  })
  session.setViewport({ x: 40, y: 80, zoom: 1.5 })
  await recorder.record({
    category: "session",
    type: "session.viewport",
    status: "observed",
    payload: { x: 40, y: 80, zoom: 1.5 },
  })
  session.setInteractionMode("pan")
  await recorder.record({
    category: "session",
    type: "session.tool",
    status: "observed",
    payload: { mode: "pan" },
  })
  session.setGridVisible(false)
  await recorder.record({
    category: "session",
    type: "session.grid",
    status: "observed",
    payload: { visible: false },
  })
  session.setExpanded(["page-1", "node-1"])
  await recorder.record({
    category: "session",
    type: "session.treeDisclosure",
    status: "observed",
    payload: { ids: ["page-1", "node-1"] },
  })

  expect(
    editor.dispatch({
      id: "node.create",
      payload: {
        id: "node-1",
        parentId: "page-1",
        name: "Original rectangle",
        x: 20,
        y: 30,
        width: 120,
        height: 80,
        fill: "#2563eb",
      },
    }).ok,
  ).toBe(true)
  expect(
    editor.dispatch({ id: "node.move", payload: { ids: ["node-1"], delta: { x: 15, y: 25 } } }).ok,
  ).toBe(true)
  expect(
    editor.dispatch({ id: "node.rename", payload: { id: "node-1", name: "Renamed rectangle" } }).ok,
  ).toBe(true)
  expect(editor.undo().ok).toBe(true)
  expect(editor.redo().ok).toBe(true)
  expect(editor.jumpToHistory(2).ok).toBe(true)

  await recorder.flush()
  const finalDocument = canonicalizeDocument(editor.getStore())
  await store.putSession({
    sessionId: recorder.sessionId,
    projectId: recorder.projectId,
    status: "ended",
    startedAt: "2026-07-14T00:00:00.000Z",
    endedAt: "2026-07-14T00:01:00.000Z",
    eventCount: recorder.sequence,
  })
  const bundle = await importLogBundle(
    await exportLogBundle(store, {
      sessionId: recorder.sessionId,
      productVersion: "roundtrip-test",
      exportedAt: "2026-07-14T00:01:00.000Z",
      redactor: <T>(value: T) => structuredClone(value),
      redactionPolicy: "replay-test-v1",
    }),
  )
  return {
    bundle,
    editor,
    finalDocument,
    finalSession: session.getState(),
    finalWorkspace: { version: 1, modeId: "2d", layout: { panels: ["inspector"] } },
    eventCount: recorder.sequence,
    store,
  }
}

describe("ReplayEngine public round trip", () => {
  it("reconstructs document, session, and workspace mutations exactly", async () => {
    const recorded = await recordScenario()
    const result = await (
      await ReplayEngine.create({
        bundle: recorded.bundle,
        createSession,
        createWorkspace,
      })
    ).verify()
    expect(result).toMatchObject({ status: "completed", deterministic: true })
    expect(await hashCanonical(result.state?.document)).toBe(
      await hashCanonical(recorded.finalDocument),
    )
    expect(await hashCanonical(result.state?.session)).toBe(
      await hashCanonical(recorded.finalSession),
    )
    expect(await hashCanonical(result.state?.workspace)).toBe(
      await hashCanonical(recorded.finalWorkspace),
    )
    expect(result.currentSequence).toBe(recorded.eventCount)
    expect(canonicalizeDocument(recorded.editor.getStore())).toEqual(recorded.finalDocument)
    const sourceEvents = await recorded.store.query({
      sessionId: recorded.bundle.session.sessionId,
    })
    expect(sourceEvents.filter((event) => event.category === "document")).toHaveLength(6)
  })

  it("keeps workspace undefined through a legacy checkpoint without workspace fields", async () => {
    const recorded = await recordScenario({ includeWorkspace: false })
    const engine = await ReplayEngine.create({
      bundle: recorded.bundle,
      createSession,
    })
    expect(engine.getState().workspace).toBeUndefined()
    const result = await engine.verify()

    expect(result).toMatchObject({ status: "completed", deterministic: true })
    expect(result.state?.workspace).toBeUndefined()
  })
})
