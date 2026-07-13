import { describe, expect, it } from "vitest"
import type { OperationSession } from "@composeui/operation-log"
import { enforceRetention, MemoryOperationLogStore } from "@composeui/operation-log"

const session = (overrides: Partial<OperationSession>): OperationSession => ({
  sessionId: "session",
  projectId: "project",
  status: "ended",
  startedAt: "2026-06-01T00:00:00.000Z",
  endedAt: "2026-06-01T01:00:00.000Z",
  eventCount: 0,
  ...overrides,
})

describe("enforceRetention", () => {
  it("removes oldest completed sessions but preserves active and newest complete sessions", async () => {
    const store = new MemoryOperationLogStore()
    await store.putSession(session({ sessionId: "old", endedAt: "2026-07-01T00:00:00.000Z" }))
    await store.putSession(session({ sessionId: "new", endedAt: "2026-07-12T00:00:00.000Z" }))
    await store.putSession(
      session({
        sessionId: "current",
        status: "active",
        startedAt: "2026-07-13T00:00:00.000Z",
        endedAt: undefined,
      }),
    )

    await enforceRetention(store, {
      now: new Date("2026-07-13T00:00:00.000Z"),
      maxAgeMs: 1,
      maxBytes: 1,
    })

    expect((await store.listSessions("project")).map((item) => item.sessionId)).toEqual([
      "new",
      "current",
    ])
  })

  it("sorts equal timestamps by session id and deletes whole sessions", async () => {
    const store = new MemoryOperationLogStore()
    await store.putSession(session({ sessionId: "b", endedAt: "2026-07-01T00:00:00.000Z" }))
    await store.putSession(session({ sessionId: "a", endedAt: "2026-07-01T00:00:00.000Z" }))
    await store.putSession(session({ sessionId: "new", endedAt: "2026-07-12T00:00:00.000Z" }))

    const result = await enforceRetention(store, {
      now: new Date("2026-07-13T00:00:00.000Z"),
      maxAgeMs: 1,
      maxBytes: 1,
    })

    expect(result.deletedSessionIds).toEqual(["a", "b"])
    expect(await store.getSession("a")).toBeUndefined()
    expect(await store.query({ sessionId: "a" })).toEqual([])
  })

  it("filters deletion by project and uses store usage for byte retention", async () => {
    const store = new MemoryOperationLogStore()
    await store.putSession(session({ sessionId: "p1-old", projectId: "p1" }))
    await store.putSession(
      session({ sessionId: "p1-new", projectId: "p1", endedAt: "2026-07-12T00:00:00.000Z" }),
    )
    await store.putSession(session({ sessionId: "p2-old", projectId: "p2" }))

    const before = await store.estimateUsage()
    const result = await enforceRetention(store, {
      projectId: "p1",
      now: new Date("2026-07-13T00:00:00.000Z"),
      maxAgeMs: Number.POSITIVE_INFINITY,
      maxBytes: before - 1,
    })

    expect(result.usageBytes).toBe(await store.estimateUsage())
    expect(await store.getSession("p1-old")).toBeUndefined()
    expect(await store.getSession("p2-old")).toBeDefined()
  })
})
