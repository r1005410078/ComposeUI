/**
 * @module commands/editor
 *
 * 文档命令门面：`createEditor` 将用户意图统一为 registry prepare → transact → history → 订阅通知。
 *
 * 不变量：
 * - 工具栏 / 画布 / 树 / 快捷键必须调用同一套 dispatch，禁止 UI 旁路改 Store
 * - 一次命令 = 一次事务 = 一步 undo（多节点 move/delete 也是单步）
 * - 失败返回 Result + Diagnostic，不抛业务异常给调用方
 * - operationObserver / listener 抛错只记诊断，不回滚已提交文档
 * - dispose 幂等；之后变更类 API 返回 EDITOR_DISPOSED，只读 API 仍可用
 *
 * 数据流：DispatchCommand → registry.get → prepare → transact → History.record → subscribe / observe。
 */

import type { Diagnostic, Result } from "../../shared/diagnostics"
import type { PageDocument } from "../../document/schema"
import { canonicalizeDocument } from "../../document/snapshot"
import { RecordStore } from "../../store/store"
import { History } from "../history"
import type { HistoryEntry } from "../history"
import type { EditorOperation } from "../operations"
import { transact } from "../transaction"
import type { TransactionPatch } from "../transaction"
import { builtinCommandPlugin } from "./builtin"
import { installCommandPlugins } from "./plugin"
import { CommandRegistry } from "./registry"
import type { DispatchCommand, Editor, EditorChangeEvent, EditorOptions } from "./types"

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

const disposedResult = (): Result<void> => ({
  ok: false,
  diagnostics: [
    {
      code: "EDITOR_DISPOSED",
      severity: "error",
      message: "Editor is disposed.",
    },
  ],
})

/**
 * 从 PageDocument 创建隔离的 Editor 实例。
 * 含独立 History、诊断缓冲、命令 registry 与订阅表；勿跨实例共享闭包状态。
 */
export function createEditor(document: PageDocument, options: EditorOptions = {}): Editor {
  let store = RecordStore.fromDocument(document)
  const history = new History()
  const listeners = new Set<(event: EditorChangeEvent) => void>()
  const diagnostics: Diagnostic[] = []
  let transactionSequence = 0
  let disposed = false

  const registry = new CommandRegistry()
  const plugins = [builtinCommandPlugin, ...(options.plugins ?? [])]
  const installation = installCommandPlugins(registry, plugins)

  const reportDiagnostic = (diagnostic: Diagnostic): void => {
    diagnostics.push(structuredClone(diagnostic))
    // dispose 完成后不再调用宿主 onDiagnostic，避免 UI 已拆钩时二次失败
    if (disposed || options.onDiagnostic === undefined) return
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
    if (disposed || options.operationObserver === undefined) return
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
    if (disposed) return disposedResult()
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
    if (disposed) return disposedResult()
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

  const dispatch = (command: DispatchCommand): Result<void> => {
    if (disposed) return disposedResult()

    const contribution = registry.get(command.id)
    if (contribution === undefined) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "COMMAND_NOT_REGISTERED",
            severity: "error",
            message: `No command registered for id ${command.id}`,
          },
        ],
      }
    }

    // before 在事务前冻结，供 operation log / 回放对齐
    const before = structuredClone(canonicalizeDocument(store))
    observeOperation({ type: "document.command", status: "started", command })

    const prepared = contribution.prepare(store, command)
    if (!prepared.ok) {
      observeOperation({
        type: "document.command",
        status: "failed",
        command,
        diagnostics: prepared.diagnostics,
      })
      return { ok: false, diagnostics: prepared.diagnostics }
    }

    const result = transact(store, { kind: "local-command", commandId: command.id }, prepared.value)
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
      label: contribution.label ?? command.id,
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
    dispose() {
      if (disposed) return
      disposed = true
      installation.disposeAll()
      listeners.clear()
    },
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
      if (disposed) return () => undefined
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
  return editor
}
