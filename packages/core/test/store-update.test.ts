import { describe, expect, it } from "vitest"
import { createEmptyDocument, RecordStore } from "../src/index"

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

  it("clones update patches and records", () => {
    const before = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )
    const layout = { mode: "free" as const }
    const after = before.withUpdated("page-1", { layout })
    layout.mode = "free"

    expect(after.get("page-1")?.layout).toEqual({ mode: "free" })
  })

  it("rejects missing and identity-changing updates", () => {
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    )

    expect(() => store.withUpdated("missing", { name: "Dashboard" })).toThrow("MISSING_RECORD_ID")
    expect(() => store.withUpdated("page-1", { id: "other" })).toThrow("INVALID_RECORD_PATCH")
    expect(() => store.withUpdated("page-1", { typeName: "document" })).toThrow(
      "INVALID_RECORD_PATCH",
    )
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
})
