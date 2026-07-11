import type { PageDocument, PersistentRecord, RecordUpdatePatch } from "./schema"
import { deepEqual, validateNodeTree } from "./validation"

const UPDATE_FIELDS: Record<PersistentRecord["typeName"], ReadonlySet<string>> = {
  document: new Set(["rootPageId"]),
  page: new Set(["name", "width", "height", "background", "overflow", "layout"]),
  node: new Set(["name", "parentId", "index", "layout", "visible", "locked", "props"]),
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value)
}

function isFreeLayout(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false
  const layout = value as Record<string, unknown>
  return (
    layout.mode === "free" &&
    isFiniteNumber(layout.x) &&
    isFiniteNumber(layout.y) &&
    isFiniteNumber(layout.width) &&
    isFiniteNumber(layout.height)
  )
}

export function validateRecordShape(record: PersistentRecord): void {
  if (record.typeName !== "document" && record.typeName !== "page" && record.typeName !== "node") {
    throw new Error("UNKNOWN_RECORD_TYPE")
  }
  if (typeof record.id !== "string" || !Number.isInteger(record.revision)) {
    throw new Error("INVALID_RECORD_SHAPE")
  }
  if (record.typeName === "document") {
    if (record.schemaVersion !== 1 || typeof record.rootPageId !== "string") {
      throw new Error("INVALID_RECORD_SHAPE")
    }
    return
  }
  if (record.typeName === "page") {
    if (
      typeof record.name !== "string" ||
      !isFiniteNumber(record.width) ||
      !isFiniteNumber(record.height) ||
      typeof record.background !== "string" ||
      !["visible", "hidden", "scroll"].includes(record.overflow) ||
      record.layout === null ||
      typeof record.layout !== "object" ||
      Array.isArray(record.layout) ||
      record.layout.mode !== "free"
    ) {
      throw new Error("INVALID_RECORD_SHAPE")
    }
    return
  }
  if (
    record.nodeType !== "rectangle" ||
    typeof record.name !== "string" ||
    typeof record.parentId !== "string" ||
    typeof record.index !== "string" ||
    !isFreeLayout(record.layout) ||
    typeof record.visible !== "boolean" ||
    typeof record.locked !== "boolean" ||
    record.props === null ||
    typeof record.props !== "object" ||
    Array.isArray(record.props) ||
    typeof record.props.fill !== "string"
  ) {
    throw new Error("INVALID_RECORD_SHAPE")
  }
}

function sameBusinessValue(left: PersistentRecord, right: PersistentRecord): boolean {
  const leftValue = { ...left, id: undefined, typeName: undefined, revision: undefined }
  const rightValue = { ...right, id: undefined, typeName: undefined, revision: undefined }
  return deepEqual(leftValue, rightValue)
}

export function updateRecord(
  record: PersistentRecord,
  patch: Partial<PersistentRecord>,
): PersistentRecord {
  const update = structuredClone(patch) as Record<string, unknown>
  delete update.id
  delete update.typeName
  delete update.revision
  for (const field of Object.keys(update)) {
    if (!UPDATE_FIELDS[record.typeName].has(field)) {
      throw new Error(`INVALID_RECORD_PATCH_FIELD:${field}`)
    }
  }
  const updated = structuredClone({
    ...record,
    ...update,
    id: record.id,
    typeName: record.typeName,
    revision: record.revision,
  }) as PersistentRecord
  validateRecordShape(updated)
  if (sameBusinessValue(record, updated)) return structuredClone(record)
  updated.revision = record.revision + 1
  return updated
}

export class RecordStore {
  readonly revision: number
  readonly #records: ReadonlyMap<string, PersistentRecord>

  private constructor(records: ReadonlyMap<string, PersistentRecord>, revision: number) {
    this.#records = records
    this.revision = revision
  }

  static fromDocument(document: PageDocument): RecordStore {
    const records = new Map<string, PersistentRecord>()
    for (const record of document.records) {
      if (records.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
      validateRecordShape(record)
      records.set(record.id, structuredClone(record))
    }
    const documents = [...records.values()].filter((record) => record.typeName === "document")
    if (documents.length !== 1) throw new Error("DOCUMENT_COUNT_INVALID")
    const documentRecord = documents[0]!
    const rootPage = records.get(documentRecord.rootPageId)
    if (rootPage?.typeName !== "page") throw new Error("ROOT_PAGE_INVALID")
    const treeDiagnostics = validateNodeTree(records, documentRecord.rootPageId)
    if (treeDiagnostics.length > 0) throw new Error(treeDiagnostics[0]!.code)
    const pages = [...records.values()].filter((record) => record.typeName === "page")
    if (pages.length !== 1) throw new Error("PAGE_COUNT_INVALID")
    if (pages[0]!.id !== documentRecord.rootPageId) throw new Error("ROOT_PAGE_INVALID")
    return new RecordStore(records, 0)
  }

  get(id: string): PersistentRecord | undefined {
    const record = this.#records.get(id)
    return record === undefined ? undefined : structuredClone(record)
  }

  all(): PersistentRecord[] {
    return [...this.#records.values()].map((record) => structuredClone(record))
  }

  withCreated(record: PersistentRecord): RecordStore {
    return this.withCreatedMany([record])
  }

  withCreatedMany(records: readonly PersistentRecord[]): RecordStore {
    const next = new Map(this.#records)
    for (const record of records) {
      if (next.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
      next.set(record.id, structuredClone(record))
    }
    return new RecordStore(next, records.length === 0 ? this.revision : this.revision + 1)
  }

  withRemoved(id: string): RecordStore {
    return this.withRemovedMany([id])
  }

  withUpdated<T extends PersistentRecord["typeName"]>(
    id: string,
    patch: RecordUpdatePatch<T>,
  ): RecordStore {
    const current = this.#records.get(id)
    if (current === undefined) throw new Error("MISSING_RECORD_ID")
    const updated = updateRecord(current, patch)
    const next = new Map(this.#records)
    next.set(id, updated)
    return new RecordStore(next, this.revision + 1)
  }

  withAppliedChanges(input: {
    removed: readonly string[]
    replaced: readonly PersistentRecord[]
    created: readonly PersistentRecord[]
  }): RecordStore {
    const next = new Map(this.#records)
    for (const id of input.removed) {
      if (!next.has(id)) throw new Error("MISSING_RECORD_ID")
      next.delete(id)
    }
    for (const record of input.replaced) {
      const current = next.get(record.id)
      if (current === undefined) throw new Error("MISSING_RECORD_ID")
      if (current.typeName !== record.typeName) throw new Error("RECORD_TYPE_MISMATCH")
      next.set(record.id, structuredClone(record))
    }
    for (const record of input.created) {
      if (next.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
      next.set(record.id, structuredClone(record))
    }
    return new RecordStore(next, this.revision + 1)
  }

  withRemovedMany(ids: readonly string[]): RecordStore {
    for (const id of ids) {
      if (!this.#records.has(id)) throw new Error("MISSING_RECORD_ID")
    }

    const next = new Map(this.#records)
    for (const id of ids) next.delete(id)
    return new RecordStore(next, this.revision + 1)
  }
}
