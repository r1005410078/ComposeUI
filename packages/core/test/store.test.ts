import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore } from "../src/index"
import type { NodeRecord, PageDocument, PageRecord, PersistentRecord } from "../src/index"

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

const secondPage: PageRecord = {
  id: "page-2",
  revision: 0,
  typeName: "page",
  name: "Page 2",
  width: 800,
  height: 600,
  background: "#ffffff",
  overflow: "hidden",
  layout: { mode: "free" },
}

function documentWith(...records: PersistentRecord[]): PageDocument {
  const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
  return { ...document, records: [...document.records, ...records] }
}

describe("RecordStore", () => {
  it("returns immutable snapshots and rejects duplicate ids", () => {
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )

    expect(store.get("page-1")?.typeName).toBe("page")
    expect(() => store.withCreated(store.get("page-1")!)).toThrow("DUPLICATE_RECORD_ID")
    expect(store.revision).toBe(0)
  })

  it.each([
    ["dangling parent", documentWith(node("node-1", "missing", "a0")), "NODE_PARENT_NOT_FOUND"],
    [
      "non-root page parent",
      documentWith(secondPage, node("node-1", "page-2", "a0")),
      "PARENT_NOT_ROOT_PAGE",
    ],
    [
      "indirect parent cycle",
      documentWith(node("node-a", "node-b", "a0"), node("node-b", "node-a", "b0")),
      "NODE_PARENT_CYCLE",
    ],
    [
      "sibling index collision",
      documentWith(node("node-1", "page-1", "a0"), node("node-2", "page-1", "a0")),
      "SIBLING_INDEX_CONFLICT",
    ],
  ])("rejects an invalid node tree: %s", (_name, document, code) => {
    expect(() => RecordStore.fromDocument(document)).toThrow(code)
  })

  it("accepts a valid multi-level node tree", () => {
    const store = RecordStore.fromDocument(
      documentWith(node("node-1", "page-1", "a0"), node("node-2", "node-1", "a0")),
    )

    expect(store.get("node-2")?.typeName).toBe("node")
  })
})
