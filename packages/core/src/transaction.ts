import type { Diagnostic } from "./diagnostics"
import type { EditorRecord } from "./schema"
import { RecordStore } from "./store"

export type TransactionOrigin =
  | { kind: "local-command"; commandId: string }
  | { kind: "system-init" }

export interface TransactionPatch {
  created: EditorRecord[]
  updated: []
  removed: EditorRecord[]
}

export interface TransactionDraft {
  create(record: EditorRecord): void
}

export type TransactionResult =
  | {
      ok: true
      store: RecordStore
      origin: TransactionOrigin
      patch: TransactionPatch
      inverse: TransactionPatch
      diagnostics: Diagnostic[]
    }
  | { ok: false; store: RecordStore; diagnostics: Diagnostic[] }

export function transact(
  store: RecordStore,
  origin: TransactionOrigin,
  execute: (draft: TransactionDraft) => void,
): TransactionResult {
  const created: EditorRecord[] = []
  const ids = new Set<string>()

  try {
    execute({
      create(record) {
        if (store.get(record.id) !== undefined || ids.has(record.id)) {
          throw new Error("DUPLICATE_RECORD_ID")
        }
        ids.add(record.id)
        created.push(structuredClone(record))
      },
    })

    const next = store.withCreatedMany(created)
    return {
      ok: true,
      store: next,
      origin,
      patch: { created, updated: [], removed: [] },
      inverse: { created: [], updated: [], removed: created },
      diagnostics: [],
    }
  } catch (error) {
    return {
      ok: false,
      store,
      diagnostics: [
        {
          code: error instanceof Error ? error.message : "TRANSACTION_FAILED",
          severity: "error",
          message: "Transaction was rejected before commit.",
        },
      ],
    }
  }
}
