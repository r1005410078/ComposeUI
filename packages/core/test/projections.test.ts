import { describe, expect, it } from "vitest"
import { createEmptyDocument, getChildren, getTreeItems, RecordStore } from "@composeui/core"
import type { NodeRecord } from "@composeui/core"

const node = (id: string, parentId: string, index: string): NodeRecord => ({
  id,
  revision: 0,
  typeName: "node",
  nodeType: "rectangle",
  name: id,
  parentId,
  index,
  layout: { mode: "free", x: 0, y: 0, width: 100, height: 100 },
  visible: true,
  locked: false,
  props: { fill: "#2563eb" },
})

describe("tree projections", () => {
  it("sorts children by index without changing the store", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const store = RecordStore.fromDocument({
      ...document,
      records: [
        ...document.records,
        node("node-b", "page-1", "b0"),
        node("node-a", "page-1", "a0"),
      ],
    })
    const recordsBefore = store.all()

    expect(getChildren(store, "page-1").map((record) => record.id)).toEqual(["node-a", "node-b"])
    expect(store.all()).toEqual(recordsBefore)
  })

  it("returns the expanded tree in index order with depths", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const store = RecordStore.fromDocument({
      ...document,
      records: [
        ...document.records,
        node("node-b", "page-1", "b0"),
        node("node-a", "page-1", "a0"),
        node("node-a-child", "node-a", "a0"),
      ],
    })
    const all = store.all.bind(store)
    let allCalls = 0
    store.all = () => {
      allCalls++
      return all()
    }

    expect(getTreeItems(store, "page-1", new Set(["page-1"]))).toEqual([
      expect.objectContaining({ id: "page-1", depth: 0, hasChildren: true }),
      expect.objectContaining({ id: "node-a", depth: 1, hasChildren: true }),
      expect.objectContaining({ id: "node-b", depth: 1, hasChildren: false }),
    ])
    expect(allCalls).toBe(1)
    allCalls = 0
    expect(
      getTreeItems(store, "page-1", new Set(["page-1", "node-a"])).map(({ id, depth }) => ({
        id,
        depth,
      })),
    ).toEqual([
      { id: "page-1", depth: 0 },
      { id: "node-a", depth: 1 },
      { id: "node-a-child", depth: 2 },
      { id: "node-b", depth: 1 },
    ])
    expect(allCalls).toBe(1)
  })

  it("returns an empty projection for a missing or non-page root", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const store = RecordStore.fromDocument({
      ...document,
      records: [...document.records, node("node-1", "page-1", "a0")],
    })

    expect(getTreeItems(store, "missing", new Set())).toEqual([])
    expect(getTreeItems(store, "node-1", new Set())).toEqual([])
  })
})
