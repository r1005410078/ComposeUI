import { describe, expect, it } from "vitest"
import {
  applyPatch,
  canonicalizeDocument,
  createEmptyDocument,
  createEditor,
  RecordStore,
  transact,
} from "../src/index"
import type { DocumentRecord, NodeRecord, PageRecord } from "../src/index"

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

const documentRecord: DocumentRecord = {
  id: "doc-2",
  revision: 0,
  typeName: "document",
  schemaVersion: 1,
  rootPageId: "page-1",
}

function createStore(): RecordStore {
  return RecordStore.fromDocument(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
}

function applyPatchOrThrow(
  store: RecordStore,
  patch: Parameters<typeof applyPatch>[1],
): RecordStore {
  const result = applyPatch(store, patch)
  if (!result.ok) throw new Error(result.diagnostics[0]?.code)
  return result.value
}

function createMultiPageDocument() {
  const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
  return { ...document, records: [...document.records, secondPage] }
}

describe("record transaction", () => {
  it("creates an exact inverse for an update", () => {
    const before = createStore()
    const initial = canonicalizeDocument(before)
    const result = transact(before, { kind: "local-command", commandId: "page.rename" }, (tx) => {
      tx.update("page-1", { name: "Dashboard" })
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.patch.updated[0]).toMatchObject({
      id: "page-1",
      typeName: "page",
      before: { name: "Page 1", revision: 0 },
      after: { name: "Dashboard", revision: 1 },
    })
    expect(canonicalizeDocument(applyPatchOrThrow(result.store, result.inverse))).toEqual(initial)
  })

  it("rejects a stale patch without changing the current store", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "page.rename" }, (tx) => {
      tx.update("page-1", { name: "Dashboard" })
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return

    const current = result.store.withUpdated("page-1", { name: "Later" })
    const applyResult = applyPatch(current, result.inverse)

    expect(applyResult.ok).toBe(false)
    if (!applyResult.ok) {
      expect(applyResult.diagnostics[0]).toMatchObject({
        code: "PATCH_PRECONDITION_FAILED",
        recordId: "page-1",
      })
      expect(applyResult.diagnostics[0]?.message.length).toBeGreaterThan(0)
    }
    expect(current.get("page-1")).toMatchObject({ name: "Later", revision: 2 })
  })

  it("does not advance revision for an empty patch", () => {
    const before = createStore()
    const result = applyPatch(before, { created: [], updated: [], removed: [] })

    expect(result).toMatchObject({ ok: true, value: before })
    if (result.ok) {
      expect(result.value).toBe(before)
      expect(result.value.revision).toBe(0)
    }
  })

  it("isolates every forward and inverse patch snapshot", () => {
    const before = createStore().withCreated(rectangle("node-1"))
    const result = transact(before, { kind: "local-command", commandId: "mixed.edit" }, (tx) => {
      tx.update("page-1", { name: "Dashboard" })
      tx.remove("node-1")
      tx.create(rectangle("node-2"))
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    result.patch.updated[0]!.before = { ...result.patch.updated[0]!.before, name: "Corrupt" }
    result.patch.created[0]!.name = "Corrupt"
    result.patch.removed[0]!.name = "Corrupt"

    expect(result.inverse.updated[0]!.after).toMatchObject({ name: "Page 1", revision: 0 })
    expect(result.inverse.created[0]).toEqual(rectangle("node-1"))
    expect(result.inverse.removed[0]).toEqual(rectangle("node-2"))
    expect(canonicalizeDocument(applyPatchOrThrow(result.store, result.inverse))).toEqual(
      canonicalizeDocument(before),
    )
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
    expect(result.diagnostics[0]?.code).toBe("ROOT_PAGE_INVALID")
    expect(before.get("doc-1")).toMatchObject({ rootPageId: "page-1" })
    expect(before.revision).toBe(0)
  })

  it("rejects creating another document", () => {
    const before = createStore()
    const result = transact(
      before,
      { kind: "local-command", commandId: "document.create" },
      (tx) => {
        tx.create(documentRecord)
      },
    )

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe("DOCUMENT_CREATE_FORBIDDEN")
    expect(result.diagnostics[0]?.recordId).toBe("doc-2")
    expect(before.get("doc-2")).toBeUndefined()
    expect(before.revision).toBe(0)
  })

  it("rejects a node parented to a non-root page", () => {
    const before = createStore().withCreated(secondPage)
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle("node-1", "page-2"))
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      expect.arrayContaining(["PAGE_COUNT_INVALID", "PARENT_NOT_ROOT_PAGE"]),
    )
    expect(before.get("node-1")).toBeUndefined()
    expect(before.revision).toBe(1)
  })

  it("rejects multi-page documents before editor or transaction use", () => {
    const document = createMultiPageDocument()

    expect(() => RecordStore.fromDocument(document)).toThrow("PAGE_COUNT_INVALID")
    expect(() => createEditor(document)).toThrow("PAGE_COUNT_INVALID")

    const store = createStore().withCreated(secondPage)
    const result = transact(store, { kind: "local-command", commandId: "page.noop" }, (tx) => {
      tx.update("page-1", { name: "Page 1" })
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(
        result.diagnostics.some((diagnostic) => diagnostic.code === "PAGE_COUNT_INVALID"),
      ).toBe(true)
      expect(result.store).toBe(store)
    }
  })

  it("rejects creating an additional page", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "page.create" }, (tx) => {
      tx.create(secondPage)
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics[0]?.code).toBe("PAGE_CREATE_FORBIDDEN")
    expect(before.get("page-2")).toBeUndefined()
    expect(before.get("page-1")).toBeDefined()
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

  it("reuses record update field and shape validation", () => {
    const before = createStore().withCreated(rectangle("node-1"))
    const illegalPageField = transact(
      before,
      { kind: "local-command", commandId: "page.edit" },
      (tx) => tx.update("page-1", { nodeType: "rectangle" }),
    )
    const illegalPageSchema = transact(
      before,
      { kind: "local-command", commandId: "page.edit" },
      (tx) => tx.update("page-1", { schemaVersion: 1 }),
    )
    const invalidNodeShape = transact(
      before,
      { kind: "local-command", commandId: "node.edit" },
      (tx) => tx.update("node-1", { props: { fill: 123 } }),
    )
    const invalidPageLayout = transact(
      before,
      { kind: "local-command", commandId: "page.edit" },
      (tx) => tx.update("page-1", { layout: { mode: "broken" } } as never),
    )
    const invalidNodeLayout = transact(
      before,
      { kind: "local-command", commandId: "node.edit" },
      (tx) =>
        tx.update("node-1", {
          layout: { mode: "free", x: "bad", y: 40, width: 160, height: 100 },
        } as never),
    )

    expect(illegalPageField.ok).toBe(false)
    if (!illegalPageField.ok) {
      expect(illegalPageField.diagnostics[0]).toMatchObject({
        code: "INVALID_RECORD_PATCH_FIELD:nodeType",
        recordId: "page-1",
      })
    }
    expect(illegalPageSchema.ok).toBe(false)
    if (!illegalPageSchema.ok) {
      expect(illegalPageSchema.diagnostics[0]).toMatchObject({
        code: "INVALID_RECORD_PATCH_FIELD:schemaVersion",
        recordId: "page-1",
      })
    }
    expect(invalidNodeShape.ok).toBe(false)
    if (!invalidNodeShape.ok) {
      expect(invalidNodeShape.diagnostics[0]).toMatchObject({
        code: "INVALID_RECORD_SHAPE",
        recordId: "node-1",
      })
    }
    expect(invalidPageLayout.ok).toBe(false)
    if (!invalidPageLayout.ok) {
      expect(invalidPageLayout.diagnostics[0]).toMatchObject({
        code: "INVALID_RECORD_SHAPE",
        recordId: "page-1",
      })
    }
    expect(invalidNodeLayout.ok).toBe(false)
    if (!invalidNodeLayout.ok) {
      expect(invalidNodeLayout.diagnostics[0]).toMatchObject({
        code: "INVALID_RECORD_SHAPE",
        recordId: "node-1",
      })
    }
    expect(before.get("page-1")).toMatchObject({ name: "Page 1" })
    expect(before.get("node-1")).toEqual(rectangle("node-1"))
  })

  it("rejects explicit identity fields in transaction updates", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "page.edit" }, (tx) => {
      tx.update("page-1", { typeName: "node" } as never)
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.diagnostics[0]).toMatchObject({
        code: "INVALID_IDENTITY_PATCH",
        recordId: "page-1",
      })
      expect(result.diagnostics[0]?.message.length).toBeGreaterThan(0)
    }
    expect(result.ok ? result.store : result.store).toBe(before)
    expect(before.get("page-1")).toMatchObject({ typeName: "page", name: "Page 1", revision: 0 })
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

  it("rejects indirect parent cycles", () => {
    const before = createStore()
    const createdCycle = transact(
      before,
      { kind: "local-command", commandId: "node.create" },
      (tx) => {
        tx.create(rectangle("node-a", "node-b"))
        tx.create(rectangle("node-b", "node-a", "b0"))
      },
    )
    const linked = before
      .withCreated(rectangle("node-1", "page-1", "a0"))
      .withCreated(rectangle("node-2", "node-1", "b0"))
    const updatedCycle = transact(
      linked,
      { kind: "local-command", commandId: "node.reparent" },
      (tx) => tx.update("node-1", { parentId: "node-2" }),
    )

    expect(createdCycle.ok).toBe(false)
    if (!createdCycle.ok) expect(createdCycle.diagnostics[0]?.code).toBe("NODE_PARENT_CYCLE")
    expect(updatedCycle.ok).toBe(false)
    if (!updatedCycle.ok) expect(updatedCycle.diagnostics[0]?.code).toBe("NODE_PARENT_CYCLE")
    expect(before.revision).toBe(0)
    expect(before.get("node-a")).toBeUndefined()
    expect(linked.get("node-1")).toEqual(rectangle("node-1"))
  })

  it("returns every validation diagnostic", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "node.create" }, (tx) => {
      tx.create(rectangle("node-1", "missing-parent"))
      tx.create(rectangle("node-2", "node-2"))
    })

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.diagnostics).toHaveLength(2)
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "NODE_PARENT_NOT_FOUND",
      "NODE_SELF_PARENT",
    ])
    expect(result.diagnostics.every((diagnostic) => diagnostic.message.length > 0)).toBe(true)
    expect(result.diagnostics.map((diagnostic) => diagnostic.recordId)).toEqual([
      "node-1",
      "node-2",
    ])
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

  it("restores a removed node through its inverse", () => {
    const before = createStore().withCreated(rectangle("node-1"))
    const result = transact(before, { kind: "local-command", commandId: "node.remove" }, (tx) => {
      tx.remove("node-1")
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(applyPatchOrThrow(result.store, result.inverse).get("node-1")).toEqual(
      rectangle("node-1"),
    )
  })

  it("restores a mixed create update remove patch in inverse order", () => {
    const before = createStore().withCreated(rectangle("node-1"))
    const result = transact(before, { kind: "local-command", commandId: "mixed.edit" }, (tx) => {
      tx.update("page-1", { name: "Dashboard" })
      tx.remove("node-1")
      tx.create(rectangle("node-2"))
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const restored = applyPatchOrThrow(result.store, result.inverse)
    expect(canonicalizeDocument(restored)).toEqual(canonicalizeDocument(before))
  })

  it("rejects updates that create invalid node relationships", () => {
    const before = createStore()
      .withCreated(rectangle("node-1", "page-1", "a0"))
      .withCreated(rectangle("node-2", "page-1", "b0"))
    const dangling = transact(before, { kind: "local-command", commandId: "node.reparent" }, (tx) =>
      tx.update("node-1", { parentId: "missing-parent" }),
    )
    const selfParent = transact(
      before,
      { kind: "local-command", commandId: "node.reparent" },
      (tx) => tx.update("node-1", { parentId: "node-1" }),
    )
    const siblingConflict = transact(
      before,
      { kind: "local-command", commandId: "node.reorder" },
      (tx) => tx.update("node-2", { index: "a0" }),
    )

    expect(dangling.ok).toBe(false)
    if (!dangling.ok) expect(dangling.diagnostics[0]?.code).toBe("NODE_PARENT_NOT_FOUND")
    expect(selfParent.ok).toBe(false)
    if (!selfParent.ok) expect(selfParent.diagnostics[0]?.code).toBe("NODE_SELF_PARENT")
    expect(siblingConflict.ok).toBe(false)
    if (!siblingConflict.ok) {
      expect(siblingConflict.diagnostics[0]?.code).toBe("SIBLING_INDEX_CONFLICT")
    }
    expect(before.get("node-1")).toEqual(rectangle("node-1"))
    expect(before.get("node-2")).toEqual(rectangle("node-2", "page-1", "b0"))
  })

  it("treats a no-op update as a successful transaction without changes", () => {
    const before = createStore()
    const result = transact(before, { kind: "local-command", commandId: "page.rename" }, (tx) => {
      tx.update("page-1", { name: "Page 1" })
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.store).toBe(before)
    expect(result.store.revision).toBe(0)
    expect(result.patch).toEqual({ created: [], updated: [], removed: [] })
    expect(result.inverse).toEqual({ created: [], updated: [], removed: [] })
  })

  it("treats reordered layout keys as a no-op update", () => {
    const before = createStore().withCreated(rectangle("node-1"))
    const result = transact(before, { kind: "local-command", commandId: "node.layout" }, (tx) => {
      tx.update("node-1", {
        layout: { height: 100, width: 160, y: 40, x: 40, mode: "free" },
      })
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.store).toBe(before)
    expect(result.patch).toEqual({ created: [], updated: [], removed: [] })
  })
})
