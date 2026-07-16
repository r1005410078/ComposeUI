/**
 * @module transaction
 *
 * 文档权威状态的唯一原子写路径。
 *
 * 流程：clone → draft 变更 → 形状与树校验 → 建 patch/inverse → apply → 新 store。
 * 失败返回原 store，无部分提交。
 *
 * 关键策略（M1）：
 * - 禁止在普通事务中创建/删除 document、创建/删除 page（仅初始化）
 * - patch 应用有前置条件（before 必须匹配当前），防止脏写
 * - 同一 id 不得同时出现在 created/updated/removed
 *
 * 数据流：Command.prepare → transact(draft) → History.record(forward/inverse)。
 * UI 与 Session 不得调用 draft 绕过命令层写持久数据。
 */

import type { Diagnostic, Result } from "./diagnostics"
import type { PersistentRecord } from "./schema"
import { RecordStore, updateRecord, validateRecordShape } from "./store"
import { deepEqual, validateNodeTree } from "./validation"

/** 事务来源，供 history、协作与诊断区分本地命令 vs 撤销重做等。 */
export type TransactionOrigin =
  | { kind: "local-command"; commandId: string }
  | { kind: "history-undo"; transactionId: string }
  | { kind: "history-redo"; transactionId: string }
  | { kind: "history-jump"; transactionId: string }
  | { kind: "system-init" }

/** 单条更新在 patch 中的前后快照（含完整 record，便于 inverse 与 precondition）。 */
export interface UpdatedRecordPatch {
  id: string
  typeName: PersistentRecord["typeName"]
  before: PersistentRecord
  after: PersistentRecord
}

/** 一次事务的前向变更集。 */
export interface TransactionPatch {
  created: PersistentRecord[]
  updated: UpdatedRecordPatch[]
  removed: PersistentRecord[]
}

/** 事务草稿 API：只在 execute 回调内有效，不直接暴露给 UI。 */
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
export type PatchApplyResult = Result<RecordStore>

class TransactionError extends Error {
  constructor(readonly diagnostics: Diagnostic[]) {
    super(diagnostics[0]?.code ?? "TRANSACTION_FAILED")
  }
}

function operationError(code: string, message: string, recordId?: string): TransactionError {
  const diagnostic: Diagnostic = { code, severity: "error", message }
  if (recordId !== undefined) diagnostic.recordId = recordId
  return new TransactionError([diagnostic])
}

function cloneRecords(store: RecordStore): RecordMap {
  return new Map(store.all().map((record) => [record.id, structuredClone(record)]))
}

function sameValue(left: unknown, right: unknown): boolean {
  return deepEqual(left, right)
}

/** 比较业务字段是否变化；忽略 id/typeName/revision，避免 revision-only “假更新”。 */
function recordsDiffer(before: PersistentRecord, after: PersistentRecord): boolean {
  const beforeRecord = before as unknown as Record<string, unknown>
  const afterRecord = after as unknown as Record<string, unknown>

  for (const field of Object.keys(afterRecord)) {
    if (field === "id" || field === "typeName" || field === "revision") continue
    if (!sameValue(beforeRecord[field], afterRecord[field])) {
      return true
    }
  }
  return false
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
    if (recordsDiffer(record, next)) {
      updated.push({
        id,
        typeName: next.typeName,
        before: structuredClone(record),
        after: structuredClone(next),
      })
    }
  }

  for (const [id, record] of after) {
    if (!before.has(id)) created.push(structuredClone(record))
  }

  return { created, updated, removed }
}

/** 全库形状 + 文档基数 + 节点树策略。 */
function validateRecords(records: RecordMap): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const record of records.values()) {
    try {
      validateRecordShape(record)
    } catch (error) {
      diagnostics.push({
        code: error instanceof Error ? error.message : "INVALID_RECORD_SHAPE",
        severity: "error",
        message: "Record shape is invalid.",
        recordId: record.id,
      })
    }
  }

  const documents = [...records.values()].filter((record) => record.typeName === "document")
  if (documents.length !== 1) {
    diagnostics.push({
      code: "DOCUMENT_COUNT_INVALID",
      severity: "error",
      message: "Exactly one document record is required.",
    })
  }
  const document = documents[0]

  if (document?.typeName !== "document") {
    return diagnostics
  }

  const pages = [...records.values()].filter((record) => record.typeName === "page")
  if (pages.length !== 1) {
    diagnostics.push({
      code: "PAGE_COUNT_INVALID",
      severity: "error",
      message: "Exactly one page record is required.",
      recordId: document.rootPageId,
    })
  }
  const rootPage = records.get(document.rootPageId)
  if (rootPage?.typeName !== "page") {
    diagnostics.push({
      code: "ROOT_PAGE_INVALID",
      severity: "error",
      message: "Document rootPageId must identify the page record.",
      recordId: document.rootPageId,
    })
  }

  diagnostics.push(...validateNodeTree(records, document.rootPageId))

  return diagnostics
}

