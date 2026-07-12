import type { Diagnostic, Result } from "./diagnostics"
import { History } from "./history"
import type { HistoryEntry } from "./history"
import type { NodeRecord, PageDocument, PersistentRecord } from "./schema"
import { RecordStore } from "./store"
import { transact } from "./transaction"
import type { TransactionDraft, TransactionOrigin, TransactionResult } from "./transaction"

export interface CreateNodeCommand {
  id: "node.create"
  payload: {
    id: string
    parentId: string
    name: string
    x: number
    y: number
    width: number
    height: number
    fill: string
  }
}

export interface MoveNodeCommand {
  id: "node.move"
  payload: { ids: string[]; delta: { x: number; y: number } }
}

export interface ResizeNodeCommand {
  id: "node.resize"
  payload: { id: string; width: number; height: number }
}

export interface DeleteNodeCommand {
  id: "node.delete"
  payload: { ids: string[] }
}

export interface ReorderNodeCommand {
  id: "node.reorder"
  payload: { id: string; parentId: string; index: string }
}

export interface RenameNodeCommand {
  id: "node.rename"
  payload: { id: string; name: string }
}

export interface SetNodeVisibleCommand {
  id: "node.setVisible"
  payload: { id: string; visible: boolean }
}

export interface SetNodeLockedCommand {
  id: "node.setLocked"
  payload: { id: string; locked: boolean }
}

export type EditorCommand =
  | CreateNodeCommand
  | MoveNodeCommand
  | ResizeNodeCommand
  | DeleteNodeCommand
  | ReorderNodeCommand
  | RenameNodeCommand
  | SetNodeVisibleCommand
  | SetNodeLockedCommand

export interface EditorChangeEvent {
  store: RecordStore
  transaction: HistoryEntry
  origin: TransactionOrigin
}

export interface Editor {
  readonly store: RecordStore
  dispatch(command: EditorCommand): Result<void>
  execute(command: EditorCommand): Result<void>
  getRecord(id: string): ReturnType<RecordStore["get"]>
  getStore(): RecordStore
  undo(): Result<void>
  redo(): Result<void>
  canUndo(): boolean
  canRedo(): boolean
  subscribe(listener: (event: EditorChangeEvent) => void): () => void
}

type PreparedCommand = Result<(draft: TransactionDraft) => void>

function failure(code: string, message: string, recordId?: string): PreparedCommand {
  const diagnostic: Diagnostic = { code, severity: "error", message }
  if (recordId !== undefined) diagnostic.recordId = recordId
  return { ok: false, diagnostics: [diagnostic] }
}

function success(execute: (draft: TransactionDraft) => void): PreparedCommand {
  return { ok: true, value: execute, diagnostics: [] }
}

function nodeResult(store: RecordStore, id: string): Result<NodeRecord> {
  const record = store.get(id)
  if (record === undefined) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "NODE_NOT_FOUND",
          severity: "error",
          message: `Node ${id} does not exist.`,
          recordId: id,
        },
      ],
    }
  }
  if (record.typeName !== "node") {
    return {
      ok: false,
      diagnostics: [
        {
          code: "NODE_REQUIRED",
          severity: "error",
          message: `Record ${id} is not a node.`,
          recordId: id,
        },
      ],
    }
  }
  return { ok: true, value: record, diagnostics: [] }
}

function validSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1
}

function lockedTransformBarrier(store: RecordStore, node: NodeRecord): NodeRecord | undefined {
  let current: NodeRecord | undefined = node
  while (current !== undefined) {
    if (current.locked) return current
    const parent = store.get(current.parentId)
    current = parent?.typeName === "node" ? parent : undefined
  }
  return undefined
}

function nextSiblingIndex(store: RecordStore, parentId: string): string {
  const indexes = new Set(
    store
      .all()
      .filter(
        (record): record is NodeRecord =>
          record.typeName === "node" && record.parentId === parentId,
      )
      .map((record) => record.index),
  )
  let position = 0
  while (indexes.has(`a${position}`)) position += 1
  return `a${position}`
}

