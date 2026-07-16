/**
 * @module history
 *
 * 基于 forward/inverse patch 的线性撤销栈。
 *
 * 不变量：
 * - 空 patch 不入栈
 * - 在 past 中间 record 新操作会截断 future
 * - undo/redo/jump 通过 `applyPatch` 重放，失败则不移动 currentIndex
 *
 * 边界：History 不持有 Store；每次操作由调用方传入当前 store 并接收新 store。
 * 协作场景下将来由 Y.UndoManager 替代/协同，本类服务本地命令路径。
 *
 * 数据流：Editor 成功事务 → history.record → undo/redo → applyPatch → 新 store + emit。
 */

import type { Result } from "../shared/diagnostics"
import type { RecordStore } from "../store/store"
import { applyPatch } from "./transaction"
import type { TransactionOrigin, TransactionPatch } from "./transaction"

/** 可撤销的一次文档事务记录。 */
export interface HistoryEntry {
  transactionId: string
  /** 通常为 command id，供 UI 标签展示。 */
  label: string
  forward: TransactionPatch
  inverse: TransactionPatch
}

/** undo/redo/jump 成功后交给 Editor 广播的载荷。 */
export interface HistoryChange {
  store: RecordStore
  entry: HistoryEntry
  origin: Extract<TransactionOrigin, { kind: "history-undo" | "history-redo" | "history-jump" }>
}

/** 快照：past 为已应用栈，future 为可 redo 栈（时间逆序便于 UI 展示）。 */
export interface HistorySnapshot {
  past: HistoryEntry[]
  future: HistoryEntry[]
  entries: HistoryEntry[]
  /** 0..entries.length；等于 length 表示在最新状态。 */
  currentIndex: number
}

function cloneEntry(entry: HistoryEntry): HistoryEntry {
  return structuredClone(entry)
}

function isEmptyPatch(patch: TransactionPatch): boolean {
  return patch.created.length === 0 && patch.updated.length === 0 && patch.removed.length === 0
}

function emptyHistory(code: "HISTORY_UNDO_EMPTY" | "HISTORY_REDO_EMPTY"): Result<HistoryChange> {
  return {
    ok: false,
    diagnostics: [
      {
        code,
        severity: "error",
        message:
          code === "HISTORY_UNDO_EMPTY" ? "There is nothing to undo." : "There is nothing to redo.",
      },
    ],
  }
}

export class History {
  readonly #limit: number
  readonly #entries: HistoryEntry[] = []
  #currentIndex = 0

  constructor(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("INVALID_HISTORY_LIMIT")
    this.#limit = limit
  }

  /**
   * 记录一次成功事务。会丢弃 currentIndex 之后的 future。
   * 超过 limit 时从头部丢弃最旧条目。
   */
  record(entry: HistoryEntry): void {
    if (isEmptyPatch(entry.forward)) return
    this.#entries.splice(this.#currentIndex)
    this.#entries.push(cloneEntry(entry))
    if (this.#entries.length > this.#limit) this.#entries.shift()
    this.#currentIndex = this.#entries.length
  }

  undo(store: RecordStore): Result<HistoryChange> {
    const entry = this.#entries[this.#currentIndex - 1]
    if (entry === undefined) return emptyHistory("HISTORY_UNDO_EMPTY")

    const applied = applyPatch(store, entry.inverse)
    if (!applied.ok) return applied

    this.#currentIndex -= 1
    return {
      ok: true,
      value: {
        store: applied.value,
        entry: cloneEntry(entry),
        origin: { kind: "history-undo", transactionId: entry.transactionId },
      },
      diagnostics: [],
    }
  }

  redo(store: RecordStore): Result<HistoryChange> {
    const entry = this.#entries[this.#currentIndex]
    if (entry === undefined) return emptyHistory("HISTORY_REDO_EMPTY")

    const applied = applyPatch(store, entry.forward)
    if (!applied.ok) return applied

    this.#currentIndex += 1
    return {
      ok: true,
      value: {
        store: applied.value,
        entry: cloneEntry(entry),
        origin: { kind: "history-redo", transactionId: entry.transactionId },
      },
      diagnostics: [],
    }
  }

  canUndo(): boolean {
    return this.#currentIndex > 0
  }

  canRedo(): boolean {
    return this.#currentIndex < this.#entries.length
  }

  /**
   * 跳转到指定 history 索引（0 = 全部撤销后，length = 最新）。
   * 连续 apply 中间任一步失败则整体失败且不更新 index。
   */
  jumpTo(store: RecordStore, currentIndex: number): Result<HistoryChange> {
    if (
      !Number.isInteger(currentIndex) ||
      currentIndex < 0 ||
      currentIndex > this.#entries.length
    ) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "HISTORY_INDEX_INVALID",
            severity: "error",
            message: `History index must be between 0 and ${this.#entries.length}.`,
          },
        ],
      }
    }
    if (currentIndex === this.#currentIndex) {
      return {
        ok: false,
        diagnostics: [
          {
            code: "HISTORY_INDEX_UNCHANGED",
            severity: "error",
            message: "The requested history point is already active.",
          },
        ],
      }
    }

    let nextStore = store
    let lastEntry: HistoryEntry | undefined
    if (currentIndex < this.#currentIndex) {
      for (let index = this.#currentIndex - 1; index >= currentIndex; index -= 1) {
        const entry = this.#entries[index]!
        const applied = applyPatch(nextStore, entry.inverse)
        if (!applied.ok) return applied
        nextStore = applied.value
        lastEntry = entry
      }
    } else {
      for (let index = this.#currentIndex; index < currentIndex; index += 1) {
        const entry = this.#entries[index]!
        const applied = applyPatch(nextStore, entry.forward)
        if (!applied.ok) return applied
        nextStore = applied.value
        lastEntry = entry
      }
    }

    this.#currentIndex = currentIndex
    return {
      ok: true,
      value: {
        store: nextStore,
        entry: cloneEntry(lastEntry!),
        origin: { kind: "history-jump", transactionId: lastEntry!.transactionId },
      },
      diagnostics: [],
    }
  }

  snapshot(): HistorySnapshot {
    // future 按“最近可 redo 优先”反转，便于操作日志/时间线 UI
    const future = this.#entries
      .slice(this.#currentIndex)
      .reduceRight<HistoryEntry[]>((reversed, entry) => {
        reversed.push(entry)
        return reversed
      }, [])
    return {
      past: structuredClone(this.#entries.slice(0, this.#currentIndex)),
      future: structuredClone(future),
      entries: structuredClone(this.#entries),
      currentIndex: this.#currentIndex,
    }
  }

  clear(): void {
    this.#entries.length = 0
    this.#currentIndex = 0
  }
}
