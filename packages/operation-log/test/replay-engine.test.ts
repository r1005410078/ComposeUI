import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import type { LogBundleV1, OperationEvent, ReplaySessionPort } from "../src/index"
import { canonicalJson, hashCanonical, importLogBundle } from "../src/index"
import { ReplayEngine } from "../src/index"

const document = createEmptyDocument({ documentId: "document-1", pageId: "page-1" })

function sessionPort(): ReplaySessionPort & { state: Record<string, unknown> } {
  const state: Record<string, unknown> = {
    selection: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    interactionMode: "select",
    gridVisible: true,
    expanded: [],
  }
  return {
    state,
    setSelection: (ids) => {
      state.selection = [...ids]
    },
    setViewport: (viewport) => {
      state.viewport = { ...viewport }
    },
    setInteractionMode: (mode) => {
      state.interactionMode = mode
    },
    setGridVisible: (visible) => {
      state.gridVisible = visible
    },
    setExpanded: (ids) => {
      state.expanded = [...ids]
    },
    getState: () => structuredClone(state),
  }
}

function event(sequence: number, payload: unknown): OperationEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sessionId: "session-1",
    projectId: "project-1",
    sequence,
    timestamp: `2026-07-14T00:${String(Math.floor(sequence / 60)).padStart(2, "0")}:${String(sequence % 60).padStart(2, "0")}.000Z`,
    category: "session",
    type: "session.gridVisibility",
    status: "succeeded",
    payload,
  }
}

function bundleWithCheckpoints(events: OperationEvent[]): LogBundleV1 {
  const bundle: LogBundleV1 = {
    manifest: {
      bundleVersion: 1,
      schemaVersion: 1,
      hashAlgorithm: "SHA-256",
      sessionId: "session-1",
      productVersion: "test",
      exportedAt: "2026-07-14T00:01:00.000Z",
      sectionHashes: { session: "", checkpoints: "", events: "" },
      manifestHash: "",
    },
    session: {
      sessionId: "session-1",
      projectId: "project-1",
      status: "ended",
      startedAt: "2026-07-14T00:00:00.000Z",
      endedAt: "2026-07-14T00:01:00.000Z",
      eventCount: events.length,
      finalHash: "final",
    },
    checkpoints: [
      {
        sessionId: "session-1",
        sequence: 0,
        createdAt: "2026-07-14T00:00:00.000Z",
        document,
        sessionState: sessionPort().state,
        documentHash: "document",
        sessionHash: "session",
      },
    ],
    events,
  }
  return bundle
}

async function importTestBundle(bundle: LogBundleV1) {
  const sectionHashes = {
    session: await hashCanonical(bundle.session),
    checkpoints: await hashCanonical(bundle.checkpoints),
    events: await hashCanonical(bundle.events),
  }
  const { manifestHash: _oldManifestHash, ...manifestWithoutHash } = {
    ...bundle.manifest,
    sectionHashes,
  }
  const encoded = canonicalJson({
    ...bundle,
    manifest: {
      ...manifestWithoutHash,
      manifestHash: await hashCanonical(manifestWithoutHash),
    },
  })
  return importLogBundle(encoded)
}

