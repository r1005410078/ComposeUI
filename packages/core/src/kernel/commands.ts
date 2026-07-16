/**
 * @module commands
 *
 * 文档命令门面：`createEditor` 将用户意图统一为 prepare → transact → history → 订阅通知。
 *
 * 不变量：
 * - 工具栏 / 画布 / 树 / 快捷键必须调用同一套 dispatch，禁止 UI 旁路改 Store
 * - 一次命令 = 一次事务 = 一步 undo（多节点 move/delete 也是单步）
 * - 失败返回 Result + Diagnostic，不抛业务异常给调用方
 * - operationObserver / listener 抛错只记诊断，不回滚已提交文档
 *
 * 数据流：EditorCommand → prepare* → transact → History.record → subscribe / observe。
 */

import type { Diagnostic, Result } from "./diagnostics"
import { History } from "./history"
import type { HistoryEntry } from "./history"
import type { EditorOperation, EditorOperationObserver } from "./operations"
import type { NodeRecord, PageDocument, PageRecord } from "./schema"
import { canonicalizeDocument } from "./snapshot"
import { RecordStore } from "./store"
import { transact } from "./transaction"
import type {
  TransactionDraft,
  TransactionOrigin,
  TransactionPatch,
  TransactionResult,
} from "./transaction"

/** 在 parent 下创建 rectangle；index 由 core 分配，调用方不指定同级序。 */
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

/**
 * 平移一组节点。仅更新选中集合中的“顶层”节点，避免父子同选时双重位移。
 * 任一节点自身或祖先 locked 则整命令失败。
 */
export interface MoveNodeCommand {
  id: "node.move"
  payload: { ids: string[]; delta: { x: number; y: number } }
}

/** 单节点缩放；可选改 x/y（锚点拖拽时由 editor 计算）。 */
export interface ResizeNodeCommand {
  id: "node.resize"
  payload: { id: string; x?: number; y?: number; width: number; height: number }
}

/**
 * 多选等比/组缩放提交：≥2 个节点、同 parent、坐标尺寸一次写齐。
 * 指针预览应在 session，完成时再 dispatch 本命令。
 */
export interface ResizeManyNodeCommand {
  id: "node.resizeMany"
  payload: {
    items: Array<{ id: string; x: number; y: number; width: number; height: number }>
  }
}

/** 删除节点及其子树；禁止删 page。删除顺序由深到浅，保证 draft 一致性。 */
export interface DeleteNodeCommand {
  id: "node.delete"
  payload: { ids: string[] }
}

/**
 * 调整同级/跨 parent 顺序。若目标 index 被占用且仍在同 parent，
 * 与占用者交换 index，避免 sibling 冲突。
 */
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

/** 所有文档变更意图的可辨识联合；新增命令须同步 prepare 与 operation log。 */
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

/** 成功提交后广播给 UI 的变更事件（含新 store 与 history 条目）。 */
export interface EditorChangeEvent {
  store: RecordStore
  transaction: HistoryEntry
  origin: TransactionOrigin
}

export interface EditorOptions {
  onDiagnostic?: (diagnostic: Diagnostic) => void
  /** 旁路观察；异常不得阻断 dispatch。 */
  operationObserver?: EditorOperationObserver
}

/**
 * 单文档编辑会话的核心门面（非 DOM）。
 * 多实例互不共享 store/history；宿主每挂载一个 board 应 createEditor 一次。
 */
export interface Editor {
  readonly store: RecordStore
  dispatch(command: EditorCommand): Result<void>
  /** 与 dispatch 相同，保留兼容别名。 */
  execute(command: EditorCommand): Result<void>
  getRecord(id: string): ReturnType<RecordStore["get"]>
  getStore(): RecordStore
  undo(): Result<void>
  redo(): Result<void>
  canUndo(): boolean
  canRedo(): boolean
  getHistory(): {
    past: HistoryEntry[]
    future: HistoryEntry[]
    entries: HistoryEntry[]
    currentIndex: number
  }
  jumpToHistory(index: number): Result<void>
  getDiagnostics(): Diagnostic[]
  /** 返回 dispose；listener 异常记诊断不摘掉其他监听。 */
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

/**
 * 变换（move/resize）锁屏障：自身或任意祖先 locked 则返回该锁节点。
 * 锁定祖先时子节点同样不可拖拽变换。
 */
function lockedTransformBarrier(store: RecordStore, node: NodeRecord): NodeRecord | undefined {
  let current: NodeRecord | undefined = node
  while (current !== undefined) {
    if (current.locked) return current
    const parent = store.get(current.parentId)
    current = parent?.typeName === "node" ? parent : undefined
  }
  return undefined
}

/** 分配 `a0`,`a1`,… 形式的同级 index；仅保证当前 store 内唯一，非 fractional indexing 完整实现。 */
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

