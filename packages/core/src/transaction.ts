import type { Diagnostic } from "./diagnostics"
import type { PersistentRecord } from "./schema"
import { RecordStore } from "./store"

export type TransactionOrigin =
  | { kind: "local-command"; commandId: string }
  | { kind: "history-undo"; transactionId: string }
  | { kind: "history-redo"; transactionId: string }
  | { kind: "system-init" }

export interface UpdatedRecordPatch {
  id: string
  typeName: PersistentRecord["typeName"]
  before: Partial<PersistentRecord>
  after: Partial<PersistentRecord>
}

export interface TransactionPatch {
  created: PersistentRecord[]
  updated: UpdatedRecordPatch[]
  removed: PersistentRecord[]
}

export interface TransactionDraft {
  create(record: PersistentRecord): void
  update(id: string, patch: Partial<PersistentRecord>): void
  remove(id: string): void
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

type RecordMap = Map<string, PersistentRecord>

function cloneRecords(store: RecordStore): RecordMap {
  return new Map(store.all().map((record) => [record.id, structuredClone(record)]))
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function changedFields(
  before: PersistentRecord,
  after: PersistentRecord,
): { before: Partial<PersistentRecord>; after: Partial<PersistentRecord> } {
  const beforePatch: Record<string, unknown> = {}
  const afterPatch: Record<string, unknown> = {}
  const beforeRecord = before as unknown as Record<string, unknown>
  const afterRecord = after as unknown as Record<string, unknown>

  for (const field of Object.keys(afterRecord)) {
    if (field === "id" || field === "typeName" || field === "revision") continue
    if (!sameValue(beforeRecord[field], afterRecord[field])) {
      beforePatch[field] = structuredClone(beforeRecord[field])
      afterPatch[field] = structuredClone(afterRecord[field])
    }
  }

  return {
    before: beforePatch as Partial<PersistentRecord>,
    after: afterPatch as Partial<PersistentRecord>,
  }
}

function buildPatch(before: RecordMap, after: RecordMap): TransactionPatch {
  const created: PersistentRecord[] = []
  const updated: UpdatedRecordPatch[] = []
  const removed: PersistentRecord[] = []

  for (const [id, record] of before) {
    const next = after.get(id)
    if (next === undefined) {
      removed.push(structuredClone(record))
      continue
    }
    const fields = changedFields(record, next)
    if (Object.keys(fields.after).length > 0) {
      updated.push({
        id,
        typeName: next.typeName,
        before: fields.before,
        after: fields.after,
      })
    }
  }

  for (const [id, record] of after) {
    if (!before.has(id)) created.push(structuredClone(record))
  }

  return { created, updated, removed }
}

function validateRecords(records: RecordMap): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const document = [...records.values()].find((record) => record.typeName === "document")

  if (document?.typeName !== "document") {
    diagnostics.push({
      code: "DOCUMENT_NOT_FOUND",
      severity: "error",
      message: "Document record is required.",
    })
    return diagnostics
  }

  const rootPage = records.get(document.rootPageId)
  if (rootPage?.typeName !== "page") {
    diagnostics.push({
      code: "ROOT_PAGE_NOT_FOUND",
      severity: "error",
      message: "Document rootPageId must identify a page record.",
      recordId: document.rootPageId,
    })
  }

  const siblingIndexes = new Map<string, Set<string>>()
  for (const record of records.values()) {
    if (record.typeName !== "node") continue

    if (record.parentId === record.id) {
      diagnostics.push({
        code: "NODE_SELF_PARENT",
        severity: "error",
        message: "A node cannot be its own parent.",
        recordId: record.id,
      })
      continue
    }

    const parent = records.get(record.parentId)
    if (parent?.typeName !== "page" && parent?.typeName !== "node") {
      diagnostics.push({
        code: "NODE_PARENT_NOT_FOUND",
        severity: "error",
        message: "Node parentId must identify a page or node record.",
        recordId: record.id,
      })
      continue
    }

    const indexes = siblingIndexes.get(record.parentId) ?? new Set<string>()
    if (indexes.has(record.index)) {
      diagnostics.push({
        code: "SIBLING_INDEX_CONFLICT",
        severity: "error",
        message: "Sibling node indexes must be unique.",
        recordId: record.id,
      })
    }
    indexes.add(record.index)
    siblingIndexes.set(record.parentId, indexes)
  }

  return diagnostics
}

function diagnosticError(diagnostic: Diagnostic): Error {
  return new Error(diagnostic.code)
}

function assertNoPageRemoval(store: RecordStore, ids: readonly string[]): void {
  for (const id of ids) {
    if (store.get(id)?.typeName === "page") throw new Error("PAGE_REMOVE_FORBIDDEN")
  }
}

function applyTransactionPatch(store: RecordStore, patch: TransactionPatch): RecordStore {
  let next = store
  if (patch.removed.length > 0) {
    assertNoPageRemoval(
      store,
      patch.removed.map((record) => record.id),
    )
    next = next.withRemovedMany(patch.removed.map((record) => record.id))
  }
  for (const update of patch.updated) {
    next = next.withUpdated(update.id, update.after as never)
  }
  if (patch.created.length > 0) {
    next = next.withCreatedMany(patch.created)
  }

  const diagnostics = validateRecords(cloneRecords(next))
  if (diagnostics.length > 0) throw diagnosticError(diagnostics[0]!)
  return next
}

export function applyPatch(store: RecordStore, patch: TransactionPatch): RecordStore {
  return applyTransactionPatch(store, patch)
}

export function transact(
  store: RecordStore,
  origin: TransactionOrigin,
  execute: (draft: TransactionDraft) => void,
): TransactionResult {
  const before = cloneRecords(store)
  const draft = cloneRecords(store)

  try {
    execute({
      create(record) {
        if (draft.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
        draft.set(record.id, structuredClone(record))
      },
      update(id, patch) {
        const current = draft.get(id)
        if (current === undefined) throw new Error("MISSING_RECORD_ID")
        const update = structuredClone(patch) as Record<string, unknown>
        update.id = current.id
        update.typeName = current.typeName
        update.revision = current.revision
        draft.set(id, structuredClone({ ...current, ...update }) as PersistentRecord)
      },
      remove(id) {
        const current = draft.get(id)
        if (current === undefined) throw new Error("MISSING_RECORD_ID")
        if (current.typeName === "page") throw new Error("PAGE_REMOVE_FORBIDDEN")
        draft.delete(id)
      },
    })

    for (const record of before.values()) {
      if (record.typeName === "page" && draft.get(record.id)?.typeName !== "page") {
        throw new Error("PAGE_REMOVE_FORBIDDEN")
      }
    }

    const validation = validateRecords(draft)
    if (validation.length > 0) throw diagnosticError(validation[0]!)

    const patch = buildPatch(before, draft)
    const next = applyTransactionPatch(store, patch)
    const inverse: TransactionPatch = {
      created: patch.removed,
      updated: patch.updated.map((update) => ({
        id: update.id,
        typeName: update.typeName,
        before: update.after,
        after: update.before,
      })),
      removed: patch.created,
    }

    return { ok: true, store: next, origin, patch, inverse, diagnostics: [] }
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
