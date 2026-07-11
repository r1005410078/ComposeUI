import { describe, expect, it } from "vitest"
import { applyPatch, createEmptyDocument, RecordStore, transact } from "../src/index"
import type { NodeRecord } from "../src/index"

const rectangle = (id: string, parentId = "page-1", index = "a0"): NodeRecord => ({
  id,
  revision: 0,
  typeName: "node",
  nodeType: "rectangle",
  name: "Rectangle",
  parentId,
  index,
  layout: { mode: "free", x: 40, y: 40, width: 160, height: 100 },
  visible: true,
  locked: false,
  props: { fill: "#2563eb" },
})

function createStore(): RecordStore {
  return RecordStore.fromDocument(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
}

describe("record transaction", () => {
  it("creates an exact inverse for an update", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "page.rename" }, (tx) => {
      tx.update("page-1", { name: "Dashboard" })
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.updated[0]).toMatchObject({
      id: "page-1",
      typeName: "page",
      before: { name: "Page 1" },
      after: { name: "Dashboard" },
    })
    expect(applyPatch(result.store, result.inverse).get("page-1")).toMatchObject({
      name: "Page 1",
    })
  })

  it("rejects a transaction that removes the page board", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "node.delete" }, (tx) => {
      tx.remove("page-1")
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe("PAGE_REMOVE_FORBIDDEN")
    expect(before.get("page-1")).toBeDefined()
    expect(before.revision).toBe(0)
  })

  it("rejects a document with a dangling root page", () => {
    const before = createStore()
    const result = transact(
      before,
      { kind: "local-command", commandId: "page.change-root" },
      (tx) => {
        tx.update("doc-1", { rootPageId: "missing-page" })
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe("ROOT_PAGE_NOT_FOUND")
    expect(before.get("doc-1")).toMatchObject({ rootPageId: "page-1" })
    expect(before.revision).toBe(0)
  })

  it("rejects duplicate records atomically", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle("node-1"))
      tx.create(rectangle("node-1"))
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe("DUPLICATE_RECORD_ID")
    expect(before.get("node-1")).toBeUndefined()
    expect(before.revision).toBe(0)
  })

  it("rejects dangling and self parents atomically", () => {
    const before = createStore()
    const dangling = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) =>
      tx.create(rectangle("node-1", "missing-parent")),
    )
    const selfParent = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) =>
      tx.create(rectangle("node-1", "node-1")),
    )

    expect(dangling.ok).toBe(false)
    if (!dangling.ok) expect(dangling.diagnostics[0]?.code).toBe("NODE_PARENT_NOT_FOUND")
    expect(selfParent.ok).toBe(false)
    if (!selfParent.ok) expect(selfParent.diagnostics[0]?.code).toBe("NODE_SELF_PARENT")
    expect(before.get("node-1")).toBeUndefined()
    expect(before.revision).toBe(0)
  })

  it("rejects duplicate sibling indexes atomically", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle("node-1", "page-1", "a0"))
      tx.create(rectangle("node-2", "page-1", "a0"))
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe("SIBLING_INDEX_CONFLICT")
    expect(before.all()).toHaveLength(2)
    expect(before.revision).toBe(0)
  })
})