  // 父子同选时只移动祖先，子节点随父布局保留相对坐标
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

  // 深节点先删；数组为新建，排序不会改 Store / 命令入参
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

/**
 * 从 PageDocument 创建隔离的 Editor 实例。
 * 含独立 History、诊断缓冲与订阅表；勿跨实例共享闭包状态。
 */
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
      // 宿主 hook 失败不得形成递归炸栈；再记一条诊断即可
      diagnostics.push({
        code: "EDITOR_DIAGNOSTIC_HOOK_ERROR",
        severity: "error",
        message: safeErrorMessage(error),
      })
    }
  }

  const observeOperation = (operation: EditorOperation): void => {
    if (options.operationObserver === undefined) return
    try {
      options.operationObserver.observe(structuredClone(operation))
    } catch (error) {
      reportDiagnostic({
        code: "EDITOR_OPERATION_OBSERVER_ERROR",
        severity: "error",
        message: safeErrorMessage(error),
      })
    }
  }

  const currentHistoryIndex = (): number => history.snapshot().currentIndex

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
    const type = direction === "undo" ? "history.undo" : "history.redo"
    if (!result.ok) {
      observeOperation({
        type,
        status: "failed",
        currentIndex: currentHistoryIndex(),
        diagnostics: result.diagnostics,
      })
      return result
    }
    store = result.value.store
    observeOperation({
      type,
      status: "succeeded",
      transactionId: result.value.entry.transactionId,
      currentIndex: currentHistoryIndex(),
    })
    emit({
      store,
      transaction: result.value.entry,
      origin: result.value.origin,
    })
    return { ok: true, value: undefined, diagnostics: [] }
  }

  const jumpToHistory = (index: number): Result<void> => {
    if (index === history.snapshot().currentIndex) {
      observeOperation({
        type: "history.jump",
        status: "succeeded",
        currentIndex: currentHistoryIndex(),
      })
      return { ok: true, value: undefined, diagnostics: [] }
    }
    const result = history.jumpTo(store, index)
    if (!result.ok) {
      observeOperation({
        type: "history.jump",
        status: "failed",
        currentIndex: currentHistoryIndex(),
        diagnostics: result.diagnostics,
      })
      return result
    }
    store = result.value.store
    observeOperation({
      type: "history.jump",
      status: "succeeded",
      transactionId: result.value.entry.transactionId,
      currentIndex: currentHistoryIndex(),
    })
    emit({
      store,
      transaction: result.value.entry,
      origin: result.value.origin,
    })
    return { ok: true, value: undefined, diagnostics: [] }
  }

  const dispatch = (command: EditorCommand): Result<void> => {
    // before 在事务前冻结，供 operation log / 回放对齐
    const before = structuredClone(canonicalizeDocument(store))
    observeOperation({ type: "document.command", status: "started", command })
    const result = runCommand(store, command)
    if (!result.ok) {
      observeOperation({
        type: "document.command",
        status: "failed",
        command,
        diagnostics: result.diagnostics,
      })
      return { ok: false, diagnostics: result.diagnostics }
    }

    store = result.store
    const entry: HistoryEntry = {
      transactionId: `transaction-${++transactionSequence}`,
      label: command.id,
      forward: result.patch,
      inverse: result.inverse,
    }
    observeOperation({
      type: "document.command",
      status: "succeeded",
      command,
      transaction: entry,
      before,
      after: structuredClone(canonicalizeDocument(store)),
    })
    // 空 patch：命令合法但无业务变化，不污染 history、不通知订阅者
    if (isEmptyPatch(result.patch)) return { ok: true, value: undefined, diagnostics: [] }
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
    jumpToHistory,
    canUndo: () => history.canUndo(),
    canRedo: () => history.canRedo(),
    getHistory: () => history.snapshot(),
    getDiagnostics: () => structuredClone(diagnostics),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return editor
}
