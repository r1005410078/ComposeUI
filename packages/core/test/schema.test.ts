import { describe, expect, it } from "vitest"
import { createEmptyDocument } from "@composeui/core"

describe("createEmptyDocument", () => {
  it("creates one page board with stable ids", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })

    expect(document.schemaVersion).toBe(1)
    expect(document.rootPageId).toBe("page-1")
    expect(document.records.map((record) => record.id)).toEqual(["doc-1", "page-1"])

    expect(document.records[1]).toMatchObject({
      typeName: "page",
      background: "#ffffff",
      overflow: "visible",
      layout: { mode: "free" },
    })
  })
})
