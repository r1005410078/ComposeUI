import "fake-indexeddb/auto"

import { afterEach, describe, expect, it } from "vitest"
import type { OperationEvent } from "../src/events"
import { IndexedDbOperationLogStore } from "../src/indexeddb-store"

const databases: string[] = []

afterEach(async () => {
  for (const name of databases.splice(0)) {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase(name)
      request.addEventListener("success", () => resolve())
      request.addEventListener("error", () => reject(request.error))
      request.addEventListener("blocked", () => resolve())
    })
  }
})

describe("IndexedDbOperationLogStore", () => {
  it("reopens persisted events and rejects a non-contiguous batch atomically", async () => {
    const name = databaseName()
    const first = await IndexedDbOperationLogStore.open({ databaseName: name })
    await first.append([event({ sequence: 1, eventId: "e1" })])
    await first.close()

    const second = await IndexedDbOperationLogStore.open({ databaseName: name })
    expect(await second.query({ sessionId: "s1" })).toHaveLength(1)
    await expect(second.append([event({ sequence: 3, eventId: "e3" })])).rejects.toThrow(
      "NON_CONTIGUOUS_OPERATION_SEQUENCE",
    )
    expect(await second.query({ sessionId: "s1" })).toHaveLength(1)
    await second.close()
  })

  it("rejects duplicate IDs and a mixed invalid batch without partial writes", async () => {
    const store = await openStore()
    await store.append([event({ sequence: 1, eventId: "e1" })])

    await expect(
      store.append([event({ sequence: 2, eventId: "e2" }), event({ sequence: 3, eventId: "e1" })]),
    ).rejects.toThrow("DUPLICATE_OPERATION_EVENT")
    expect(await store.query({ sessionId: "s1" })).toHaveLength(1)

    await store.close()
  })

  it("deletes a session's events and checkpoints in one transaction", async () => {
    const store = await openStore()
    await store.putSession({
      sessionId: "s1",
      projectId: "p1",
      status: "ended",
      startedAt: "2026-07-13T00:00:00.000Z",
      endedAt: "2026-07-13T00:00:02.000Z",
      eventCount: 2,
    })
    await store.append([
      event({ sequence: 1, eventId: "e1" }),
      event({ sequence: 2, eventId: "e2" }),
    ])
    await store.putCheckpoint({
      sessionId: "s1",
      sequence: 2,
      createdAt: "2026-07-13T00:00:02.000Z",
      document: { pages: [] },
      sessionState: {},
      documentHash: "doc-hash",
      sessionHash: "session-hash",
    })

    await store.deleteSession("s1")
    expect(await store.query({ sessionId: "s1" })).toEqual([])
    expect(await store.getSession("s1")).toBeUndefined()
    expect(await store.getNearestCheckpoint("s1", 2)).toBeUndefined()

    await store.append([event({ sequence: 1, eventId: "e1" })])
    expect(await store.query({ sessionId: "s1" })).toHaveLength(1)
    await store.close()
  })

  it("persists sessions and checkpoints and exposes the version 1 schema", async () => {
    const name = databaseName()
    const store = await IndexedDbOperationLogStore.open({ databaseName: name })
    await store.putSession({
      sessionId: "s1",
      projectId: "p1",
      status: "active",
      startedAt: "2026-07-13T00:00:00.000Z",
      eventCount: 1,
    })
    await store.putCheckpoint({
      sessionId: "s1",
      sequence: 1,
      createdAt: "2026-07-13T00:00:01.000Z",
      document: { pages: [] },
      sessionState: { selectedId: "node-1" },
      documentHash: "doc-hash",
      sessionHash: "session-hash",
    })
    await store.close()

    const reopened = await IndexedDbOperationLogStore.open({ databaseName: name })
    expect(await reopened.getSession("s1")).toMatchObject({ status: "active" })
    expect(await reopened.getNearestCheckpoint("s1", 2)).toMatchObject({ sequence: 1 })
    await reopened.close()

    const request = indexedDB.open(name)
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      request.addEventListener("success", () => resolve(request.result))
      request.addEventListener("error", () => reject(request.error))
    })
    expect(database.version).toBe(1)
    expect([...database.objectStoreNames]).toEqual(
      expect.arrayContaining(["sessions", "events", "checkpoints", "metadata"]),
    )
    const transaction = database.transaction("events", "readonly")
    const events = transaction.objectStore("events")
    expect([...events.indexNames]).toEqual(
      expect.arrayContaining(["eventId", "category", "type", "status"]),
    )
    database.close()
  })

  it("rejects unsupported upgrades and operations after close", async () => {
    const name = databaseName()
    const store = await IndexedDbOperationLogStore.open({ databaseName: name })
    await store.close()
    await expect(store.query({ sessionId: "s1" })).rejects.toThrow("OPERATION_LOG_STORE_CLOSED")
    await expect(
      IndexedDbOperationLogStore.open({ databaseName: databaseName(), version: 2 }),
    ).rejects.toThrow("UNSUPPORTED_OPERATION_LOG_SCHEMA")
  })
})

function databaseName(): string {
  const name = `operation-log-test-${crypto.randomUUID()}`
  databases.push(name)
  return name
}

async function openStore(): Promise<IndexedDbOperationLogStore> {
  return IndexedDbOperationLogStore.open({ databaseName: databaseName() })
}

function event(overrides: Partial<OperationEvent> = {}): OperationEvent {
  return {
    schemaVersion: 1,
    eventId: "event-id",
    sessionId: "s1",
    projectId: "p1",
    sequence: 1,
    timestamp: "2026-07-13T00:00:00.000Z",
    category: "document",
    type: "node.create",
    status: "succeeded",
    payload: { nodeId: "node-1" },
    ...overrides,
  }
}
