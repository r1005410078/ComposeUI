import { describe, expect, it, vi } from "vitest"
import type { PageDocument } from "@composeui/core"
import {
  MemoryOperationLogStore,
  OperationLogCoordinator,
  OperationRecorder,
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

  it("writes the first event-count checkpoint and does not checkpoint early", async () => {
    const { store, recorder } = create()
    const coordinator = await OperationLogCoordinator.start({
      store,
      recorder,
      snapshot,
      checkpointEveryEvents: 2,
      checkpointEveryMs: 30_000,
    })

    await coordinator.documentEvent(2)
    expect(await store.getNearestCheckpoint("s1", 2)).toBeUndefined()
    await coordinator.documentEvent(3)

    expect(await store.getNearestCheckpoint("s1", 3)).toMatchObject({
      sequence: 3,
      documentHash: "document-hash",
    })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { type: "system.sessionStarted" },
      { type: "system.checkpoint", sequence: 2 },
    ])
    await coordinator.end()
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
    await coordinator.documentEvent(2)

    expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({ sequence: 2 })
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
