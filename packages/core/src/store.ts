import type { PageDocument, PersistentRecord, RecordUpdatePatch } from "./schema"

const UPDATE_FIELDS: Record<PersistentRecord["typeName"], ReadonlySet<string>> = {
  document: new Set(),
  page: new Set(["name", "width", "height", "background", "overflow", "layout"]),
  node: new Set(["name", "parentId", "index", "layout", "visible", "locked", "props"]),
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
      records.set(record.id, structuredClone(record))
    }
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
    const update = structuredClone(patch) as Record<string, unknown>
    delete update.id
    delete update.typeName
    delete update.revision
    for (const field of Object.keys(update)) {
      if (!UPDATE_FIELDS[current.typeName].has(field)) {
        throw new Error(`INVALID_RECORD_PATCH_FIELD:${field}`)
      }
    }
    const updated = structuredClone({
      ...current,
      ...update,
      id: current.id,
      typeName: current.typeName,
      revision: current.revision + 1,
    }) as PersistentRecord
    const next = new Map(this.#records)
    next.set(id, updated)
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
