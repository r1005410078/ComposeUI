import { describe, expect, it } from "vitest"
import { createEditor, createEmptyDocument } from "@composeui/core"
import {
  createCoreOperationObserver,
  MemoryOperationLogStore,
  OperationRecorder,
} from "@composeui/operation-log"
import { hashCanonical } from "@composeui/operation-log"

const createNodeCommand = (id: string) => ({
  id: "node.create" as const,
  payload: {
    id,
    parentId: "page-1",
    name: id,
    x: 0,
    y: 0,
    width: 100,
    height: 80,
    fill: "",
  },
})

describe("core operation observer adapter", () => {
  it("records a successful command with document hashes and a transaction patch", async () => {
    const store = new MemoryOperationLogStore()
    const recorder = new OperationRecorder({ sessionId: "s1", projectId: "p1", store })
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }), {
      operationObserver: createCoreOperationObserver(recorder),
    })

    editor.dispatch(createNodeCommand("node-1"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await recorder.flush()

    const events = await store.query({ sessionId: "s1" })
    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ type: "document.command", status: "started" })
    expect(events[1]).toMatchObject({
      type: "document.command",
      status: "succeeded",
      beforeHash: expect.any(String),
      afterHash: expect.any(String),
      payload: {
        command: createNodeCommand("node-1"),
        transaction: expect.objectContaining({ transactionId: expect.any(String) }),
        patch: expect.objectContaining({ created: expect.any(Array) }),
      },
    })
    expect(events[1]!.beforeHash).toBe(
      await hashCanonical(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })),
    )
  })

  it("keeps async hashing and recording in observation order", async () => {
    const store = new MemoryOperationLogStore()
    const recorder = new OperationRecorder({ sessionId: "s1", projectId: "p1", store })
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }), {
      operationObserver: createCoreOperationObserver(recorder),
    })

    editor.dispatch(createNodeCommand("node-1"))
    editor.dispatch(createNodeCommand("node-2"))
    await new Promise((resolve) => setTimeout(resolve, 0))
    await recorder.flush()

    expect((await store.query({ sessionId: "s1" })).map((event) => event.sequence)).toEqual([
      1, 2, 3, 4,
    ])
  })
})
