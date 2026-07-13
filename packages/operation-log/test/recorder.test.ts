import { describe, expect, it, vi } from "vitest"
import type {
  OperationEvent,
  OperationLogStore,
  RecordOperationInput,
} from "@composeui/operation-log"
import { MemoryOperationLogStore, OperationRecorder } from "@composeui/operation-log"

const input = (overrides: Partial<RecordOperationInput> = {}): RecordOperationInput => ({
  category: "system",
  type: "system.sessionStarted",
  status: "observed",
  payload: {},
  ...overrides,
})

describe("OperationRecorder", () => {
  it("assigns metadata, sequence, and sanitized payload", async () => {
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

    const first = await recorder.record(input())
    const second = await recorder.record(
      input({
        category: "document",
        type: "document.command",
        status: "failed",
        causationId: first.eventId,
        payload: { token: "secret" },
      }),
    )
    await recorder.flush()

    expect(first).toMatchObject({
      schemaVersion: 1,
      eventId: "event-1",
      sessionId: "s1",
      projectId: "p1",
      sequence: 1,
      timestamp: "2026-07-13T00:00:00.000Z",
    })
    expect(second).toMatchObject({ sequence: 2, causationId: "event-1" })
    expect(await store.query({ sessionId: "s1" })).toMatchObject([
      { sequence: 1 },
      { sequence: 2, payload: { token: "[REDACTED]" } },
    ])
  })

  it("writes events serially in call order and flush waits for all writes", async () => {
    const writes: OperationEvent[] = []
    let releaseFirst: (() => void) | undefined
    const firstWrite = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const store: OperationLogStore = {
      append: vi.fn(async (events) => {
        if (writes.length === 0) await firstWrite
        writes.push(...events)
      }),
      query: vi.fn(async () => []),
      subscribe: () => () => undefined,
    }
    const recorder = new OperationRecorder({
      sessionId: "s1",
      projectId: "p1",
      store,
      idFactory: (() => {
        let index = 0
        return () => `event-${++index}`
      })(),
    })

    const first = recorder.record(input({ type: "first" }))
    const second = recorder.record(input({ type: "second" }))
    const flushed = recorder.flush()
    await Promise.resolve()
    expect(writes).toEqual([])

    releaseFirst!()
    await expect(flushed).resolves.toBeUndefined()
    await expect(Promise.all([first, second])).resolves.toMatchObject([
      { sequence: 1, type: "first" },
      { sequence: 2, type: "second" },
    ])
    expect(writes.map((event) => event.type)).toEqual(["first", "second"])
    expect(store.append).toHaveBeenCalledTimes(2)
  })

  it("reports store failures, resolves record, and continues the queue", async () => {
    const failure = new Error("disk full")
    const degraded = vi.fn()
    const append = vi
      .fn<OperationLogStore["append"]>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValue(undefined)
    const store: OperationLogStore = {
      append,
      query: vi.fn(async () => []),
      subscribe: () => () => undefined,
    }
    const recorder = new OperationRecorder({
      sessionId: "s1",
      projectId: "p1",
      store,
      onDegraded: degraded,
      idFactory: (() => {
        let index = 0
        return () => `event-${++index}`
      })(),
    })

    const first = recorder.record(input({ type: "first" }))
    const second = recorder.record(input({ type: "second" }))

    await expect(first).resolves.toMatchObject({ sequence: 1 })
    await expect(second).resolves.toMatchObject({ sequence: 2 })
    await expect(recorder.flush()).resolves.toBeUndefined()
    expect(degraded).toHaveBeenCalledWith(failure, expect.objectContaining({ sequence: 1 }))
    expect(append).toHaveBeenCalledTimes(2)
  })
})
