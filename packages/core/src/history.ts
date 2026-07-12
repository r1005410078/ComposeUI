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
  origin: Extract<TransactionOrigin, { kind: "history-undo" | "history-redo" | "history-jump" }>
}

export interface HistorySnapshot {
  past: HistoryEntry[]
  future: HistoryEntry[]
  entries: HistoryEntry[]
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
    const future = this.#entries.slice(this.#currentIndex).reduceRight<HistoryEntry[]>(
      (reversed, entry) => {
        reversed.push(entry)
        return reversed
      },
      [],
    )
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
