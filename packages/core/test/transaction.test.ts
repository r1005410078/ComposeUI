import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore, transact } from "../src/index"

const rectangle = {
  id: "node-1",
  revision: 0,
  typeName: "node" as const,
  nodeType: "rectangle" as const,
  name: "Rectangle",
  parentId: "page-1",
  index: "a0",
  layout: { mode: "free" as const, x: 40, y: 40, width: 160, height: 100 },
  visible: true,
  locked: false,
  props: { fill: "#2563eb" },
}

describe("transact", () => {
  it("returns forward and inverse patches", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle)
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.created).toEqual([rectangle])
    expect(result.inverse.removed).toEqual([rectangle])
    expect(result.store.get("node-1")).toEqual(rectangle)
  })

  it("does not commit a partial transaction", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle)
      tx.create(rectangle)
    })

    expect(result.ok).toBe(false)
    expect(before.get("node-1")).toBeUndefined()
    expect(before.revision).toBe(0)
  })
})