function validationError(diagnostics: Diagnostic[]): TransactionError {
  return new TransactionError(diagnostics)
}

function assertNoDocumentCreation(records: readonly PersistentRecord[]): void {
  if (records.some((record) => record.typeName === "document")) {
    throw operationError(
      "DOCUMENT_CREATE_FORBIDDEN",
      "Document records can only be created during document initialization.",
    )
  }
}

function assertNoPageCreation(records: readonly PersistentRecord[]): void {
  const page = records.find((record) => record.typeName === "page")
  if (page !== undefined) {
    throw operationError("PAGE_CREATE_FORBIDDEN", "Pages can only be initialized.", page.id)
  }
}

function patchConflict(message: string, recordId?: string): PatchApplyResult {
  const diagnostic: Diagnostic = { code: "PATCH_PRECONDITION_FAILED", severity: "error", message }
  if (recordId !== undefined) diagnostic.recordId = recordId
  return { ok: false, diagnostics: [diagnostic] }
}

function duplicatePatchRecordId(patch: TransactionPatch): string | undefined {
  const seen = new Set<string>()
  const ids = [
    ...patch.created.map((record) => record.id),
    ...patch.updated.map((record) => record.id),
    ...patch.removed.map((record) => record.id),
  ]
  for (const id of ids) {
    if (seen.has(id)) return id
    seen.add(id)
  }
  return undefined
}

/**
 * 在校验前置条件后把 patch 应用到 store。
 * undo/redo 与 transact 成功路径共用，保证回放语义一致。
 */
function applyTransactionPatch(store: RecordStore, patch: TransactionPatch): PatchApplyResult {
  const duplicateId = duplicatePatchRecordId(patch)
  if (duplicateId !== undefined) {
    return {
      ok: false,
      diagnostics: [
        {
          code: "PATCH_DUPLICATE_RECORD_ENTRY",
          severity: "error",
          message: "A record id may appear in only one patch entry.",
          recordId: duplicateId,
        },
      ],
    }
  }
  if (patch.created.length === 0 && patch.updated.length === 0 && patch.removed.length === 0) {
    return { ok: true, value: store, diagnostics: [] }
  }
  const removedIds = new Set(patch.removed.map((record) => record.id))
  for (const record of patch.removed) {
    const current = store.get(record.id)
    if (current === undefined || !deepEqual(current, record)) {
      return patchConflict("Patch removal precondition failed.", record.id)
    }
  }
  for (const update of patch.updated) {
    const current = store.get(update.id)
    if (
      current === undefined ||
      removedIds.has(update.id) ||
      current.typeName !== update.typeName ||
      !deepEqual(current, update.before)
    ) {
      return patchConflict("Patch update precondition failed.", update.id)
    }
  }
  for (const record of patch.created) {
    if (store.get(record.id) !== undefined) {
      return patchConflict("Patch creation precondition failed.", record.id)
    }
  }
  const createdPage = patch.created.find((record) => record.typeName === "page")
  if (createdPage !== undefined) {
    return patchConflict("Page creation is forbidden in a patch.", createdPage.id)
  }
  const removedPage = patch.removed.find((record) => store.get(record.id)?.typeName === "page")
  if (removedPage !== undefined) {
    return patchConflict("Page removal is forbidden in a patch.", removedPage.id)
  }
  for (const update of patch.updated) {
    if (update.after.id !== update.id || update.after.typeName !== update.typeName) {
      return patchConflict("Patch update identity is invalid.", update.id)
    }
  }
  try {
    const next = store.withAppliedChanges({
      removed: patch.removed.map((record) => record.id),
      replaced: patch.updated.map((update) => update.after),
      created: patch.created,
    })
    const diagnostics = validateRecords(cloneRecords(next))
    if (diagnostics.length > 0) return { ok: false, diagnostics }
    return { ok: true, value: next, diagnostics: [] }
  } catch (error) {
    return patchConflict(error instanceof Error ? error.message : "Patch application failed.")
  }
}

