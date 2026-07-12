import { describe, expect, it } from "vitest"
import { applyPatch, createEditor, createEmptyDocument, History, RecordStore } from "../src/index"
import type { EditorChangeEvent, HistoryEntry, NodeRecord } from "../src/index"

const createNode = (editor: ReturnType<typeof createEditor>, id: string) =>
  editor.dispatch({
    id: "node.create",
    payload: {
      id,
      parentId: "page-1",
      name: id,
      x: 0,
      y: 0,
      width: 100,
      height: 80,
      fill: "#2563eb",
    },
  })

describe("Editor history", () => {
  it("isolates listener failures and reports them while notifying later listeners", () => {
    const diagnostics: string[] = []
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }), {
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic.code),
    })
    createNode(editor, "node-1")
    const calls: string[] = []
    editor.subscribe(() => {
      calls.push("first")
      throw new Error("listener exploded")
    })
    editor.subscribe(() => calls.push("second"))

    expect(
      editor.dispatch({
        id: "node.move",
        payload: { ids: ["node-1"], delta: { x: 1, y: 2 } },
      }).ok,
    ).toBe(true)
    expect(editor.undo().ok).toBe(true)
    expect(editor.redo().ok).toBe(true)

    expect(calls).toEqual(["first", "second", "first", "second", "first", "second"])
    expect(diagnostics).toEqual([
      "EDITOR_LISTENER_ERROR",
      "EDITOR_LISTENER_ERROR",
      "EDITOR_LISTENER_ERROR",
    ])
    expect(editor.getDiagnostics().map((diagnostic) => diagnostic.code)).toEqual(diagnostics)
  })

  it("does not record or emit a no-op command and preserves redo", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createNode(editor, "node-1")
    editor.dispatch({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 10, y: 20 } },
    })
    expect(editor.undo().ok).toBe(true)
    expect(editor.canRedo()).toBe(true)
    let eventCount = 0
    editor.subscribe(() => eventCount++)

    expect(
      editor.execute({
        id: "node.rename",
        payload: { id: "node-1", name: "node-1" },
      }).ok,
    ).toBe(true)

    expect(eventCount).toBe(0)
    expect(editor.canRedo()).toBe(true)
    expect(editor.redo().ok).toBe(true)
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 10, y: 20 } })
  })

  it("does not record initialized records or external patch applications", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const events: EditorChangeEvent[] = []
    editor.subscribe((event) => events.push(event))
    const externalNode: NodeRecord = {
      id: "external",
      revision: 0,
      typeName: "node",
      nodeType: "rectangle",
      name: "External",
      parentId: "page-1",
      index: "a0",
      layout: { mode: "free", x: 1, y: 2, width: 10, height: 10 },
      visible: true,
      locked: false,
      props: { fill: "#000000" },
    }

    expect(editor.canUndo()).toBe(false)
    const external = applyPatch(editor.store, {
      created: [externalNode],
      updated: [],
      removed: [],
    })

    expect(external.ok).toBe(true)
    expect(editor.store.get("external")).toBeUndefined()
    expect(editor.canUndo()).toBe(false)
    expect(events).toHaveLength(0)
  })

  it("exposes the live store and execute while preserving dispatch compatibility", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))

    expect(editor.store).toBe(editor.getStore())
    expect(
      editor.execute({
        id: "node.create",
        payload: {
          id: "node-1",
          parentId: "page-1",
          name: "Card",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          fill: "#2563eb",
        },
      }).ok,
    ).toBe(true)
    expect(editor.store.get("node-1")).toBeDefined()
  })

  it("undoes and redoes one multi-node move as one history item", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createNode(editor, "node-1")
    createNode(editor, "node-2")
    editor.dispatch({
      id: "node.move",
      payload: { ids: ["node-1", "node-2"], delta: { x: 40, y: 20 } },
    })

    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 40, y: 20 } })
    expect(editor.getRecord("node-2")).toMatchObject({ layout: { x: 40, y: 20 } })
    expect(editor.undo().ok).toBe(true)
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 0, y: 0 } })
    expect(editor.getRecord("node-2")).toMatchObject({ layout: { x: 0, y: 0 } })
    expect(editor.redo().ok).toBe(true)
    expect(editor.getRecord("node-1")).toMatchObject({ layout: { x: 40, y: 20 } })
    expect(editor.getRecord("node-2")).toMatchObject({ layout: { x: 40, y: 20 } })
  })

  it("clears redo after a new local edit", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    createNode(editor, "node-1")
    editor.dispatch({
      id: "node.move",
      payload: { ids: ["node-1"], delta: { x: 10, y: 20 } },
    })
    editor.undo()

    expect(editor.canRedo()).toBe(true)
    editor.dispatch({ id: "node.rename", payload: { id: "node-1", name: "Replacement" } })
    expect(editor.canRedo()).toBe(false)
    expect(editor.redo()).toMatchObject({
      ok: false,
      diagnostics: [{ code: "HISTORY_REDO_EMPTY" }],
    })
  })

  it("emits changes only for successful commits with typed origins", () => {
    const editor = createEditor(createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }))
    const events: EditorChangeEvent[] = []
    const unsubscribe = editor.subscribe((event) => events.push(event))

    createNode(editor, "node-1")
    editor.dispatch({
      id: "node.resize",
      payload: { id: "node-1", width: 0, height: 10 },
    })
    editor.undo()
    editor.redo()
    unsubscribe()
    editor.dispatch({ id: "node.rename", payload: { id: "node-1", name: "Ignored" } })

    expect(events.map((event) => event.origin.kind)).toEqual([
      "local-command",
      "history-undo",
      "history-redo",
    ])
    expect(events[0]?.transaction.forward.created).toHaveLength(1)
    expect(events[1]?.origin).toMatchObject({
      kind: "history-undo",
      transactionId: events[0]?.transaction.transactionId,
    })
    expect(events[2]?.store.get("node-1")?.typeName).toBe("node")
  })

  it("isolates stores, histories, and listeners between editor instances", () => {
    const document = createEmptyDocument({ documentId: "doc-1", pageId: "page-1" })
    const first = createEditor(document)
    const second = createEditor(document)
    let secondChanges = 0
    second.subscribe(() => secondChanges++)

    createNode(first, "node-1")

    expect(first.canUndo()).toBe(true)
    expect(second.canUndo()).toBe(false)
    expect(second.getRecord("node-1")).toBeUndefined()
    expect(secondChanges).toBe(0)
  })
})