function prepareCreate(store: RecordStore, command: CreateNodeCommand): PreparedCommand {
  const parent = store.get(command.payload.parentId)
  if (parent?.typeName !== "page" && parent?.typeName !== "node") {
    return failure(
      "PARENT_NOT_FOUND",
      `Parent ${command.payload.parentId} does not exist.`,
      command.payload.parentId,
    )
  }
  if (!validSize(command.payload.width, command.payload.height)) {
    return failure(
      "INVALID_FREE_LAYOUT_SIZE",
      "Free Layout dimensions must be finite numbers greater than or equal to 1.",
      command.payload.id,
    )
  }

  const node: NodeRecord = {
    id: command.payload.id,
    revision: 0,
    typeName: "node",
    nodeType: "rectangle",
    name: command.payload.name,
    parentId: command.payload.parentId,
    index: nextSiblingIndex(store, command.payload.parentId),
    layout: {
      mode: "free",
      x: command.payload.x,
      y: command.payload.y,
      width: command.payload.width,
      height: command.payload.height,
    },
    visible: true,
    locked: false,
    props: { fill: command.payload.fill },
  }
  return success((draft) => draft.create(node))
}

function prepareMove(store: RecordStore, command: MoveNodeCommand): PreparedCommand {
  const nodes: NodeRecord[] = []
  const selected = new Set(command.payload.ids)
  for (const id of selected) {
    const result = nodeResult(store, id)
    if (!result.ok) return result
    const locked = lockedTransformBarrier(store, result.value)
    if (locked !== undefined) {
      return failure("NODE_LOCKED", `Node ${locked.id} is locked.`, locked.id)
    }
    if (!validSize(result.value.layout.width, result.value.layout.height)) {
      return failure("INVALID_FREE_LAYOUT_SIZE", "Free Layout dimensions must be at least 1.", id)
    }
    nodes.push(result.value)
  }

  const topLevelNodes = nodes.filter((node) => {
    let parent = store.get(node.parentId)
    while (parent?.typeName === "node") {
      if (selected.has(parent.id)) return false
      parent = store.get(parent.parentId)
    }
    return true
  })

  return success((draft) => {
    for (const node of topLevelNodes) {
      draft.update(node.id, {
        layout: {
          ...node.layout,
          x: node.layout.x + command.payload.delta.x,
          y: node.layout.y + command.payload.delta.y,
        },
      })
    }
  })
}

function prepareResize(store: RecordStore, command: ResizeNodeCommand): PreparedCommand {
  const result = nodeResult(store, command.payload.id)
  if (!result.ok) return result
  const locked = lockedTransformBarrier(store, result.value)
  if (locked !== undefined) {
    return failure("NODE_LOCKED", `Node ${locked.id} is locked.`, locked.id)
  }
  if (!validSize(command.payload.width, command.payload.height)) {
    return failure(
      "INVALID_FREE_LAYOUT_SIZE",
      "Free Layout dimensions must be finite numbers greater than or equal to 1.",
      command.payload.id,
    )
  }
  return success((draft) =>
    draft.update(command.payload.id, {
      layout: {
        ...result.value.layout,
        width: command.payload.width,
        height: command.payload.height,
      },
    }),
  )
}

function nodeDepth(records: ReadonlyMap<string, PersistentRecord>, id: string): number {
  let depth = 0
  let current = records.get(id)
  while (current?.typeName === "node") {
    depth += 1
    current = records.get(current.parentId)
  }
  return depth
}

function prepareDelete(store: RecordStore, command: DeleteNodeCommand): PreparedCommand {
  const records = new Map(store.all().map((record) => [record.id, record]))
  const selected = new Set<string>()
  for (const id of command.payload.ids) {
    const record = records.get(id)
    if (record?.typeName === "page") {
      return failure("PAGE_REMOVE_FORBIDDEN", "The root page cannot be removed.", id)
    }
    const result = nodeResult(store, id)
    if (!result.ok) return result
    selected.add(id)
  }

  let changed = true
  while (changed) {
    changed = false
    for (const record of records.values()) {
      if (record.typeName === "node" && selected.has(record.parentId) && !selected.has(record.id)) {
        selected.add(record.id)
        changed = true
      }
    }
  }
  // This is a fresh array; sorting it cannot mutate Store or command input.
  // oxlint-disable-next-line unicorn/no-array-sort
  const ids = [...selected].sort((left, right) => {
    const difference = nodeDepth(records, right) - nodeDepth(records, left)
    return difference === 0 ? left.localeCompare(right) : difference
  })
  return success((draft) => {
    for (const id of ids) draft.remove(id)
  })
}

