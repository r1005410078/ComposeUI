import type { Diagnostic, Result } from "./diagnostics"
import { History } from "./history"
import type { HistoryEntry } from "./history"
import type { NodeRecord, PageDocument, PageRecord } from "./schema"
import { RecordStore } from "./store"
import { transact } from "./transaction"
import type {
  TransactionDraft,
  TransactionOrigin,
  TransactionPatch,
  TransactionResult,
} from "./transaction"

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
  payload: { id: string; x?: number; y?: number; width: number; height: number }
}

export interface ResizeManyNodeCommand {
  id: "node.resizeMany"
  payload: {
    items: Array<{ id: string; x: number; y: number; width: number; height: number }>
  }
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

export interface SetPageOverflowCommand {
  id: "page.setOverflow"
  payload: { id: string; overflow: PageRecord["overflow"] }
}

export type EditorCommand =
  | CreateNodeCommand
  | MoveNodeCommand
  | ResizeNodeCommand
  | ResizeManyNodeCommand
  | DeleteNodeCommand
  | ReorderNodeCommand
  | RenameNodeCommand
  | SetNodeVisibleCommand
  | SetNodeLockedCommand
  | SetPageOverflowCommand

export interface EditorChangeEvent {
  store: RecordStore
  transaction: HistoryEntry
  origin: TransactionOrigin
}

export interface EditorOptions {
  onDiagnostic?: (diagnostic: Diagnostic) => void
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
  getDiagnostics(): Diagnostic[]
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

function isEmptyPatch(patch: TransactionPatch): boolean {
  return patch.created.length === 0 && patch.updated.length === 0 && patch.removed.length === 0
}

function safeErrorMessage(error: unknown): string {
  try {
    if (error instanceof Error) {
      const message = error.message
      return typeof message === "string" ? message : String(message)
    }
    return String(error)
  } catch {
    return "Unknown thrown value"
  }
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

function pageResult(store: RecordStore, id: string): Result<PageRecord> {
  const record = store.get(id)
  if (record === undefined) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "PAGE_NOT_FOUND",
          severity: "error",
          message: `Page ${id} does not exist.`,
          recordId: id,
        },
      ],
    }
  }
  if (record.typeName !== "page") {
    return {
      ok: false,
      diagnostics: [
        {
          code: "PAGE_REQUIRED",
          severity: "error",
          message: `Record ${id} is not a page.`,
          recordId: id,
        },
      ],
    }
  }
  return { ok: true, value: record, diagnostics: [] }
}

function validOverflow(value: unknown): value is PageRecord["overflow"] {
  return value === "visible" || value === "hidden" || value === "scroll"
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
  const x = command.payload.x ?? result.value.layout.x
  const y = command.payload.y ?? result.value.layout.y
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return failure(
      "INVALID_FREE_LAYOUT_POSITION",
      "Free Layout positions must be finite numbers.",
      command.payload.id,
    )
  }
  return success((draft) =>
    draft.update(command.payload.id, {
      layout: {
        ...result.value.layout,
        x,
        y,
        width: command.payload.width,
        height: command.payload.height,
      },
    }),
  )
}

function prepareResizeMany(store: RecordStore, command: ResizeManyNodeCommand): PreparedCommand {
  if (command.payload.items.length < 2) {
    return failure("INVALID_RESIZE_MANY_ITEMS", "Multi-resize requires at least two unique nodes.")
  }

  const ids = new Set<string>()
  const nodes = new Map<string, NodeRecord>()
  let parentId: string | undefined
  for (const item of command.payload.items) {
    if (ids.has(item.id)) {
      return failure(
        "DUPLICATE_RESIZE_MANY_NODE",
        `Node ${item.id} appears more than once.`,
        item.id,
      )
    }
    ids.add(item.id)

    const result = nodeResult(store, item.id)
    if (!result.ok) return result
    const locked = lockedTransformBarrier(store, result.value)
    if (locked !== undefined) {
      return failure("NODE_LOCKED", `Node ${locked.id} is locked.`, locked.id)
    }
    if (!Number.isFinite(item.x) || !Number.isFinite(item.y)) {
      return failure(
        "INVALID_FREE_LAYOUT_POSITION",
        "Free Layout positions must be finite numbers.",
        item.id,
      )
    }
    if (!validSize(item.width, item.height)) {
      return failure(
        "INVALID_FREE_LAYOUT_SIZE",
        "Free Layout dimensions must be finite numbers greater than or equal to 1.",
        item.id,
      )
    }
    if (parentId === undefined) {
      parentId = result.value.parentId
    } else if (result.value.parentId !== parentId) {
      return failure(
        "RESIZE_MANY_PARENT_MISMATCH",
        "Multi-resize nodes must share the same parent.",
        item.id,
      )
    }
    nodes.set(item.id, result.value)
  }

  return success((draft) => {
    for (const item of command.payload.items) {
      const node = nodes.get(item.id)!
      draft.update(item.id, {
        layout: {
          ...node.layout,
          x: item.x,
          y: item.y,
          width: item.width,
          height: item.height,
        },
      })
    }
  })
}