describe("ReplayEngine", () => {
  it("starts at the nearest checkpoint and pauses at the first difference", async () => {
    const command = {
      id: "node.create" as const,
      payload: {
        id: "node-1",
        parentId: "page-1",
        name: "Rectangle",
        x: 0,
        y: 0,
        width: 100,
        height: 80,
        fill: "#f00",
      },
    }
    const expected = createEditor(document)
    expect(expected.dispatch(command).ok).toBe(true)
    const transaction = expected.getHistory().entries[0]!
    const checkpointHash = await hashCanonical(document)
    const events = Array.from({ length: 120 }, (_, index) =>
      event(index + 1, { gridVisible: true }),
    )
    events[113] = {
      ...events[113]!,
      category: "document",
      type: "document.command",
      payload: { command, transaction, patch: transaction.forward },
      afterHash: "0000000000000000000000000000000000000000000000000000000000000000",
    }
    const bundle = bundleWithCheckpoints(events)
    bundle.checkpoints = [
      {
        sessionId: "session-1",
        sequence: 0,
        createdAt: "2026-07-14T00:00:00.000Z",
        document,
        sessionState: sessionPort().state,
        documentHash: checkpointHash,
        sessionHash: await hashCanonical(sessionPort().state),
      },
      {
        sessionId: "session-1",
        sequence: 100,
        createdAt: "2026-07-14T00:00:50.000Z",
        document,
        sessionState: sessionPort().state,
        documentHash: checkpointHash,
        sessionHash: await hashCanonical(sessionPort().state),
      },
    ]

    const activeEditor = createEditor(document)
    const activeBefore = activeEditor.getStore().all()
    const engine = await ReplayEngine.create({
      bundle: await importTestBundle(bundle),
      targetSequence: 120,
      createSession: () => sessionPort(),
    })
    const result = await engine.runTo(120)

    expect(result.startedAtSequence).toBe(100)
    expect(result.status).toBe("paused")
    expect(result.difference).toMatchObject({
      type: "state-hash-mismatch",
      sequence: 114,
    })
    expect(result.currentSequence).toBe(114)
    expect(activeEditor.getStore().all()).toEqual(activeBefore)
  })

  it("continues after a mismatch as nondeterministic", async () => {
    const events = [
      event(1, { gridVisible: false }),
      { ...event(2, { gridVisible: true }), afterHash: "bad" },
      event(3, { gridVisible: false }),
    ]
    const engine = await ReplayEngine.create({
      bundle: await importTestBundle(bundleWithCheckpoints(events)),
      createSession: () => sessionPort(),
    })
    const paused = await engine.verify()
    expect(paused.status).toBe("paused")
    const continued = await engine.continueBestEffort()
    expect(continued.deterministic).toBe(false)
    expect(continued.currentSequence).toBe(3)
  })

  it("rejects an unbranded bundle and reports a missing prior checkpoint", async () => {
    const futureCheckpointBundle = bundleWithCheckpoints([event(1, { gridVisible: true })])
    futureCheckpointBundle.checkpoints[0]!.sequence = 1
    const bundle = await importTestBundle(futureCheckpointBundle)
    expect(Object.getOwnPropertySymbols(bundle)).toHaveLength(0)
    await expect(
      ReplayEngine.create({
        bundle: structuredClone(bundle),
        createSession: () => sessionPort(),
      }),
    ).rejects.toThrow("REPLAY_BUNDLE_NOT_VALIDATED")
    await expect(
      ReplayEngine.create({
        bundle: { ...bundle },
        createSession: () => sessionPort(),
      }),
    ).rejects.toThrow("REPLAY_BUNDLE_NOT_VALIDATED")

    const engine = await ReplayEngine.create({
      bundle,
      targetSequence: 0,
      createSession: () => sessionPort(),
    })
    const result = await engine.runTo(0)
    expect(result.status).toBe("paused")
    expect(result.difference).toMatchObject({ type: "schema-incompatible", sequence: 0 })
  })

  it("turns handler and session exceptions into typed differences", async () => {
    const handlerBundle = await importTestBundle(
      bundleWithCheckpoints([event(1, { gridVisible: true })]),
    )
    const handlerEngine = await ReplayEngine.create({
      bundle: handlerBundle,
      createSession: () => sessionPort(),
      approvedHandlers: {
        "session.gridVisibility": async () => {
          throw new Error("handler boom")
        },
      },
    })
    const handlerResult = await handlerEngine.verify()
    expect(handlerResult.difference).toMatchObject({
      type: "session-error",
      eventType: "session.gridVisibility",
    })

    const sessionEngine = await ReplayEngine.create({
      bundle: handlerBundle,
      createSession: () => ({
        ...sessionPort(),
        setGridVisible: () => {
          throw new Error("session boom")
        },
      }),
    })
    const sessionResult = await sessionEngine.verify()
    expect(sessionResult.difference).toMatchObject({
      type: "session-error",
      eventType: "session.gridVisibility",
    })
  })

  it("uses the target supplied to each runTo call", async () => {
    const bundle = await importTestBundle(
      bundleWithCheckpoints([event(1, { gridVisible: true }), event(2, { gridVisible: true })]),
    )
    const engine = await ReplayEngine.create({
      bundle,
      createSession: () => sessionPort(),
    })
    expect((await engine.runTo(1)).targetSequence).toBe(1)
    expect((await engine.runTo(2)).targetSequence).toBe(2)
  })
})
