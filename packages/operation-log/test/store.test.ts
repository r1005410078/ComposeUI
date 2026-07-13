import { describe, expect, it, vi } from "vitest"
import type { OperationEvent } from "@composeui/operation-log"
import { MemoryOperationLogStore } from "@composeui/operation-log"

const event = (overrides: Partial<OperationEvent> = {}): OperationEvent => ({
  schemaVersion: 1,
  eventId: "e1",
  sessionId: "s1",
  projectId: "p1",
  sequence: 1,
  timestamp: "2026-07-13T00:00:00.000Z",
  category: "document",
  type: "document.command",
  status: "succeeded",
  payload: { value: 1 },
  ...overrides,
})

describe("MemoryOperationLogStore", () => {
  it("appends events in sequence order and rejects duplicate or non-contiguous events", async () => {
    const store = new MemoryOperationLogStore()

    await store.append([event()])

    await expect(store.append([event({ eventId: "e1", sequence: 2 })])).rejects.toThrow(
      "DUPLICATE_OPERATION_EVENT",
    )
    await expect(store.append([event({ eventId: "e2", sequence: 3 })])).rejects.toThrow(
      "NON_CONTIGUOUS_OPERATION_SEQUENCE",
    )
    expect(await store.query({ sessionId: "s1" })).toEqual([
      expect.objectContaining({ eventId: "e1", sequence: 1 }),
    ])
  })

  it("keeps batches atomic and notifies only after a successful append", async () => {
    const store = new MemoryOperationLogStore()
    const listener = vi.fn()
    store.subscribe(listener)

    await expect(store.append([event(), event({ eventId: "e2", sequence: 3 })])).rejects.toThrow(
      "NON_CONTIGUOUS_OPERATION_SEQUENCE",
    )
    expect(await store.query({ sessionId: "s1" })).toEqual([])
    expect(listener).not.toHaveBeenCalled()

    await store.append([event(), event({ eventId: "e2", sequence: 2 })])
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it("clones input and query results, filters afterSequence, and tracks sequences per session", async () => {
    const store = new MemoryOperationLogStore()
    const payload = { nested: { value: 1 } }

    await store.append([
      event({ eventId: "e2", sessionId: "s2", sequence: 1, payload }),
      event({ eventId: "e1", sessionId: "s1", sequence: 1 }),
    ])
    payload.nested.value = 99

    const result = await store.query({ sessionId: "s2", afterSequence: 0 })
    result[0]!.payload = { nested: { value: 42 } }

    expect((await store.query({ sessionId: "s2" }))[0]!.payload).toEqual({
      nested: { value: 1 },
    })
    expect(await store.query({ sessionId: "s1", afterSequence: 1 })).toEqual([])
  })

  it("rejects event ids globally across sessions", async () => {
    const store = new MemoryOperationLogStore()

    await store.append([event()])
    await expect(
      store.append([event({ sessionId: "s2", eventId: "e1", sequence: 1 })]),
    ).rejects.toThrow("DUPLICATE_OPERATION_EVENT")
  })
})
