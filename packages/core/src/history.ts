import type { Result } from "./diagnostics"
import type { RecordStore } from "./store"
import { applyPatch } from "./transaction"
import type { TransactionOrigin, TransactionPatch } from "./transaction"

export interface HistoryEntry {
  transactionId: string
  label: string
  forward: TransactionPatch
  inverse: TransactionPatch
}

export interface HistoryChange {
  store: RecordStore
  entry: HistoryEntry
  origin: Extract<TransactionOrigin, { kind: "history-undo" | "history-redo" }>
}

function cloneEntry(entry: HistoryEntry): HistoryEntry {
  return structuredClone(entry)
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
  readonly #past: HistoryEntry[] = []
  readonly #future: HistoryEntry[] = []

  constructor(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("INVALID_HISTORY_LIMIT")
    this.#limit = limit
  }

  record(entry: HistoryEntry): void {
    this.#past.push(cloneEntry(entry))
    if (this.#past.length > this.#limit) this.#past.shift()
    this.#future.length = 0
  }

  undo(store: RecordStore): Result<HistoryChange> {
    const entry = this.#past.at(-1)
    if (entry === undefined) return emptyHistory("HISTORY_UNDO_EMPTY")

    const applied = applyPatch(store, entry.inverse)
    if (!applied.ok) return applied

    this.#past.pop()
    this.#future.push(entry)
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
    const entry = this.#future.at(-1)
    if (entry === undefined) return emptyHistory("HISTORY_REDO_EMPTY")

    const applied = applyPatch(store, entry.forward)
    if (!applied.ok) return applied

    this.#future.pop()
    this.#past.push(entry)
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
    return this.#past.length > 0
  }

  canRedo(): boolean {
    return this.#future.length > 0
  }

  clear(): void {
    this.#past.length = 0
    this.#future.length = 0
  }
}
