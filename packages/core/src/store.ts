import type { EditorRecord, PageDocument } from "./schema"

export class RecordStore {
  readonly revision: number
  readonly #records: ReadonlyMap<string, EditorRecord>

  private constructor(records: ReadonlyMap<string, EditorRecord>, revision: number) {
    this.#records = records
    this.revision = revision
  }

  static fromDocument(document: PageDocument): RecordStore {
    const records = new Map<string, EditorRecord>()
    for (const record of document.records) {
      if (records.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
      records.set(record.id, structuredClone(record))
    }
    return new RecordStore(records, 0)
  }

  get(id: string): EditorRecord | undefined {
    const record = this.#records.get(id)
    return record === undefined ? undefined : structuredClone(record)
  }

  all(): EditorRecord[] {
    return [...this.#records.values()].map((record) => structuredClone(record))
  }

  withCreated(record: EditorRecord): RecordStore {
    return this.withCreatedMany([record])
  }

  withCreatedMany(records: readonly EditorRecord[]): RecordStore {
    const next = new Map(this.#records)
    for (const record of records) {
      if (next.has(record.id)) throw new Error("DUPLICATE_RECORD_ID")
      next.set(record.id, structuredClone(record))
    }
    return new RecordStore(next, records.length === 0 ? this.revision : this.revision + 1)
  }

  withRemoved(id: string): RecordStore {
    if (!this.#records.has(id)) throw new Error("MISSING_RECORD_ID")
    const next = new Map(this.#records)
    next.delete(id)
    return new RecordStore(next, this.revision + 1)
  }
}
