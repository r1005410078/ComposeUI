import { describe, expect, it } from "vitest"
import type { PageDocument } from "@composeui/core"
import type { OperationCheckpoint, OperationSession } from "@composeui/operation-log"
import { MemoryOperationLogStore } from "@composeui/operation-log"

const document = (): PageDocument => ({
  schemaVersion: 1,
  rootPageId: "page-1",
  records: [],
})

const session = (overrides: Partial<OperationSession> = {}): OperationSession => ({
  sessionId: "s1",
  projectId: "p1",
  status: "active",
  startedAt: "2026-07-13T00:00:00.000Z",
  eventCount: 0,
  ...overrides,
})

const checkpoint = (overrides: Partial<OperationCheckpoint> = {}): OperationCheckpoint => ({
  sessionId: "s1",
  sequence: 10,
  createdAt: "2026-07-13T00:00:10.000Z",
  document: document(),
  sessionState: { expanded: ["page-1"] },
  documentHash: "document-hash",
  sessionHash: "session-hash",
  ...overrides,
})

describe("MemoryOperationLogStore lifecycle storage", () => {
  it("stores cloned session metadata and checkpoints", async () => {
    const store = new MemoryOperationLogStore()
    const metadata = session({ status: "active" })
    const savedCheckpoint = checkpoint()

    await store.putSession(metadata)
    await store.putCheckpoint(savedCheckpoint)
    metadata.status = "ended"
    savedCheckpoint.sessionState = { expanded: ["changed"] }

    expect(await store.getSession("s1")).toMatchObject({ status: "active" })
    expect(await store.getNearestCheckpoint("s1", 12)).toMatchObject({ sequence: 10 })
    expect((await store.getNearestCheckpoint("s1", 12))?.sessionState).toEqual({
      expanded: ["page-1"],
    })
  })

  it("clones lifecycle reads and lists sessions by project deterministically", async () => {
    const store = new MemoryOperationLogStore()
    await store.putSession(
      session({ sessionId: "s2", projectId: "p1", startedAt: "2026-07-13T00:00:02.000Z" }),
    )
    await store.putSession(
      session({ sessionId: "s1", projectId: "p1", startedAt: "2026-07-13T00:00:01.000Z" }),
    )
    await store.putSession(session({ sessionId: "other", projectId: "p2" }))

    const sessions = await store.listSessions("p1")
    sessions[0]!.eventCount = 99

    expect(sessions.map((item) => item.sessionId)).toEqual(["s1", "s2"])
    expect((await store.getSession("s1"))?.eventCount).toBe(0)
    expect(await store.listSessions("missing")).toEqual([])
  })

  it("returns the nearest checkpoint at or before a sequence", async () => {
    const store = new MemoryOperationLogStore()
    await store.putCheckpoint(checkpoint({ sequence: 2 }))
    await store.putCheckpoint(checkpoint({ sequence: 10 }))
    await store.putCheckpoint(checkpoint({ sequence: 20 }))

    expect(await store.getNearestCheckpoint("s1", 19)).toMatchObject({ sequence: 10 })
    expect(await store.getNearestCheckpoint("s1", 2)).toMatchObject({ sequence: 2 })
    expect(await store.getNearestCheckpoint("s1", 1)).toBeUndefined()
  })

  it("deletes a session, its events, and its checkpoints atomically", async () => {
    const store = new MemoryOperationLogStore()
    await store.putSession(session())
    await store.putCheckpoint(checkpoint())

    await store.deleteSession("s1")

    expect(await store.getSession("s1")).toBeUndefined()
    expect(await store.getNearestCheckpoint("s1", 10)).toBeUndefined()
    expect(await store.query({ sessionId: "s1" })).toEqual([])
  })

  it("estimates stored usage and keeps rejected writes unchanged", async () => {
    const store = new MemoryOperationLogStore()
    const first = session({ sessionId: "s1" })
    await store.putSession(first)
    const before = await store.estimateUsage()

    await expect(store.putSession(session({ sessionId: "s1", projectId: "" }))).rejects.toThrow(
      "INVALID_OPERATION_SESSION",
    )

    expect(await store.getSession("s1")).toEqual(first)
    expect(await store.estimateUsage()).toBe(before)
  })
})
