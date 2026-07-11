import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore } from "../src/index"
import type { NodeRecord } from "../src/index"

const rectangle: NodeRecord = {
  id: "node-1",
  revision: 0,
  typeName: "node",
  nodeType: "rectangle",
  name: "Rectangle",
  parentId: "page-1",
  index: "a0",
  layout: { mode: "free", x: 40, y: 40, width: 160, height: 100 },
  visible: true,
  locked: false,
  props: { fill: "#2563eb" },
}

describe("RecordStore persistent operations", () => {
  it("updates a record without mutating the prior store", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const after = before.withUpdated("page-1", { name: "Dashboard" })

    expect(before.get("page-1")).toMatchObject({ name: "Page 1", revision: 0 })
    expect(after.get("page-1")).toMatchObject({ name: "Dashboard", revision: 1 })
    expect(after.revision).toBe(1)
  })

  it("clones nested records and update patches", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    ).withCreated(rectangle)

    const read = before.get("node-1")
    if (read?.typeName !== "node") throw new Error("NODE_NOT_FOUND")
    read.layout.x = 999
    read.props.fill = "#dc2626"

    const layout = { mode: "free" as const, x: 80, y: 40, width: 160, height: 100 }
    const props = { fill: "#16a34a" }
    const after = before.withUpdated("node-1", { layout, props })
    layout.x = 999
    props.fill = "#dc2626"

    expect(before.get("node-1")).toMatchObject({
      layout: { x: 40 },
      props: { fill: "#2563eb" },
    })
    expect(after.get("node-1")).toMatchObject({
      layout: { x: 80 },
      props: { fill: "#16a34a" },
    })
  })

  it("clones nested records returned by all", () => {
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    ).withCreated(rectangle)

    const records = store.all()
    const node = records.find((record) => record.id === "node-1")
    if (node?.typeName !== "node") throw new Error("NODE_NOT_FOUND")
    node.layout.x = 999
    node.props.fill = "#dc2626"

    expect(store.get("node-1")).toMatchObject({
      layout: { x: 40 },
      props: { fill: "#2563eb" },
    })
  })

  it("ignores identity fields in a runtime update patch", () => {
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )

    expect(() => store.withUpdated("missing", { name: "Dashboard" })).toThrow("MISSING_RECORD_ID")
    const after = store.withUpdated("page-1", {
      id: "other-id",
      typeName: "document",
      revision: 999,
      name: "Dashboard",
    } as never)

    expect(after.get("page-1")).toMatchObject({
      id: "page-1",
      typeName: "page",
      revision: 1,
      name: "Dashboard",
    })
  })

  it("rejects fields from another record type without changing the store", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )

    expect(() => before.withUpdated("page-1", { parentId: "node-1" } as never)).toThrow(
      "INVALID_RECORD_PATCH_FIELD:parentId",
    )
    expect(before.revision).toBe(0)
    expect(before.get("page-1")).toMatchObject({ name: "Page 1", layout: { mode: "free" } })
  })

  it("rejects page-only fields on nodes without changing the store", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    ).withCreated(rectangle)

    expect(() => before.withUpdated("node-1", { width: 800 } as never)).toThrow(
      "INVALID_RECORD_PATCH_FIELD:width",
    )
    expect(before.revision).toBe(1)
    expect(before.get("node-1")).toEqual(rectangle)
  })

  it("removes many records in one immutable revision", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const after = before.withRemovedMany(["doc-1", "page-1"])

    expect(before.get("doc-1")).toBeDefined()
    expect(before.get("page-1")).toBeDefined()
    expect(after.get("doc-1")).toBeUndefined()
    expect(after.get("page-1")).toBeUndefined()
    expect(after.revision).toBe(1)
  })

  it("creates a new revision for an empty removal", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const beforeRecords = before.all()
    const after = before.withRemovedMany([])

    expect(after).not.toBe(before)
    expect(after.revision).toBe(1)
    expect(after.all()).toEqual(beforeRecords)
    expect(before.revision).toBe(0)
    expect(before.all()).toEqual(beforeRecords)
  })
})
