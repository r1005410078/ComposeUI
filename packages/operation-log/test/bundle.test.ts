import { describe, expect, it } from "vitest"
import type { OperationEvent, OperationSession } from "../src/index"
import { MemoryOperationLogStore, exportLogBundle, importLogBundle } from "../src/index"

const session: OperationSession = {
  sessionId: "s1",
  projectId: "p1",
  status: "ended",
  startedAt: "2026-07-13T00:00:00.000Z",
  endedAt: "2026-07-13T00:01:00.000Z",
  eventCount: 2,
  finalHash: "final",
}

const event = (sequence: number, eventId = `e${sequence}`): OperationEvent => ({
  schemaVersion: 1,
  eventId,
  sessionId: "s1",
  projectId: "p1",
  sequence,
  timestamp: `2026-07-13T00:00:0${sequence}.000Z`,
  category: "document",
  type: sequence === 1 ? "node.create" : "node.move",
  status: "succeeded",
  payload: { nodeId: "node-1", token: "secret" },
})

async function seededStore(): Promise<MemoryOperationLogStore> {
  const store = new MemoryOperationLogStore()
  await store.putSession(session)
  await store.append([event(1), event(2)])
  await store.putCheckpoint({
    sessionId: "s1",
    sequence: 2,
    createdAt: "2026-07-13T00:01:00.000Z",
    document: { schemaVersion: 1, rootPageId: "page-1", records: [] },
    sessionState: { selection: { nodeId: "node-1" } },
    documentHash: "document",
    sessionHash: "session",
  })
  return store
}

describe("log bundles", () => {
  it("round-trips a redacted bundle", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
      exportedAt: "2026-07-13T00:02:00.000Z",
    })

    const bundle = await importLogBundle(encoded)

    expect(bundle.manifest.schemaVersion).toBe(1)
    expect(bundle.manifest.productVersion).toBe("0.0.0")
    expect(bundle.events).toHaveLength(2)
    expect(bundle.events[0]?.payload).toMatchObject({ token: "[REDACTED]" })
  })

  it("rejects tampering with section contents", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })

    await expect(importLogBundle(encoded.replace("node.create", "node.delete"))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })

  it("rejects invalid event order, duplicate IDs, and checkpoint ranges", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })
    const bundle = JSON.parse(encoded) as Record<string, unknown>
    const events = bundle.events as Array<Record<string, unknown>>
    events[1]!.sequence = 3
    await expect(importLogBundle(JSON.stringify(bundle))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )

    const duplicate = JSON.parse(encoded) as Record<string, unknown>
    const duplicateEvents = duplicate.events as Array<Record<string, unknown>>
    duplicateEvents[1]!.eventId = duplicateEvents[0]!.eventId
    await expect(importLogBundle(JSON.stringify(duplicate))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )

    const checkpoint = JSON.parse(encoded) as Record<string, unknown>
    const checkpoints = checkpoint.checkpoints as Array<Record<string, unknown>>
    checkpoints[0]!.sequence = 3
    await expect(importLogBundle(JSON.stringify(checkpoint))).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })

  it("enforces the encoded byte limit", async () => {
    const encoded = await exportLogBundle(await seededStore(), {
      sessionId: "s1",
      productVersion: "0.0.0",
    })

    await expect(importLogBundle(encoded, { maxBytes: 1 })).rejects.toThrow(
      "LOG_BUNDLE_INTEGRITY_FAILED",
    )
  })
})
