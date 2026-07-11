import type { PageDocument } from "./schema"
import type { RecordStore } from "./store"

export function canonicalizeDocument(store: RecordStore): PageDocument {
  const records = store.all()
  // oxlint-disable-next-line unicorn(no-array-sort) -- this is a fresh snapshot owned by the canonicalizer.
  records.sort((left, right) => left.id.localeCompare(right.id))
  const document = records.find((record) => record.typeName === "document")
  if (document?.typeName !== "document") throw new Error("DOCUMENT_RECORD_NOT_FOUND")
  return { schemaVersion: document.schemaVersion, rootPageId: document.rootPageId, records }
}