/** 对外 apply：History 与外部回放使用。 */
export function applyPatch(store: RecordStore, patch: TransactionPatch): PatchApplyResult {
  return applyTransactionPatch(store, patch)
}

/**
 * 执行原子事务。
 * execute 内抛 TransactionError 或任意 Error 都会回滚到入参 store。
 * 无业务变更时仍 ok:true，但 patch 为空（History 可忽略）。
 */
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
        if (draft.has(record.id)) {
          throw operationError("DUPLICATE_RECORD_ID", "Record id already exists.", record.id)
        }
        if (record.typeName === "page")
          throw operationError("PAGE_CREATE_FORBIDDEN", "Pages can only be initialized.", record.id)
        if (record.typeName === "document")
          throw operationError(
            "DOCUMENT_CREATE_FORBIDDEN",
            "Documents can only be initialized.",
            record.id,
          )
        try {
          validateRecordShape(record)
        } catch (error) {
          throw operationError(
            error instanceof Error ? error.message : "INVALID_RECORD_SHAPE",
            "Created record shape is invalid.",
            record.id,
          )
        }
        draft.set(record.id, structuredClone(record))
      },
      update(id, patch) {
        const current = draft.get(id)
        if (current === undefined) {
          throw operationError("MISSING_RECORD_ID", "Record id does not exist.", id)
        }
        const rawPatch = patch as Record<string, unknown>
        // 身份字段必须在类型层与运行时双重禁止
        for (const field of ["id", "typeName", "revision"] as const) {
          if (Object.prototype.hasOwnProperty.call(rawPatch, field)) {
            throw operationError(
              "INVALID_IDENTITY_PATCH",
              `Identity field ${field} cannot be updated in a transaction.`,
              id,
            )
          }
        }
        try {
          draft.set(id, updateRecord(current, patch))
        } catch (error) {
          throw operationError(
            error instanceof Error ? error.message : "INVALID_RECORD_SHAPE",
            "Record update was rejected.",
            id,
          )
        }
      },
      remove(id) {
        const current = draft.get(id)
        if (current === undefined) {
          throw operationError("MISSING_RECORD_ID", "Record id does not exist.", id)
        }
        if (current.typeName === "page") {
          throw operationError("PAGE_REMOVE_FORBIDDEN", "The root page cannot be removed.", id)
        }
        draft.delete(id)
      },
    })

    for (const record of before.values()) {
      if (record.typeName === "page" && draft.get(record.id)?.typeName !== "page") {
        throw new Error("PAGE_REMOVE_FORBIDDEN")
      }
    }
    assertNoPageCreation([...draft.values()].filter((record) => !before.has(record.id)))
    assertNoDocumentCreation([...draft.values()].filter((record) => !before.has(record.id)))

    const validation = validateRecords(draft)
    if (validation.length > 0) throw validationError(validation)

    const patch = buildPatch(before, draft)
    if (patch.created.length === 0 && patch.updated.length === 0 && patch.removed.length === 0) {
      return {
        ok: true,
        store,
        origin,
        patch,
        inverse: { created: [], updated: [], removed: [] },
        diagnostics: [],
      }
    }
    const applied = applyTransactionPatch(store, patch)
    if (!applied.ok) throw new TransactionError(applied.diagnostics)
    const next = applied.value
    // inverse：created↔removed 对调，updated 的 before/after 对调
    const inverse: TransactionPatch = {
      created: patch.removed.map((record) => structuredClone(record)),
      updated: patch.updated.map((update) => ({
        id: update.id,
        typeName: update.typeName,
        before: structuredClone(update.after),
        after: structuredClone(update.before),
      })),
      removed: patch.created.map((record) => structuredClone(record)),
    }

    return { ok: true, store: next, origin, patch, inverse, diagnostics: [] }
  } catch (error) {
    if (error instanceof TransactionError)
      return { ok: false, store, diagnostics: error.diagnostics }
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
