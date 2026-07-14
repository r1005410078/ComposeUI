import { describe, expect, it, vi } from "vitest"
import type { PageDocument } from "@composeui/core"
import {
  MemoryOperationLogStore,
  OperationLogCoordinator,
  OperationRecorder,
  hashCanonical,
} from "@composeui/operation-log"

const document = (): PageDocument => ({ schemaVersion: 1, rootPageId: "page-1", records: [] })

const snapshot = () => ({
  document: document(),
  sessionState: { expanded: ["page-1"] },
  documentHash: "document-hash",
  sessionHash: "session-hash",
})

const clock = () => {
  let current = "2026-07-13T00:00:00.000Z"
  return {
    now: () => current,
    advance: (value: string) => {
      current = value
    },
  }
}

const create = (
  options: Partial<ConstructorParameters<typeof OperationLogCoordinator.start>[0]> = {},
) => {
  const store = new MemoryOperationLogStore()
  const recorder = new OperationRecorder({
    sessionId: "s1",
    projectId: "p1",
    store,
    clock: () => "2026-07-13T00:00:00.000Z",
    idFactory: (() => {
      let index = 0
      return () => `event-${++index}`
    })(),
  })
  return { store, recorder, ...options }
}

describe("OperationLogCoordinator", () => {
  it("persists an active session and records sessionStarted", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      clock: { now: () => "2026-07-13T00:00:00.000Z" },
    })

    expect(await store.getSession("s1")).toMatchObject({
      projectId: "p1",
      status: "active",
      eventCount: 1,
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { type: "system.sessionStarted", sequence: 1 },
    ])
    await coordinator.end()
  })

  it("uses recorder sequence for the first no-argument checkpoint", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      checkpointEveryEvents: 2,
      checkpointEveryMs: 30_000,
    })

    await coordinator.documentEvent()
    expect(await store.getNearestCheckpoint("s1", 2)).toBeUndefined()
    await coordinator.documentEvent()

    expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({
      sequence: 2,
      documentHash: "document-hash",
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { type: "system.sessionStarted" },
      { type: "system.checkpoint", sequence: 2 },
    ])
    await coordinator.end()
  })

  it("persists a workspace snapshot and reports its hash in the checkpoint event", async () => {
    const { store, recorder } = create()
    const workspaceState = { panels: { inspector: true } }
    const workspaceHash = await hashCanonical(workspaceState)
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot: () => ({
        ...snapshot(),
        workspaceState,
        workspaceHash,
      }),
      checkpointEveryEvents: 1,
    })

    await coordinator.documentEvent()

    expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({
      sequence: 2,
      workspaceState,
      workspaceHash,
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { type: "system.sessionStarted" },
      {
        type: "system.checkpoint",
        payload: { sequence: 2, workspaceHash },
      },
    ])
    await coordinator.end()
  })

  it("rejects a snapshot with only one workspace field", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot: () => ({ ...snapshot(), workspaceState: {} }),
      checkpointEveryEvents: 1,
    })

    await expect(coordinator.documentEvent()).rejects.toThrow("INVALID_OPERATION_SNAPSHOT")
    await coordinator.end()
  })

  it("rejects a workspace snapshot with a mismatched hash", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot: () => ({
        ...snapshot(),
        workspaceState: { panels: { inspector: true } },
        workspaceHash: "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      }),
      checkpointEveryEvents: 1,
    })

    await expect(coordinator.documentEvent()).rejects.toThrow("INVALID_OPERATION_SNAPSHOT")
    await coordinator.end()
  })

  it("captures and appends a checkpoint before a concurrent workspace event", async () => {
    const { store, recorder } = create()
    const workspaceState = { panels: { inspector: true } }
    const workspaceHash = await hashCanonical(workspaceState)
    let releaseSnapshot!: () => void
    let snapshotStarted!: () => void
    const snapshotReady = new Promise<void>((resolve) => {
      releaseSnapshot = resolve
    })
    const snapshotStartedPromise = new Promise<void>((resolve) => {
      snapshotStarted = resolve
    })
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot: async () => {
        snapshotStarted()
        await snapshotReady
        return { ...snapshot(), workspaceState, workspaceHash }
      },
      checkpointEveryEvents: 1,
    })

    const checkpointing = coordinator.documentEvent()
    await snapshotStartedPromise
    const workspaceEvent = recorder.record({
      category: "workspace",
      type: "workspace.layoutChanged",
      status: "observed",
      payload: { panel: "inspector" },
    })
    releaseSnapshot()
    await Promise.all([checkpointing, workspaceEvent])

    expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({
      sequence: 2,
      workspaceState,
      workspaceHash,
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { sequence: 1, type: "system.sessionStarted" },
      { sequence: 2, type: "system.checkpoint", payload: { sequence: 2, workspaceHash } },
      { sequence: 3, type: "workspace.layoutChanged" },
    ])
    await coordinator.end()
  })

  it("synchronizes session eventCount after flushing non-document events", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({ store, recorder, snapshot })

    await recorder.record({
      category: "session",
      type: "session.selection",
      status: "observed",
      payload: { ids: ["node-1"] },
    })
    await coordinator.flush()

    expect(await store.getSession("s1")).toMatchObject({ status: "active", eventCount: 2 })
    await coordinator.end()
  })

  it("preserves ended status when flushing after session end", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({ store, recorder, snapshot })

    await coordinator.end()
    await coordinator.flush()

    expect(await store.getSession("s1")).toMatchObject({
      status: "ended",
      eventCount: recorder.sequence,
    })
  })

  it("serializes a concurrent flush behind end without overwriting the ended session", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({ store, recorder, snapshot })
    await recorder.record({
      category: "session",
      type: "session.selection",
      status: "observed",
      payload: { ids: ["node-1"] },
    })

    let releaseActiveSessionWrite!: () => void
    let activeSessionWriteStarted!: () => void
    const activeSessionWriteReleased = new Promise<void>((resolve) => {
      releaseActiveSessionWrite = resolve
    })
    const activeSessionWriteStartedPromise = new Promise<void>((resolve) => {
      activeSessionWriteStarted = resolve
    })
    const putSession = store.putSession.bind(store)
    vi.spyOn(store, "putSession").mockImplementation(async (session) => {
      if (session.status === "active" && session.eventCount === 2) {
        activeSessionWriteStarted()
        await activeSessionWriteReleased
      }
      await putSession(session)
    })

    const ending = coordinator.end("final-hash")
    const flushing = coordinator.flush()
    const writeStartedBeforeEnd = await Promise.race([
      activeSessionWriteStartedPromise.then(() => true),
      ending.then(() => false),
    ])
    expect(writeStartedBeforeEnd).toBe(false)
    releaseActiveSessionWrite()
    await Promise.all([ending, flushing])

    expect(await store.getSession("s1")).toMatchObject({
      status: "ended",
      eventCount: 3,
      finalHash: "final-hash",
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { sequence: 1, type: "system.sessionStarted" },
      { sequence: 2, type: "session.selection" },
      { sequence: 3, type: "system.sessionEnded" },
    ])
  })

  it("checkpoints when the time threshold is reached", async () => {
    const time = clock()
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      clock: time,
      checkpointEveryEvents: 100,
      checkpointEveryMs: 30_000,
    })

    time.advance("2026-07-13T00:00:31.000Z")
    await coordinator.documentEvent()

    expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({ sequence: 2 })
    await coordinator.end()
  })

  it("keeps an explicit recorder sequence aligned across interleaved events", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      checkpointEveryEvents: 2,
      checkpointEveryMs: 30_000,
    })

    await recorder.record({
      category: "document",
      type: "document.command",
      status: "observed",
      payload: { step: 1 },
    })
    await coordinator.documentEvent(2)
    await recorder.record({
      category: "document",
      type: "document.command",
      status: "observed",
      payload: { step: 2 },
    })
    await coordinator.documentEvent(3)

    expect(await store.getNearestCheckpoint("s1", 4)).toMatchObject({ sequence: 4 })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { sequence: 1, type: "system.sessionStarted" },
      { sequence: 2, type: "document.command" },
      { sequence: 3, type: "document.command" },
      { sequence: 4, type: "system.checkpoint", payload: { sequence: 4 } },
    ])
    await coordinator.end()
  })

  it("rejects an explicit sequence that is not the recorder sequence", async () => {
    const { recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store: new MemoryOperationLogStore(),
      recorder,
      snapshot,
    })

    await expect(coordinator.documentEvent(99)).rejects.toThrow("OPERATION_SEQUENCE_OUT_OF_SYNC")
    await coordinator.end()
  })

  it("flushes, records sessionEnded, and marks the session ended", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({ store, recorder, snapshot })

    await coordinator.end("final-hash")

    expect(await store.getSession("s1")).toMatchObject({
      status: "ended",
      endedAt: expect.any(String),
      finalHash: "final-hash",
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { type: "system.sessionStarted", sequence: 1 },
      { type: "system.sessionEnded", sequence: 2 },
    ])
    await expect(coordinator.end()).resolves.toBeUndefined()
  })

  it("marks stale active sessions abnormal without adding a recovery event", async () => {
    const { store, recorder } = create()
    await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      clock: { now: () => "2026-07-13T00:00:00.000Z" },
    })
    const before = await store.query({ sessionId: "s1" })

    await OperationLogCoordinator.recover(store, "2026-07-13T01:00:00.000Z")

    expect(await store.getSession("s1")).toMatchObject({ status: "abnormal" })
    expect(await store.query({ sessionId: "s1" })).toEqual(before)
  })

  it("installs lifecycle hooks and flushes when hidden or disposed", async () => {
    const hidden = vi.fn<(listener: () => Promise<void>) => () => void>()
    const dispose = vi.fn<(listener: () => Promise<void>) => () => void>()
    const { store, recorder } = create()
    await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      lifecycle: { onHidden: hidden, onDispose: dispose },
    })

    expect(hidden).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
