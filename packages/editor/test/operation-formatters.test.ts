import { describe, expect, it } from "vitest"
import type { OperationEvent } from "@composeui/operation-log"
import { formatOperation, registerOperationFormatter } from "../src/workspace/operation-formatters"

function event(
  type: string,
  payload: unknown,
  input: Partial<OperationEvent> = {},
): OperationEvent {
  return {
    schemaVersion: 1,
    eventId: "event-1",
    sessionId: "session-1",
    projectId: "project-1",
    sequence: 1,
    timestamp: "2026-07-14T00:00:00.000Z",
    category: "document",
    type,
    status: "succeeded",
    payload,
    ...input,
  }
}

describe("operation formatters", () => {
  it("formats move coordinates and diagnostics in Chinese", () => {
    expect(
      formatOperation(
        event("document.command", {
          command: {
            id: "node.move",
            payload: {
              ids: ["rect-1"],
              delta: { x: 60, y: 40 },
              before: { x: 120, y: 80 },
              after: { x: 180, y: 120 },
            },
          },
          patch: [{ op: "replace", path: ["records", "rect-1", "x"], value: 180 }],
        }),
      ),
    ).toContain("移动“rect-1”：(120, 80) -> (180, 120)")

    expect(
      formatOperation(
        event(
          "document.command",
          { command: { id: "node.lock", payload: { id: "rect-1" } } },
          {
            status: "failed",
            diagnostics: [
              { code: "NODE_LOCKED", severity: "error", message: "节点已锁定", recordId: "rect-1" },
            ],
          },
        ),
      ),
    ).toContain("NODE_LOCKED")
  })

  it("formats core observer move patches with before and after coordinates", () => {
    const summary = formatOperation(
      event("document.command", {
        command: {
          id: "node.move",
          payload: { ids: ["rect-1"], delta: { x: 60, y: 40 } },
        },
        transaction: { transactionId: "tx-1" },
        patch: {
          created: [],
          updated: [
            {
              id: "rect-1",
              typeName: "node",
              before: { id: "rect-1", typeName: "node", x: 120, y: 80 },
              after: { id: "rect-1", typeName: "node", x: 180, y: 120 },
            },
          ],
          removed: [],
        },
      }),
    )

    expect(summary).toContain("移动“rect-1”：(120, 80) -> (180, 120)")
  })

  it("formats history, session, patch, and common document operations", () => {
    expect(
      formatOperation(event("history.undo", { currentIndex: 2 }, { category: "history" })),
    ).toContain("撤销")
    expect(
      formatOperation(
        event(
          "session.viewport",
          { viewport: { x: 12, y: 8, zoom: 1.5 } },
          { category: "session" },
        ),
      ),
    ).toContain("视口")
    expect(
      formatOperation(
        event("document.command", {
          command: { id: "node.rename", payload: { id: "rect-1", name: "标题" } },
          patch: [{ op: "replace", path: ["records", "rect-1", "name"], value: "标题" }],
        }),
      ),
    ).toContain("重命名")
  })

  it("supports custom registration and conditional unregister", () => {
    const unregister = registerOperationFormatter("custom.event", () => "自定义操作")
    expect(formatOperation(event("custom.event", {}))).toBe("自定义操作")
    unregister()
    expect(formatOperation(event("custom.event", {}))).toContain("custom.event")
  })

  it("uses a safe fallback for unknown types and cyclic or BigInt payloads", () => {
    const payload: Record<string, unknown> = { amount: 1n }
    payload.self = payload
    expect(formatOperation(event("unknown.event", payload))).toContain("unknown.event")
  })
})