function prepareReorder(store: RecordStore, command: ReorderNodeCommand): PreparedCommand {
  const node = nodeResult(store, command.payload.id)
  if (!node.ok) return node
  const parent = store.get(command.payload.parentId)
  if (parent?.typeName !== "page" && parent?.typeName !== "node") {
    return failure(
      "PARENT_NOT_FOUND",
      `Parent ${command.payload.parentId} does not exist.`,
      command.payload.parentId,
    )
  }
  return success((draft) =>
    draft.update(command.payload.id, {
      parentId: command.payload.parentId,
      index: command.payload.index,
    }),
  )
}

function prepareNodeUpdate(
  store: RecordStore,
  id: string,
  patch: Partial<NodeRecord>,
): PreparedCommand {
  const node = nodeResult(store, id)
  if (!node.ok) return node
  return success((draft) => draft.update(id, patch))
}

function prepareCommand(store: RecordStore, command: EditorCommand): PreparedCommand {
  switch (command.id) {
    case "node.create":
      return prepareCreate(store, command)
    case "node.move":
      return prepareMove(store, command)
    case "node.resize":
      return prepareResize(store, command)
    case "node.delete":
      return prepareDelete(store, command)
    case "node.reorder":
      return prepareReorder(store, command)
    case "node.rename":
      return prepareNodeUpdate(store, command.payload.id, { name: command.payload.name })
    case "node.setVisible":
      return prepareNodeUpdate(store, command.payload.id, { visible: command.payload.visible })
    case "node.setLocked":
      return prepareNodeUpdate(store, command.payload.id, { locked: command.payload.locked })
  }
}

function runCommand(store: RecordStore, command: EditorCommand): TransactionResult {
  const prepared = prepareCommand(store, command)
  if (!prepared.ok) return { ok: false, store, diagnostics: prepared.diagnostics }
  return transact(store, { kind: "local-command", commandId: command.id }, prepared.value)
}

export function createEditor(document: PageDocument): Editor {
  let store = RecordStore.fromDocument(document)
  const history = new History()
  const listeners = new Set<(event: EditorChangeEvent) => void>()
  let transactionSequence = 0

  const emit = (event: EditorChangeEvent): void => {
    for (const listener of listeners) {
      listener({
        store: event.store,
        transaction: structuredClone(event.transaction),
        origin: structuredClone(event.origin),
      })
    }
  }

  const applyHistory = (direction: "undo" | "redo"): Result<void> => {
    const result = direction === "undo" ? history.undo(store) : history.redo(store)
    if (!result.ok) return result
    store = result.value.store
    emit({
      store,
      transaction: result.value.entry,
      origin: result.value.origin,
    })
    return { ok: true, value: undefined, diagnostics: [] }
  }

  const dispatch = (command: EditorCommand): Result<void> => {
    const result = runCommand(store, command)
    if (!result.ok) return { ok: false, diagnostics: result.diagnostics }

    store = result.store
    const entry: HistoryEntry = {
      transactionId: `transaction-${++transactionSequence}`,
      label: command.id,
      forward: result.patch,
      inverse: result.inverse,
    }
    history.record(entry)
    emit({ store, transaction: entry, origin: result.origin })
    return { ok: true, value: undefined, diagnostics: [] }
  }

  const editor: Editor = {
    get store() {
      return store
    },
    dispatch,
    execute: dispatch,
    getRecord: (id) => store.get(id),
    getStore: () => store,
    undo: () => applyHistory("undo"),
    redo: () => applyHistory("redo"),
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return editor
}
