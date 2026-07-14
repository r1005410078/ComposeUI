import { describe, expect, it, vi } from "vitest"
import type { OperationEvent, OperationLogStore } from "@composeui/operation-log"
import { OperationLogController } from "../src/operation-log-controller"

function event(
  sequence: number,
  input: Partial<Pick<OperationEvent, "category" | "status" | "type" | "payload">> = {},
): OperationEvent {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sessionId: "session-1",
    projectId: "project-1",
    sequence,
    timestamp: `2026-07-14T00:00:0${sequence}.000Z`,
    category: input.category ?? "document",
    type: input.type ?? "node.create",
    status: input.status ?? "succeeded",
    payload: input.payload ?? { name: `Node ${sequence}` },
  }
}

function storeWith(events: OperationEvent[]): OperationLogStore & { notify(): void } {
  const listeners = new Set<() => void>()
  return {
    append: vi.fn(async () => undefined),
    query: vi.fn(async () => structuredClone(events)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    notify() {
      for (const listener of listeners) listener()
    },
  }
}

describe("OperationLogController", () => {
  it("loads rows in store order and publishes query updates", async () => {
    const store = storeWith([event(2), event(1)])
    const controller = new OperationLogController({ store, sessionId: "session-1" })
    const updates: number[] = []
    controller.subscribe((state) => updates.push(state.rows.length))

    await expect(controller.query()).resolves.toEqual([event(2), event(1)])
    expect(controller.rows.map((item) => item.sequence)).toEqual([2, 1])
    expect(updates).toEqual([2])

    controller.dispose()
    expect(store.query).toHaveBeenCalledWith({ sessionId: "session-1" })
  })

  it("filters category, status, and text without changing event order", async () => {
    const store = storeWith([
      event(1, { category: "session", status: "observed", type: "session.selection" }),
      event(2, { category: "document", status: "failed", payload: { error: "NODE_LOCKED" } }),
      event(3, { category: "document", status: "succeeded", type: "node.move" }),
    ])
    const controller = new OperationLogController({ store, sessionId: "session-1" })

    await controller.query({ category: "document", status: "failed", text: "locked" })

    expect(controller.rows.map((item) => item.sequence)).toEqual([2])
    expect(controller.filter).toEqual({ category: "document", status: "failed", text: "locked" })
  })

  it("accepts the view query shape and keeps the legacy filter shape working", async () => {
    const store = storeWith([
      event(1, { category: "document", status: "failed", type: "node.delete" }),
      event(2, { category: "session", status: "observed", type: "session.selection" }),
    ])
    const controller = new OperationLogController({ store, sessionId: "session-1" })

    await controller.query({ levels: ["failed"], categories: ["document"], search: "delete" })

    expect(controller.rows.map((item) => item.sequence)).toEqual([1])
    expect(controller.viewQuery).toEqual({
      levels: ["failed"],
      categories: ["document"],
      search: "delete",
    })

    await controller.query({ status: "observed", category: "session", text: "selection" })
    expect(controller.rows.map((item) => item.sequence)).toEqual([2])
  })

  it("searches BigInt and cyclic payloads without throwing", async () => {
    const cyclic: Record<string, unknown> = { token: "cycle-secret" }
    cyclic.self = cyclic
    const store = storeWith([
      event(1, { payload: { amount: 42n, nested: cyclic } }),
      event(2, { payload: { amount: 7n } }),
    ])
    const controller = new OperationLogController({ store, sessionId: "session-1" })

    await controller.query({ levels: [], categories: [], search: "cycle-secret" })

    expect(controller.rows.map((item) => item.sequence)).toEqual([1])
  })

  it("isolates listener errors and gives each listener an independent state clone", async () => {
    const store = storeWith([event(1)])
    const controller = new OperationLogController({ store, sessionId: "session-1" })
    const secondListener = vi.fn()
    controller.subscribe((state) => {
      state.rows[0]!.payload = { changed: true }
      throw new Error("listener failed")
    })
    controller.subscribe(secondListener)

    await expect(controller.query()).resolves.toHaveLength(1)

    expect(secondListener).toHaveBeenCalledWith(expect.objectContaining({ rows: [event(1)] }))
  })

  it("keeps optional export, import, and replay commands safe and injectable", async () => {
    const store = storeWith([])
    const exportSession = vi.fn(async () => "bundle")
    const importBundle = vi.fn(async (_serialized: string) => undefined)
    const startReplay = vi.fn(async (_sequence: number) => undefined)
    const controller = new OperationLogController({
      store,
      sessionId: "session-1",
      exportSession,
      importBundle,
      startReplay,
    })

    await expect(controller.exportSession()).resolves.toBe("bundle")
    await controller.importBundle("serialized")
    await controller.startReplay(3)
    expect(exportSession).toHaveBeenCalledOnce()
    expect(importBundle).toHaveBeenCalledWith("serialized")
    expect(startReplay).toHaveBeenCalledWith(3)

    const safeController = new OperationLogController({ store, sessionId: "session-1" })
    await expect(safeController.exportSession()).resolves.toBe("")
    await expect(safeController.importBundle("serialized")).resolves.toBeUndefined()
    expect(() => safeController.startReplay(3)).not.toThrow()
  })

  it("tracks selected detail and clears selection without deleting rows", async () => {
    const store = storeWith([event(1), event(2)])
    const controller = new OperationLogController({ store, sessionId: "session-1" })
    const listener = vi.fn()
    controller.subscribe(listener)
    await controller.query()

    controller.select("event-2")
    expect(controller.selection?.eventId).toBe("event-2")
    expect(controller.detail).toEqual(event(2))

    controller.clearSelection()
    expect(controller.selection).toBeUndefined()
    expect(controller.detail).toBeUndefined()
    expect(controller.rows).toHaveLength(2)
    expect(listener).toHaveBeenCalledTimes(3)
  })

  it("refreshes when the store changes and stops observing after dispose", async () => {
    const store = storeWith([event(1)])
    const controller = new OperationLogController({ store, sessionId: "session-1" })
    const listener = vi.fn()
    controller.subscribe(listener)
    await controller.query()
    store.notify()
    await vi.waitFor(() => expect(store.query).toHaveBeenCalledTimes(2))

    controller.dispose()
    store.notify()
    await Promise.resolve()
    expect(store.query).toHaveBeenCalledTimes(2)
  })
})
