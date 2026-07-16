/**
 * @module snapshot
 *
 * 将 RecordStore 导出为规范 `PageDocument`。
 *
 * 用途：golden 对比、operation log 的 before/after、宿主 save。
 * 规范约定：records 按 id 字典序排列，保证同一文档状态序列化稳定。
 */

import type { PageDocument } from "./schema"
import type { RecordStore } from "./store"

/**
 * 从当前 store 生成可序列化文档快照。
 * 缺少 document record 时抛错（装载/事务本应保证恰好一条 document）。
 */
export function canonicalizeDocument(store: RecordStore): PageDocument {
  const records = store.all()
  // oxlint-disable-next-line unicorn(no-array-sort) -- this is a fresh snapshot owned by the canonicalizer.
  records.sort((left, right) => left.id.localeCompare(right.id))
  const document = records.find((record) => record.typeName === "document")
  if (document?.typeName !== "document") throw new Error("DOCUMENT_RECORD_NOT_FOUND")
  return { schemaVersion: document.schemaVersion, rootPageId: document.rootPageId, records }
}