describe("History", () => {
  const historyRecord: NodeRecord = {
    id: "history-node",
    revision: 0,
    typeName: "node",
    nodeType: "rectangle",
    name: "History",
    parentId: "page-1",
    index: "a0",
    layout: { mode: "free", x: 0, y: 0, width: 10, height: 10 },
    visible: true,
    locked: false,
    props: { fill: "#000000" },
  }
  const entry = (transactionId: string): HistoryEntry => ({
    transactionId,
    label: transactionId,
    forward: { created: [historyRecord], updated: [], removed: [] },
    inverse: { created: [], updated: [], removed: [historyRecord] },
  })

  it("bounds past entries and clears both stacks", () => {
    const history = new History(1)
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    ).withCreated(historyRecord)
    history.record(entry("tx-1"))
    history.record(entry("tx-2"))

    const undo = history.undo(store)
    expect(undo.ok && undo.value.entry.transactionId).toBe("tx-2")
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(true)

    history.clear()
    expect(history.canUndo()).toBe(false)
    expect(history.canRedo()).toBe(false)
  })

  it("deep-clones recorded transaction patches and metadata", () => {
    const history = new History()
    const store = RecordStore.fromDocument(
      createEmptyDocument({ documentId: "doc-1", pageId: "page-1" }),
    ).withCreated(historyRecord)
    const source = entry("tx-1")
    history.record(source)
    source.label = "mutated"
    source.inverse.created.push(structuredClone(store.get("page-1")!))

    const undo = history.undo(store)
    expect(undo.ok).toBe(true)
    if (!undo.ok) return
    expect(undo.value.entry.label).toBe("tx-1")
    expect(undo.value.entry.inverse.removed).toEqual([historyRecord])
  })
})
