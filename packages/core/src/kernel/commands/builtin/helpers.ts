/**
 * @module commands/builtin/helpers
 *
 * Builtin prepare 共用校验与 Result 构造。
 *
 * 边界：只读 store；不写 transact / history。
 */

import type { Diagnostic, Result } from "../../../shared/diagnostics"
import type { NodeRecord, PageRecord } from "../../../document/schema"
import type { RecordStore } from "../../../store/store"
import type { TransactionDraft } from "../../transaction"
import type { PreparedCommand } from "../types"

export function failure(code: string, message: string, recordId?: string): PreparedCommand {
  const diagnostic: Diagnostic = { code, severity: "error", message }
  if (recordId !== undefined) diagnostic.recordId = recordId
  return { ok: false, diagnostics: [diagnostic] }
}

export function success(execute: (draft: TransactionDraft) => void): PreparedCommand {
  return { ok: true, value: execute, diagnostics: [] }
}

export function nodeResult(store: RecordStore, id: string): Result<NodeRecord> {
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

export function pageResult(store: RecordStore, id: string): Result<PageRecord> {
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

export function validOverflow(value: unknown): value is PageRecord["overflow"] {
  return value === "visible" || value === "hidden" || value === "scroll"
}

export function validSize(width: number, height: number): boolean {
  return Number.isFinite(width) && Number.isFinite(height) && width >= 1 && height >= 1
}

/**
 * 变换（move/resize）锁屏障：自身或任意祖先 locked 则返回该锁节点。
 * 锁定祖先时子节点同样不可拖拽变换。
 */
export function lockedTransformBarrier(
  store: RecordStore,
  node: NodeRecord,
): NodeRecord | undefined {
  let current: NodeRecord | undefined = node
  while (current !== undefined) {
    if (current.locked) return current
    const parent = store.get(current.parentId)
    current = parent?.typeName === "node" ? parent : undefined
  }
  return undefined
}

/** 分配 `a0`,`a1`,… 形式的同级 index；仅保证当前 store 内唯一，非 fractional indexing 完整实现。 */
export function nextSiblingIndex(store: RecordStore, parentId: string): string {
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
