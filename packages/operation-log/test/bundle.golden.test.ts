import { readFile } from "node:fs/promises"
import { describe, expect, it } from "vitest"
import type { OperationLifecycleStore } from "../src/index"
import { canonicalJson, exportLogBundle } from "../src/index"

describe("operation log bundle golden", () => {
  it("matches the reviewed canonical node move bundle", async () => {
    const session = {
      sessionId: "golden-session",
      projectId: "golden-project",
      status: "ended" as const,
      startedAt: "2026-07-15T00:00:00.000Z",
      endedAt: "2026-07-15T00:00:02.000Z",
      eventCount: 1,
      finalHash: undefined,
    }
    const moveEvent = {
      schemaVersion: 1 as const,
      eventId: "move-1",
      sessionId: "golden-session",
      projectId: "golden-project",
      sequence: 1,
      timestamp: "2026-07-15T00:00:01.000Z",
      category: "document" as const,
      type: "node.move",
      status: "succeeded" as const,
      payload: {
        nodeId: "node-blue",
        from: { x: 400, y: 200 },
        to: { x: 440, y: 230 },
        legacyOptional: undefined,
      },
    }
    const store = {
      getSession: async () => session,
      query: async () => [moveEvent],
      getNearestCheckpoint: async () => undefined,
    } as unknown as OperationLifecycleStore

    const encoded = await exportLogBundle(store, {
      sessionId: "golden-session",
      productVersion: "0.0.0",
      exportedAt: "2026-07-15T00:00:03.000Z",
      redactor: <T>(value: T): T => structuredClone(value),
      redactionPolicy: "none",
    })
    const golden = await readFile(
      new URL("./goldens/node-move-bundle.json", import.meta.url),
      "utf8",
    )

    expect(encoded).toBe(canonicalJson(JSON.parse(golden)))
  })
})