function prepareDelete(store: RecordStore, command: DeleteNodeCommand): PreparedCommand {
  const records = new Map(store.all().map((record) => [record.id, record]))
  const childrenByParent = new Map<string, string[]>()
  for (const record of records.values()) {
    if (record.typeName !== "node") continue
    const children = childrenByParent.get(record.parentId) ?? []
    children.push(record.id)
    childrenByParent.set(record.parentId, children)
  }

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

  const roots = [...selected].filter((id) => {
    let parent = records.get(id)
    if (parent?.typeName === "node") parent = records.get(parent.parentId)
    while (parent?.typeName === "node") {
      if (selected.has(parent.id)) return false
      parent = records.get(parent.parentId)
    }
    return true
  })
  const subtree: Array<{ id: string; depth: number }> = []
  for (const root of roots) {
    const pending = [{ id: root, depth: 0 }]
    while (pending.length > 0) {
      const current = pending.pop()!
      subtree.push(current)
      for (const childId of childrenByParent.get(current.id) ?? []) {
        pending.push({ id: childId, depth: current.depth + 1 })
      }
    }
  }

  // This is a fresh array; sorting it cannot mutate Store or command input.
  const ids = subtree
    // oxlint-disable-next-line unicorn/no-array-sort
    .sort((left, right) => {
      const difference = right.depth - left.depth
      return difference === 0 ? left.id.localeCompare(right.id) : difference
    })
    .map((item) => item.id)
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
  const occupiedSibling = store
    .all()
    .find(
      (record): record is NodeRecord =>
        record.typeName === "node" &&
        record.id !== node.value.id &&
        record.parentId === command.payload.parentId &&
        record.index === command.payload.index,
    )
  return success((draft) => {
    if (node.value.parentId === command.payload.parentId && occupiedSibling !== undefined) {
      draft.update(occupiedSibling.id, { index: node.value.index })
    }
    draft.update(command.payload.id, {
      parentId: command.payload.parentId,
      index: command.payload.index,
    })
  })
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

function prepareSetPageOverflow(
  store: RecordStore,
  command: SetPageOverflowCommand,
): PreparedCommand {
  const page = pageResult(store, command.payload.id)
  if (!page.ok) return page
  if (!validOverflow(command.payload.overflow)) {
    return failure(
      "INVALID_PAGE_OVERFLOW",
      "Page overflow must be visible, hidden, or scroll.",
      command.payload.id,
    )
  }
  return success((draft) =>
    draft.update(command.payload.id, { overflow: command.payload.overflow }),
  )
}

function prepareCommand(store: RecordStore, command: EditorCommand): PreparedCommand {
  switch (command.id) {
    case "node.create":
      return prepareCreate(store, command)
    case "node.move":
      return prepareMove(store, command)
    case "node.resize":
      return prepareResize(store, command)
    case "node.resizeMany":
      return prepareResizeMany(store, command)
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
    case "page.setOverflow":
      return prepareSetPageOverflow(store, command)
  }
}

function runCommand(store: RecordStore, command: EditorCommand): TransactionResult {
  const prepared = prepareCommand(store, command)
  if (!prepared.ok) return { ok: false, store, diagnostics: prepared.diagnostics }
  return transact(store, { kind: "local-command", commandId: command.id }, prepared.value)
}

export function createEditor(document: PageDocument, options: EditorOptions = {}): Editor {
  let store = RecordStore.fromDocument(document)
  const history = new History()
  const listeners = new Set<(event: EditorChangeEvent) => void>()
  const diagnostics: Diagnostic[] = []
  let transactionSequence = 0

  const reportDiagnostic = (diagnostic: Diagnostic): void => {
    diagnostics.push(structuredClone(diagnostic))
    if (options.onDiagnostic === undefined) return
    try {
      options.onDiagnostic(structuredClone(diagnostic))
    } catch (error) {
      diagnostics.push({
        code: "EDITOR_DIAGNOSTIC_HOOK_ERROR",
        severity: "error",
        message: safeErrorMessage(error),
      })
    }
  }

  const emit = (event: EditorChangeEvent): void => {
    for (const listener of listeners) {
      try {
        listener({
          store: event.store,
          transaction: structuredClone(event.transaction),
          origin: structuredClone(event.origin),
        })
      } catch (error) {
        reportDiagnostic({
          code: "EDITOR_LISTENER_ERROR",
          severity: "error",
          message: safeErrorMessage(error),
        })
      }
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
    if (isEmptyPatch(result.patch)) return { ok: true, value: undefined, diagnostics: [] }
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
    getDiagnostics: () => structuredClone(diagnostics),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return editor
}
