import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore } from "../src/index"

describe("RecordStore", () => {
  it("returns immutable snapshots and rejects duplicate ids", () => {
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )

    expect(store.get("page-1")?.typeName).toBe("page")
    expect(() => store.withCreated(store.get("page-1")!)).toThrow("DUPLICATE_RECORD_ID")
    expect(store.revision).toBe(0)
  })
})
